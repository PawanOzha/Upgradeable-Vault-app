import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import './globals.css';
import HomePage from './pages/HomePage';
import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';
import StickyNotePage from './pages/StickyNotePage';

function App() {
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

  return (
    <HashRouter>
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

