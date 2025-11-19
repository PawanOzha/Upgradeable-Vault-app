import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import './globals.css';
import HomePage from './pages/HomePage';
import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';
import StickyNotePage from './pages/StickyNotePage';
import { Download, RefreshCw, X, CheckCircle, AlertCircle } from 'lucide-react';

function App() {
  const [updateStatus, setUpdateStatus] = useState<string>('');
  const [updateInfo, setUpdateInfo] = useState<any>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);

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

      // Show modal when update is available or downloaded
      if (data.status === 'update-available' || data.status === 'download-progress' || data.status === 'update-downloaded') {
        setShowUpdateModal(true);
      }
    });

    return () => {
      cleanup?.();
    };
  }, []);

  const handleInstallUpdate = () => {
    window.electronAPI?.update?.quitAndInstall();
  };

  const handleDismiss = () => {
    if (updateStatus !== 'download-progress') {
      setShowUpdateModal(false);
    }
  };

  return (
    <HashRouter>
      {/* Custom Update Modal */}
      {showUpdateModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#30302E] rounded-2xl w-full max-w-md shadow-2xl border border-[#3a3a38] animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="p-6 border-b border-[#3a3a38]">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg mt-0.5 ${
                    updateStatus === 'update-downloaded'
                      ? 'bg-emerald-500/10'
                      : updateStatus === 'error'
                        ? 'bg-red-500/10'
                        : 'bg-[#D97757]/10'
                  }`}>
                    {updateStatus === 'update-downloaded' ? (
                      <CheckCircle className="w-5 h-5 text-emerald-400" />
                    ) : updateStatus === 'error' ? (
                      <AlertCircle className="w-5 h-5 text-red-400" />
                    ) : (
                      <Download className="w-5 h-5 text-[#D97757]" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white">
                      {updateStatus === 'update-downloaded'
                        ? 'Update Ready!'
                        : updateStatus === 'error'
                          ? 'Update Error'
                          : 'Update Available'}
                    </h3>
                    <p className="text-sm text-gray-400 mt-1">
                      {updateStatus === 'update-downloaded'
                        ? `Version ${updateInfo?.version} is ready to install`
                        : updateStatus === 'error'
                          ? updateInfo?.message
                          : `Downloading version ${updateInfo?.version || 'new update'}...`}
                    </p>
                  </div>
                </div>
                {updateStatus !== 'download-progress' && (
                  <button
                    onClick={handleDismiss}
                    className="p-1 hover:bg-[#3a3a38] rounded-lg transition-colors"
                  >
                    <X className="w-4 h-4 text-gray-400" />
                  </button>
                )}
              </div>
            </div>

            {/* Progress Bar */}
            {(updateStatus === 'download-progress' || updateStatus === 'update-available') && (
              <div className="px-6 py-4">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-400">Downloading...</span>
                  <span className="text-[#D97757] font-medium">
                    {updateInfo?.percent ? `${updateInfo.percent.toFixed(0)}%` : '0%'}
                  </span>
                </div>
                <div className="h-2 bg-[#262624] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#D97757] to-[#f59e0b] rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${updateInfo?.percent || 0}%` }}
                  />
                </div>
                {updateInfo?.bytesPerSecond && (
                  <p className="text-xs text-gray-500 mt-2">
                    {(updateInfo.bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s
                  </p>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="p-6 pt-0">
              {updateStatus === 'update-downloaded' ? (
                <div className="flex gap-3">
                  <button
                    onClick={handleDismiss}
                    className="flex-1 px-4 py-2.5 border border-[#3a3a38] rounded-xl hover:bg-[#262624] transition-colors font-medium text-gray-300"
                  >
                    Later
                  </button>
                  <button
                    onClick={handleInstallUpdate}
                    className="flex-1 px-4 py-2.5 bg-[#D97757] text-white rounded-xl hover:bg-[#c96847] transition-colors font-medium flex items-center justify-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Restart Now
                  </button>
                </div>
              ) : updateStatus === 'error' ? (
                <button
                  onClick={handleDismiss}
                  className="w-full px-4 py-2.5 border border-[#3a3a38] rounded-xl hover:bg-[#262624] transition-colors font-medium text-gray-300"
                >
                  Close
                </button>
              ) : (
                <p className="text-xs text-gray-500 text-center">
                  Please wait while the update downloads...
                </p>
              )}
            </div>
          </div>
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

