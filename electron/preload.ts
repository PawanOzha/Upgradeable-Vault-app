import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface NoteData {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  alwaysOnTop?: boolean;
}

type BoundsCallback = (bounds: WindowBounds) => void;
type AlwaysOnTopCallback = (isAlwaysOnTop: boolean) => void;
type MessageCallback = (...args: any[]) => void;

// ============================================================================
// ELECTRON API - Your Custom APIs
// ============================================================================

const electronAPI = {
  // ========== WINDOW CONTROL ==========
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  
  // ========== STICKY NOTE WINDOW CONTROL ==========
  stickyNoteMinimize: () => ipcRenderer.send('sticky-note-minimize'),
  stickyNoteClose: () => ipcRenderer.send('sticky-note-close'),
  stickyNoteToggleAlwaysOnTop: () => ipcRenderer.send('sticky-note-toggle-always-on-top'),
  
  // ========== STICKY NOTE MANAGEMENT ==========
  openStickyNote: (noteId: string, noteData?: NoteData) =>
    ipcRenderer.send('open-sticky-note', noteId, noteData),
  closeStickyNoteWindow: (noteId: string) =>
    ipcRenderer.send('close-sticky-note-window', noteId),

  // ========== BROWSER CONTROL ==========
  openInBrowser: (url: string, browser: 'chrome' | 'brave' | 'edge', credentialId?: number) =>
    ipcRenderer.invoke('open-in-browser', url, browser, credentialId),
  
  // ========== EXTENSION PAIRING ==========
  getAppId: () => ipcRenderer.invoke('get-app-id'),

  // ========== WINDOW BOUNDS ==========
  getWindowBounds: (): Promise<WindowBounds | null> => 
    ipcRenderer.invoke('get-window-bounds'),
  onWindowBoundsChanged: (callback: BoundsCallback) => {
    const listener = (_event: IpcRendererEvent, bounds: WindowBounds) => callback(bounds);
    ipcRenderer.on('window-bounds-changed', listener);
    return () => ipcRenderer.removeListener('window-bounds-changed', listener);
  },
  onAlwaysOnTopChanged: (callback: AlwaysOnTopCallback) => {
    const listener = (_event: IpcRendererEvent, isAlwaysOnTop: boolean) => callback(isAlwaysOnTop);
    ipcRenderer.on('sticky-note-always-on-top-changed', listener);
    return () => ipcRenderer.removeListener('sticky-note-always-on-top-changed', listener);
  },

  // ========== SESSION MANAGEMENT ==========
  onClearSessionStorage: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('clear-session-storage', listener);
    return () => ipcRenderer.removeListener('clear-session-storage', listener);
  },

  // ========== MASTER PASSWORD PROMPT ==========
  onPromptMasterPassword: (callback: (data: { reason: string; url: string }) => void) => {
    const listener = (_event: IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('prompt-master-password', listener);
    return () => ipcRenderer.removeListener('prompt-master-password', listener);
  },
  sendMasterPassword: (password: string) => 
    ipcRenderer.invoke('master-password-response', password),
  
  // ========== AUTH API ==========
  auth: {
    signup: (username: string, password: string) => 
      ipcRenderer.invoke('auth:signup', { username, password }),
    login: (username: string, password: string) => 
      ipcRenderer.invoke('auth:login', { username, password }),
    verify: () => 
      ipcRenderer.invoke('auth:verify'),
    logout: () => 
      ipcRenderer.invoke('auth:logout'),
  },
  
  // ========== CREDENTIALS API ==========
  credentials: {
    fetch: (masterPassword: string, categoryId?: number | null, search?: string) => 
      ipcRenderer.invoke('credentials:fetch', { masterPassword, categoryId, search }),
    create: (data: any) => 
      ipcRenderer.invoke('credentials:create', data),
    update: (data: any) => 
      ipcRenderer.invoke('credentials:update', data),
    delete: (id: number) => 
      ipcRenderer.invoke('credentials:delete', { id }),
  },
  
  // ========== CATEGORIES API ==========
  categories: {
    fetch: () => 
      ipcRenderer.invoke('categories:fetch'),
    create: (name: string, color: string) => 
      ipcRenderer.invoke('categories:create', { name, color }),
    update: (id: number, name: string, color: string) => 
      ipcRenderer.invoke('categories:update', { id, name, color }),
    delete: (id: number) => 
      ipcRenderer.invoke('categories:delete', { id }),
  },
  
  // ========== NOTES API ==========
  notes: {
    fetch: () => 
      ipcRenderer.invoke('notes:fetch'),
    create: (title: string, content?: string, color?: string) => 
      ipcRenderer.invoke('notes:create', { title, content, color }),
    update: (id: number, data: any) => 
      ipcRenderer.invoke('notes:update', { id, ...data }),
    delete: (id: number) => 
      ipcRenderer.invoke('notes:delete', { id }),
  },
  
  // ========== GENERAL IPC ==========
  sendMessage: (channel: string, data?: any) => {
    const validChannels = ['app-message'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  receiveMessage: (channel: string, func: MessageCallback) => {
    const validChannels = ['app-reply', 'main-process-message'];
    if (validChannels.includes(channel)) {
      const listener = (_event: IpcRendererEvent, ...args: any[]) => func(...args);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    }
  },
  
  // ========== SYSTEM INFO ==========
  platform: process.platform,
  isElectron: true
};

// ============================================================================
// IPC RENDERER - Vite-Electron Generic IPC API
// ============================================================================

const ipcRendererAPI = {
  on(channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void) {
    ipcRenderer.on(channel, listener);
    // Return cleanup function
    return () => ipcRenderer.removeListener(channel, listener);
  },
  
  off(channel: string, listener?: (...args: any[]) => void) {
    if (listener) {
      ipcRenderer.removeListener(channel, listener);
    } else {
      ipcRenderer.removeAllListeners(channel);
    }
  },
  
  send(channel: string, ...args: any[]) {
    ipcRenderer.send(channel, ...args);
  },
  
  invoke(channel: string, ...args: any[]): Promise<any> {
    return ipcRenderer.invoke(channel, ...args);
  },
  
  // Additional utility methods
  once(channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void) {
    ipcRenderer.once(channel, listener);
  },
  
  removeAllListeners(channel: string) {
    ipcRenderer.removeAllListeners(channel);
  }
};

// ============================================================================
// EXPOSE TO RENDERER PROCESS
// ============================================================================

// Expose your custom Electron API
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Expose generic IPC renderer for flexibility (Vite-Electron style)
contextBridge.exposeInMainWorld('ipcRenderer', ipcRendererAPI);

// ============================================================================
// TYPE DECLARATIONS FOR RENDERER PROCESS
// ============================================================================

// Add this to your global.d.ts or types file:
/*
declare global {
  interface Window {
    electronAPI: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      stickyNoteMinimize: () => void;
      stickyNoteClose: () => void;
      stickyNoteToggleAlwaysOnTop: () => void;
      openStickyNote: (noteId: string, noteData?: NoteData) => void;
      closeStickyNoteWindow: (noteId: string) => void;
      getWindowBounds: () => Promise<WindowBounds | null>;
      onWindowBoundsChanged: (callback: (bounds: WindowBounds) => void) => () => void;
      onAlwaysOnTopChanged: (callback: (isAlwaysOnTop: boolean) => void) => () => void;
      sendMessage: (channel: string, data?: any) => void;
      receiveMessage: (channel: string, func: (...args: any[]) => void) => (() => void) | undefined;
      platform: NodeJS.Platform;
      isElectron: boolean;
    };
    
    ipcRenderer: {
      on: (channel: string, listener: (event: any, ...args: any[]) => void) => () => void;
      off: (channel: string, listener?: (...args: any[]) => void) => void;
      send: (channel: string, ...args: any[]) => void;
      invoke: (channel: string, ...args: any[]) => Promise<any>;
      once: (channel: string, listener: (event: any, ...args: any[]) => void) => void;
      removeAllListeners: (channel: string) => void;
    };
  }
}

export {};
*/