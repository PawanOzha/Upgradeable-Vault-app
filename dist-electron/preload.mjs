"use strict";
const electron = require("electron");
const electronAPI = {
  // ========== WINDOW CONTROL ==========
  minimize: () => electron.ipcRenderer.send("window-minimize"),
  maximize: () => electron.ipcRenderer.send("window-maximize"),
  close: () => electron.ipcRenderer.send("window-close"),
  // ========== STICKY NOTE WINDOW CONTROL ==========
  stickyNoteMinimize: () => electron.ipcRenderer.send("sticky-note-minimize"),
  stickyNoteClose: () => electron.ipcRenderer.send("sticky-note-close"),
  stickyNoteToggleAlwaysOnTop: () => electron.ipcRenderer.send("sticky-note-toggle-always-on-top"),
  // ========== MAIL WINDOW CONTROL ==========
  openMailWindow: () => electron.ipcRenderer.send("open-mail-window"),
  mailWindowMinimize: () => electron.ipcRenderer.send("mail-window-minimize"),
  mailWindowMaximize: () => electron.ipcRenderer.send("mail-window-maximize"),
  mailWindowClose: () => electron.ipcRenderer.send("mail-window-close"),
  // ========== EXTERNAL LINK ==========
  openExternal: (url) => electron.ipcRenderer.send("open-external-url", url),
  // ========== STICKY NOTE MANAGEMENT ==========
  openStickyNote: (noteId, noteData) => electron.ipcRenderer.send("open-sticky-note", noteId, noteData),
  closeStickyNoteWindow: (noteId) => electron.ipcRenderer.send("close-sticky-note-window", noteId),
  // ========== BROWSER CONTROL ==========
  openInBrowser: (url, browser, credentialId) => electron.ipcRenderer.invoke("open-in-browser", url, browser, credentialId),
  // ========== EXTENSION PAIRING ==========
  getAppId: () => electron.ipcRenderer.invoke("get-app-id"),
  // ========== WINDOW BOUNDS ==========
  getWindowBounds: () => electron.ipcRenderer.invoke("get-window-bounds"),
  onWindowBoundsChanged: (callback) => {
    const listener = (_event, bounds) => callback(bounds);
    electron.ipcRenderer.on("window-bounds-changed", listener);
    return () => electron.ipcRenderer.removeListener("window-bounds-changed", listener);
  },
  onAlwaysOnTopChanged: (callback) => {
    const listener = (_event, isAlwaysOnTop) => callback(isAlwaysOnTop);
    electron.ipcRenderer.on("sticky-note-always-on-top-changed", listener);
    return () => electron.ipcRenderer.removeListener("sticky-note-always-on-top-changed", listener);
  },
  // ========== SESSION MANAGEMENT ==========
  onClearSessionStorage: (callback) => {
    const listener = () => callback();
    electron.ipcRenderer.on("clear-session-storage", listener);
    return () => electron.ipcRenderer.removeListener("clear-session-storage", listener);
  },
  // ========== MASTER PASSWORD PROMPT ==========
  onPromptMasterPassword: (callback) => {
    const listener = (_event, data) => callback(data);
    electron.ipcRenderer.on("prompt-master-password", listener);
    return () => electron.ipcRenderer.removeListener("prompt-master-password", listener);
  },
  sendMasterPassword: (password) => electron.ipcRenderer.invoke("master-password-response", password),
  // ========== AUTH API ==========
  auth: {
    signup: (username, password) => electron.ipcRenderer.invoke("auth:signup", { username, password }),
    login: (username, password) => electron.ipcRenderer.invoke("auth:login", { username, password }),
    verify: () => electron.ipcRenderer.invoke("auth:verify"),
    logout: () => electron.ipcRenderer.invoke("auth:logout")
  },
  // ========== CREDENTIALS API ==========
  credentials: {
    fetch: (masterPassword, categoryId, search) => electron.ipcRenderer.invoke("credentials:fetch", { masterPassword, categoryId, search }),
    create: (data) => electron.ipcRenderer.invoke("credentials:create", data),
    update: (data) => electron.ipcRenderer.invoke("credentials:update", data),
    delete: (id) => electron.ipcRenderer.invoke("credentials:delete", { id })
  },
  // ========== CATEGORIES API ==========
  categories: {
    fetch: () => electron.ipcRenderer.invoke("categories:fetch"),
    create: (name, color) => electron.ipcRenderer.invoke("categories:create", { name, color }),
    update: (id, name, color) => electron.ipcRenderer.invoke("categories:update", { id, name, color }),
    delete: (id) => electron.ipcRenderer.invoke("categories:delete", { id })
  },
  // ========== NOTES API ==========
  notes: {
    fetch: () => electron.ipcRenderer.invoke("notes:fetch"),
    create: (title, content, color) => electron.ipcRenderer.invoke("notes:create", { title, content, color }),
    update: (id, data) => electron.ipcRenderer.invoke("notes:update", { id, ...data }),
    delete: (id) => electron.ipcRenderer.invoke("notes:delete", { id })
  },
  // ========== GENERAL IPC ==========
  sendMessage: (channel, data) => {
    const validChannels = ["app-message"];
    if (validChannels.includes(channel)) {
      electron.ipcRenderer.send(channel, data);
    }
  },
  receiveMessage: (channel, func) => {
    const validChannels = ["app-reply", "main-process-message"];
    if (validChannels.includes(channel)) {
      const listener = (_event, ...args) => func(...args);
      electron.ipcRenderer.on(channel, listener);
      return () => electron.ipcRenderer.removeListener(channel, listener);
    }
  },
  // ========== SYSTEM INFO ==========
  platform: process.platform,
  isElectron: true,
  // ========== AUTO-UPDATE API ==========
  update: {
    checkForUpdates: () => electron.ipcRenderer.invoke("check-for-updates"),
    quitAndInstall: () => electron.ipcRenderer.invoke("quit-and-install"),
    getAppVersion: () => electron.ipcRenderer.invoke("get-app-version"),
    onUpdateStatus: (callback) => {
      const listener = (_event, data) => callback(data);
      electron.ipcRenderer.on("update-status", listener);
      return () => electron.ipcRenderer.removeListener("update-status", listener);
    }
  },
  // ========== MAIL API ==========
  mail: {
    // Account Management
    getAccounts: () => electron.ipcRenderer.invoke("mail:getAccounts"),
    addAccount: (account, password) => electron.ipcRenderer.invoke("mail:addAccount", { account, password }),
    deleteAccount: (accountId) => electron.ipcRenderer.invoke("mail:deleteAccount", { accountId }),
    testConnection: (account, password) => electron.ipcRenderer.invoke("mail:testConnection", { account, password }),
    // Folder Management
    getFolders: (accountId) => electron.ipcRenderer.invoke("mail:getFolders", { accountId }),
    syncFolders: (accountId, password) => electron.ipcRenderer.invoke("mail:syncFolders", { accountId, password }),
    // Email Operations
    getEmails: (accountId, folder, password, limit) => electron.ipcRenderer.invoke("mail:getEmails", { accountId, folder, password, limit }),
    getEmailsFresh: (accountId, folder, password, limit) => electron.ipcRenderer.invoke("mail:getEmailsFresh", { accountId, folder, password, limit }),
    getEmail: (emailId) => electron.ipcRenderer.invoke("mail:getEmail", { emailId }),
    fetchEmailBody: (accountId, emailId, password) => electron.ipcRenderer.invoke("mail:fetchEmailBody", { accountId, emailId, password }),
    sendEmail: (accountId, draft, password) => electron.ipcRenderer.invoke("mail:sendEmail", { accountId, draft, password }),
    markAsRead: (accountId, emailId, isRead, password) => electron.ipcRenderer.invoke("mail:markAsRead", { accountId, emailId, isRead, password }),
    deleteEmail: (accountId, emailId, password) => electron.ipcRenderer.invoke("mail:deleteEmail", { accountId, emailId, password }),
    // Attachment Operations
    openAttachment: (attachmentPath) => electron.ipcRenderer.invoke("mail:openAttachment", { attachmentPath }),
    // IMAP IDLE (Push Notifications)
    startIdle: (accountId, folder) => electron.ipcRenderer.invoke("mail:startIdle", { accountId, folder }),
    stopIdle: (accountId) => electron.ipcRenderer.invoke("mail:stopIdle", { accountId }),
    onNewMail: (callback) => {
      const listener = (_event, data) => callback(data);
      electron.ipcRenderer.on("mail:newMail", listener);
      return () => electron.ipcRenderer.removeListener("mail:newMail", listener);
    },
    // Reputation Checker
    checkReputation: (accountId) => electron.ipcRenderer.invoke("mail:checkReputation", { accountId }),
    // Signature Operations
    getSignatures: (accountId) => electron.ipcRenderer.invoke("mail:getSignatures", { accountId }),
    getDefaultSignature: (accountId) => electron.ipcRenderer.invoke("mail:getDefaultSignature", { accountId }),
    addSignature: (accountId, name, htmlContent, isDefault) => electron.ipcRenderer.invoke("mail:addSignature", { accountId, name, htmlContent, isDefault }),
    updateSignature: (signatureId, name, htmlContent, isDefault) => electron.ipcRenderer.invoke("mail:updateSignature", { signatureId, name, htmlContent, isDefault }),
    deleteSignature: (signatureId) => electron.ipcRenderer.invoke("mail:deleteSignature", { signatureId })
  },
  // ========== AI EMAIL VALIDATION ==========
  validateEmail: (subject, body) => electron.ipcRenderer.invoke("openai:validateEmail", { subject, body }),
  generateEmail: (subject, body, context) => electron.ipcRenderer.invoke("openai:generateEmail", { subject, body, context })
};
const ALLOWED_SEND_CHANNELS = [
  "app-message",
  "window-minimize",
  "window-maximize",
  "window-close",
  "sticky-note-minimize",
  "sticky-note-close",
  "sticky-note-toggle-always-on-top",
  "open-sticky-note",
  "close-sticky-note-window",
  "open-mail-window",
  "mail-window-minimize",
  "mail-window-maximize",
  "mail-window-close"
];
const ALLOWED_RECEIVE_CHANNELS = [
  "app-reply",
  "main-process-message",
  "update-status",
  "window-bounds-changed",
  "sticky-note-always-on-top-changed",
  "clear-session-storage",
  "prompt-master-password",
  "mail:newMail"
];
const ALLOWED_INVOKE_CHANNELS = [
  "auth:signup",
  "auth:login",
  "auth:verify",
  "auth:logout",
  "auth:verifyMasterPassword",
  "credentials:fetch",
  "credentials:create",
  "credentials:update",
  "credentials:delete",
  "categories:fetch",
  "categories:create",
  "categories:update",
  "categories:delete",
  "notes:fetch",
  "notes:create",
  "notes:update",
  "notes:delete",
  "apikeys:fetch",
  "apikeys:save",
  "apikeys:delete",
  "backup:create",
  "backup:list",
  "backup:restore",
  "backup:getPath",
  "openai:analyzeEmail",
  "openai:reformatEmail",
  "openai:validateEmail",
  "openai:generateEmail",
  "check-for-updates",
  "quit-and-install",
  "mail:getAccounts",
  "mail:addAccount",
  "mail:deleteAccount",
  "mail:testConnection",
  "mail:getFolders",
  "mail:syncFolders",
  "mail:getEmails",
  "mail:getEmailsFresh",
  "mail:getEmail",
  "mail:fetchEmailBody",
  "mail:sendEmail",
  "mail:markAsRead",
  "mail:deleteEmail",
  "mail:openAttachment",
  "mail:startIdle",
  "mail:stopIdle",
  "mail:checkReputation",
  "mail:getSignatures",
  "mail:getDefaultSignature",
  "mail:addSignature",
  "mail:updateSignature",
  "mail:deleteSignature",
  "get-app-version",
  "get-app-id",
  "get-window-bounds",
  "open-in-browser",
  "master-password-response"
];
const ipcRendererAPI = {
  on(channel, listener) {
    if (!ALLOWED_RECEIVE_CHANNELS.includes(channel)) {
      console.warn(`[Security] Blocked listening on unauthorized channel: ${channel}`);
      return () => {
      };
    }
    electron.ipcRenderer.on(channel, listener);
    return () => electron.ipcRenderer.removeListener(channel, listener);
  },
  off(channel, listener) {
    if (!ALLOWED_RECEIVE_CHANNELS.includes(channel)) {
      console.warn(`[Security] Blocked removing listener on unauthorized channel: ${channel}`);
      return;
    }
    if (listener) {
      electron.ipcRenderer.removeListener(channel, listener);
    } else {
      electron.ipcRenderer.removeAllListeners(channel);
    }
  },
  send(channel, ...args) {
    if (!ALLOWED_SEND_CHANNELS.includes(channel)) {
      console.warn(`[Security] Blocked send on unauthorized channel: ${channel}`);
      return;
    }
    electron.ipcRenderer.send(channel, ...args);
  },
  invoke(channel, ...args) {
    if (!ALLOWED_INVOKE_CHANNELS.includes(channel)) {
      console.warn(`[Security] Blocked invoke on unauthorized channel: ${channel}`);
      return Promise.reject(new Error(`Unauthorized channel: ${channel}`));
    }
    return electron.ipcRenderer.invoke(channel, ...args);
  },
  // Additional utility methods
  once(channel, listener) {
    if (!ALLOWED_RECEIVE_CHANNELS.includes(channel)) {
      console.warn(`[Security] Blocked once on unauthorized channel: ${channel}`);
      return;
    }
    electron.ipcRenderer.once(channel, listener);
  },
  removeAllListeners(channel) {
    if (!ALLOWED_RECEIVE_CHANNELS.includes(channel)) {
      console.warn(`[Security] Blocked removeAllListeners on unauthorized channel: ${channel}`);
      return;
    }
    electron.ipcRenderer.removeAllListeners(channel);
  }
};
electron.contextBridge.exposeInMainWorld("electronAPI", electronAPI);
electron.contextBridge.exposeInMainWorld("ipcRenderer", ipcRendererAPI);
