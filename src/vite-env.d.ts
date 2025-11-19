/// <reference types="vite/client" />

declare global {
  interface Window {
    electronAPI?: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      stickyNoteMinimize: () => void;
      stickyNoteClose: () => void;
      stickyNoteToggleAlwaysOnTop: () => void;
      openStickyNote: (noteId: string, noteData?: any) => void;
      closeStickyNoteWindow: (noteId: string) => void;
      openInBrowser: (url: string, browser: 'chrome' | 'brave' | 'edge', credentialId?: number) => Promise<any>;
      getWindowBounds: () => Promise<any>;
      onWindowBoundsChanged: (callback: (bounds: any) => void) => () => void;
      onAlwaysOnTopChanged: (callback: (isAlwaysOnTop: boolean) => void) => () => void;
      onClearSessionStorage: (callback: () => void) => () => void;
      sendMessage: (channel: string, data?: any) => void;
      receiveMessage: (channel: string, func: (...args: any[]) => void) => (() => void) | undefined;
      platform: NodeJS.Platform;
      isElectron: boolean;
    };
  }
}

export {};
