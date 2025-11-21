import { app, BrowserWindow, ipcMain, net } from 'electron';
import { spawn, exec, ChildProcess } from 'child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'fs';
import { config } from 'dotenv';

// Load environment variables from .env file
config();
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import Store from 'electron-store';
import { randomUUID, createHash } from 'crypto';
import { getDb, initDb } from './lib/db.js';
import { verifyPassword, generateSalt, hashPassword, checkLoginRateLimit, recordFailedLogin, clearLoginAttempts } from './lib/auth.js';
import { deriveEncryptionKey, encryptPassword, decryptPassword } from './lib/encryption.js';
import os from 'os';
import { autoUpdater } from 'electron-updater';

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
// AUTO-UPDATER CONFIGURATION
// ============================================================================

function setupAutoUpdater() {
  // Configure auto-updater
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // Set GitHub provider explicitly
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'PawanOzha',
    repo: 'Upgradeable-Vault-app'
  });

  // Log current version
  console.log('[AutoUpdater] Current app version:', app.getVersion());

  // Log update events
  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater] Checking for updates...');
    sendUpdateStatus('checking-for-update');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[AutoUpdater] Update available:', info.version);
    sendUpdateStatus('update-available', info);
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('[AutoUpdater] No updates available');
    sendUpdateStatus('update-not-available', info);
  });

  autoUpdater.on('download-progress', (progress) => {
    console.log(`[AutoUpdater] Download progress: ${progress.percent.toFixed(2)}%`);
    sendUpdateStatus('download-progress', progress);
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[AutoUpdater] Update downloaded:', info.version);
    sendUpdateStatus('update-downloaded', info);
    // Update notification is handled by the custom UI in App.tsx
  });

  autoUpdater.on('error', (error) => {
    console.error('[AutoUpdater] Error:', error);
    sendUpdateStatus('error', { message: error.message });
  });

  // Periodic update check (every 6 hours)
  setInterval(() => {
    console.log('[AutoUpdater] Periodic update check running...');
    autoUpdater.checkForUpdates().catch(err => {
      console.error('[AutoUpdater] Periodic check failed:', err);
    });
  }, 6 * 60 * 60 * 1000); // 6 hours
}

function sendUpdateStatus(status: string, data?: any) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status, data });
  }
}

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
  sessionKey?: string;  // Unique encryption key per session
}
let pairedClients: Map<WebSocket, { paired: boolean; sessionKey?: string }> = new Map();

// Generate a session key for encrypted communication
function generateSessionKey(): string {
  return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
}

// Simple XOR encryption for WebSocket transport (not cryptographically strong but adds obfuscation layer)
// The session key changes per connection, preventing replay attacks
function encryptForTransport(data: string, sessionKey: string): string {
  const keyBytes = Buffer.from(sessionKey, 'hex');
  const dataBytes = Buffer.from(data, 'utf8');
  const encrypted = Buffer.alloc(dataBytes.length);

  for (let i = 0; i < dataBytes.length; i++) {
    encrypted[i] = dataBytes[i] ^ keyBytes[i % keyBytes.length];
  }

  return encrypted.toString('base64');
}

function decryptFromTransport(encryptedData: string, sessionKey: string): string {
  const keyBytes = Buffer.from(sessionKey, 'hex');
  const dataBytes = Buffer.from(encryptedData, 'base64');
  const decrypted = Buffer.alloc(dataBytes.length);

  for (let i = 0; i < dataBytes.length; i++) {
    decrypted[i] = dataBytes[i] ^ keyBytes[i % keyBytes.length];
  }

  return decrypted.toString('utf8');
}

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
    
    // Bind to localhost only for security - prevents external network access
    wss = new WebSocketServer({ port: WS_PORT, host: '127.0.0.1' });

    wss.on('listening', () => {
      console.log(`[WebSocket] Server started on port ${WS_PORT}`);
      console.log(`[WebSocket] 🔐 Permanent App ID: ${appId}`);
    });

    wss.on('connection', (ws: WebSocket) => {
      console.log('[WebSocket] Extension attempting connection...');
      extensionClients.add(ws);
      pairedClients.set(ws, { paired: false }); // Not paired yet

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
              // Generate unique session key for encrypted communication
              const sessionKey = generateSessionKey();
              pairedClients.set(ws, { paired: true, sessionKey });
              // Clear rate limit on successful pairing
              wsRateLimits.delete(ws);
              ws.send(JSON.stringify({
                type: 'pair-success',
                message: 'Extension paired successfully',
                sessionKey: sessionKey  // Send session key to extension for encrypted comms
              }));
              console.log('[WebSocket] ✅ Extension paired successfully with encrypted session');
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
          const clientInfo = pairedClients.get(ws);
          if (!clientInfo || !clientInfo.paired) {
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
    const encryptionKey = deriveEncryptionKey(activeSession.masterPassword, activeSession.salt);
    const decryptedUsername = credential.username ? decryptPassword(credential.username, encryptionKey) : '';
    const decryptedPassword = decryptPassword(credential.password, encryptionKey);

    // Get session key for encrypted transport
    const clientInfo = pairedClients.get(ws);
    if (clientInfo && clientInfo.sessionKey) {
      // Encrypt credentials for transport
      const encryptedUsername = encryptForTransport(decryptedUsername, clientInfo.sessionKey);
      const encryptedPassword = encryptForTransport(decryptedPassword, clientInfo.sessionKey);

      ws.send(JSON.stringify({
        type: 'credentials-response',
        success: true,
        url: requestUrl,
        username: encryptedUsername,
        password: encryptedPassword,
        encrypted: true  // Flag to indicate credentials are encrypted
      }));
    } else {
      // Fallback for legacy clients (should not happen)
      ws.send(JSON.stringify({
        type: 'credentials-response',
        success: true,
        url: requestUrl,
        username: decryptedUsername,
        password: decryptedPassword,
        encrypted: false
      }));
    }

    console.log('[WebSocket] ✅ Encrypted credentials sent to extension');
  } catch (error) {
    console.error('[WebSocket] Error handling credential request:', error);
    ws.send(JSON.stringify({
      type: 'credentials-response',
      success: false,
      error: 'Internal error'
    }));
  }
}

// ============================================================================
// PASSWORD SYNC - Poll Connector API for pending password changes
// ============================================================================

// Configuration for Connector API polling
const CONNECTOR_API_NGROK_URL = 'https://nonfermenting-kamdyn-expressable.ngrok-free.dev';
const VAULT_API_KEY = 'vault-secure-key-2024';
let syncPollingInterval: NodeJS.Timeout | null = null;
const SYNC_POLL_INTERVAL = 30000; // Poll every 30 seconds

// Get all emails from user's credentials for polling (DECRYPTED)
function getAllUserEmails(): string[] {
  if (!activeSession || !activeSession.masterPassword) return [];

  try {
    const db = getDb();
    const credentials = db.prepare(`
      SELECT DISTINCT username FROM credentials WHERE user_id = ?
    `).all(activeSession.userId) as any[];

    // Decrypt usernames before sending to API
    const encryptionKey = deriveEncryptionKey(activeSession.masterPassword, activeSession.salt);

    const decryptedEmails: string[] = [];
    for (const cred of credentials) {
      if (cred.username) {
        try {
          const decrypted = decryptPassword(cred.username, encryptionKey);
          if (decrypted) {
            decryptedEmails.push(decrypted);
          }
        } catch (e) {
          // Skip if decryption fails
          console.error('[PasswordSync] Failed to decrypt username:', e);
        }
      }
    }

    return decryptedEmails.filter(Boolean);
  } catch (error) {
    console.error('[PasswordSync] Error getting emails:', error);
    return [];
  }
}

// Poll Connector API for pending password changes
async function pollForPendingPasswordChanges() {
  if (!activeSession || !activeSession.masterPassword) {
    console.log('[PasswordSync] Skipping poll - not logged in or vault locked');
    return;
  }

  const emails = getAllUserEmails();
  if (emails.length === 0) {
    console.log('[PasswordSync] No emails in vault to check');
    return;
  }

  try {
    console.log(`[PasswordSync] Polling API for ${emails.length} emails:`, emails);

    // Call Connector API to check for pending changes
    const response = await fetch(`${CONNECTOR_API_NGROK_URL}/api/vault/check-pending`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Vault-Key': VAULT_API_KEY,
        'ngrok-skip-browser-warning': 'true'
      },
      body: JSON.stringify({ emails })
    });

    console.log(`[PasswordSync] API response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[PasswordSync] API error: ${response.status} - ${errorText}`);
      return;
    }

    const data = await response.json();
    console.log(`[PasswordSync] API returned: ${data.count} pending changes`);

    if (data.count === 0) {
      console.log('[PasswordSync] No pending changes for our emails');
      return;
    }

    console.log(`[PasswordSync] Found ${data.count} pending password changes:`, data.pending_changes);

    // Process each pending change
    const confirmedIds: string[] = [];

    for (const change of data.pending_changes) {
      console.log(`[PasswordSync] Processing: ${change.email}`);
      const success = await updateCredentialPassword(change.email, change.password, change.source);
      if (success) {
        confirmedIds.push(change.event_id);
        console.log(`[PasswordSync] ✅ Updated: ${change.email}`);
      } else {
        console.log(`[PasswordSync] ❌ Failed to update: ${change.email}`);
      }
    }

    // Confirm synced changes with API
    if (confirmedIds.length > 0) {
      await confirmSyncWithAPI(confirmedIds);
    }
  } catch (error) {
    console.error('[PasswordSync] Poll error:', error);
  }
}

// Update credential password in local database
async function updateCredentialPassword(email: string, newPassword: string, source: string): Promise<boolean> {
  if (!activeSession || !activeSession.masterPassword) {
    console.log('[PasswordSync] Cannot update - vault locked');
    return false;
  }

  try {
    const db = getDb();
    const encryptionKey = deriveEncryptionKey(activeSession.masterPassword, activeSession.salt);

    // Get all credentials and find matching one by decrypting usernames
    const credentials = db.prepare(`
      SELECT id, title, username FROM credentials WHERE user_id = ?
    `).all(activeSession.userId) as any[];

    let matchedCredential: any = null;

    for (const cred of credentials) {
      if (cred.username) {
        try {
          const decryptedUsername = decryptPassword(cred.username, encryptionKey);
          // Check if decrypted username matches the email (case-insensitive)
          if (decryptedUsername && decryptedUsername.toLowerCase() === email.toLowerCase()) {
            matchedCredential = cred;
            break;
          }
        } catch (e) {
          // Skip if decryption fails
        }
      }
    }

    if (!matchedCredential) {
      console.log(`[PasswordSync] Email not found in vault: ${email}`);
      return false;
    }

    // Encrypt the new password
    const encryptedPassword = encryptPassword(newPassword, encryptionKey);

    // Update the credential
    db.prepare(`
      UPDATE credentials
      SET password = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `).run(encryptedPassword, matchedCredential.id, activeSession.userId);

    // Decrypt title for logging (title might also be encrypted)
    let displayTitle = matchedCredential.title;
    try {
      displayTitle = decryptPassword(matchedCredential.title, encryptionKey) || matchedCredential.title;
    } catch (e) {
      // Use as-is if not encrypted
    }

    console.log(`[PasswordSync] ✅ Updated password for '${displayTitle}' (ID: ${matchedCredential.id}) via ${source}`);
    return true;
  } catch (error) {
    console.error('[PasswordSync] Update error:', error);
    return false;
  }
}

// Confirm synced changes with Connector API
async function confirmSyncWithAPI(eventIds: string[]) {
  try {
    const response = await fetch(`${CONNECTOR_API_NGROK_URL}/api/vault/confirm-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Vault-Key': VAULT_API_KEY,
        'ngrok-skip-browser-warning': 'true'
      },
      body: JSON.stringify({ event_ids: eventIds })
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`[PasswordSync] ✅ Confirmed ${data.confirmed_count} synced changes with API`);
    }
  } catch (error) {
    console.error('[PasswordSync] Confirm error:', error);
  }
}

// Start/stop polling
function startPasswordSyncPolling() {
  if (syncPollingInterval) return;

  console.log('[PasswordSync] Starting polling (every 30s)...');
  syncPollingInterval = setInterval(pollForPendingPasswordChanges, SYNC_POLL_INTERVAL);

  // Also poll immediately
  pollForPendingPasswordChanges();
}

function stopPasswordSyncPolling() {
  if (syncPollingInterval) {
    clearInterval(syncPollingInterval);
    syncPollingInterval = null;
    console.log('[PasswordSync] Stopped polling');
  }
}

function sendToExtension(data: any) {
  let sentCount = 0;

  extensionClients.forEach((client) => {
    const clientInfo = pairedClients.get(client);
    if (client.readyState === WebSocket.OPEN && clientInfo && clientInfo.paired) {
      // Encrypt credentials if session key exists and data contains credentials
      if (clientInfo.sessionKey && data.type === 'credentials' && data.username !== undefined && data.password !== undefined) {
        const encryptedData = {
          ...data,
          username: encryptForTransport(data.username, clientInfo.sessionKey),
          password: encryptForTransport(data.password, clientInfo.sessionKey),
          encrypted: true
        };
        client.send(JSON.stringify(encryptedData));
      } else {
        client.send(JSON.stringify(data));
      }
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

// ========== AUTO-UPDATE IPC HANDLERS ==========
ipcMain.handle('check-for-updates', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return { success: true, result };
  } catch (error: any) {
    console.error('[AutoUpdater] Check failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('quit-and-install', () => {
  autoUpdater.quitAndInstall();
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
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
            const browserProcess = spawn(browserPath, [url], {
              detached: true,
              stdio: 'ignore',
              shell: false
            });

            browserProcess.on('error', (error) => {
              console.error(`Failed to open ${browser}:`, error);
              reject({ success: false, error: `Failed to launch ${browser}` });
            });

            browserProcess.unref();
            console.log(`Successfully opened ${url} in ${browser}`);
            resolve({ success: true, warning: 'Master password not available for auto-fill' });
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
      // Launch browser directly with the URL using spawn (safer than exec)
      // This prevents command injection by not passing through shell
      const browserProcess = spawn(browserPath, [url], {
        detached: true,
        stdio: 'ignore',
        shell: false  // Important: don't use shell to prevent injection
      });

      browserProcess.on('error', (error) => {
        console.error(`Failed to open ${browser}:`, error);
        reject({ success: false, error: `Failed to launch ${browser}` });
      });

      // Unref to allow the app to exit independently of the browser
      browserProcess.unref();
      console.log(`Successfully opened ${url} in ${browser}`);
      resolve({ success: true });
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

    // Generate master password verification token
    // This token is encrypted with the master password and stored
    // When unlocking vault, we decrypt it to verify the password
    const encryptionKey = deriveEncryptionKey(password, salt);
    const verifyToken = encryptPassword('VAULT_VERIFY_TOKEN_' + Date.now(), encryptionKey);

    // Insert user with verification token
    const result = db.prepare(
      'INSERT INTO users (username, password_hash, salt, master_verify_token) VALUES (?, ?, ?, ?)'
    ).run(username, hashedPassword, salt, verifyToken);

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

    // Start polling for password sync from Connector API
    startPasswordSyncPolling();

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
  // Stop password sync polling
  stopPasswordSyncPolling();
  console.log('User logged out and session cleared');
  return { success: true };
});

// Verify master password (for vault unlock)
ipcMain.handle('auth:verifyMasterPassword', async (event, { masterPassword }) => {
  try {
    if (!activeSession) {
      return { success: false, error: 'Not authenticated' };
    }

    const db = getDb();
    const user: any = db.prepare('SELECT password_hash, salt, master_verify_token FROM users WHERE id = ?').get(activeSession.userId);

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // First, verify using the password hash (this is the primary verification)
    // Since master password IS the login password, we can use the stored hash
    const isValidPassword = verifyPassword(masterPassword, user.salt, user.password_hash);
    if (!isValidPassword) {
      console.log('[Auth] Master password verification failed - hash mismatch');
      return { success: false, error: 'Invalid master password' };
    }

    // If no verification token exists (legacy user), generate one now
    if (!user.master_verify_token) {
      try {
        const encryptionKey = deriveEncryptionKey(masterPassword, activeSession.salt);
        const verifyToken = encryptPassword('VAULT_VERIFY_TOKEN_' + Date.now(), encryptionKey);
        db.prepare('UPDATE users SET master_verify_token = ? WHERE id = ?').run(verifyToken, activeSession.userId);
        console.log('[Auth] Generated verification token for legacy user');
      } catch (error) {
        console.error('[Auth] Failed to generate verification token:', error);
        // Continue anyway since password hash was verified
      }
    }

    // Store master password for vault operations (needed for password sync)
    activeSession.masterPassword = masterPassword;

    // Start polling for password sync (vault is now unlocked)
    startPasswordSyncPolling();

    return { success: true };
  } catch (error: any) {
    console.error('[Auth] Verification error:', error);
    return { success: false, error: error.message || 'Verification failed' };
  }
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
// API IPC HANDLERS - API KEYS
// ============================================================================

// Get all API keys (masked)
ipcMain.handle('apikeys:fetch', async (event) => {
  try {
    if (!activeSession) {
      return { success: false, error: 'Not authenticated' };
    }

    const db = getDb();
    const apiKeys = db.prepare(`
      SELECT id, provider, api_key, created_at, updated_at
      FROM api_keys WHERE user_id = ? ORDER BY provider
    `).all(activeSession.userId) as any[];

    // Mask API keys - show only last 3 characters
    const maskedKeys = apiKeys.map(key => ({
      ...key,
      api_key_masked: key.api_key.length > 3
        ? '•'.repeat(key.api_key.length - 3) + key.api_key.slice(-3)
        : '•••',
      api_key: undefined // Don't send actual key
    }));

    return { success: true, apiKeys: maskedKeys };
  } catch (error: any) {
    console.error('Fetch API keys error:', error);
    return { success: false, error: error.message || 'Failed to fetch API keys' };
  }
});

// Create or update API key
ipcMain.handle('apikeys:save', async (event, { provider, apiKey }) => {
  try {
    if (!activeSession) {
      return { success: false, error: 'Not authenticated' };
    }

    if (!provider || !apiKey) {
      return { success: false, error: 'Provider and API key are required' };
    }

    const db = getDb();

    // Check if key exists for this provider
    const existing = db.prepare(
      'SELECT id FROM api_keys WHERE user_id = ? AND provider = ?'
    ).get(activeSession.userId, provider);

    if (existing) {
      // Update existing key
      db.prepare(`
        UPDATE api_keys SET api_key = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND provider = ?
      `).run(apiKey, activeSession.userId, provider);
    } else {
      // Insert new key
      db.prepare(`
        INSERT INTO api_keys (user_id, provider, api_key) VALUES (?, ?, ?)
      `).run(activeSession.userId, provider, apiKey);
    }

    return { success: true };
  } catch (error: any) {
    console.error('Save API key error:', error);
    return { success: false, error: error.message || 'Failed to save API key' };
  }
});

// Delete API key
ipcMain.handle('apikeys:delete', async (event, { provider }) => {
  try {
    if (!activeSession) {
      return { success: false, error: 'Not authenticated' };
    }

    const db = getDb();
    const result = db.prepare(
      'DELETE FROM api_keys WHERE user_id = ? AND provider = ?'
    ).run(activeSession.userId, provider);

    return { success: result.changes > 0 };
  } catch (error: any) {
    console.error('Delete API key error:', error);
    return { success: false, error: error.message || 'Failed to delete API key' };
  }
});

// Get API key for internal use (not exposed to renderer)
function getApiKeyForProvider(provider: string): string | null {
  if (!activeSession) return null;

  const db = getDb();
  const result = db.prepare(
    'SELECT api_key FROM api_keys WHERE user_id = ? AND provider = ?'
  ).get(activeSession.userId, provider) as any;

  return result?.api_key || null;
}

// ============================================================================
// API IPC HANDLERS - NOTES
// ============================================================================

// Get all notes
ipcMain.handle('notes:fetch', async (event, { masterPassword } = {}) => {
  try {
    if (!activeSession) {
      return { success: false, error: 'Not authenticated' };
    }

    const db = getDb();
    const notes = db.prepare(`
      SELECT * FROM notes WHERE user_id = ? ORDER BY updated_at DESC
    `).all(activeSession.userId) as any[];

    // If master password provided, decrypt note contents
    if (masterPassword) {
      const encryptionKey = deriveEncryptionKey(masterPassword, activeSession.salt);
      const decryptedNotes = notes.map(note => {
        try {
          // Only decrypt if content appears to be encrypted (contains colons for iv:authTag:data format)
          if (note.content && note.content.includes(':')) {
            return {
              ...note,
              content: decryptPassword(note.content, encryptionKey)
            };
          }
          return note;
        } catch {
          // If decryption fails, return original (might be unencrypted legacy note)
          return note;
        }
      });
      return { success: true, notes: decryptedNotes };
    }

    return { success: true, notes };
  } catch (error: any) {
    console.error('Fetch notes error:', error);
    return { success: false, error: error.message || 'Failed to fetch notes' };
  }
});

// Create note
ipcMain.handle('notes:create', async (event, { title, content, color, masterPassword }) => {
  try {
    if (!activeSession) {
      return { success: false, error: 'Not authenticated' };
    }

    let encryptedContent = content || '';

    // Encrypt content if master password is provided and content exists
    if (masterPassword && content) {
      const encryptionKey = deriveEncryptionKey(masterPassword, activeSession.salt);
      encryptedContent = encryptPassword(content, encryptionKey);
    }

    const db = getDb();
    const result = db.prepare(`
      INSERT INTO notes (user_id, title, content, color)
      VALUES (?, ?, ?, ?)
    `).run(activeSession.userId, title, encryptedContent, color || '#fbbf24');

    return { success: true, id: result.lastInsertRowid };
  } catch (error: any) {
    console.error('Create note error:', error);
    return { success: false, error: error.message || 'Failed to create note' };
  }
});

// Update note
ipcMain.handle('notes:update', async (event, { id, title, content, color, position_x, position_y, width, height, masterPassword }) => {
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
      // Encrypt content if master password is provided
      let contentToStore = content;
      if (masterPassword && content) {
        const encryptionKey = deriveEncryptionKey(masterPassword, activeSession.salt);
        contentToStore = encryptPassword(content, encryptionKey);
      }
      updates.push('content = ?');
      values.push(contentToStore);
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
// AUTOMATIC BACKUP SYSTEM
// ============================================================================

const BACKUP_RETENTION_DAYS = 7; // Keep backups for 7 days

function getBackupDir(): string {
  return path.join(app.getPath('userData'), 'backups');
}

function ensureBackupDir(): void {
  const backupDir = getBackupDir();
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
    console.log('[Backup] Created backup directory:', backupDir);
  }
}

function getBackupFileName(): string {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
  return `database-backup-${dateStr}.sqlite`;
}

function performBackup(): { success: boolean; path?: string; error?: string } {
  try {
    ensureBackupDir();

    const dbPath = path.join(app.getPath('userData'), 'database.sqlite');
    const backupDir = getBackupDir();
    const backupFileName = getBackupFileName();
    const backupPath = path.join(backupDir, backupFileName);

    // Check if database exists
    if (!fs.existsSync(dbPath)) {
      console.log('[Backup] No database to backup');
      return { success: false, error: 'Database not found' };
    }

    // Check if today's backup already exists
    if (fs.existsSync(backupPath)) {
      console.log('[Backup] Today\'s backup already exists:', backupFileName);
      return { success: true, path: backupPath };
    }

    // Copy database file
    fs.copyFileSync(dbPath, backupPath);
    console.log('[Backup] ✅ Backup created:', backupFileName);

    // Clean up old backups
    cleanupOldBackups();

    return { success: true, path: backupPath };
  } catch (error: any) {
    console.error('[Backup] ❌ Backup failed:', error);
    return { success: false, error: error.message };
  }
}

function cleanupOldBackups(): void {
  try {
    const backupDir = getBackupDir();
    if (!fs.existsSync(backupDir)) return;

    const files = fs.readdirSync(backupDir);
    const now = Date.now();
    const maxAge = BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (!file.startsWith('database-backup-')) continue;

      const filePath = path.join(backupDir, file);
      const stats = fs.statSync(filePath);
      const age = now - stats.mtimeMs;

      if (age > maxAge) {
        fs.unlinkSync(filePath);
        console.log('[Backup] 🗑️ Deleted old backup:', file);
      }
    }
  } catch (error) {
    console.error('[Backup] Error cleaning up old backups:', error);
  }
}

function listBackups(): { name: string; date: string; size: number }[] {
  try {
    const backupDir = getBackupDir();
    if (!fs.existsSync(backupDir)) return [];

    const files = fs.readdirSync(backupDir);
    const backups: { name: string; date: string; size: number }[] = [];

    for (const file of files) {
      if (!file.startsWith('database-backup-')) continue;

      const filePath = path.join(backupDir, file);
      const stats = fs.statSync(filePath);

      // Extract date from filename
      const dateMatch = file.match(/database-backup-(\d{4}-\d{2}-\d{2})/);
      const date = dateMatch ? dateMatch[1] : 'Unknown';

      backups.push({
        name: file,
        date: date,
        size: stats.size
      });
    }

    // Sort by date descending
    backups.sort((a, b) => b.date.localeCompare(a.date));

    return backups;
  } catch (error) {
    console.error('[Backup] Error listing backups:', error);
    return [];
  }
}

function restoreBackup(backupName: string): { success: boolean; error?: string } {
  try {
    const backupDir = getBackupDir();
    const backupPath = path.join(backupDir, backupName);
    const dbPath = path.join(app.getPath('userData'), 'database.sqlite');

    if (!fs.existsSync(backupPath)) {
      return { success: false, error: 'Backup file not found' };
    }

    // Create a backup of current database before restoring
    const currentBackupName = `database-pre-restore-${Date.now()}.sqlite`;
    const currentBackupPath = path.join(backupDir, currentBackupName);

    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, currentBackupPath);
      console.log('[Backup] Created pre-restore backup:', currentBackupName);
    }

    // Restore the backup
    fs.copyFileSync(backupPath, dbPath);
    console.log('[Backup] ✅ Restored backup:', backupName);

    return { success: true };
  } catch (error: any) {
    console.error('[Backup] ❌ Restore failed:', error);
    return { success: false, error: error.message };
  }
}

// IPC handlers for backup operations
ipcMain.handle('backup:create', async () => {
  return performBackup();
});

ipcMain.handle('backup:list', async () => {
  return { success: true, backups: listBackups() };
});

ipcMain.handle('backup:restore', async (event, { backupName }) => {
  return restoreBackup(backupName);
});

ipcMain.handle('backup:getPath', async () => {
  return { success: true, path: getBackupDir() };
});

// ============================================================================
// OPENAI SPACEMAIL VALIDATOR
// ============================================================================

ipcMain.handle('openai:analyzeEmail', async (event, { subject, body }) => {
  try {
    // Get API key from database (user-provided) or fallback to env
    const apiKey = getApiKeyForProvider('openai') || process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return { success: false, error: 'OpenAI API key not configured. Add your API key in the API Keys section.' };
    }

    // Spacemail.com Knowledge Base
    const knowledgeBase = `
SPACEMAIL.COM EMAIL DELIVERABILITY KNOWLEDGE BASE

WHY EMAILS GO TO SPAM:

1. WHERE THE MESSAGE CAME FROM
Anti-spam organizations have created special network lists called RBLs (Real-time blackhole lists). Spam filter checks such lists for the IP address and the domain name that the message was sent from. If the IP address matches one on the list, the spam score of the message increases.

2. WHO SENT THE MESSAGE
Using email headers spam filters check if the email was sent by a spam engine or by a real sender. Every email has a unique ID, but when the spammers send mass emails, they all have the same ID.

3. WHAT THE MESSAGE LOOKS LIKE
The spam filter analyzes the body and the subject of the email. Strings which can be identified as spam are 'buy now', 'lowest prices', 'click here', etc. Also, it looks for flashy HTML such as large fonts, blinking text, bright colors, and so on. A lot of spam filters compare the whole text to the number of suspicious words.

GUIDELINES TO IMPROVE EMAIL DELIVERY:

VALID SENDER INFORMATION:
- Use a recognizable and legitimate sender email address
- Avoid generic or suspicious sender names
- Ensure the "From" field accurately represents your organization or brand

CLEAR SUBJECT LINE:
- Write a subject line that reflects the email's purpose concisely
- Avoid misleading or clickbait-style subject lines
- Do not end a subject with a question mark or space
- Do not use only uppercase letters
- Do not use words like Test/Testing in the subject

STRUCTURED EMAIL BODY:
- Organize your email content into paragraphs or sections
- Use headings, bullet points, and numbered lists to improve readability
- Do not use too many special symbols, especially at the beginning or at the end of the sentence

SIGNATURE AND CONTACT INFORMATION:
- Include a professional email signature with your name, job title, and contact details
- A well-formatted signature adds credibility to your email

AVOID EXCESSIVE LINKS AND ATTACHMENTS:
- Limit the number of hyperlinks in your email
- Avoid overloading the email with files
- Be careful with images - have no less than two strings of text per image
- Do not use shortened URLs (bit.ly, tinyurl.com, etc.) - spammers use those to hide real URLs
- Avoid attachments like .exe, .zip, .swf. It is okay to use .jpg, .gif, .png and .pdf

UNSUBSCRIBE OPTION:
- The email should be identified as an ad if that is what you are sending
- Include an easy-to-find unsubscribe link for compliance with anti-spam regulations

PLAIN TEXT VERSION:
- Some email clients may not render HTML properly
- Including a plain text version ensures accessibility
- Avoid different colors of fonts if possible

DOMAIN CONFIGURATION:
- Check SPF and DKIM records for email authentication
- Check your IP and domain in blacklists before sending
- Warm up newly registered domains for better deliverability

OTHER RECOMMENDATIONS:
- Do not purchase email lists - addresses are often incorrect and lead to blacklisting
- Send individual emails to real people
- Test emails by sending to different providers (Google, Yahoo, etc.)

HOW TO IDENTIFY SPAM:
- Spammers use long email addresses with random letters/numbers
- Watch for impersonation of reputable organizations (fake domains like @paypai.com)
- Look for typos, incorrect spelling, obvious grammatical mistakes
- Be cautious of shortened URLs that may hide malicious links
- Beware of unrealistic claims, ridiculously low prices, or money rewards
`;

    const prompt = `You are an email deliverability expert for Spacemail.com. Use the following knowledge base to analyze emails:

${knowledgeBase}

EMAIL TO ANALYZE:

SUBJECT: ${subject || '(empty)'}

BODY:
${body || '(empty)'}

Based on the Spacemail.com knowledge base above, thoroughly analyze this email and identify all potential spam triggers, deliverability issues, and areas for improvement.

Respond in this exact JSON format:
{
  "score": <number 0-100, where 100 is perfect deliverability>,
  "summary": "<one sentence overall assessment>",
  "issues": [
    {
      "severity": "high|medium|low",
      "issue": "<specific problem found>",
      "suggestion": "<actionable fix based on knowledge base>"
    }
  ],
  "improvements": ["<specific text changes or additions to make>"]
}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are an email deliverability expert. Always respond with valid JSON only, no markdown formatting.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 1500
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('[OpenAI] API error:', errorData);
      return { success: false, error: `API error: ${response.status}` };
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
      return { success: false, error: 'No response from OpenAI' };
    }

    // Parse JSON response
    try {
      const analysis = JSON.parse(content);
      return { success: true, analysis };
    } catch (parseError) {
      console.error('[OpenAI] Failed to parse response:', content);
      return { success: false, error: 'Failed to parse AI response' };
    }
  } catch (error: any) {
    console.error('[OpenAI] Error:', error);
    return { success: false, error: error.message || 'Failed to analyze email' };
  }
});

// Reformat email according to Spacemail requirements
ipcMain.handle('openai:reformatEmail', async (event, { subject, body }) => {
  try {
    // Get API key from database (user-provided) or fallback to env
    const apiKey = getApiKeyForProvider('openai') || process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return { success: false, error: 'OpenAI API key not configured. Add your API key in the API Keys section.' };
    }

    // Spacemail.com Knowledge Base for reformatting
    const knowledgeBase = `
SPACEMAIL.COM EMAIL FORMATTING REQUIREMENTS:

SUBJECT LINE RULES:
- Must be clear, concise, and reflect email purpose
- NO question marks at the end
- NO trailing spaces
- NO all uppercase letters
- NO words like "Test" or "Testing"
- NO clickbait or misleading phrases
- NO spam trigger words (FREE, URGENT, ACT NOW, etc.)

BODY FORMATTING RULES:
- Organize into clear paragraphs or sections
- Use bullet points or numbered lists for readability
- NO excessive special symbols at sentence start/end
- NO all caps text blocks
- NO multiple exclamation marks in a row
- Maintain professional tone

REQUIRED ELEMENTS:
- Professional greeting
- Well-structured content with clear paragraphs
- Professional signature with name and title
- Contact information (email/phone)

LINKS AND ATTACHMENTS:
- Use full URLs, never shortened links (no bit.ly, tinyurl, etc.)
- Mention safe attachment types only (.pdf, .jpg, .png, .gif)
- Avoid mentioning .exe, .zip, .swf files

FOR MARKETING EMAILS:
- Include clear unsubscribe option
- Identify as promotional content if applicable
`;

    const prompt = `You are an email formatting expert for Spacemail.com. Reformat the following email to meet all Spacemail requirements:

${knowledgeBase}

ORIGINAL EMAIL:

Subject: ${subject || '(empty)'}

Body:
${body || '(empty)'}

TASK: Rewrite this email to fully comply with Spacemail.com requirements. Keep the original intent and message but:
1. Fix all subject line issues
2. Improve body structure and formatting
3. Add any missing required elements (signature, contact info if missing)
4. Remove all spam triggers
5. Make it professional and deliverable

Respond in this exact JSON format:
{
  "subject": "<reformatted subject line>",
  "body": "<reformatted email body with proper formatting>"
}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are an email formatting expert. Always respond with valid JSON only, no markdown formatting. Preserve the original message intent while making it compliant with email deliverability best practices.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.4,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('[OpenAI] API error:', errorData);
      return { success: false, error: `API error: ${response.status}` };
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
      return { success: false, error: 'No response from OpenAI' };
    }

    // Parse JSON response
    try {
      const reformatted = JSON.parse(content);
      return { success: true, reformatted };
    } catch (parseError) {
      console.error('[OpenAI] Failed to parse response:', content);
      return { success: false, error: 'Failed to parse AI response' };
    }
  } catch (error: any) {
    console.error('[OpenAI] Error:', error);
    return { success: false, error: error.message || 'Failed to reformat email' };
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

    // Perform automatic daily backup
    console.log('[Backup] Performing automatic backup...');
    const backupResult = performBackup();
    if (backupResult.success) {
      console.log('[Backup] Automatic backup completed');
    } else {
      console.error('[Backup] Automatic backup failed:', backupResult.error);
    }

    // Initialize WebSocket server for browser extension
    initWebSocketServer();

    // Setup auto-updater
    setupAutoUpdater();

    // Create main window
    await createWindow();

    // Check for updates after window is ready (only in packaged app)
    if (app.isPackaged) {
      setTimeout(() => {
        console.log(`[AutoUpdater] Checking for updates on startup... (Current: v${app.getVersion()})`);
        autoUpdater.checkForUpdates().catch(err => {
          console.error('[AutoUpdater] Startup check failed:', err);
        });
      }, 2000); // Wait 2 seconds after app starts
    } else {
      console.log(`[AutoUpdater] Development mode - update checks disabled. Current: v${app.getVersion()}`);
    }
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