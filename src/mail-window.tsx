/**
 * Es Mail - Standalone Email Client Window
 * Launched as a separate sandboxed Electron window
 */

import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import './globals.css';
import MailView from './mail/components/MailView';

function MailWindow() {
  useEffect(() => {
    // Debug logging for electronAPI availability
    console.log('[Mail Window Component] Mounted');
    console.log('[Mail Window Component] window.electronAPI:', window.electronAPI);
    console.log('[Mail Window Component] window.electronAPI?.mail:', window.electronAPI?.mail);

    if (!window.electronAPI) {
      console.error('[Mail Window Component] ⚠️ electronAPI is NOT available! Check preload script.');
    } else if (!window.electronAPI.mail) {
      console.error('[Mail Window Component] ⚠️ electronAPI.mail is NOT available! Check preload script mail API.');
    } else {
      console.log('[Mail Window Component] ✅ electronAPI.mail is ready');
    }
  }, []);

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#262624]">
      <MailView standalone={true} />
    </div>
  );
}

// Temporarily disable StrictMode for debugging
ReactDOM.createRoot(document.getElementById('root')!).render(
  <MailWindow />
);
