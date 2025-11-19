import { Link, useNavigate } from 'react-router-dom';
import { Shield, Lock, Key, ArrowRight, X, Minus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api-client';

export default function HomePage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  // Check if user is already authenticated on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const result = await apiClient.verify();
        if (result.success) {
          console.log('User already authenticated, redirecting to dashboard');
          navigate('/dashboard', { replace: true });
        }
      } catch (error) {
        console.log('Not authenticated, staying on home page');
      } finally {
        setChecking(false);
      }
    };
    
    checkAuth();
  }, [navigate]);

  const handleMinimize = () => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.minimize();
    }
  };

  const handleClose = () => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.close();
    }
  };

  // Show loading while checking auth (prevents flash)
  if (checking) {
    return (
      <div className="min-h-screen bg-[#262624] flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#262624] flex flex-col overflow-hidden">
      {/* ===== HEADER / TITLE BAR ===== */}
      <header className="h-14 drag bg-[#30302E] border-b border-[#3a3a38]">
        <div className="flex items-center justify-between h-full px-4">
          {/* Left: App Name & Logo */}
          <div className="flex items-center gap-3">
            <div className="flex  items-center justify-center w-8 h-8 bg-[#D97757] rounded-lg">
              <Lock className="w-4 h-4 text-white" />
            </div>
            <div className="text-sm font-bold text-white">SecureVault</div>
          </div>

          {/* Right: Window Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleMinimize}
              className="p-2 no-drag hover:bg-[#262624] rounded-lg transition-colors text-gray-400 hover:text-white"
              title="Minimize"
            >
              <Minus className="w-4 h-4" />
            </button>
            
            <button
              onClick={handleClose}
              className="p-2 no-drag hover:bg-red-500/10 rounded-lg transition-colors text-gray-400 hover:text-red-400"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* ===== MAIN CONTENT ===== */}
      <div className="flex-1 flex items-center justify-center px-4 relative overflow-hidden">
        {/* Background Effect */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-[#D97757]/5 blur-3xl"></div>

        <div className="relative max-w-md w-full">
          {/* Main Card */}
          <div className="bg-[#30302E] rounded-2xl shadow-2xl border border-[#3a3a38] overflow-hidden">
            {/* Header Section */}
            <div className="pt-8 pb-6 px-8 text-center border-b border-[#3a3a38]">
              <div className="flex justify-center mb-4">
                <div className="relative">
                  <div className="w-16 h-16 bg-[#D97757] rounded-xl flex items-center justify-center shadow-lg">
                    <Shield className="w-8 h-8 text-white" strokeWidth={2.5} />
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-[#262624] border-2 border-[#D97757] rounded-lg flex items-center justify-center">
                    <Lock className="w-3 h-3 text-[#D97757]" strokeWidth={2.5} />
                  </div>
                </div>
              </div>

              <h1 className="text-2xl font-bold text-white mb-2">
                Welcome to SecureVault
              </h1>
              <p className="text-sm text-gray-400">
                Military-grade password protection
              </p>
            </div>

            {/* Content Section */}
            <div className="p-8">
              {/* Security Features - Compact */}
              <div className="mb-6 space-y-2">
                <div className="flex items-center gap-3 p-3 rounded-lg bg-[#262624] border border-[#3a3a38]">
                  <div className="w-8 h-8 bg-[#D97757]/10 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Key className="w-4 h-4 text-[#D97757]" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-white text-sm">Argon2 Encryption</h3>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 rounded-lg bg-[#262624] border border-[#3a3a38]">
                  <div className="w-8 h-8 bg-[#D97757]/10 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Shield className="w-4 h-4 text-[#D97757]" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-white text-sm">End-to-End Encrypted</h3>
                  </div>
                </div>
              </div>

              {/* Call to Action Buttons */}
              <div className="space-y-3">
                <Link to="/auth" className="block">
                  <button className="w-full bg-[#D97757] text-white py-3 px-4 rounded-xl hover:bg-[#c26848] transition-all duration-300 font-semibold text-sm shadow-lg flex items-center justify-center gap-2">
                    Login to Your Vault
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </Link>
                
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-[#3a3a38]"></div>
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="px-3 bg-[#30302E] text-gray-500 font-medium">or</span>
                  </div>
                </div>
                
                <Link to="/auth" className="block">
                  <button className="w-full bg-[#262624] text-gray-300 py-3 px-4 rounded-xl hover:bg-[#1f1f1d] transition-all duration-300 font-semibold text-sm border border-[#3a3a38] flex items-center justify-center gap-2">
                    Create New Account
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </Link>
              </div>

              {/* Security Notice - Compact */}
              <div className="mt-6 p-3 bg-[#262624] rounded-lg border border-[#3a3a38]">
                <p className="text-xs text-center text-gray-400">
                  🔐 Your data is encrypted and never stored in plain text
                </p>
              </div>
            </div>
          </div>

          {/* Footer Text */}
          <p className="text-center mt-4 text-xs text-gray-500">
            Trusted by security-conscious users worldwide
          </p>
        </div>
      </div>
    </div>
  );
}

