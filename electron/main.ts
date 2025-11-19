import { app, BrowserWindow, ipcMain, net } from 'electron';
import { spawn, exec, ChildProcess } from 'child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'fs';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import Store from 'electron-store';
import { randomUUID, createHash } from 'crypto';
import { getDb, initDb } from './lib/db.js';
import { verifyPassword, generateSalt, hashPassword, checkLoginRateLimit, recordFailedLogin, clearLoginAttempts } from './lib/auth.js';
import { deriveEncryptionKey, encryptPassword, decryptPassword } from './lib/encryption.js';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================================
// CONFIGURATION & TYPES
// ============================================================================

interface NoteData {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  alwaysOnTop?: boolean;
}

interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Vite configuration
process.env.APP_ROOT = path.join(__dirname, '..');
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL 
  ? path.join(process.env.APP_ROOT, 'public') 
  : RENDERER_DIST;

// Next.js server configuration
const isDev = process.env.NODE_ENV !== 'production';
const PORT = process.env.PORT || 3000;

// Initialize electron-store for persistent data
const store = new Store();

// Global variables
let mainWindow: BrowserWindow | null = null;
let stickyNoteWindows = new Map<string, BrowserWindow>();

// ============================================================================
// WEBSOCKET SERVER FOR BROWSER EXTENSION
// ============================================================================

const WS_PORT = 9876;
let wss: WebSocketServer | null = null;
let extensionClients: Set<WebSocket> = new Set();

// Permanent app ID for extension security (never changes)
let appId: string = '';
interface PairedClient {
  ws: WebSocket;
  paired: boolean;
}
let pairedClients: Map<WebSocket, boolean> = new Map();

// Rate limiting for WebSocket connections
interface RateLimit {
  attempts: number;
  lastAttempt: number;
  blockedUntil: number;
}
const wsRateLimits = new Map<WebSocket, RateLimit>();

function checkWsRateLimit(ws: WebSocket, action: 'pair' | 'credentials'): boolean {
  const now = Date.now();
  const limit = wsRateLimits.get(ws) || { attempts: 0, lastAttempt: now, blockedUntil: 0 };
  
  // Check if blocked
  if (limit.blockedUntil > now) {
    const waitTime = Math.ceil((limit.blockedUntil - now) / 1000);
    ws.send(JSON.stringify({ 
      type: 'error',
      message: `Too many attempts. Wait ${waitTime} seconds.`
    }));
    return false;
  }
  
  // Reset counter after 1 minute
  if (now - limit.lastAttempt > 60000) {
    limit.attempts = 0;
  }
  
  limit.attempts++;
  limit.lastAttempt = now;
  
  // Block after 5 pairing attempts or 20 credential requests per minute
  const maxAttempts = action === 'pair' ? 5 : 20;
  if (limit.attempts > maxAttempts) {
    limit.blockedUntil = now + (5 * 60 * 1000); // Block for 5 minutes
    wsRateLimits.set(ws, limit);
    ws.send(JSON.stringify({ 
      type: 'error',
      message: `Too many ${action} attempts. Blocked for 5 minutes.`
    }));
    return false;
  }
  
  wsRateLimits.set(ws, limit);
  return true;
}

function getOrCreateAppId(): string {
  // Check if app ID already exists in persistent storage
  const storedAppId = store.get('appId') as string | undefined;
  
  // MIGRATION: Upgrade old 12-char App IDs to 64-char (256-bit)
  if (storedAppId && storedAppId.length === 12) {
    console.log('[App] ⚠️ Found old 12-character App ID - upgrading to 256-bit for security');
    const upgradedAppId = (randomUUID() + randomUUID()).replace(/-/g, '').toUpperCase();
    store.set('appId', upgradedAppId);
    console.log('[App] ✅ App ID upgraded to 256-bit! Please re-pair your browser extension.');
    return upgradedAppId;
  }
  
  if (storedAppId && storedAppId.length === 64) {
    console.log('[App] Using existing 256-bit app ID');
    return storedAppId;
  }
  
  // Generate new permanent app ID with 256-bit entropy (64 hex chars)
  // Much stronger than previous 12-char (48-bit) version
  const newAppId = (randomUUID() + randomUUID()).replace(/-/g, '').toUpperCase();
  store.set('appId', newAppId);
  console.log('[App] Generated new permanent app ID (256-bit)');
  return newAppId;
}

function initWebSocketServer() {
  try {
    // Get or create permanent app ID
    appId = getOrCreateAppId();
    
    wss = new WebSocketServer({ port: WS_PORT });

    wss.on('listening', () => {
      console.log(`[WebSocket] Server started on port ${WS_PORT}`);
      console.log(`[WebSocket] 🔐 Permanent App ID: ${appId}`);
    });

    wss.on('connection', (ws: WebSocket) => {
      console.log('[WebSocket] Extension attempting connection...');
      extensionClients.add(ws);
      pairedClients.set(ws, false); // Not paired yet

      ws.on('message', async (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          console.log('[WebSocket] Received:', message.type);

          // Handle pairing with permanent app ID
          if (message.type === 'pair') {
            // Rate limit pairing attempts
            if (!checkWsRateLimit(ws, 'pair')) {
              return;
            }
            
            if (message.code === appId) {
              pairedClients.set(ws, true);
              // Clear rate limit on successful pairing
              wsRateLimits.delete(ws);
              ws.send(JSON.stringify({ 
                type: 'pair-success',
                message: 'Extension paired successfully',
                appId: appId
              }));
              console.log('[WebSocket] ✅ Extension paired successfully');
            } else {
              ws.send(JSON.stringify({ 
                type: 'pair-failed',
                message: 'Invalid app ID'
              }));
              console.log('[WebSocket] ❌ Invalid app ID');
            }
            return;
          }

          // Check if paired for all other messages
          if (!pairedClients.get(ws)) {
            ws.send(JSON.stringify({ 
              type: 'error',
              message: 'Not paired. Please pair with the app first.'
            }));
            return;
          }

          // Handle credential request
          if (message.type === 'request-credentials') {
            // Rate limit credential requests
            if (!checkWsRateLimit(ws, 'credentials')) {
              return;
            }
            
            console.log('[WebSocket] 📨 Credential request for:', message.url);
            await handleCredentialRequest(ws, message.url);
            return;
          }

          // Legacy: extension-connected confirmation
          if (message.type === 'extension-connected') {
            console.log('[WebSocket] Extension confirmed connection');
          }
        } catch (error) {
          console.error('[WebSocket] Error parsing message:', error);
        }
      });

      ws.on('close', () => {
        console.log('[WebSocket] Extension disconnected');
        extensionClients.delete(ws);
        pairedClients.delete(ws);
        wsRateLimits.delete(ws); // Clean up rate limit data
      });

      ws.on('error', (error) => {
        console.error('[WebSocket] Client error:', error);
        extensionClients.delete(ws);
        pairedClients.delete(ws);
        wsRateLimits.delete(ws); // Clean up rate limit data
      });
    });

    wss.on('error', (error) => {
      console.error('[WebSocket] Server error:', error);
    });
  } catch (error) {
    console.error('[WebSocket] Failed to start server:', error);
  }
}

// Handle credential request from extension
async function handleCredentialRequest(ws: WebSocket, requestUrl: string) {
  try {
    if (!activeSession) {
      ws.send(JSON.stringify({ 
        type: 'credentials-response',
        success: false,
        error: 'Not authenticated. Please log in to the app first.'
      }));
      return;
    }

    // Check if master password is available (user must unlock vault first)
    if (!activeSession.masterPassword) {
      ws.send(JSON.stringify({ 
        type: 'credentials-response',
        success: false,
        error: 'Vault locked. Please unlock your vault in the app first.'
      }));
      console.log('[WebSocket] ⚠️ Vault locked - user needs to unlock');
      return;
    }

    // Extract hostname from request URL
    let hostname = '';
    try {
      hostname = new URL(requestUrl.includes('://') ? requestUrl : 'https://' + requestUrl).hostname;
    } catch (e) {
      ws.send(JSON.stringify({ 
        type: 'credentials-response',
        success: false,
        error: 'Invalid URL'
      }));
      return;
    }

    console.log(`[WebSocket] Searching credentials for hostname: ${hostname}`);

    // Search for credentials matching this hostname
    const db = getDb();
    const credentials = db.prepare(`
      SELECT * FROM credentials 
      WHERE user_id = ? AND site_link LIKE ?
      ORDER BY created_at DESC
    `).all(activeSession.userId, `%${hostname}%`) as any[];

    if (credentials.length === 0) {
      ws.send(JSON.stringify({ 
        type: 'credentials-response',
        success: false,
        error: 'No credentials found for this site'
      }));
      console.log('[WebSocket] No credentials found');
      return;
    }

    // Use the most recent credential
    const credential = credentials[0];
    const encryptionKey = await deriveEncryptionKey(activeSession.masterPassword, activeSession.salt);
    const decryptedUsername = credential.username ? decryptPassword(credential.username, encryptionKey) : '';
    const decryptedPassword = decryptPassword(credential.password, encryptionKey);

    ws.send(JSON.stringify({ 
      type: 'credentials-response',
      success: true,
      url: requestUrl,
      username: decryptedUsername,
      password: decryptedPassword
    }));

    console.log('[WebSocket] ✅ Credentials sent to extension');
  } catch (error) {
    console.error('[WebSocket] Error handling credential request:', error);
    ws.send(JSON.stringify({ 
      type: 'credentials-response',
      success: false,
      error: 'Internal error'
    }));
  }
}

function sendToExtension(data: any) {
  const message = JSON.stringify(data);
  let sentCount = 0;

  extensionClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && pairedClients.get(client)) {
      client.send(message);
      sentCount++;
    }
  });

  console.log(`[WebSocket] Sent message to ${sentCount} paired extension(s)`);
  return sentCount > 0;
}

// ============================================================================
// NEXT.JS SERVER UTILITIES
// ============================================================================

const isPortInUse = (port: number): Promise<boolean> => {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port);
  });
};

const findAvailablePort = async (startPort: number): Promise<number> => {
  let port = startPort;
  while (await isPortInUse(port)) {
    console.log(`Port ${port} is in use, trying ${port + 1}...`);
    port++;
    if (port > startPort + 10) {
      throw new Error('Could not find an available port');
    }
  }
  return port;
};

const waitForNextServer = async (port: number, maxAttempts = 30): Promise<boolean> => {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await net.fetch(`http://localhost:${port}`);
      if (response.ok) {
        console.log('Next.js server is ready');
        return true;
      }
    } catch (e) {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
};

const killProcessOnPort = async (port: number): Promise<void> => {
  return new Promise((resolve) => {
    const killCommand = process.platform === 'win32' 
      ? `netstat -ano | findstr :${port} | findstr LISTENING`
      : `lsof -ti:${port}`;
    
    const killProcess = (pid: string) => process.platform === 'win32'
      ? `taskkill /PID ${pid} /F`
      : `kill -9 ${pid}`;

    exec(killCommand, (error, stdout) => {
      if (error || !stdout) {
        resolve();
        return;
      }
      
      const pid = process.platform === 'win32' 
        ? stdout.trim().split(/\s+/).pop()
        : stdout.trim();
      
      if (pid && pid !== process.pid.toString()) {
        exec(killProcess(pid), () => {
          console.log(`Killed process on port ${port}`);
          resolve();
        });
      } else {
        resolve();
      }
    });
  });
};

const startNextServer = async (): Promise<number> => {
  const availablePort = await findAvailablePort(Number(PORT));
  serverPort = availablePort;
  
  return new Promise((resolve, reject) => {
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    
    if (isDev) {
      // Development mode
      nextServer = spawn(npmCommand, ['run', 'dev', '--', '--port', availablePort.toString()], {
        shell: true,
        env: { ...process.env, PORT: availablePort.toString() },
        stdio: 'inherit',
        cwd: process.env.APP_ROOT
      });

      nextServer.on('error', (error) => {
        console.error('Failed to start Next.js server:', error);
        reject(error);
      });

      waitForNextServer(availablePort).then((ready) => {
        if (ready) {
          resolve(availablePort);
        } else {
          reject(new Error('Next.js server failed to start in time'));
        }
      });
    } else {
      // Production mode
      console.log('Building Next.js application...');
      exec('npm run build', { cwd: process.env.APP_ROOT }, (buildError) => {
        if (buildError) {
          console.error('Build failed:', buildError);
          reject(buildError);
          return;
        }
        
        console.log('Build completed. Starting production server...');
        nextServer = spawn(npmCommand, ['run', 'start', '--', '--port', availablePort.toString()], {
          shell: true,
          env: { ...process.env, PORT: availablePort.toString() },
          stdio: 'inherit',
          cwd: process.env.APP_ROOT
        });

        nextServer.on('error', (error) => {
          console.error('Failed to start Next.js server:', error);
          reject(error);
        });

        waitForNextServer(availablePort).then((ready) => {
          if (ready) {
            resolve(availablePort);
          } else {
            reject(new Error('Next.js server failed to start in time'));
          }
        });
      });
    }
  });
};

// ============================================================================
// WINDOW CREATION
// ============================================================================

const createWindow = async (): Promise<void> => {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    icon: path.join(process.env.VITE_PUBLIC!, 'favicon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.mjs'),
      webSecurity: !isDev
    },
    show: false
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    // Set zoom level to 67% (0.67 = 67%, 1.0 = 100%, 1.5 = 150%, etc.)
    mainWindow?.webContents.setZoomFactor(0.67);
  });

  // Test active push message to Renderer-process
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.send('main-process-message', new Date().toLocaleString());
  });

  // Load from Vite dev server or built files
  if (VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }

  // if (isDev) {
  //   mainWindow.webContents.openDevTools();
  // }

  // Clear session when window is about to close
  mainWindow.on('close', (event) => {
    // Clear ONLY the master password from memory (not the user authentication)
    if (activeSession) {
      activeSession.masterPassword = undefined;
      activeSession.encryptionKey = undefined;
    }
    // Send message to renderer to clear sessionStorage (clears master password)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('clear-session-storage');
    }
    console.log('Window closing - cleared master password from session');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

const createStickyNoteWindow = (noteId: string, noteData: NoteData = {}): BrowserWindow | undefined => {
  console.log('Creating sticky note window for note:', noteId);

  // Check if window already exists
  if (stickyNoteWindows.has(noteId)) {
    const existingWindow = stickyNoteWindows.get(noteId);
    if (existingWindow && !existingWindow.isDestroyed()) {
      existingWindow.focus();
      return;
    }
  }

  // Create new sticky note window
  const noteWindow = new BrowserWindow({
    width: noteData.width || 300,
    height: noteData.height || 400,
    x: noteData.x,
    y: noteData.y,
    minWidth: 300,
    minHeight: 200,
    frame: false,
    alwaysOnTop: noteData.alwaysOnTop !== false,
    skipTaskbar: false,
    resizable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.mjs'),
      webSecurity: !isDev
    },
    backgroundColor: '#30302E',
    show: false
  });

  // Store window reference
  stickyNoteWindows.set(noteId, noteWindow);

  // Show when ready
  noteWindow.once('ready-to-show', () => {
    noteWindow.show();
  });

  // Load the sticky note page
  const noteUrl = VITE_DEV_SERVER_URL 
    ? `${VITE_DEV_SERVER_URL}#/sticky-note/${noteId}`
    : `file://${path.join(RENDERER_DIST, 'index.html')}#/sticky-note/${noteId}`;
  
  console.log('Loading sticky note URL:', noteUrl);
  
  if (VITE_DEV_SERVER_URL) {
    noteWindow.loadURL(noteUrl);
  } else {
    noteWindow.loadFile(path.join(RENDERER_DIST, 'index.html'), {
      hash: `/sticky-note/${noteId}`
    });
  }

  // Open DevTools in development
  // if (isDev) {
  //   noteWindow.webContents.openDevTools();
  // }

  // Save window position and size when moved or resized
  const saveWindowBounds = () => {
    if (!noteWindow.isDestroyed()) {
      const bounds = noteWindow.getBounds();
      noteWindow.webContents.send('window-bounds-changed', bounds);
    }
  };

  noteWindow.on('resize', saveWindowBounds);
  noteWindow.on('move', saveWindowBounds);

  // Cleanup on close
  noteWindow.on('closed', () => {
    stickyNoteWindows.delete(noteId);
    console.log('Sticky note window closed:', noteId);
  });

  return noteWindow;
};

// ============================================================================
// IPC HANDLERS
// ============================================================================

// Window control handlers for main window
ipcMain.on('window-minimize', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.restore();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) {
    mainWindow.close();
  }
});

// Sticky note window handlers
ipcMain.on('sticky-note-minimize', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window) {
    window.minimize();
  }
});

ipcMain.on('sticky-note-close', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window) {
    window.close();
  }
});

ipcMain.on('sticky-note-toggle-always-on-top', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window) {
    const isAlwaysOnTop = window.isAlwaysOnTop();
    window.setAlwaysOnTop(!isAlwaysOnTop);
    event.reply('sticky-note-always-on-top-changed', !isAlwaysOnTop);
  }
});

// Create/Open sticky note window
ipcMain.on('open-sticky-note', (event, noteId: string, noteData: NoteData) => {
  console.log('Received open-sticky-note request:', noteId);
  createStickyNoteWindow(noteId, noteData);
});

// Close specific sticky note window
ipcMain.on('close-sticky-note-window', (event, noteId: string) => {
  if (stickyNoteWindows.has(noteId)) {
    const window = stickyNoteWindows.get(noteId);
    if (window && !window.isDestroyed()) {
      window.close();
    }
    stickyNoteWindows.delete(noteId);
  }
});

// Get window bounds
ipcMain.handle('get-window-bounds', (event): WindowBounds | null => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window) {
    return window.getBounds();
  }
  return null;
});

// Get extension app ID (permanent)
ipcMain.handle('get-app-id', () => {
  return { success: true, appId: appId };
});

// Open URL in specific browser with auto-fill credentials
ipcMain.handle('open-in-browser', async (event, url: string, browser: 'chrome' | 'brave' | 'edge', credentialId?: number) => {
  console.log(`Opening ${url} in ${browser}`);

  try {
    const browserPaths: { [key: string]: string[] } = {
      'chrome': [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
      ],
      'brave': [
        'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
        'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
      ],
      'edge': [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
      ]
    };

    const paths = browserPaths[browser];

    // Find the first existing browser path
    let browserPath: string | null = null;
    for (const p of paths) {
      if (fs.existsSync(p)) {
        browserPath = p;
        break;
      }
    }

    if (!browserPath) {
      console.error(`${browser} not found in any of the expected locations`);
      return { success: false, error: `${browser} not found` };
    }

    // If credentialId is provided, fetch and send credentials to extension
    if (credentialId && activeSession) {
      try {
        console.log(`[Auto-Fill] Credential ID: ${credentialId}, Session User: ${activeSession.userId}`);

        if (!activeSession.masterPassword) {
          console.error('[Auto-Fill] ❌ Master password not in memory! User needs to enter it first.');
          console.error('[Auto-Fill] Tip: View or edit a credential in the app to load master password into memory.');
          // Browser will still open, but without auto-fill
          return new Promise((resolve, reject) => {
            exec(`"${browserPath}" "${url}"`, (error) => {
              if (error) {
                console.error(`Failed to open ${browser}:`, error);
                reject({ success: false, error: `Failed to launch ${browser}` });
              } else {
                console.log(`Successfully opened ${url} in ${browser}`);
                resolve({ success: true, warning: 'Master password not available for auto-fill' });
              }
            });
          });
        }

        const db = getDb();
        const credential: any = db.prepare('SELECT * FROM credentials WHERE id = ? AND user_id = ?')
          .get(credentialId, activeSession.userId);

        console.log(`[Auto-Fill] Credential found: ${credential ? 'Yes' : 'No'}`);

        if (credential) {
          // Derive encryption key and decrypt credentials
          console.log('[Auto-Fill] Decrypting credentials...');
          const encryptionKey = await deriveEncryptionKey(activeSession.masterPassword, activeSession.salt);
          const decryptedUsername = credential.username ? decryptPassword(credential.username, encryptionKey) : '';
          const decryptedPassword = decryptPassword(credential.password, encryptionKey);

          console.log(`[Auto-Fill] Decrypted - Username: ${decryptedUsername ? 'Yes' : 'No'}, Password: ${decryptedPassword ? 'Yes' : 'No'}`);

          // Send credentials to browser extension via WebSocket
          // autoClick: true indicates this was opened from the app, so auto-click login button
          const sent = sendToExtension({
            type: 'credentials',
            url: url,
            username: decryptedUsername,
            password: decryptedPassword,
            autoClick: true  // Enable auto-click for app-launched pages
          });

          if (sent) {
            console.log('[WebSocket] ✅ Credentials sent to extension');
          } else {
            console.warn('[WebSocket] ⚠️ No extension connected to receive credentials');
          }
        } else {
          console.error('[Auto-Fill] ❌ Credential not found in database');
        }
      } catch (error) {
        console.error('[Auto-Fill] ❌ Error processing credentials:', error);
      }
    } else if (credentialId && !activeSession) {
      console.error('[Auto-Fill] ❌ No active session!');
    }

    return new Promise((resolve, reject) => {
      // Launch browser directly with the URL
      exec(`"${browserPath}" "${url}"`, (error) => {
        if (error) {
          console.error(`Failed to open ${browser}:`, error);
          reject({ success: false, error: `Failed to launch ${browser}` });
        } else {
          console.log(`Successfully opened ${url} in ${browser}`);
          resolve({ success: true });
        }
      });
    });
  } catch (error) {
    console.error('Browser launch error:', error);
    return { success: false, error: 'Failed to launch browser' };
  }
});

// IPC handlers for other messages
ipcMain.on('app-message', (event, arg) => {
  console.log('Received message from renderer:', arg);
  event.reply('app-reply', 'Message received');
});

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================
interface UserSession {
  userId: number;
  username: string;
  salt: string;
  masterPassword?: string;
  encryptionKey?: Buffer;
}

interface PersistedSession {
  id: number;
  username: string;
  salt: string;
  expiresAt: number;
  deviceId: string;
}

let activeSession: UserSession | null = null;

// Generate device fingerprint for session binding
function getDeviceFingerprint(): string {
  const deviceInfo = `${os.hostname()}-${os.platform()}-${os.arch()}-${os.userInfo().username}`;
  return createHash('sha256').update(deviceInfo).digest('hex').substring(0, 32);
}

// ============================================================================
// API IPC HANDLERS - AUTH
// ============================================================================

// Signup
ipcMain.handle('auth:signup', async (event, { username, password }) => {
  try {
    const db = getDb();
    
    // Check if user exists
    const existingUser = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (existingUser) {
      return { success: false, error: 'Username already exists' };
    }

    // Generate salt and hash password
    const salt = generateSalt();
    const hashedPassword = hashPassword(password, salt);

    // Insert user
    const result = db.prepare(
      'INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)'
    ).run(username, hashedPassword, salt);

    return {
      success: true,
      user: {
        id: result.lastInsertRowid,
        username,
        salt
      }
    };
  } catch (error: any) {
    console.error('Signup error:', error);
    return { success: false, error: error.message || 'Signup failed' };
  }
});

// Login
ipcMain.handle('auth:login', async (event, { username, password }) => {
  try {
    // Check rate limit first
    const rateLimit = checkLoginRateLimit(username);
    if (rateLimit.isBlocked) {
      return { 
        success: false, 
        error: `Too many failed login attempts. Please wait ${rateLimit.waitTime} seconds.` 
      };
    }
    
    const db = getDb();
    
    // Get user
    const user: any = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      recordFailedLogin(username);
      return { 
        success: false, 
        error: 'Invalid username or password',
        attemptsRemaining: Math.max(0, 5 - (rateLimit.attemptsRemaining - 1))
      };
    }

    // Verify password
    const isValid = verifyPassword(password, user.salt, user.password_hash);
    if (!isValid) {
      recordFailedLogin(username);
      const updatedLimit = checkLoginRateLimit(username);
      return { 
        success: false, 
        error: 'Invalid username or password',
        attemptsRemaining: updatedLimit.attemptsRemaining
      };
    }

    // Clear failed login attempts on successful login
    clearLoginAttempts(username);

    // Store session in memory (for current session)
    activeSession = {
      userId: user.id,
      username: user.username,
      salt: user.salt,
      masterPassword: password
    };
    
    // Persist user authentication to disk with expiration and device binding
    const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 days
    const deviceId = getDeviceFingerprint();
    
    store.set('user', {
      id: user.id,
      username: user.username,
      salt: user.salt,
      expiresAt,
      deviceId
    } as PersistedSession);
    
    console.log('User authenticated and persisted (expires in 30 days):', username);

    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        salt: user.salt
      }
    };
  } catch (error: any) {
    console.error('Login error:', error);
    return { success: false, error: error.message || 'Login failed' };
  }
});

// Verify (check if session exists - check both memory and persistent storage)
ipcMain.handle('auth:verify', async (event) => {
  // First check active session in memory
  if (activeSession) {
    return {
      success: true,
      user: {
        id: activeSession.userId,
        username: activeSession.username,
        salt: activeSession.salt
      }
    };
  }
  
  // If no active session, check if user is persisted (logged in before)
  const persistedUser = store.get('user') as PersistedSession | undefined;
  if (persistedUser) {
    console.log('Found persisted user, verifying session:', persistedUser.username);
    
    const now = Date.now();
    
    // Check session expiration
    if (persistedUser.expiresAt && persistedUser.expiresAt < now) {
      console.log('Session expired, clearing');
      store.delete('user');
      return { success: false, error: 'Session expired. Please log in again.' };
    }
    
    // Check device binding
    const currentDeviceId = getDeviceFingerprint();
    if (persistedUser.deviceId && persistedUser.deviceId !== currentDeviceId) {
      console.log('Device mismatch, clearing session');
      store.delete('user');
      return { success: false, error: 'Session invalid on this device. Please log in again.' };
    }

    // Verify the user actually exists in the database
    try {
      const db = getDb();
      const userInDb = db.prepare('SELECT id, username, salt FROM users WHERE id = ?').get(persistedUser.id);

      if (userInDb) {
        // User exists in database, restore session
        console.log('User verified in database, restoring session');
        activeSession = {
          userId: persistedUser.id,
          username: persistedUser.username,
          salt: persistedUser.salt
        };
        return {
          success: true,
          user: {
            id: persistedUser.id,
            username: persistedUser.username,
            salt: persistedUser.salt
          }
        };
      } else {
        // User doesn't exist in database, clear persisted session
        console.log('User not found in database, clearing persisted session');
        store.delete('user');
        activeSession = null;
        return { success: false, error: 'Session expired or user not found' };
      }
    } catch (error) {
      console.error('Error verifying persisted user:', error);
      store.delete('user');
      activeSession = null;
      return { success: false, error: 'Not authenticated' };
    }
  }
  
  return { success: false, error: 'Not authenticated' };
});

// Logout
ipcMain.handle('auth:logout', async (event) => {
  activeSession = null;
  // Clear persisted user on logout
  store.delete('user');
  console.log('User logged out and session cleared');
  return { success: true };
});

// ============================================================================
// API IPC HANDLERS - CREDENTIALS
// ============================================================================

// Get all credentials
ipcMain.handle('credentials:fetch', async (event, { masterPassword, categoryId, search }) => {
  try {
    if (!activeSession) {
      return { success: false, error: 'Not authenticated' };
    }

    // Derive encryption key from master password
    const encryptionKey = await deriveEncryptionKey(masterPassword, activeSession.salt);

    const db = getDb();
    let query = `
      SELECT 
        c.*,
        cat.name as category_name,
        cat.color as category_color
      FROM credentials c
      LEFT JOIN categories cat ON c.category_id = cat.id
      WHERE c.user_id = ?
    `;
    const params: any[] = [activeSession.userId];

    if (categoryId !== undefined && categoryId !== null) {
      query += ' AND c.category_id = ?';
      params.push(categoryId);
    }

    if (search) {
      query += ' AND (c.title LIKE ? OR c.description LIKE ? OR c.site_link LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    query += ' ORDER BY c.created_at DESC';

    const credentials = db.prepare(query).all(...params) as any[];

    // Decrypt passwords
    const decryptedCredentials = credentials.map(cred => ({
      ...cred,
      password: decryptPassword(cred.password, encryptionKey),
      username: cred.username ? decryptPassword(cred.username, encryptionKey) : ''
    }));

    // IMPORTANT: Store master password in active session for autofill
    // This enables browser extension autofill without prompting again
    if (!activeSession.masterPassword) {
      activeSession.masterPassword = masterPassword;
      console.log('[Session] Master password loaded into memory for autofill');
    }

    return { success: true, credentials: decryptedCredentials };
  } catch (error: any) {
    console.error('Fetch credentials error:', error);
    return { success: false, error: error.message || 'Failed to fetch credentials' };
  }
});

// Create credential
ipcMain.handle('credentials:create', async (event, data) => {
  try {
    if (!activeSession) {
      return { success: false, error: 'Not authenticated' };
    }

    const { masterPassword, title, siteLink, username, password, description, categoryId } = data;

    // Derive encryption key
    const encryptionKey = await deriveEncryptionKey(masterPassword, activeSession.salt);

    // Encrypt sensitive data
    const encryptedPassword = encryptPassword(password, encryptionKey);
    const encryptedUsername = username ? encryptPassword(username, encryptionKey) : '';

    const db = getDb();
    const result = db.prepare(`
      INSERT INTO credentials (user_id, category_id, title, site_link, username, password, description)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      activeSession.userId,
      categoryId || null,
      title,
      siteLink || '',
      encryptedUsername,
      encryptedPassword,
      description || ''
    );

    return { success: true, id: result.lastInsertRowid };
  } catch (error: any) {
    console.error('Create credential error:', error);
    return { success: false, error: error.message || 'Failed to create credential' };
  }
});

// Update credential
ipcMain.handle('credentials:update', async (event, data) => {
  try {
    if (!activeSession) {
      return { success: false, error: 'Not authenticated' };
    }

    const { id, masterPassword, title, siteLink, username, password, description, categoryId } = data;

    // Derive encryption key
    const encryptionKey = await deriveEncryptionKey(masterPassword, activeSession.salt);

    // Encrypt sensitive data
    const encryptedPassword = encryptPassword(password, encryptionKey);
    const encryptedUsername = username ? encryptPassword(username, encryptionKey) : '';

    const db = getDb();
    db.prepare(`
      UPDATE credentials 
      SET category_id = ?, title = ?, site_link = ?, username = ?, password = ?, description = ?
      WHERE id = ? AND user_id = ?
    `).run(
      categoryId || null,
      title,
      siteLink || '',
      encryptedUsername,
      encryptedPassword,
      description || '',
      id,
      activeSession.userId
    );

    return { success: true };
  } catch (error: any) {
    console.error('Update credential error:', error);
    return { success: false, error: error.message || 'Failed to update credential' };
  }
});

// Delete credential
ipcMain.handle('credentials:delete', async (event, { id }) => {
  try {
    if (!activeSession) {
      return { success: false, error: 'Not authenticated' };
    }

    const db = getDb();
    db.prepare('DELETE FROM credentials WHERE id = ? AND user_id = ?').run(id, activeSession.userId);

    return { success: true };
  } catch (error: any) {
    console.error('Delete credential error:', error);
    return { success: false, error: error.message || 'Failed to delete credential' };
  }
});

// ============================================================================
// API IPC HANDLERS - CATEGORIES
// ============================================================================

// Get all categories
ipcMain.handle('categories:fetch', async (event) => {
  try {
    if (!activeSession) {
      return { success: false, error: 'Not authenticated' };
    }

    const db = getDb();
    const categories = db.prepare(`
      SELECT * FROM categories WHERE user_id = ? ORDER BY name ASC
    `).all(activeSession.userId);

    return { success: true, categories };
  } catch (error: any) {
    console.error('Fetch categories error:', error);
    return { success: false, error: error.message || 'Failed to fetch categories' };
  }
});

// Create category
ipcMain.handle('categories:create', async (event, { name, color }) => {
  try {
    if (!activeSession) {
      return { success: false, error: 'Not authenticated' };
    }

    const db = getDb();
    const result = db.prepare(`
      INSERT INTO categories (user_id, name, color) VALUES (?, ?, ?)
    `).run(activeSession.userId, name, color || '#D97757');

    return { success: true, id: result.lastInsertRowid };
  } catch (error: any) {
    console.error('Create category error:', error);
    return { success: false, error: error.message || 'Failed to create category' };
  }
});

// Update category
ipcMain.handle('categories:update', async (event, { id, name, color }) => {
  try {
    if (!activeSession) {
      return { success: false, error: 'Not authenticated' };
    }

    const db = getDb();
    db.prepare(`
      UPDATE categories 
      SET name = ?, color = ?
      WHERE id = ? AND user_id = ?
    `).run(name, color || '#D97757', id, activeSession.userId);

    return { success: true };
  } catch (error: any) {
    console.error('Update category error:', error);
    return { success: false, error: error.message || 'Failed to update category' };
  }
});

// Delete category
ipcMain.handle('categories:delete', async (event, { id }) => {
  try {
    if (!activeSession) {
      return { success: false, error: 'Not authenticated' };
    }

    const db = getDb();
    db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').run(id, activeSession.userId);

    return { success: true };
  } catch (error: any) {
    console.error('Delete category error:', error);
    return { success: false, error: error.message || 'Failed to delete category' };
  }
});

// ============================================================================
// API IPC HANDLERS - NOTES
// ============================================================================

// Get all notes
ipcMain.handle('notes:fetch', async (event) => {
  try {
    if (!activeSession) {
      return { success: false, error: 'Not authenticated' };
    }

    const db = getDb();
    const notes = db.prepare(`
      SELECT * FROM notes WHERE user_id = ? ORDER BY updated_at DESC
    `).all(activeSession.userId);

    return { success: true, notes };
  } catch (error: any) {
    console.error('Fetch notes error:', error);
    return { success: false, error: error.message || 'Failed to fetch notes' };
  }
});

// Create note
ipcMain.handle('notes:create', async (event, { title, content, color }) => {
  try {
    if (!activeSession) {
      return { success: false, error: 'Not authenticated' };
    }

    const db = getDb();
    const result = db.prepare(`
      INSERT INTO notes (user_id, title, content, color)
      VALUES (?, ?, ?, ?)
    `).run(activeSession.userId, title, content || '', color || '#fbbf24');

    return { success: true, id: result.lastInsertRowid };
  } catch (error: any) {
    console.error('Create note error:', error);
    return { success: false, error: error.message || 'Failed to create note' };
  }
});

// Update note
ipcMain.handle('notes:update', async (event, { id, title, content, color, position_x, position_y, width, height }) => {
  try {
    if (!activeSession) {
      return { success: false, error: 'Not authenticated' };
    }

    const db = getDb();
    
    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];

    if (title !== undefined) {
      updates.push('title = ?');
      values.push(title);
    }
    if (content !== undefined) {
      updates.push('content = ?');
      values.push(content);
    }
    if (color !== undefined) {
      updates.push('color = ?');
      values.push(color);
    }
    if (position_x !== undefined) {
      updates.push('position_x = ?');
      values.push(position_x);
    }
    if (position_y !== undefined) {
      updates.push('position_y = ?');
      values.push(position_y);
    }
    if (width !== undefined) {
      updates.push('width = ?');
      values.push(width);
    }
    if (height !== undefined) {
      updates.push('height = ?');
      values.push(height);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id, activeSession.userId);

    db.prepare(`
      UPDATE notes SET ${updates.join(', ')}
      WHERE id = ? AND user_id = ?
    `).run(...values);

    return { success: true };
  } catch (error: any) {
    console.error('Update note error:', error);
    return { success: false, error: error.message || 'Failed to update note' };
  }
});

// Delete note
ipcMain.handle('notes:delete', async (event, { id }) => {
  try {
    if (!activeSession) {
      return { success: false, error: 'Not authenticated' };
    }

    const db = getDb();
    db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run(id, activeSession.userId);

    return { success: true };
  } catch (error: any) {
    console.error('Delete note error:', error);
    return { success: false, error: error.message || 'Failed to delete note' };
  }
});

// ============================================================================
// APP EVENT HANDLERS
// ============================================================================

app.whenReady().then(async () => {
  try {
    // Initialize database
    console.log('Initializing database...');
    initDb();
    console.log('Database initialized');

    // Initialize WebSocket server for browser extension
    initWebSocketServer();

    // Create main window
    await createWindow();
  } catch (error) {
    console.error('Failed to start application:', error);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createWindow();
  }
});

app.on('before-quit', () => {
  // Close all sticky note windows
  stickyNoteWindows.forEach((window) => {
    if (!window.isDestroyed()) {
      window.close();
    }
  });
  stickyNoteWindows.clear();

  // Close WebSocket server
  if (wss) {
    console.log('[WebSocket] Closing server...');
    extensionClients.forEach((client) => {
      client.close();
    });
    extensionClients.clear();
    wss.close();
  }
});

// Handle process termination
process.on('SIGINT', () => {
  process.exit();
});

process.on('SIGTERM', () => {
  process.exit();
});