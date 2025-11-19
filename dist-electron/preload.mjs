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
  isElectron: true
};
const ipcRendererAPI = {
  on(channel, listener) {
    electron.ipcRenderer.on(channel, listener);
    return () => electron.ipcRenderer.removeListener(channel, listener);
  },
  off(channel, listener) {
    if (listener) {
      electron.ipcRenderer.removeListener(channel, listener);
    } else {
      electron.ipcRenderer.removeAllListeners(channel);
    }
  },
  send(channel, ...args) {
    electron.ipcRenderer.send(channel, ...args);
  },
  invoke(channel, ...args) {
    return electron.ipcRenderer.invoke(channel, ...args);
  },
  // Additional utility methods
  once(channel, listener) {
    electron.ipcRenderer.once(channel, listener);
  },
  removeAllListeners(channel) {
    electron.ipcRenderer.removeAllListeners(channel);
  }
};
electron.contextBridge.exposeInMainWorld("electronAPI", electronAPI);
electron.contextBridge.exposeInMainWorld("ipcRenderer", ipcRendererAPI);
