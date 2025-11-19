import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, User, Eye, EyeOff, Key, X, Minus } from 'lucide-react';
import { apiClient } from '../lib/api-client';

export default function AuthPage() {
  const navigate = useNavigate();
  const [isLogin, setIsLogin] = useState(true);
  
  // Login form
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  
  // Register form
  const [registerUsername, setRegisterUsername] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState('');
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await apiClient.login(loginUsername, loginPassword);
      
      // Store the password in session storage to use as master password
      sessionStorage.setItem('mp', loginPassword);
      
      // Redirect to dashboard
      navigate('/dashboard');
    } catch (err: any) {
      console.error('Login error:', err);
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validation
    if (registerPassword !== registerConfirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (registerPassword.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    if (registerUsername.length < 3) {
      setError('Username must be at least 3 characters long');
      return;
    }

    setLoading(true);

    try {
      console.log('Attempting to register with username:', registerUsername);
      
      await apiClient.signup(registerUsername, registerPassword);
      
      // Auto-login after registration
      sessionStorage.setItem('mp', registerPassword);
      
      console.log('Registration successful, attempting auto-login...');
      
      // Login the user
      await apiClient.login(registerUsername, registerPassword);
      
      console.log('Auto-login successful, redirecting...');
      navigate('/dashboard');
    } catch (err: any) {
      console.error('Registration error:', err);
      setError(err.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen bg-[#262624] flex flex-col overflow-hidden">
      {/* ===== HEADER / TITLE BAR ===== */}
      <header className="h-14 drag bg-[#30302E] border-b border-[#3a3a38]">
        <div className="flex items-center justify-between h-full px-4">
          {/* Left: App Name & Logo */}
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 bg-[#D97757] rounded-lg">
              <Lock className="w-4 h-4 text-white" />
            </div>
            <div className="text-sm font-bold text-white">SecureVault</div>
          </div>

          {/* Right: Window Controls */}
          <div className="flex no-drag items-center gap-2">
            <button
              onClick={handleMinimize}
              className="p-2 hover:bg-[#262624] rounded-lg transition-colors text-gray-400 hover:text-white"
              title="Minimize"
            >
              <Minus className="w-4 h-4" />
            </button>
            
            <button
              onClick={handleClose}
              className="p-2 hover:bg-red-500/10 rounded-lg transition-colors text-gray-400 hover:text-red-400"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* ===== MAIN CONTENT ===== */}
      <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
        <div className="w-full max-w-md">
          {/* Logo/Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-[#D97757] rounded-2xl mb-4">
              <Lock className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-white mb-2">SecureVault</h1>
            <p className="text-gray-400 text-sm">Your encrypted password manager</p>
          </div>

          {/* Auth Card */}
          <div className="bg-[#30302E] rounded-2xl border border-[#3a3a38] overflow-hidden">
            {/* Tabs - Rounded Style */}
            <div className="p-2 border-b border-[#3a3a38]">
              <div className="flex bg-[#262624] rounded-xl p-1 gap-1">
                <button
                  onClick={() => {
                    setIsLogin(true);
                    setError('');
                  }}
                  className={`flex-1 py-2.5 font-semibold text-sm transition-all rounded-lg ${
                    isLogin
                      ? 'bg-[#D97757] text-white shadow-lg'
                      : 'text-gray-400 hover:text-gray-300'
                  }`}
                >
                  Sign In
                </button>
                <button
                  onClick={() => {
                    setIsLogin(false);
                    setError('');
                  }}
                  className={`flex-1 py-2.5 font-semibold text-sm transition-all rounded-lg ${
                    !isLogin
                      ? 'bg-[#D97757] text-white shadow-lg'
                      : 'text-gray-400 hover:text-gray-300'
                  }`}
                >
                  Sign Up
                </button>
              </div>
            </div>

            {/* Forms */}
            <div className="p-8">
              {isLogin ? (
                // LOGIN FORM
                <form onSubmit={handleLogin} className="space-y-5">
                  {/* Username */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-300 mb-2">
                      Username
                    </label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                      <input
                        type="text"
                        value={loginUsername}
                        onChange={(e) => setLoginUsername(e.target.value)}
                        className="w-full pl-11 pr-4 py-3 bg-[#262624] border border-[#3a3a38] rounded-xl focus:ring-1 focus:ring-[#D97757] focus:border-[#D97757] outline-none transition-colors text-white placeholder-gray-600"
                        placeholder="Enter your username"
                        required
                      />
                    </div>
                  </div>

                  {/* Password */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-300 mb-2">
                      Password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                      <input
                        type={showLoginPassword ? 'text' : 'password'}
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        className="w-full pl-11 pr-12 py-3 bg-[#262624] border border-[#3a3a38] rounded-xl focus:ring-1 focus:ring-[#D97757] focus:border-[#D97757] outline-none transition-colors text-white placeholder-gray-600"
                        placeholder="Enter your password"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowLoginPassword(!showLoginPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                      >
                        {showLoginPassword ? (
                          <EyeOff className="w-5 h-5" />
                        ) : (
                          <Eye className="w-5 h-5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Error Message */}
                  {error && (
                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                      <p className="text-sm text-red-400 font-medium">{error}</p>
                    </div>
                  )}

                  {/* Submit Button */}
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3 bg-[#D97757] text-white rounded-xl hover:bg-[#c26848] transition-colors font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? 'Signing in...' : 'Sign In'}
                  </button>
                </form>
              ) : (
                // REGISTER FORM
                <form onSubmit={handleRegister} className="space-y-5">
                  {/* Username */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-300 mb-2">
                      Username
                    </label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                      <input
                        type="text"
                        value={registerUsername}
                        onChange={(e) => setRegisterUsername(e.target.value)}
                        className="w-full pl-11 pr-4 py-3 bg-[#262624] border border-[#3a3a38] rounded-xl focus:ring-1 focus:ring-[#D97757] focus:border-[#D97757] outline-none transition-colors text-white placeholder-gray-600"
                        placeholder="Choose a username"
                        required
                      />
                    </div>
                  </div>

                  {/* Password */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-300 mb-2">
                      Password
                    </label>
                    <div className="relative">
                      <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                      <input
                        type={showRegisterPassword ? 'text' : 'password'}
                        value={registerPassword}
                        onChange={(e) => setRegisterPassword(e.target.value)}
                        className="w-full pl-11 pr-12 py-3 bg-[#262624] border border-[#3a3a38] rounded-xl focus:ring-1 focus:ring-[#D97757] focus:border-[#D97757] outline-none transition-colors text-white placeholder-gray-600"
                        placeholder="Create a strong password"
                        required
                        minLength={8}
                      />
                      <button
                        type="button"
                        onClick={() => setShowRegisterPassword(!showRegisterPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                      >
                        {showRegisterPassword ? (
                          <EyeOff className="w-5 h-5" />
                        ) : (
                          <Eye className="w-5 h-5" />
                        )}
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Minimum 8 characters</p>
                  </div>

                  {/* Confirm Password */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-300 mb-2">
                      Confirm Password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        value={registerConfirmPassword}
                        onChange={(e) => setRegisterConfirmPassword(e.target.value)}
                        className="w-full pl-11 pr-12 py-3 bg-[#262624] border border-[#3a3a38] rounded-xl focus:ring-1 focus:ring-[#D97757] focus:border-[#D97757] outline-none transition-colors text-white placeholder-gray-600"
                        placeholder="Confirm your password"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                      >
                        {showConfirmPassword ? (
                          <EyeOff className="w-5 h-5" />
                        ) : (
                          <Eye className="w-5 h-5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Error Message */}
                  {error && (
                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                      <p className="text-sm text-red-400 font-medium">{error}</p>
                    </div>
                  )}

                  {/* Submit Button */}
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3 bg-[#D97757] text-white rounded-xl hover:bg-[#c26848] transition-colors font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? 'Creating account...' : 'Create Account'}
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* Footer Note */}
          <div className="mt-6 text-center">
            <p className="text-xs text-gray-500">
              {isLogin ? (
                <>Your password encrypts your vault. Keep it safe!</>
              ) : (
                <>Your password will be used to encrypt all your data</>
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}






