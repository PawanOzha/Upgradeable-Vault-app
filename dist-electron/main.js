import { app, ipcMain, BrowserWindow } from "electron";
import { exec } from "child_process";
import { fileURLToPath } from "node:url";
import path$1 from "node:path";
import fs from "fs";
import "http";
import { WebSocket, WebSocketServer } from "ws";
import Store from "electron-store";
import crypto, { createHash, randomUUID } from "crypto";
import Database from "better-sqlite3";
import path from "path";
import os from "os";
let db = null;
function initDb() {
  if (!db) {
    try {
      const dbPath = path.join(app.getPath("userData"), "database.sqlite");
      db = new Database(dbPath, { verbose: console.log });
      console.log("Database connected successfully at:", dbPath);
      db.pragma("foreign_keys = ON");
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          salt TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          color TEXT DEFAULT '#6366f1',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE(user_id, name)
        )
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS credentials (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          category_id INTEGER,
          title TEXT NOT NULL,
          site_link TEXT,
          username TEXT,
          password TEXT NOT NULL,
          description TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
        )
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          content TEXT DEFAULT '',
          color TEXT DEFAULT '#fbbf24',
          is_pinned INTEGER DEFAULT 0,
          is_floating INTEGER DEFAULT 0,
          position_x INTEGER,
          position_y INTEGER,
          width INTEGER,
          height INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
      console.log("All database tables created/verified");
    } catch (error) {
      console.error("Database initialization error:", error);
      throw error;
    }
  }
  return db;
}
function getDb() {
  if (!db) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return db;
}
function generateSalt() {
  return crypto.randomBytes(16).toString("hex");
}
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 1e5, 64, "sha512").toString("hex");
}
function verifyPassword(password, salt, storedHash) {
  const hash = hashPassword(password, salt);
  return crypto.timingSafeEqual(
    Buffer.from(hash, "hex"),
    Buffer.from(storedHash, "hex")
  );
}
const loginAttempts = /* @__PURE__ */ new Map();
function checkLoginRateLimit(username) {
  const now = Date.now();
  const attempt = loginAttempts.get(username);
  if (!attempt) {
    return { isBlocked: false, waitTime: 0, attemptsRemaining: 5 };
  }
  if (attempt.blockedUntil && attempt.blockedUntil > now) {
    return {
      isBlocked: true,
      waitTime: Math.ceil((attempt.blockedUntil - now) / 1e3),
      attemptsRemaining: 0
    };
  }
  if (now - attempt.firstAttempt > 15 * 60 * 1e3) {
    loginAttempts.delete(username);
    return { isBlocked: false, waitTime: 0, attemptsRemaining: 5 };
  }
  return {
    isBlocked: false,
    waitTime: 0,
    attemptsRemaining: Math.max(0, 5 - attempt.count)
  };
}
function recordFailedLogin(username) {
  const now = Date.now();
  const attempt = loginAttempts.get(username);
  if (!attempt) {
    loginAttempts.set(username, {
      count: 1,
      firstAttempt: now,
      blockedUntil: null
    });
    return;
  }
  attempt.count++;
  if (attempt.count >= 5) {
    const blockDuration = Math.min(
      30 * 60 * 1e3,
      // Max 30 minutes
      5 * 60 * 1e3 * Math.pow(2, attempt.count - 5)
      // Exponential backoff
    );
    attempt.blockedUntil = now + blockDuration;
  }
  loginAttempts.set(username, attempt);
}
function clearLoginAttempts(username) {
  loginAttempts.delete(username);
}
function cleanupLoginAttempts() {
  const now = Date.now();
  const maxAge = 60 * 60 * 1e3;
  for (const [username, attempt] of loginAttempts.entries()) {
    if (now - attempt.firstAttempt > maxAge) {
      loginAttempts.delete(username);
    }
  }
}
setInterval(cleanupLoginAttempts, 60 * 60 * 1e3);
function deriveEncryptionKey(masterPassword, salt) {
  return crypto.scryptSync(masterPassword, salt, 32);
}
function encryptPassword(plaintext, encryptionKey) {
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
  } catch (error) {
    console.error("Encryption error:", error);
    throw new Error("Failed to encrypt password");
  }
}
function decryptPassword(encryptedData, encryptionKey) {
  try {
    const parts = encryptedData.split(":");
    if (parts.length !== 3) {
      throw new Error("Invalid encrypted data format");
    }
    const [ivHex, authTagHex, encryptedHex] = parts;
    if (!ivHex || !authTagHex || !encryptedHex) {
      throw new Error("Invalid encrypted data: missing components");
    }
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    if (iv.length !== 16) {
      throw new Error("Invalid IV length");
    }
    if (authTag.length !== 16) {
      throw new Error("Invalid auth tag length");
    }
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    console.error("Decryption error:", error.message);
    if (error.message.includes("Unsupported state or unable to authenticate data")) {
      throw new Error("Decryption failed: Wrong password or corrupted data");
    }
    throw new Error("Failed to decrypt password");
  }
}
const __dirname = path$1.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path$1.join(__dirname, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path$1.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path$1.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path$1.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
const isDev = process.env.NODE_ENV !== "production";
process.env.PORT || 3e3;
const store = new Store();
let mainWindow = null;
let stickyNoteWindows = /* @__PURE__ */ new Map();
const WS_PORT = 9876;
let wss = null;
let extensionClients = /* @__PURE__ */ new Set();
let appId = "";
let pairedClients = /* @__PURE__ */ new Map();
const wsRateLimits = /* @__PURE__ */ new Map();
function checkWsRateLimit(ws, action) {
  const now = Date.now();
  const limit = wsRateLimits.get(ws) || { attempts: 0, lastAttempt: now, blockedUntil: 0 };
  if (limit.blockedUntil > now) {
    const waitTime = Math.ceil((limit.blockedUntil - now) / 1e3);
    ws.send(JSON.stringify({
      type: "error",
      message: `Too many attempts. Wait ${waitTime} seconds.`
    }));
    return false;
  }
  if (now - limit.lastAttempt > 6e4) {
    limit.attempts = 0;
  }
  limit.attempts++;
  limit.lastAttempt = now;
  const maxAttempts = action === "pair" ? 5 : 20;
  if (limit.attempts > maxAttempts) {
    limit.blockedUntil = now + 5 * 60 * 1e3;
    wsRateLimits.set(ws, limit);
    ws.send(JSON.stringify({
      type: "error",
      message: `Too many ${action} attempts. Blocked for 5 minutes.`
    }));
    return false;
  }
  wsRateLimits.set(ws, limit);
  return true;
}
function getOrCreateAppId() {
  const storedAppId = store.get("appId");
  if (storedAppId && storedAppId.length === 12) {
    console.log("[App] ⚠️ Found old 12-character App ID - upgrading to 256-bit for security");
    const upgradedAppId = (randomUUID() + randomUUID()).replace(/-/g, "").toUpperCase();
    store.set("appId", upgradedAppId);
    console.log("[App] ✅ App ID upgraded to 256-bit! Please re-pair your browser extension.");
    return upgradedAppId;
  }
  if (storedAppId && storedAppId.length === 64) {
    console.log("[App] Using existing 256-bit app ID");
    return storedAppId;
  }
  const newAppId = (randomUUID() + randomUUID()).replace(/-/g, "").toUpperCase();
  store.set("appId", newAppId);
  console.log("[App] Generated new permanent app ID (256-bit)");
  return newAppId;
}
function initWebSocketServer() {
  try {
    appId = getOrCreateAppId();
    wss = new WebSocketServer({ port: WS_PORT });
    wss.on("listening", () => {
      console.log(`[WebSocket] Server started on port ${WS_PORT}`);
      console.log(`[WebSocket] 🔐 Permanent App ID: ${appId}`);
    });
    wss.on("connection", (ws) => {
      console.log("[WebSocket] Extension attempting connection...");
      extensionClients.add(ws);
      pairedClients.set(ws, false);
      ws.on("message", async (data) => {
        try {
          const message = JSON.parse(data.toString());
          console.log("[WebSocket] Received:", message.type);
          if (message.type === "pair") {
            if (!checkWsRateLimit(ws, "pair")) {
              return;
            }
            if (message.code === appId) {
              pairedClients.set(ws, true);
              wsRateLimits.delete(ws);
              ws.send(JSON.stringify({
                type: "pair-success",
                message: "Extension paired successfully",
                appId
              }));
              console.log("[WebSocket] ✅ Extension paired successfully");
            } else {
              ws.send(JSON.stringify({
                type: "pair-failed",
                message: "Invalid app ID"
              }));
              console.log("[WebSocket] ❌ Invalid app ID");
            }
            return;
          }
          if (!pairedClients.get(ws)) {
            ws.send(JSON.stringify({
              type: "error",
              message: "Not paired. Please pair with the app first."
            }));
            return;
          }
          if (message.type === "request-credentials") {
            if (!checkWsRateLimit(ws, "credentials")) {
              return;
            }
            console.log("[WebSocket] 📨 Credential request for:", message.url);
            await handleCredentialRequest(ws, message.url);
            return;
          }
          if (message.type === "extension-connected") {
            console.log("[WebSocket] Extension confirmed connection");
          }
        } catch (error) {
          console.error("[WebSocket] Error parsing message:", error);
        }
      });
      ws.on("close", () => {
        console.log("[WebSocket] Extension disconnected");
        extensionClients.delete(ws);
        pairedClients.delete(ws);
        wsRateLimits.delete(ws);
      });
      ws.on("error", (error) => {
        console.error("[WebSocket] Client error:", error);
        extensionClients.delete(ws);
        pairedClients.delete(ws);
        wsRateLimits.delete(ws);
      });
    });
    wss.on("error", (error) => {
      console.error("[WebSocket] Server error:", error);
    });
  } catch (error) {
    console.error("[WebSocket] Failed to start server:", error);
  }
}
async function handleCredentialRequest(ws, requestUrl) {
  try {
    if (!activeSession) {
      ws.send(JSON.stringify({
        type: "credentials-response",
        success: false,
        error: "Not authenticated. Please log in to the app first."
      }));
      return;
    }
    if (!activeSession.masterPassword) {
      ws.send(JSON.stringify({
        type: "credentials-response",
        success: false,
        error: "Vault locked. Please unlock your vault in the app first."
      }));
      console.log("[WebSocket] ⚠️ Vault locked - user needs to unlock");
      return;
    }
    let hostname = "";
    try {
      hostname = new URL(requestUrl.includes("://") ? requestUrl : "https://" + requestUrl).hostname;
    } catch (e) {
      ws.send(JSON.stringify({
        type: "credentials-response",
        success: false,
        error: "Invalid URL"
      }));
      return;
    }
    console.log(`[WebSocket] Searching credentials for hostname: ${hostname}`);
    const db2 = getDb();
    const credentials = db2.prepare(`
      SELECT * FROM credentials 
      WHERE user_id = ? AND site_link LIKE ?
      ORDER BY created_at DESC
    `).all(activeSession.userId, `%${hostname}%`);
    if (credentials.length === 0) {
      ws.send(JSON.stringify({
        type: "credentials-response",
        success: false,
        error: "No credentials found for this site"
      }));
      console.log("[WebSocket] No credentials found");
      return;
    }
    const credential = credentials[0];
    const encryptionKey = await deriveEncryptionKey(activeSession.masterPassword, activeSession.salt);
    const decryptedUsername = credential.username ? decryptPassword(credential.username, encryptionKey) : "";
    const decryptedPassword = decryptPassword(credential.password, encryptionKey);
    ws.send(JSON.stringify({
      type: "credentials-response",
      success: true,
      url: requestUrl,
      username: decryptedUsername,
      password: decryptedPassword
    }));
    console.log("[WebSocket] ✅ Credentials sent to extension");
  } catch (error) {
    console.error("[WebSocket] Error handling credential request:", error);
    ws.send(JSON.stringify({
      type: "credentials-response",
      success: false,
      error: "Internal error"
    }));
  }
}
function sendToExtension(data) {
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
const createWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    icon: path$1.join(process.env.VITE_PUBLIC, "favicon.ico"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path$1.join(__dirname, "preload.mjs"),
      webSecurity: !isDev
    },
    show: false
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow == null ? void 0 : mainWindow.show();
    mainWindow == null ? void 0 : mainWindow.webContents.setZoomFactor(0.67);
  });
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow == null ? void 0 : mainWindow.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  });
  if (VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path$1.join(RENDERER_DIST, "index.html"));
  }
  mainWindow.on("close", (event) => {
    if (activeSession) {
      activeSession.masterPassword = void 0;
      activeSession.encryptionKey = void 0;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("clear-session-storage");
    }
    console.log("Window closing - cleared master password from session");
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
};
const createStickyNoteWindow = (noteId, noteData = {}) => {
  console.log("Creating sticky note window for note:", noteId);
  if (stickyNoteWindows.has(noteId)) {
    const existingWindow = stickyNoteWindows.get(noteId);
    if (existingWindow && !existingWindow.isDestroyed()) {
      existingWindow.focus();
      return;
    }
  }
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
      preload: path$1.join(__dirname, "preload.mjs"),
      webSecurity: !isDev
    },
    backgroundColor: "#30302E",
    show: false
  });
  stickyNoteWindows.set(noteId, noteWindow);
  noteWindow.once("ready-to-show", () => {
    noteWindow.show();
  });
  const noteUrl = VITE_DEV_SERVER_URL ? `${VITE_DEV_SERVER_URL}#/sticky-note/${noteId}` : `file://${path$1.join(RENDERER_DIST, "index.html")}#/sticky-note/${noteId}`;
  console.log("Loading sticky note URL:", noteUrl);
  if (VITE_DEV_SERVER_URL) {
    noteWindow.loadURL(noteUrl);
  } else {
    noteWindow.loadFile(path$1.join(RENDERER_DIST, "index.html"), {
      hash: `/sticky-note/${noteId}`
    });
  }
  const saveWindowBounds = () => {
    if (!noteWindow.isDestroyed()) {
      const bounds = noteWindow.getBounds();
      noteWindow.webContents.send("window-bounds-changed", bounds);
    }
  };
  noteWindow.on("resize", saveWindowBounds);
  noteWindow.on("move", saveWindowBounds);
  noteWindow.on("closed", () => {
    stickyNoteWindows.delete(noteId);
    console.log("Sticky note window closed:", noteId);
  });
  return noteWindow;
};
ipcMain.on("window-minimize", () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});
ipcMain.on("window-maximize", () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.restore();
    } else {
      mainWindow.maximize();
    }
  }
});
ipcMain.on("window-close", () => {
  if (mainWindow) {
    mainWindow.close();
  }
});
ipcMain.on("sticky-note-minimize", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window) {
    window.minimize();
  }
});
ipcMain.on("sticky-note-close", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window) {
    window.close();
  }
});
ipcMain.on("sticky-note-toggle-always-on-top", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window) {
    const isAlwaysOnTop = window.isAlwaysOnTop();
    window.setAlwaysOnTop(!isAlwaysOnTop);
    event.reply("sticky-note-always-on-top-changed", !isAlwaysOnTop);
  }
});
ipcMain.on("open-sticky-note", (event, noteId, noteData) => {
  console.log("Received open-sticky-note request:", noteId);
  createStickyNoteWindow(noteId, noteData);
});
ipcMain.on("close-sticky-note-window", (event, noteId) => {
  if (stickyNoteWindows.has(noteId)) {
    const window = stickyNoteWindows.get(noteId);
    if (window && !window.isDestroyed()) {
      window.close();
    }
    stickyNoteWindows.delete(noteId);
  }
});
ipcMain.handle("get-window-bounds", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window) {
    return window.getBounds();
  }
  return null;
});
ipcMain.handle("get-app-id", () => {
  return { success: true, appId };
});
ipcMain.handle("open-in-browser", async (event, url, browser, credentialId) => {
  console.log(`Opening ${url} in ${browser}`);
  try {
    const browserPaths = {
      "chrome": [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
      ],
      "brave": [
        "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
        "C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"
      ],
      "edge": [
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
      ]
    };
    const paths = browserPaths[browser];
    let browserPath = null;
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
    if (credentialId && activeSession) {
      try {
        console.log(`[Auto-Fill] Credential ID: ${credentialId}, Session User: ${activeSession.userId}`);
        if (!activeSession.masterPassword) {
          console.error("[Auto-Fill] ❌ Master password not in memory! User needs to enter it first.");
          console.error("[Auto-Fill] Tip: View or edit a credential in the app to load master password into memory.");
          return new Promise((resolve, reject) => {
            exec(`"${browserPath}" "${url}"`, (error) => {
              if (error) {
                console.error(`Failed to open ${browser}:`, error);
                reject({ success: false, error: `Failed to launch ${browser}` });
              } else {
                console.log(`Successfully opened ${url} in ${browser}`);
                resolve({ success: true, warning: "Master password not available for auto-fill" });
              }
            });
          });
        }
        const db2 = getDb();
        const credential = db2.prepare("SELECT * FROM credentials WHERE id = ? AND user_id = ?").get(credentialId, activeSession.userId);
        console.log(`[Auto-Fill] Credential found: ${credential ? "Yes" : "No"}`);
        if (credential) {
          console.log("[Auto-Fill] Decrypting credentials...");
          const encryptionKey = await deriveEncryptionKey(activeSession.masterPassword, activeSession.salt);
          const decryptedUsername = credential.username ? decryptPassword(credential.username, encryptionKey) : "";
          const decryptedPassword = decryptPassword(credential.password, encryptionKey);
          console.log(`[Auto-Fill] Decrypted - Username: ${decryptedUsername ? "Yes" : "No"}, Password: ${decryptedPassword ? "Yes" : "No"}`);
          const sent = sendToExtension({
            type: "credentials",
            url,
            username: decryptedUsername,
            password: decryptedPassword,
            autoClick: true
            // Enable auto-click for app-launched pages
          });
          if (sent) {
            console.log("[WebSocket] ✅ Credentials sent to extension");
          } else {
            console.warn("[WebSocket] ⚠️ No extension connected to receive credentials");
          }
        } else {
          console.error("[Auto-Fill] ❌ Credential not found in database");
        }
      } catch (error) {
        console.error("[Auto-Fill] ❌ Error processing credentials:", error);
      }
    } else if (credentialId && !activeSession) {
      console.error("[Auto-Fill] ❌ No active session!");
    }
    return new Promise((resolve, reject) => {
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
    console.error("Browser launch error:", error);
    return { success: false, error: "Failed to launch browser" };
  }
});
ipcMain.on("app-message", (event, arg) => {
  console.log("Received message from renderer:", arg);
  event.reply("app-reply", "Message received");
});
let activeSession = null;
function getDeviceFingerprint() {
  const deviceInfo = `${os.hostname()}-${os.platform()}-${os.arch()}-${os.userInfo().username}`;
  return createHash("sha256").update(deviceInfo).digest("hex").substring(0, 32);
}
ipcMain.handle("auth:signup", async (event, { username, password }) => {
  try {
    const db2 = getDb();
    const existingUser = db2.prepare("SELECT * FROM users WHERE username = ?").get(username);
    if (existingUser) {
      return { success: false, error: "Username already exists" };
    }
    const salt = generateSalt();
    const hashedPassword = hashPassword(password, salt);
    const result = db2.prepare(
      "INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)"
    ).run(username, hashedPassword, salt);
    return {
      success: true,
      user: {
        id: result.lastInsertRowid,
        username,
        salt
      }
    };
  } catch (error) {
    console.error("Signup error:", error);
    return { success: false, error: error.message || "Signup failed" };
  }
});
ipcMain.handle("auth:login", async (event, { username, password }) => {
  try {
    const rateLimit = checkLoginRateLimit(username);
    if (rateLimit.isBlocked) {
      return {
        success: false,
        error: `Too many failed login attempts. Please wait ${rateLimit.waitTime} seconds.`
      };
    }
    const db2 = getDb();
    const user = db2.prepare("SELECT * FROM users WHERE username = ?").get(username);
    if (!user) {
      recordFailedLogin(username);
      return {
        success: false,
        error: "Invalid username or password",
        attemptsRemaining: Math.max(0, 5 - (rateLimit.attemptsRemaining - 1))
      };
    }
    const isValid = verifyPassword(password, user.salt, user.password_hash);
    if (!isValid) {
      recordFailedLogin(username);
      const updatedLimit = checkLoginRateLimit(username);
      return {
        success: false,
        error: "Invalid username or password",
        attemptsRemaining: updatedLimit.attemptsRemaining
      };
    }
    clearLoginAttempts(username);
    activeSession = {
      userId: user.id,
      username: user.username,
      salt: user.salt,
      masterPassword: password
    };
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1e3;
    const deviceId = getDeviceFingerprint();
    store.set("user", {
      id: user.id,
      username: user.username,
      salt: user.salt,
      expiresAt,
      deviceId
    });
    console.log("User authenticated and persisted (expires in 30 days):", username);
    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        salt: user.salt
      }
    };
  } catch (error) {
    console.error("Login error:", error);
    return { success: false, error: error.message || "Login failed" };
  }
});
ipcMain.handle("auth:verify", async (event) => {
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
  const persistedUser = store.get("user");
  if (persistedUser) {
    console.log("Found persisted user, verifying session:", persistedUser.username);
    const now = Date.now();
    if (persistedUser.expiresAt && persistedUser.expiresAt < now) {
      console.log("Session expired, clearing");
      store.delete("user");
      return { success: false, error: "Session expired. Please log in again." };
    }
    const currentDeviceId = getDeviceFingerprint();
    if (persistedUser.deviceId && persistedUser.deviceId !== currentDeviceId) {
      console.log("Device mismatch, clearing session");
      store.delete("user");
      return { success: false, error: "Session invalid on this device. Please log in again." };
    }
    try {
      const db2 = getDb();
      const userInDb = db2.prepare("SELECT id, username, salt FROM users WHERE id = ?").get(persistedUser.id);
      if (userInDb) {
        console.log("User verified in database, restoring session");
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
        console.log("User not found in database, clearing persisted session");
        store.delete("user");
        activeSession = null;
        return { success: false, error: "Session expired or user not found" };
      }
    } catch (error) {
      console.error("Error verifying persisted user:", error);
      store.delete("user");
      activeSession = null;
      return { success: false, error: "Not authenticated" };
    }
  }
  return { success: false, error: "Not authenticated" };
});
ipcMain.handle("auth:logout", async (event) => {
  activeSession = null;
  store.delete("user");
  console.log("User logged out and session cleared");
  return { success: true };
});
ipcMain.handle("credentials:fetch", async (event, { masterPassword, categoryId, search }) => {
  try {
    if (!activeSession) {
      return { success: false, error: "Not authenticated" };
    }
    const encryptionKey = await deriveEncryptionKey(masterPassword, activeSession.salt);
    const db2 = getDb();
    let query = `
      SELECT 
        c.*,
        cat.name as category_name,
        cat.color as category_color
      FROM credentials c
      LEFT JOIN categories cat ON c.category_id = cat.id
      WHERE c.user_id = ?
    `;
    const params = [activeSession.userId];
    if (categoryId !== void 0 && categoryId !== null) {
      query += " AND c.category_id = ?";
      params.push(categoryId);
    }
    if (search) {
      query += " AND (c.title LIKE ? OR c.description LIKE ? OR c.site_link LIKE ?)";
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }
    query += " ORDER BY c.created_at DESC";
    const credentials = db2.prepare(query).all(...params);
    const decryptedCredentials = credentials.map((cred) => ({
      ...cred,
      password: decryptPassword(cred.password, encryptionKey),
      username: cred.username ? decryptPassword(cred.username, encryptionKey) : ""
    }));
    if (!activeSession.masterPassword) {
      activeSession.masterPassword = masterPassword;
      console.log("[Session] Master password loaded into memory for autofill");
    }
    return { success: true, credentials: decryptedCredentials };
  } catch (error) {
    console.error("Fetch credentials error:", error);
    return { success: false, error: error.message || "Failed to fetch credentials" };
  }
});
ipcMain.handle("credentials:create", async (event, data) => {
  try {
    if (!activeSession) {
      return { success: false, error: "Not authenticated" };
    }
    const { masterPassword, title, siteLink, username, password, description, categoryId } = data;
    const encryptionKey = await deriveEncryptionKey(masterPassword, activeSession.salt);
    const encryptedPassword = encryptPassword(password, encryptionKey);
    const encryptedUsername = username ? encryptPassword(username, encryptionKey) : "";
    const db2 = getDb();
    const result = db2.prepare(`
      INSERT INTO credentials (user_id, category_id, title, site_link, username, password, description)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      activeSession.userId,
      categoryId || null,
      title,
      siteLink || "",
      encryptedUsername,
      encryptedPassword,
      description || ""
    );
    return { success: true, id: result.lastInsertRowid };
  } catch (error) {
    console.error("Create credential error:", error);
    return { success: false, error: error.message || "Failed to create credential" };
  }
});
ipcMain.handle("credentials:update", async (event, data) => {
  try {
    if (!activeSession) {
      return { success: false, error: "Not authenticated" };
    }
    const { id, masterPassword, title, siteLink, username, password, description, categoryId } = data;
    const encryptionKey = await deriveEncryptionKey(masterPassword, activeSession.salt);
    const encryptedPassword = encryptPassword(password, encryptionKey);
    const encryptedUsername = username ? encryptPassword(username, encryptionKey) : "";
    const db2 = getDb();
    db2.prepare(`
      UPDATE credentials 
      SET category_id = ?, title = ?, site_link = ?, username = ?, password = ?, description = ?
      WHERE id = ? AND user_id = ?
    `).run(
      categoryId || null,
      title,
      siteLink || "",
      encryptedUsername,
      encryptedPassword,
      description || "",
      id,
      activeSession.userId
    );
    return { success: true };
  } catch (error) {
    console.error("Update credential error:", error);
    return { success: false, error: error.message || "Failed to update credential" };
  }
});
ipcMain.handle("credentials:delete", async (event, { id }) => {
  try {
    if (!activeSession) {
      return { success: false, error: "Not authenticated" };
    }
    const db2 = getDb();
    db2.prepare("DELETE FROM credentials WHERE id = ? AND user_id = ?").run(id, activeSession.userId);
    return { success: true };
  } catch (error) {
    console.error("Delete credential error:", error);
    return { success: false, error: error.message || "Failed to delete credential" };
  }
});
ipcMain.handle("categories:fetch", async (event) => {
  try {
    if (!activeSession) {
      return { success: false, error: "Not authenticated" };
    }
    const db2 = getDb();
    const categories = db2.prepare(`
      SELECT * FROM categories WHERE user_id = ? ORDER BY name ASC
    `).all(activeSession.userId);
    return { success: true, categories };
  } catch (error) {
    console.error("Fetch categories error:", error);
    return { success: false, error: error.message || "Failed to fetch categories" };
  }
});
ipcMain.handle("categories:create", async (event, { name, color }) => {
  try {
    if (!activeSession) {
      return { success: false, error: "Not authenticated" };
    }
    const db2 = getDb();
    const result = db2.prepare(`
      INSERT INTO categories (user_id, name, color) VALUES (?, ?, ?)
    `).run(activeSession.userId, name, color || "#D97757");
    return { success: true, id: result.lastInsertRowid };
  } catch (error) {
    console.error("Create category error:", error);
    return { success: false, error: error.message || "Failed to create category" };
  }
});
ipcMain.handle("categories:update", async (event, { id, name, color }) => {
  try {
    if (!activeSession) {
      return { success: false, error: "Not authenticated" };
    }
    const db2 = getDb();
    db2.prepare(`
      UPDATE categories 
      SET name = ?, color = ?
      WHERE id = ? AND user_id = ?
    `).run(name, color || "#D97757", id, activeSession.userId);
    return { success: true };
  } catch (error) {
    console.error("Update category error:", error);
    return { success: false, error: error.message || "Failed to update category" };
  }
});
ipcMain.handle("categories:delete", async (event, { id }) => {
  try {
    if (!activeSession) {
      return { success: false, error: "Not authenticated" };
    }
    const db2 = getDb();
    db2.prepare("DELETE FROM categories WHERE id = ? AND user_id = ?").run(id, activeSession.userId);
    return { success: true };
  } catch (error) {
    console.error("Delete category error:", error);
    return { success: false, error: error.message || "Failed to delete category" };
  }
});
ipcMain.handle("notes:fetch", async (event) => {
  try {
    if (!activeSession) {
      return { success: false, error: "Not authenticated" };
    }
    const db2 = getDb();
    const notes = db2.prepare(`
      SELECT * FROM notes WHERE user_id = ? ORDER BY updated_at DESC
    `).all(activeSession.userId);
    return { success: true, notes };
  } catch (error) {
    console.error("Fetch notes error:", error);
    return { success: false, error: error.message || "Failed to fetch notes" };
  }
});
ipcMain.handle("notes:create", async (event, { title, content, color }) => {
  try {
    if (!activeSession) {
      return { success: false, error: "Not authenticated" };
    }
    const db2 = getDb();
    const result = db2.prepare(`
      INSERT INTO notes (user_id, title, content, color)
      VALUES (?, ?, ?, ?)
    `).run(activeSession.userId, title, content || "", color || "#fbbf24");
    return { success: true, id: result.lastInsertRowid };
  } catch (error) {
    console.error("Create note error:", error);
    return { success: false, error: error.message || "Failed to create note" };
  }
});
ipcMain.handle("notes:update", async (event, { id, title, content, color, position_x, position_y, width, height }) => {
  try {
    if (!activeSession) {
      return { success: false, error: "Not authenticated" };
    }
    const db2 = getDb();
    const updates = [];
    const values = [];
    if (title !== void 0) {
      updates.push("title = ?");
      values.push(title);
    }
    if (content !== void 0) {
      updates.push("content = ?");
      values.push(content);
    }
    if (color !== void 0) {
      updates.push("color = ?");
      values.push(color);
    }
    if (position_x !== void 0) {
      updates.push("position_x = ?");
      values.push(position_x);
    }
    if (position_y !== void 0) {
      updates.push("position_y = ?");
      values.push(position_y);
    }
    if (width !== void 0) {
      updates.push("width = ?");
      values.push(width);
    }
    if (height !== void 0) {
      updates.push("height = ?");
      values.push(height);
    }
    updates.push("updated_at = CURRENT_TIMESTAMP");
    values.push(id, activeSession.userId);
    db2.prepare(`
      UPDATE notes SET ${updates.join(", ")}
      WHERE id = ? AND user_id = ?
    `).run(...values);
    return { success: true };
  } catch (error) {
    console.error("Update note error:", error);
    return { success: false, error: error.message || "Failed to update note" };
  }
});
ipcMain.handle("notes:delete", async (event, { id }) => {
  try {
    if (!activeSession) {
      return { success: false, error: "Not authenticated" };
    }
    const db2 = getDb();
    db2.prepare("DELETE FROM notes WHERE id = ? AND user_id = ?").run(id, activeSession.userId);
    return { success: true };
  } catch (error) {
    console.error("Delete note error:", error);
    return { success: false, error: error.message || "Failed to delete note" };
  }
});
app.whenReady().then(async () => {
  try {
    console.log("Initializing database...");
    initDb();
    console.log("Database initialized");
    initWebSocketServer();
    await createWindow();
  } catch (error) {
    console.error("Failed to start application:", error);
    app.quit();
  }
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createWindow();
  }
});
app.on("before-quit", () => {
  stickyNoteWindows.forEach((window) => {
    if (!window.isDestroyed()) {
      window.close();
    }
  });
  stickyNoteWindows.clear();
  if (wss) {
    console.log("[WebSocket] Closing server...");
    extensionClients.forEach((client) => {
      client.close();
    });
    extensionClients.clear();
    wss.close();
  }
});
process.on("SIGINT", () => {
  process.exit();
});
process.on("SIGTERM", () => {
  process.exit();
});
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
