import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import './globals.css';
import HomePage from './pages/HomePage';
import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';
import StickyNotePage from './pages/StickyNotePage';

function App() {
  const [updateStatus, setUpdateStatus] = useState<string>('');
  const [updateInfo, setUpdateInfo] = useState<any>(null);

  // Listen for app close event to clear session storage
  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) return;

    const cleanup = electronAPI.onClearSessionStorage?.(() => {
      console.log('Clearing session storage (app closing)');
      sessionStorage.clear();
    });

    return () => {
      cleanup?.();
    };
  }, []);

  // Listen for update status events
  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!electronAPI?.update?.onUpdateStatus) return;

    const cleanup = electronAPI.update.onUpdateStatus((data: { status: string; data?: any }) => {
      console.log('[Update Status]', data.status, data.data);
      setUpdateStatus(data.status);
      if (data.data) setUpdateInfo(data.data);
    });

    return () => {
      cleanup?.();
    };
  }, []);

  const handleInstallUpdate = () => {
    window.electronAPI?.update?.quitAndInstall();
  };

  return (
    <HashRouter>
      {/* Update notification banner */}
      {updateStatus === 'update-available' && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          background: '#3b82f6',
          color: 'white',
          padding: '8px 16px',
          textAlign: 'center',
          zIndex: 9999,
          fontSize: '14px'
        }}>
          Downloading update v{updateInfo?.version}...
        </div>
      )}
      {updateStatus === 'download-progress' && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          background: '#3b82f6',
          color: 'white',
          padding: '8px 16px',
          textAlign: 'center',
          zIndex: 9999,
          fontSize: '14px'
        }}>
          Downloading update: {updateInfo?.percent?.toFixed(0)}%
        </div>
      )}
      {updateStatus === 'update-downloaded' && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          background: '#22c55e',
          color: 'white',
          padding: '8px 16px',
          textAlign: 'center',
          zIndex: 9999,
          fontSize: '14px',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '12px'
        }}>
          <span>Update v{updateInfo?.version} ready!</span>
          <button
            onClick={handleInstallUpdate}
            style={{
              background: 'white',
              color: '#22c55e',
              border: 'none',
              padding: '4px 12px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            Restart Now
          </button>
        </div>
      )}
      {updateStatus === 'error' && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          background: '#ef4444',
          color: 'white',
          padding: '8px 16px',
          textAlign: 'center',
          zIndex: 9999,
          fontSize: '14px'
        }}>
          Update error: {updateInfo?.message}
        </div>
      )}

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/sticky-note/:id" element={<StickyNotePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}

export default App;

