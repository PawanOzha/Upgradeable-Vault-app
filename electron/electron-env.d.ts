/// <reference types="vite-plugin-electron/electron-env" />

// ============================================================================
// PROCESS ENV TYPES
// ============================================================================

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
    /** Vite dev server URL */
    VITE_DEV_SERVER_URL?: string
    /** Use Next.js server instead of Vite */
    USE_NEXTJS?: string
    /** Port for Next.js server */
    PORT?: string
    /** Node environment */
    NODE_ENV?: 'development' | 'production'
  }
}

// ============================================================================
// CUSTOM TYPE DEFINITIONS
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

// ============================================================================
// WINDOW API DECLARATIONS
// ============================================================================

// Used in Renderer process, exposed in `preload.ts`
interface Window {
  /**
   * Custom Electron API - Complete Password Manager API
   */
  electronAPI: {
    // ========== WINDOW CONTROL ==========
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    
    // ========== STICKY NOTE WINDOW CONTROL ==========
    stickyNoteMinimize: () => void;
    stickyNoteClose: () => void;
    stickyNoteToggleAlwaysOnTop: () => void;
    
    // ========== STICKY NOTE MANAGEMENT ==========
    openStickyNote: (noteId: string, noteData?: NoteData) => void;
    closeStickyNoteWindow: (noteId: string) => void;
    
    // ========== WINDOW BOUNDS ==========
    getWindowBounds: () => Promise<WindowBounds | null>;
    onWindowBoundsChanged: (callback: (bounds: WindowBounds) => void) => () => void;
    onAlwaysOnTopChanged: (callback: (isAlwaysOnTop: boolean) => void) => () => void;

    // ========== SESSION MANAGEMENT ==========
    onClearSessionStorage: (callback: () => void) => () => void;
    
    // ========== AUTH API ==========
    auth: {
      signup: (username: string, password: string) => Promise<{
        success: boolean;
        user?: { id: number; username: string; salt: string };
        error?: string;
      }>;
      login: (username: string, password: string) => Promise<{
        success: boolean;
        user?: { id: number; username: string; salt: string };
        error?: string;
      }>;
      verify: () => Promise<{
        success: boolean;
        user?: { id: number; username: string; salt: string };
        error?: string;
      }>;
      logout: () => Promise<{ success: boolean }>;
    };
    
    // ========== CREDENTIALS API ==========
    credentials: {
      fetch: (masterPassword: string, categoryId?: number | null, search?: string) => Promise<{
        success: boolean;
        credentials?: any[];
        error?: string;
      }>;
      create: (data: any) => Promise<{ success: boolean; id?: number; error?: string }>;
      update: (data: any) => Promise<{ success: boolean; error?: string }>;
      delete: (id: number) => Promise<{ success: boolean; error?: string }>;
    };
    
    // ========== CATEGORIES API ==========
    categories: {
      fetch: () => Promise<{ success: boolean; categories?: any[]; error?: string }>;
      create: (name: string, color: string) => Promise<{ success: boolean; id?: number; error?: string }>;
      delete: (id: number) => Promise<{ success: boolean; error?: string }>;
    };
    
    // ========== NOTES API ==========
    notes: {
      fetch: () => Promise<{ success: boolean; notes?: any[]; error?: string }>;
      create: (title: string, content?: string, color?: string) => Promise<{ success: boolean; id?: number; error?: string }>;
      update: (id: number, data: any) => Promise<{ success: boolean; error?: string }>;
      delete: (id: number) => Promise<{ success: boolean; error?: string }>;
    };
    
    // ========== GENERAL IPC ==========
    sendMessage: (channel: string, data?: any) => void;
    receiveMessage: (channel: string, func: (...args: any[]) => void) => (() => void) | undefined;
    
    // ========== SYSTEM INFO ==========
    platform: NodeJS.Platform;
    isElectron: boolean;
  };
  
  /**
   * Generic IPC Renderer - Vite-Electron style for flexibility
   */
  ipcRenderer: {
    on: (channel: string, listener: (event: any, ...args: any[]) => void) => () => void;
    off: (channel: string, listener?: (...args: any[]) => void) => void;
    send: (channel: string, ...args: any[]) => void;
    invoke: (channel: string, ...args: any[]) => Promise<any>;
    once: (channel: string, listener: (event: any, ...args: any[]) => void) => void;
    removeAllListeners: (channel: string) => void;
  };
}