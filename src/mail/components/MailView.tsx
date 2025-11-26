/**
 * MailView Component - Thunderbird-style Email Client
 *
 * Auto-detects email settings and shows inline setup
 */

import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import {
  Mail, Plus, Send, Trash2, RefreshCw, Settings,
  Inbox, Archive, Star, AlertCircle, Paperclip,
  X, ChevronLeft, ChevronRight, Loader2, CheckCircle, AlertTriangle,
  Minus, Maximize2, Check, Reply, Sparkles, Wand2, ThumbsUp, ThumbsDown, Shield, ShieldAlert,
  Globe, Server, Key, Lock, XCircle, ArrowRight, Edit3, FileSignature,
  Image, File, FileText
} from 'lucide-react';
import { autoDetectConfig, isValidEmail } from '../utils/autoconfig';

declare global {
  interface Window {
    electronAPI: any;
    ipcRenderer: any;
  }
}

interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface MailViewProps {
  onBack?: () => void;
  standalone?: boolean; // Whether this is running in standalone mail window
}

// Memoized Email List Item for performance
interface EmailListItemProps {
  email: any;
  isSelected: boolean;
  onEmailClick: (email: any) => void;
  style?: React.CSSProperties;
}

const EmailListItem = memo(({ email, isSelected, onEmailClick, style }: EmailListItemProps) => {
  // Memoize formatted date to avoid recreating on every render
  const formattedDate = useMemo(
    () => new Date(email.date).toLocaleDateString(),
    [email.date]
  );

  return (
    <button
      style={style}
      onClick={() => onEmailClick(email)}
      className={`w-full p-4 border-b border-[#3a3a38] text-left hover:bg-[#30302E] transition-colors relative ${
        isSelected
          ? 'bg-[#30302E] border-l-2 border-l-[#D97757]'
          : email.isRead
            ? ''
            : 'bg-[#D97757]/5 border-l-2 border-l-[#D97757]'
      }`}
    >
      {/* Unread indicator dot */}
      {!email.isRead && (
        <div className="absolute left-2 top-1/2 -translate-y-1/2 w-2 h-2 bg-[#D97757] rounded-full"></div>
      )}

      <div className={`flex items-start justify-between gap-2 mb-1 ${!email.isRead ? 'pl-3' : ''}`}>
        <div className="flex items-center gap-2 truncate flex-1">
          <span className={`text-sm truncate ${email.isRead ? 'text-gray-400 font-normal' : 'text-white font-bold'}`}>
            {email.from && email.from[0]?.name || email.from[0]?.address || 'Unknown'}
          </span>
          {email.isSuspicious && (
            <ShieldAlert
              className={`flex-shrink-0 ${
                email.securityRating === 'dangerous'
                  ? 'text-red-500'
                  : email.securityRating === 'suspicious'
                  ? 'text-yellow-500'
                  : 'text-orange-500'
              }`}
              size={16}
            />
          )}
        </div>
        <span className={`text-xs whitespace-nowrap ${email.isRead ? 'text-gray-500' : 'text-[#D97757] font-semibold'}`}>
          {formattedDate}
        </span>
      </div>
      <div className={`text-sm mb-1 truncate ${!email.isRead ? 'pl-3' : ''} ${email.isRead ? 'text-gray-500 font-normal' : 'text-white font-bold'}`}>
        {email.subject || '(No Subject)'}
      </div>
      <div className={`text-xs text-gray-600 truncate ${!email.isRead ? 'pl-3' : ''}`}>
        {email.textBody?.substring(0, 100) || ''}
      </div>
      {email.isSuspicious && (
        <div className={`mt-2 ${!email.isRead ? 'pl-3' : ''}`}>
          <div className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
            email.securityRating === 'dangerous'
              ? 'bg-red-500/20 text-red-400 border border-red-500/30'
              : email.securityRating === 'suspicious'
              ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
              : 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
          }`}>
            <ShieldAlert size={12} />
            <span>
              {email.securityRating === 'dangerous'
                ? 'Dangerous'
                : email.securityRating === 'suspicious'
                ? 'Suspicious'
                : 'Security Warning'}
            </span>
          </div>
        </div>
      )}
    </button>
  );
}, (prevProps, nextProps) => {
  // Only re-render if these properties change
  return (
    prevProps.email.id === nextProps.email.id &&
    prevProps.email.isRead === nextProps.email.isRead &&
    prevProps.isSelected === nextProps.isSelected
  );
});

EmailListItem.displayName = 'EmailListItem';

export default function MailView({ onBack, standalone = false }: MailViewProps = {}) {
  // State
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<any | null>(null);
  const [folders, setFolders] = useState<any[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>('INBOX');
  const [emails, setEmails] = useState<any[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<any | null>(null);

  // UI State
  const [isLoading, setIsLoading] = useState(false);
  const [showAccountSetup, setShowAccountSetup] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [showSignatureManager, setShowSignatureManager] = useState(false);
  const [signatures, setSignatures] = useState<any[]>([]);
  const [selectedSignature, setSelectedSignature] = useState<any | null>(null);
  const [editingSignature, setEditingSignature] = useState<any | null>(null);
  const [signatureForm, setSignatureForm] = useState({ name: '', htmlContent: '', isDefault: false });
  const [showSignatureEditor, setShowSignatureEditor] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showMasterPasswordPrompt, setShowMasterPasswordPrompt] = useState(false);
  const [masterPassword, setMasterPassword] = useState('');
  const [pendingMailOperation, setPendingMailOperation] = useState<(() => Promise<void>) | null>(null);
  const [setupStep, setSetupStep] = useState<'credentials' | 'settings' | 'testing'>('credentials');
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [apiReady, setApiReady] = useState(false);
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set()); // Track expanded email subjects

  // Account Setup Form
  const [accountForm, setAccountForm] = useState({
    email: '',
    password: '',
    name: '',
    imapHost: '',
    imapPort: 993,
    imapSecure: true,
    smtpHost: '',
    smtpPort: 465,
    smtpSecure: true,
    autoDetected: false,
  });

  // Compose Form
  const [composeForm, setComposeForm] = useState({
    to: '',
    cc: '',
    bcc: '',
    subject: '',
    body: '',
  });

  // Attachments
  const [attachments, setAttachments] = useState<Array<{ name: string; size: number; type: string; path: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // AI Email Validation
  const [emailValidation, setEmailValidation] = useState<any>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // Ref for compose editor
  const composeEditorRef = useRef<HTMLDivElement>(null);
  const isTypingRef = useRef(false); // Track if user is actively typing
  const [showSecurityReport, setShowSecurityReport] = useState(false);
  const [selectedEmailSecurity, setSelectedEmailSecurity] = useState<any>(null);

  // Ref for signature WYSIWYG editor
  const signatureEditorRef = useRef<HTMLDivElement>(null);
  const [showSignatureHTMLMode, setShowSignatureHTMLMode] = useState(false);

  // Reputation Checker
  const [showReputationModal, setShowReputationModal] = useState(false);
  const [reputationData, setReputationData] = useState<any>(null);
  const [isCheckingReputation, setIsCheckingReputation] = useState(false);
  const [reputationError, setReputationError] = useState<string | null>(null);

  // Track folders with new mail for highlighting (0-latency visual feedback!)
  const [foldersWithNewMail, setFoldersWithNewMail] = useState<Set<string>>(new Set());

  // Auto-detect settings when email changes
  useEffect(() => {
    if (accountForm.email && isValidEmail(accountForm.email) && !accountForm.autoDetected) {
      const config = autoDetectConfig(accountForm.email);
      if (config) {
        setAccountForm((prev) => ({
          ...prev,
          name: config.provider,
          imapHost: config.imapHost,
          imapPort: config.imapPort,
          imapSecure: config.imapSecure,
          smtpHost: config.smtpHost,
          smtpPort: config.smtpPort,
          smtpSecure: config.smtpSecure,
          autoDetected: true,
        }));
        addToast(`Auto-detected settings for ${config.provider}`, 'success');
      }
    }
  }, [accountForm.email]);

  // Toast helper
  const addToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const toast: Toast = { id: Date.now().toString(), type, message };
    setToasts((prev) => [...prev, toast]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    }, 5000);
  };

  // HTML conversion helpers for email
  const convertTextToHTML = (text: string): string => {
    // Convert plain text to HTML with proper line breaks and formatting
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  };

  const stripHTMLTags = (html: string): string => {
    // Strip HTML tags for plain text fallback
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();
  };

  // Listen for link clicks from iframe and open in external browser
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'open-external-link' && event.data?.url) {
        const url = event.data.url;
        console.log('[MailView] Opening external link:', url);

        // Open in system default browser
        if (window.electronAPI?.openExternal) {
          window.electronAPI.openExternal(url);
        } else if (window.ipcRenderer) {
          window.ipcRenderer.send('open-external-url', url);
        } else {
          console.error('[MailView] No method available to open external URL');
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Close account dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (showAccountDropdown) {
        const target = e.target as HTMLElement;
        if (!target.closest('.account-dropdown-container')) {
          setShowAccountDropdown(false);
        }
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showAccountDropdown]);

  // Wait for electronAPI to be ready, then load accounts
  useEffect(() => {
    let attempts = 0;
    const maxAttempts = 50; // 5 seconds max wait (50 * 100ms)

    const checkAndLoadAccounts = () => {
      attempts++;

      if (window.electronAPI?.mail) {
        console.log('[Es Mail] electronAPI.mail ready!');
        setApiReady(true);
        loadAccounts();
      } else if (attempts >= maxAttempts) {
        console.error('[Es Mail] Failed to load electronAPI after 5 seconds');
        console.error('[Es Mail] window.electronAPI:', window.electronAPI);
        console.error('[Es Mail] This may be a preload script issue');
        // Set API ready anyway to show error in UI
        setApiReady(true);
      } else {
        console.log(`[Es Mail] Waiting for electronAPI... (attempt ${attempts}/${maxAttempts})`);
        // Retry after a short delay
        setTimeout(checkAndLoadAccounts, 100);
      }
    };

    checkAndLoadAccounts();
  }, []);

  // Load folders when account selected
  useEffect(() => {
    if (selectedAccount) {
      loadFolders(selectedAccount.id);
    }
  }, [selectedAccount]);

  // Load emails when folder selected
  useEffect(() => {
    if (selectedAccount && selectedFolder) {
      loadEmails(selectedAccount.id, selectedFolder);
    }
  }, [selectedAccount, selectedFolder]);

  // Start IMAP IDLE for push notifications (ONCE per account, always on INBOX)
  useEffect(() => {
    if (!selectedAccount) return;

    // Always monitor INBOX for new incoming mails (not the selected folder!)
    console.log('[Mail] 🔔 Starting IMAP IDLE on INBOX for instant notifications...');
    window.electronAPI.mail.startIdle(selectedAccount.id, 'INBOX')
      .then(result => {
        if (result.success) {
          console.log('[Mail] ✅ IMAP IDLE active on INBOX - you\'ll get INSTANT new mail notifications!');
        } else {
          console.warn('[Mail] ⚠️ IDLE not available, falling back to polling');
        }
      })
      .catch(err => {
        console.error('[Mail] IDLE error:', err);
      });

    // Cleanup: Stop IDLE when account changes
    return () => {
      window.electronAPI.mail.stopIdle(selectedAccount.id);
    };
  }, [selectedAccount]); // Only depends on account, not folder

  // Load signatures when account changes
  useEffect(() => {
    if (selectedAccount) {
      loadSignatures();
    }
  }, [selectedAccount]);

  // Auto-load default signature when opening compose
  useEffect(() => {
    if (showCompose && selectedAccount && signatures.length > 0 && composeEditorRef.current) {
      const defaultSig = signatures.find(s => s.isDefault);
      if (defaultSig && !composeForm.body) {
        setSelectedSignature(defaultSig);
        const signatureHTML = '<br><br>---<br>' + defaultSig.htmlContent;
        setComposeForm({
          ...composeForm,
          body: signatureHTML
        });
        // Directly set editor content
        composeEditorRef.current.innerHTML = signatureHTML;
      } else if (!composeForm.body && composeEditorRef.current) {
        // No signature, clear editor
        composeEditorRef.current.innerHTML = '';
      }
    }

    // Clear editor when modal closes
    if (!showCompose && composeEditorRef.current) {
      composeEditorRef.current.innerHTML = '';
      setComposeForm({ to: '', cc: '', bcc: '', subject: '', body: '' });
    }
  }, [showCompose]);

  // Initialize signature editor when editing
  useEffect(() => {
    if (showSignatureEditor && signatureEditorRef.current && signatureForm.htmlContent && !showSignatureHTMLMode) {
      signatureEditorRef.current.innerHTML = signatureForm.htmlContent;
    }
  }, [showSignatureEditor, editingSignature]);

  // Clear signature editor when closing
  useEffect(() => {
    if (!showSignatureEditor && signatureEditorRef.current) {
      signatureEditorRef.current.innerHTML = '';
      setShowSignatureHTMLMode(false);
    }
  }, [showSignatureEditor]);

  // Listen for IMAP IDLE push notifications
  useEffect(() => {
    const unsubscribe = window.electronAPI.mail.onNewMail((data) => {
      console.log('[Mail] 📬 INSTANT PUSH: New mail arrived!', data);
      console.log('[Mail] Current selectedAccount:', selectedAccount?.id);
      console.log('[Mail] Current selectedFolder:', selectedFolder);
      console.log('[Mail] Push data:', data);

      // Only process if this is for the currently selected account
      if (!selectedAccount || data.accountId !== selectedAccount.id) {
        console.log('[Mail] ⚠️ Different account, ignoring.');
        return;
      }

      // Mark folder as having new mail for visual highlight
      setFoldersWithNewMail(prev => new Set(prev).add(data.folder));

      // Remove highlight after 5 seconds (pulse animation)
      setTimeout(() => {
        setFoldersWithNewMail(prev => {
          const next = new Set(prev);
          next.delete(data.folder);
          return next;
        });
      }, 5000);

      // Show toast notification for new mail (professional feedback!)
      const folderName = data.folder === 'INBOX' ? 'Inbox' : data.folder.replace('INBOX.', '');
      addToast(`📬 New mail in ${folderName}`, 'info');

      // ALWAYS refresh folder list to update unread counts (NON-BLOCKING!)
      console.log('[Mail] 🔄 Refreshing folder list for unread counts...');
      loadFolders(selectedAccount.id, true);

      // If viewing the folder with new mail, refresh email list IMMEDIATELY
      if (selectedFolder && data.folder === selectedFolder) {
        console.log('[Mail] ✅ INSTANT REFRESH: New mail in current folder! Fetching NOW...');

        // CRITICAL: 150ms delay for perfect sync (Thunderbird best practice)
        // This ensures IMAP server has finished writing all message metadata
        setTimeout(async () => {
          try {
            console.log('[Mail] 🔥 Forcing FRESH FETCH from server (bypassing ALL caches)...');

            // Force fresh fetch from server - BYPASSES memory + database cache!
            const result = await window.electronAPI.mail.getEmailsFresh(
              selectedAccount.id,
              selectedFolder,
              masterPassword,
              50
            );

            if (result.success && result.data) {
              console.log('[Mail] ✅ SUCCESS! Got', result.data.length, 'FRESH emails. Updating UI NOW!');

              // INSTANT UI update - but preserve optimistic updates (emails user marked as read)
              setEmails(prevEmails => {
                const newEmails = result.data || [];

                // Preserve optimistic read status
                const mergedEmails = newEmails.map(newEmail => {
                  const existingEmail = prevEmails.find(e => e.id === newEmail.id);

                  // If user already marked this email as read locally, keep that status
                  if (existingEmail && existingEmail.isRead && !newEmail.isRead) {
                    console.log('[Mail] 🔒 Preserving optimistic read status during push update:', newEmail.subject);
                    return { ...newEmail, isRead: true };
                  }

                  return newEmail;
                });

                return mergedEmails;
              });

              console.log('[Mail] ✨ UI UPDATED! New mail is now visible instantly!');
            } else {
              console.error('[Mail] ❌ Failed to fetch emails:', result.error);
            }
          } catch (error: any) {
            console.error('[Mail] ❌ Error fetching new emails:', error);
          }
        }, 150); // 150ms delay for perfect sync (Thunderbird best practice)
      } else {
        console.log('[Mail] 📁 New mail in', data.folder, '- folder list updated with unread count');
      }
    });

    return () => unsubscribe();
  }, [selectedAccount, selectedFolder, masterPassword]);

  // Fallback polling (every 30 seconds) in case IDLE fails
  useEffect(() => {
    if (!selectedAccount || !selectedFolder) return;

    const intervalId = setInterval(() => {
      console.log('[Mail] 🔄 Fallback sync (IDLE should handle most new mail)');
      loadEmails(selectedAccount.id, selectedFolder, true); // silent mode
      loadFolders(selectedAccount.id);
    }, 30000); // 30 seconds fallback (IDLE handles real-time)

    return () => clearInterval(intervalId);
  }, [selectedAccount, selectedFolder]);

  // Update window title with unread count (Thunderbird-style!)
  useEffect(() => {
    if (!standalone) return; // Only for standalone mail window

    const totalUnread = folders.reduce((sum, folder) => sum + (folder.unread_messages || 0), 0);

    if (totalUnread > 0) {
      document.title = `Es Mail (${totalUnread})`;
    } else {
      document.title = 'Es Mail - Email Client';
    }
  }, [folders, standalone]);

  // ======================
  // ACCOUNT OPERATIONS
  // ======================

  const loadAccounts = async () => {
    try {
      if (!window.electronAPI?.mail) {
        console.error('electronAPI.mail not available');
        addToast('Mail API not available', 'error');
        return;
      }
      const result = await window.electronAPI.mail.getAccounts();
      if (result.success) {
        setAccounts(result.data || []);
        if (result.data && result.data.length > 0 && !selectedAccount) {
          setSelectedAccount(result.data[0]);
        }
      }
    } catch (error: any) {
      console.error('Failed to load accounts:', error);
      addToast('Failed to load accounts', 'error');
    }
  };

  const testConnection = async () => {
    if (!accountForm.email || !accountForm.password) {
      addToast('Please enter email and password', 'error');
      return;
    }

    setSetupStep('testing');
    setIsLoading(true);
    setTestResult(null);

    try {
      const result = await window.electronAPI.mail.testConnection(
        {
          email: accountForm.email,
          imapHost: accountForm.imapHost,
          imapPort: accountForm.imapPort,
          imapSecure: accountForm.imapSecure,
          smtpHost: accountForm.smtpHost,
          smtpPort: accountForm.smtpPort,
          smtpSecure: accountForm.smtpSecure,
        },
        accountForm.password
      );

      if (result.success) {
        setTestResult({ success: true, message: 'Connection successful! Both IMAP and SMTP tests passed. Ready to add account.' });
        addToast('Connection test passed!', 'success');
      } else {
        // Extract more specific error information
        const errorMsg = result.error || 'Connection failed. Check your settings below.';
        setTestResult({
          success: false,
          message: errorMsg
        });
        setSetupStep('settings');
        addToast(`Connection failed: ${errorMsg.substring(0, 100)}`, 'error');
      }
    } catch (error: any) {
      setTestResult({
        success: false,
        message: error.message || 'Connection test failed'
      });
      setSetupStep('settings');
      addToast('Connection test failed', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const addAccount = async () => {
    if (!accountForm.email || !accountForm.password) {
      addToast('Please fill in email and password', 'error');
      return;
    }

    setIsLoading(true);
    try {
      const result = await window.electronAPI.mail.addAccount(
        {
          name: accountForm.name || accountForm.email,
          email: accountForm.email,
          imapHost: accountForm.imapHost,
          imapPort: accountForm.imapPort,
          imapSecure: accountForm.imapSecure,
          smtpHost: accountForm.smtpHost,
          smtpPort: accountForm.smtpPort,
          smtpSecure: accountForm.smtpSecure,
        },
        accountForm.password
      );

      if (result.success) {
        addToast('Account added successfully!', 'success');
        setShowAccountSetup(false);
        loadAccounts();
        // Reset form
        setAccountForm({
          email: '',
          password: '',
          name: '',
          imapHost: '',
          imapPort: 993,
          imapSecure: true,
          smtpHost: '',
          smtpPort: 465,
          smtpSecure: true,
          autoDetected: false,
        });
        setSetupStep('credentials');
        setTestResult(null);
      } else {
        addToast(result.error || 'Failed to add account', 'error');
      }
    } catch (error: any) {
      addToast(error.message || 'Failed to add account', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // ======================
  // FOLDER OPERATIONS
  // ======================

  const loadFolders = async (accountId: string, forceSync: boolean = true) => {
    try {
      // Load folders from cache IMMEDIATELY (instant UI update)
      const cachedResult = await window.electronAPI.mail.getFolders(accountId);
      if (cachedResult.success) {
        console.log('[Mail] ⚡ Instant load from cache:', cachedResult.data?.length, 'folders');
        setFolders(cachedResult.data || []);
      }

      // THEN sync with server in background (non-blocking)
      if (forceSync) {
        console.log('[Mail] 🔄 Background sync: Fetching latest unread counts from server...');

        // Non-blocking background sync
        window.electronAPI.mail.syncFolders(accountId, masterPassword).then(syncResult => {
          if (syncResult.success) {
            console.log('[Mail] ✅ Background sync complete!');

            // Reload folders with fresh data
            window.electronAPI.mail.getFolders(accountId).then(result => {
              if (result.success) {
                console.log('[Mail] 📁 Updated folders with fresh unread counts');
                result.data?.forEach((folder: any) => {
                  console.log(`[Mail] ${folder.name}: ${folder.unread_messages} unread`);
                });
                setFolders(result.data || []);
              }
            });
          } else {
            console.warn('[Mail] ⚠️ Background sync failed (using cached data):', syncResult.error);
          }
        });
      }
    } catch (error: any) {
      console.error('[Mail] Failed to load folders:', error);
      addToast('Failed to load folders', 'error');
    }
  };

  // ======================
  // EMAIL OPERATIONS
  // ======================

  const loadEmails = async (accountId: string, folder: string, silent: boolean = false) => {
    // Only show loading spinner if not silent (first load or manual refresh)
    if (!silent) {
      setIsLoading(true);
    }

    try {
      const result = await window.electronAPI.mail.getEmails(
        accountId,
        folder,
        null, // Password will be retrieved from vault automatically
        50
      );

      if (result.success) {
        const newEmails = result.data || [];

        // Smart email list update: Preserve optimistic UI updates during background sync
        setEmails(prevEmails => {
          // If this is a silent background sync, merge with existing optimistic updates
          if (silent) {
            // Preserve optimistic updates (e.g., emails marked as read by user)
            const mergedEmails = newEmails.map(newEmail => {
              const existingEmail = prevEmails.find(e => e.id === newEmail.id);

              // If user already marked this email as read locally, keep that status
              if (existingEmail && existingEmail.isRead && !newEmail.isRead) {
                console.log('[Mail] 🔒 Preserving optimistic read status for:', newEmail.subject);
                return { ...newEmail, isRead: true };
              }

              return newEmail;
            });

            // Update selected email only if backend has changes, but preserve optimistic updates
            if (selectedEmail) {
              const updatedSelectedEmail = mergedEmails.find(e => e.id === selectedEmail.id);

              if (updatedSelectedEmail) {
                // Only update selected email if it's different (but preserve isRead if user marked it)
                if (selectedEmail.isRead && !updatedSelectedEmail.isRead) {
                  // User marked as read, keep it
                  setSelectedEmail({ ...updatedSelectedEmail, isRead: true });
                } else if (JSON.stringify(updatedSelectedEmail) !== JSON.stringify(selectedEmail)) {
                  // Other changes from backend, apply them
                  setSelectedEmail(updatedSelectedEmail);
                }
              }
            }

            // Check for new emails (only count unread ones to avoid spam)
            const newUnreadCount = mergedEmails.filter(e => !e.isRead).length;
            const oldUnreadCount = prevEmails.filter(e => !e.isRead).length;

            if (newUnreadCount > oldUnreadCount) {
              const newMailCount = newUnreadCount - oldUnreadCount;
              console.log(`📬 ${newMailCount} new email(s) received!`);
              // Don't show toast during reading to avoid interruption
              // The unread badge will update automatically
            }

            return mergedEmails;
          }

          return newEmails;
        });

        // Only clear selection on manual/non-silent loads (folder changes, manual refresh)
        if (!silent) {
          setSelectedEmail(null);
        }

        if (result.cached) {
          console.log(`✨ Instant load: ${result.data?.length || 0} cached emails`);
          if (result.syncing) {
            console.log('⚡ Background sync running for new emails...');
          }
        } else {
          console.log(`📥 Loaded ${result.data?.length || 0} emails from server`);
        }
      } else {
        if (!silent) {
          addToast(result.error || 'Failed to load emails', 'error');
        }
      }
    } catch (error: any) {
      if (!silent) {
        addToast(error.message || 'Failed to load emails', 'error');
      }
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  };

  // ========== SIGNATURE MANAGEMENT ==========

  const loadSignatures = async () => {
    if (!selectedAccount) return;

    try {
      const result = await window.electronAPI.mail.getSignatures(selectedAccount.id);
      if (result.success) {
        setSignatures(result.data || []);
      }
    } catch (error: any) {
      console.error('[Signatures] Load error:', error);
    }
  };

  const saveSignature = async (name: string, htmlContent: string, isDefault: boolean, editingId?: string) => {
    if (!selectedAccount) return;

    try {
      let result;
      if (editingId) {
        result = await window.electronAPI.mail.updateSignature(editingId, name, htmlContent, isDefault);
      } else {
        result = await window.electronAPI.mail.addSignature(selectedAccount.id, name, htmlContent, isDefault);
      }

      if (result.success) {
        addToast(editingId ? 'Signature updated successfully' : 'Signature created successfully', 'success');
        await loadSignatures();
        return true;
      } else {
        addToast('Failed to save signature', 'error');
        return false;
      }
    } catch (error: any) {
      console.error('[Signatures] Save error:', error);
      addToast('Error saving signature', 'error');
      return false;
    }
  };

  const deleteSignature = async (signatureId: string) => {
    try {
      const result = await window.electronAPI.mail.deleteSignature(signatureId);
      if (result.success) {
        addToast('Signature deleted successfully', 'success');
        await loadSignatures();
      } else {
        addToast('Failed to delete signature', 'error');
      }
    } catch (error: any) {
      console.error('[Signatures] Delete error:', error);
      addToast('Error deleting signature', 'error');
    }
  };

  const checkReputation = async () => {
    if (!selectedAccount) {
      addToast('No account selected', 'error');
      return;
    }

    setIsCheckingReputation(true);
    setShowReputationModal(true);
    setReputationData(null);
    setReputationError(null);

    try {
      console.log('[Reputation] Checking reputation for account:', selectedAccount.id);
      const result = await window.electronAPI.mail.checkReputation(selectedAccount.id);
      console.log('[Reputation] Result:', result);

      if (result.success) {
        console.log('[Reputation] Success! Data:', result.data);
        setReputationData(result.data);
        setReputationError(null);
        addToast('Reputation check complete', 'success');
      } else {
        console.error('[Reputation] Failed:', result.error);
        setReputationError(result.error || 'Failed to check reputation');
        addToast(result.error || 'Failed to check reputation', 'error');
      }
    } catch (error: any) {
      console.error('[Reputation] Exception:', error);
      setReputationError(error.message || 'Failed to check reputation');
      addToast(error.message || 'Failed to check reputation', 'error');
    } finally {
      setIsCheckingReputation(false);
    }
  };

  // Handle file attachments
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const newAttachments: Array<{ name: string; size: number; type: string; path: string }> = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Limit file size to 25MB
      if (file.size > 25 * 1024 * 1024) {
        addToast(`File ${file.name} is too large (max 25MB)`, 'error');
        continue;
      }

      newAttachments.push({
        name: file.name,
        size: file.size,
        type: file.type,
        path: (file as any).path || file.name // Electron provides file.path
      });
    }

    setAttachments([...attachments, ...newAttachments]);

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments(attachments.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const getFileIcon = (type: string, name: string) => {
    if (type.startsWith('image/')) return <Image className="w-4 h-4" />;
    if (type === 'application/pdf' || name.endsWith('.pdf')) return <FileText className="w-4 h-4" />;
    return <File className="w-4 h-4" />;
  };

  const sendEmail = async () => {
    if (!selectedAccount || !composeForm.to || !composeForm.subject) {
      addToast('Please fill in recipient and subject', 'error');
      return;
    }

    setIsLoading(true);
    try {
      // Body is already in HTML format from contentEditable editor
      const htmlBody = composeForm.body;
      const textBody = stripHTMLTags(composeForm.body);

      const draft = {
        to: composeForm.to.split(',').map((email) => ({ address: email.trim() })),
        cc: composeForm.cc ? composeForm.cc.split(',').map((email) => ({ address: email.trim() })) : [],
        bcc: composeForm.bcc ? composeForm.bcc.split(',').map((email) => ({ address: email.trim() })) : [],
        subject: composeForm.subject,
        textBody: textBody, // Plain text fallback
        htmlBody: htmlBody, // HTML version with signatures
        attachments: attachments.map(att => ({ path: att.path, filename: att.name })),
      };

      const result = await window.electronAPI.mail.sendEmail(
        selectedAccount.id,
        draft,
        null // Password will be retrieved from vault automatically
      );

      if (result.success) {
        addToast('Email sent successfully!', 'success');
        setShowCompose(false);
        setComposeForm({ to: '', cc: '', bcc: '', subject: '', body: '' });
        setSelectedSignature(null);
        setAttachments([]);

        // Refresh current folder to show the sent message
        if (selectedAccount) {
          await loadFolders(selectedAccount.id); // Sync folders to update counts
          await loadEmails(selectedAccount.id, selectedFolder); // Reload current folder
        }
      } else {
        addToast(result.error || 'Failed to send email', 'error');
      }
    } catch (error: any) {
      addToast(error.message || 'Failed to send email', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Optimized email click handler with useCallback
  const handleEmailClick = useCallback(async (email: any) => {
    // Select email INSTANTLY - body is already loaded!
    setSelectedEmail(email);

    // Mark as read when clicked (Gmail/Thunderbird style)
    if (!email.isRead && selectedAccount) {
      console.log('[Mail] 📖 Marking email as read:', email.subject);

      // INSTANT optimistic UI update (no delays)
      const updatedEmail = { ...email, isRead: true };

      // Update emails list immediately
      setEmails(prevEmails =>
        prevEmails.map(e =>
          e.id === email.id ? updatedEmail : e
        )
      );

      // Update selected email to show as read
      setSelectedEmail(updatedEmail);

      // Backend sync in background (fire and forget)
      window.electronAPI.mail.markAsRead(
        selectedAccount.id,
        email.id,
        true,
        null
      ).then(result => {
        if (result.success) {
          console.log('[Mail] ✅ Backend sync: Email marked as read successfully');
          // Refresh folder counts to update unread badge (non-blocking)
          loadFolders(selectedAccount.id, false);
        } else {
          console.error('[Mail] ❌ Backend sync failed:', result.error);
          // Revert optimistic update on error
          setEmails(prevEmails =>
            prevEmails.map(e =>
              e.id === email.id ? { ...e, isRead: false } : e
            )
          );
          setSelectedEmail(email);
        }
      }).catch(error => {
        console.error('[Mail] ❌ Backend sync error:', error);
        // Revert optimistic update on error
        setEmails(prevEmails =>
          prevEmails.map(e =>
            e.id === email.id ? { ...e, isRead: false } : e
          )
        );
        setSelectedEmail(email);
      });
    }
  }, [selectedAccount]);

  const handleReply = () => {
    if (!selectedEmail) return;

    // Pre-fill compose form with reply data
    const replyTo = selectedEmail.from[0]?.address || '';
    const replySubject = selectedEmail.subject?.startsWith('Re:')
      ? selectedEmail.subject
      : `Re: ${selectedEmail.subject || ''}`;

    // Create quoted reply text
    const originalText = selectedEmail.textBody || selectedEmail.htmlBody?.replace(/<[^>]*>/g, '') || '';
    const replyBody = `\n\n--- Original Message ---\nFrom: ${selectedEmail.from[0]?.name || selectedEmail.from[0]?.address}\nDate: ${new Date(selectedEmail.date).toLocaleString()}\nSubject: ${selectedEmail.subject}\n\n${originalText}`;

    setComposeForm({
      to: replyTo,
      cc: '',
      bcc: '',
      subject: replySubject,
      body: replyBody
    });

    setShowCompose(true);
  };

  const validateEmail = async () => {
    if (!composeForm.subject && !composeForm.body) {
      addToast('Please write something to validate', 'error');
      return;
    }

    setIsValidating(true);
    try {
      const result = await window.electronAPI.validateEmail(composeForm.subject, composeForm.body);

      if (result.success) {
        setEmailValidation(result.validation);
        addToast(`Email Score: ${result.validation.score}/100 - ${result.validation.rating}`, 'success');
      } else {
        addToast(result.error || 'Failed to validate email', 'error');
      }
    } catch (error: any) {
      addToast(error.message || 'Failed to validate email', 'error');
    } finally {
      setIsValidating(false);
    }
  };

  const generateEmail = async () => {
    setIsGenerating(true);
    try {
      const result = await window.electronAPI.generateEmail(
        composeForm.subject,
        composeForm.body,
        'Professional business email'
      );

      if (result.success) {
        setComposeForm({
          ...composeForm,
          subject: result.generated.subject,
          body: result.generated.body
        });
        addToast('Email generated successfully!', 'success');
        // Auto-validate the generated email
        setTimeout(() => validateEmail(), 500);
      } else {
        addToast(result.error || 'Failed to generate email', 'error');
      }
    } catch (error: any) {
      addToast(error.message || 'Failed to generate email', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const applyImprovement = (betterText: string, location: 'subject' | 'body', badText: string) => {
    if (location === 'subject') {
      setComposeForm({
        ...composeForm,
        subject: composeForm.subject.replace(badText, betterText)
      });
    } else {
      setComposeForm({
        ...composeForm,
        body: composeForm.body.replace(badText, betterText)
      });
    }
    addToast('Improvement applied!', 'success');
  };

  // ======================
  // RENDER
  // ======================

  // Show loading while API is initializing
  if (!apiReady) {
    return (
      <div className="h-full flex flex-col bg-[#262624]">
        {/* Custom Title Bar for Standalone Window */}
        {standalone && (
          <div className="drag flex items-center justify-between px-4 py-2 bg-[#30302E] border-b border-[#3a3a38] flex-shrink-0 select-none">
            <div className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-[#D97757]" />
              <h1 className="text-sm font-semibold text-white">Es Mail</h1>
            </div>
            <div className="no-drag flex items-center gap-1">
              <button
                onClick={() => window.electronAPI?.mailWindowMinimize?.()}
                className="p-2 hover:bg-[#262624] rounded-lg transition-colors"
                title="Minimize"
              >
                <Minus className="w-4 h-4 text-gray-400" />
              </button>
              <button
                onClick={() => window.electronAPI?.mailWindowMaximize?.()}
                className="p-2 hover:bg-[#262624] rounded-lg transition-colors"
                title="Maximize"
              >
                <Maximize2 className="w-4 h-4 text-gray-400" />
              </button>
              <button
                onClick={() => window.electronAPI?.mailWindowClose?.()}
                className="p-2 hover:bg-red-500/20 rounded-lg transition-colors"
                title="Close"
              >
                <X className="w-4 h-4 text-gray-400 hover:text-red-400" />
              </button>
            </div>
          </div>
        )}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-12 h-12 text-[#D97757] animate-spin mx-auto mb-4" />
            <p className="text-white text-sm">Initializing Es Mail...</p>
            <p className="text-gray-500 text-xs mt-2">Loading mail API...</p>
          </div>
        </div>
      </div>
    );
  }

  // Show error if electronAPI is not available after timeout
  if (apiReady && !window.electronAPI?.mail) {
    return (
      <div className="h-full flex flex-col bg-[#262624]">
        {/* Custom Title Bar for Standalone Window */}
        {standalone && (
          <div className="drag flex items-center justify-between px-4 py-2 bg-[#30302E] border-b border-[#3a3a38] flex-shrink-0 select-none">
            <div className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-[#D97757]" />
              <h1 className="text-sm font-semibold text-white">Es Mail - Error</h1>
            </div>
            <div className="no-drag flex items-center gap-1">
              <button
                onClick={() => window.electronAPI?.mailWindowClose?.()}
                className="p-2 hover:bg-red-500/20 rounded-lg transition-colors"
                title="Close"
              >
                <X className="w-4 h-4 text-gray-400 hover:text-red-400" />
              </button>
            </div>
          </div>
        )}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md text-center">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Mail API Not Available</h2>
            <p className="text-gray-400 mb-4">
              The Electron mail API failed to initialize. This might be a preload script issue.
            </p>
            <div className="bg-[#30302E] border border-[#3a3a38] rounded-lg p-4 text-left text-xs">
              <p className="text-gray-500 mb-2">Debug Information:</p>
              <p className="text-gray-300 font-mono">electronAPI: {window.electronAPI ? '✓ Available' : '✗ Missing'}</p>
              <p className="text-gray-300 font-mono">electronAPI.mail: {window.electronAPI?.mail ? '✓ Available' : '✗ Missing'}</p>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="mt-6 px-6 py-2 bg-[#D97757] text-white rounded-xl font-medium hover:bg-[#c26848] transition-all"
            >
              Reload Window
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Show account setup if no accounts
  if (accounts.length === 0 || showAccountSetup) {
    return (
      <div className="h-full flex flex-col bg-[#262624]">
        {/* Custom Title Bar for Standalone Window */}
        {standalone && (
          <div className="drag flex items-center justify-between px-4 py-2 bg-[#30302E] border-b border-[#3a3a38] flex-shrink-0 select-none">
            <div className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-[#D97757]" />
              <h1 className="text-sm font-semibold text-white">Es Mail - Setup</h1>
            </div>
            <div className="no-drag flex items-center gap-1">
              <button
                onClick={() => window.electronAPI?.mailWindowMinimize?.()}
                className="p-2 hover:bg-[#262624] rounded-lg transition-colors"
                title="Minimize"
              >
                <Minus className="w-4 h-4 text-gray-400" />
              </button>
              <button
                onClick={() => window.electronAPI?.mailWindowMaximize?.()}
                className="p-2 hover:bg-[#262624] rounded-lg transition-colors"
                title="Maximize"
              >
                <Maximize2 className="w-4 h-4 text-gray-400" />
              </button>
              <button
                onClick={() => window.electronAPI?.mailWindowClose?.()}
                className="p-2 hover:bg-red-500/20 rounded-lg transition-colors"
                title="Close"
              >
                <X className="w-4 h-4 text-gray-400 hover:text-red-400" />
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 flex items-center justify-center p-8 overflow-y-auto">
          {/* Toasts */}
          <div className="fixed bottom-6 right-6 z-50 space-y-2">
            {toasts.map((toast) => (
              <div
                key={toast.id}
              className={`px-4 py-3 rounded-xl border backdrop-blur text-sm font-medium animate-in slide-in-from-right ${
                toast.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                  : toast.type === 'error'
                  ? 'bg-red-500/10 border-red-500/20 text-red-400'
                  : 'bg-[#D97757]/10 border-[#D97757]/20 text-[#D97757]'
              }`}
            >
              {toast.message}
            </div>
          ))}
        </div>

        {/* Centered Form Container */}
        <div className="w-full max-w-2xl">
          {/* Header */}
          <div className="text-center mb-8">
            <Mail className="w-16 h-16 text-[#D97757] mx-auto mb-4" />
            <h2 className="text-3xl font-bold text-white mb-2">Add Email Account</h2>
            <p className="text-gray-400">
              Enter your credentials and we'll auto-detect your server settings
            </p>
          </div>

          <div className="space-y-6">
            {/* Credentials Step */}
            <div className="bg-[#30302E] rounded-2xl border border-[#3a3a38] p-6 mb-6">
              <h3 className="text-lg font-bold text-white mb-4">Email & Password</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Email Address *
                  </label>
                  <input
                    type="email"
                    value={accountForm.email}
                    onChange={(e) => setAccountForm({ ...accountForm, email: e.target.value, autoDetected: false })}
                    placeholder="you@example.com"
                    className="w-full px-4 py-3 bg-[#262624] border border-[#3a3a38] rounded-xl text-white placeholder-gray-600 focus:ring-2 focus:ring-[#D97757] focus:border-[#D97757] outline-none"
                  />
                  {accountForm.autoDetected && (
                    <p className="text-xs text-emerald-400 mt-2 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" />
                      Settings auto-detected for {accountForm.name}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Password *
                  </label>
                  <input
                    type="password"
                    value={accountForm.password}
                    onChange={(e) => setAccountForm({ ...accountForm, password: e.target.value })}
                    placeholder="••••••••"
                    className="w-full px-4 py-3 bg-[#262624] border border-[#3a3a38] rounded-xl text-white placeholder-gray-600 focus:ring-2 focus:ring-[#D97757] focus:border-[#D97757] outline-none"
                  />
                  <p className="text-xs text-gray-500 mt-2">
                    For accounts with 2FA, use an app-specific password
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Account Name (optional)
                  </label>
                  <input
                    type="text"
                    value={accountForm.name}
                    onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
                    placeholder="Work Email"
                    className="w-full px-4 py-3 bg-[#262624] border border-[#3a3a38] rounded-xl text-white placeholder-gray-600 focus:ring-2 focus:ring-[#D97757] focus:border-[#D97757] outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Server Settings */}
            {(setupStep === 'settings' || setupStep === 'testing') && (
              <div className="bg-[#30302E] rounded-2xl border border-[#3a3a38] p-6 mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-white">Server Settings</h3>
                  <button
                    onClick={() => setSetupStep('credentials')}
                    className="text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    Edit
                  </button>
                </div>

                <div className="space-y-6">
                  {/* IMAP */}
                  <div>
                    <h4 className="text-sm font-semibold text-white mb-3">Incoming Mail (IMAP)</h4>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-2">
                        <label className="block text-xs text-gray-400 mb-2">Server</label>
                        <input
                          type="text"
                          value={accountForm.imapHost}
                          onChange={(e) => setAccountForm({ ...accountForm, imapHost: e.target.value })}
                          className="w-full px-3 py-2 bg-[#262624] border border-[#3a3a38] rounded-lg text-white text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-2">Port</label>
                        <input
                          type="number"
                          value={accountForm.imapPort}
                          onChange={(e) => setAccountForm({ ...accountForm, imapPort: parseInt(e.target.value) })}
                          className="w-full px-3 py-2 bg-[#262624] border border-[#3a3a38] rounded-lg text-white text-sm"
                        />
                      </div>
                      <div className="col-span-3">
                        <label className="flex items-center gap-2 text-sm text-gray-300">
                          <input
                            type="checkbox"
                            checked={accountForm.imapSecure}
                            onChange={(e) => setAccountForm({ ...accountForm, imapSecure: e.target.checked })}
                            className="w-4 h-4 rounded border-gray-600 text-[#D97757] focus:ring-[#D97757]"
                          />
                          Use SSL/TLS
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* SMTP */}
                  <div>
                    <h4 className="text-sm font-semibold text-white mb-3">Outgoing Mail (SMTP)</h4>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-2">
                        <label className="block text-xs text-gray-400 mb-2">Server</label>
                        <input
                          type="text"
                          value={accountForm.smtpHost}
                          onChange={(e) => setAccountForm({ ...accountForm, smtpHost: e.target.value })}
                          className="w-full px-3 py-2 bg-[#262624] border border-[#3a3a38] rounded-lg text-white text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-2">Port</label>
                        <input
                          type="number"
                          value={accountForm.smtpPort}
                          onChange={(e) => setAccountForm({ ...accountForm, smtpPort: parseInt(e.target.value) })}
                          className="w-full px-3 py-2 bg-[#262624] border border-[#3a3a38] rounded-lg text-white text-sm"
                        />
                      </div>
                      <div className="col-span-3">
                        <label className="flex items-center gap-2 text-sm text-gray-300">
                          <input
                            type="checkbox"
                            checked={accountForm.smtpSecure}
                            onChange={(e) => setAccountForm({ ...accountForm, smtpSecure: e.target.checked })}
                            className="w-4 h-4 rounded border-gray-600 text-[#D97757] focus:ring-[#D97757]"
                          />
                          Use SSL/TLS
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Test Result */}
            {testResult && (
              <div className={`p-4 rounded-xl border mb-6 ${
                testResult.success
                  ? 'bg-emerald-500/10 border-emerald-500/30'
                  : 'bg-red-500/10 border-red-500/30'
              }`}>
                <div className="flex items-start gap-3">
                  {testResult.success ? (
                    <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1">
                    <p className={`text-sm font-medium ${
                      testResult.success ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                      {testResult.message}
                    </p>
                    {!testResult.success && (
                      <div className="text-xs text-gray-400 mt-3 space-y-2">
                        <p className="font-semibold text-gray-300">Troubleshooting steps:</p>
                        <ul className="list-disc list-inside space-y-1 ml-2">
                          <li>Verify server hostname is correct: mail.entegrasources.com.np</li>
                          <li>Check IMAP port (993) and SMTP port (465) are correct</li>
                          <li>Ensure your email and password are correct</li>
                          <li>If 2FA is enabled, generate and use an app-specific password</li>
                          <li>Check if firewall is blocking ports 993 and 465</li>
                          <li>Verify the mail server is accessible from your network</li>
                          <li>Try disabling VPN if connected</li>
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={testConnection}
                disabled={isLoading || !accountForm.email || !accountForm.password}
                className="flex-1 py-3 bg-[#3a3a38] text-white rounded-xl font-medium hover:bg-[#4a4a48] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isLoading && setupStep === 'testing' ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Testing...
                  </>
                ) : (
                  'Test Connection'
                )}
              </button>
              <button
                onClick={addAccount}
                disabled={isLoading || !testResult?.success}
                className="flex-1 py-3 bg-[#D97757] text-white rounded-xl font-medium hover:bg-[#c26848] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isLoading && setupStep !== 'testing' ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Adding Account...
                  </>
                ) : (
                  <>
                    <Plus className="w-5 h-5" />
                    Add Account
                  </>
                )}
              </button>
            </div>

            {/* Back to Mail button if accounts exist */}
            {accounts.length > 0 && (
              <div className="mt-6 text-center">
                <button
                  onClick={() => setShowAccountSetup(false)}
                  className="text-sm text-gray-400 hover:text-white transition-colors inline-flex items-center gap-2"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Back to Mail
                </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#262624] overflow-hidden">
      {/* Custom Title Bar for Standalone Window */}
      {standalone && (
        <div className="drag flex items-center justify-between px-4 py-2 bg-[#30302E] border-b border-[#3a3a38] flex-shrink-0 select-none">
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-[#D97757]" />
            <h1 className="text-sm font-semibold text-white">Es Mail</h1>
            {(() => {
              const totalUnread = folders.reduce((sum, folder) => sum + (folder.unread_messages || 0), 0);
              return totalUnread > 0 ? (
                <span className="text-xs px-2 py-0.5 bg-[#D97757] text-white rounded-full font-bold min-w-[20px] text-center animate-pulse">
                  {totalUnread}
                </span>
              ) : null;
            })()}
            {selectedAccount && (
              <>
                <span className="text-gray-600">•</span>
                <span className="text-xs text-gray-400">{selectedAccount.email}</span>
              </>
            )}
          </div>
          <div className="no-drag flex items-center gap-1">
            <button
              onClick={() => window.electronAPI?.mailWindowMinimize?.()}
              className="p-2 hover:bg-[#262624] rounded-lg transition-colors"
              title="Minimize"
            >
              <Minus className="w-4 h-4 text-gray-400" />
            </button>
            <button
              onClick={() => window.electronAPI?.mailWindowMaximize?.()}
              className="p-2 hover:bg-[#262624] rounded-lg transition-colors"
              title="Maximize"
            >
              <Maximize2 className="w-4 h-4 text-gray-400" />
            </button>
            <button
              onClick={() => window.electronAPI?.mailWindowClose?.()}
              className="p-2 hover:bg-red-500/20 rounded-lg transition-colors"
              title="Close"
            >
              <X className="w-4 h-4 text-gray-400 hover:text-red-400" />
            </button>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div className="fixed bottom-6 right-6 z-50 space-y-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`px-4 py-3 rounded-xl border backdrop-blur text-sm font-medium animate-in slide-in-from-right ${
              toast.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                : toast.type === 'error'
                ? 'bg-red-500/10 border-red-500/20 text-red-400'
                : 'bg-[#D97757]/10 border-[#D97757]/20 text-[#D97757]'
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>

      {/* Compose Modal */}
      {showCompose && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-8">
          <div className="bg-[#30302E] rounded-2xl w-full max-w-3xl shadow-2xl border border-[#3a3a38] max-h-[90vh] flex flex-col">
            <div className="p-4 border-b border-[#3a3a38] flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">New Message</h3>
              <button
                onClick={() => {
                  setShowCompose(false);
                  setSelectedSignature(null);
                  setAttachments([]);
                }}
                className="p-2 hover:bg-[#262624] rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
            <div className="p-6 space-y-4">
              <input
                type="text"
                value={composeForm.to}
                onChange={(e) => setComposeForm({ ...composeForm, to: e.target.value })}
                placeholder="To: recipient@example.com"
                className="w-full px-4 py-2 bg-[#262624] border-b border-[#3a3a38] text-white placeholder-gray-600 focus:border-[#D97757] outline-none"
              />
              <input
                type="text"
                value={composeForm.subject}
                onChange={(e) => setComposeForm({ ...composeForm, subject: e.target.value })}
                placeholder="Subject"
                className="w-full px-4 py-2 bg-[#262624] border-b border-[#3a3a38] text-white placeholder-gray-600 focus:border-[#D97757] outline-none"
              />
              {/* WYSIWYG HTML Editor */}
              <div
                ref={composeEditorRef}
                contentEditable
                suppressContentEditableWarning
                onInput={(e) => {
                  isTypingRef.current = true;
                  const content = e.currentTarget.innerHTML;
                  setComposeForm((prev) => ({ ...prev, body: content }));
                }}
                onFocus={() => {
                  isTypingRef.current = true;
                }}
                onBlur={() => {
                  isTypingRef.current = false;
                }}
                onPaste={(e) => {
                  // Handle paste to preserve formatting
                  e.preventDefault();
                  const html = e.clipboardData.getData('text/html');
                  const text = e.clipboardData.getData('text/plain');
                  if (html) {
                    document.execCommand('insertHTML', false, html);
                  } else if (text) {
                    // Convert plain text to HTML
                    const htmlText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
                    document.execCommand('insertHTML', false, htmlText);
                  }
                }}
                data-placeholder="Write your message..."
                className="w-full min-h-[300px] px-4 py-3 bg-[#262624] border border-[#3a3a38] rounded-xl text-white focus:ring-1 focus:ring-[#D97757] focus:border-[#D97757] outline-none overflow-y-auto"
                style={{
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap'
                }}
              />

              {/* Signature Selector */}
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-gray-400 min-w-[80px]">Signature:</label>
                <select
                  value={selectedSignature?.id || ''}
                  onChange={(e) => {
                    const sig = signatures.find(s => s.id === e.target.value);
                    setSelectedSignature(sig || null);
                    if (sig && composeEditorRef.current) {
                      // Remove old signature if exists (look for separator)
                      let currentBody = composeEditorRef.current.innerHTML;
                      const separatorHTML = '<br><br>---<br>';
                      const separatorIndex = currentBody.indexOf(separatorHTML);
                      if (separatorIndex !== -1) {
                        currentBody = currentBody.substring(0, separatorIndex);
                      }

                      // Append signature with HTML separator
                      const newBody = currentBody + separatorHTML + sig.htmlContent;
                      setComposeForm({ ...composeForm, body: newBody });

                      // Update editor display
                      composeEditorRef.current.innerHTML = newBody;
                    } else if (!sig && composeEditorRef.current) {
                      // Remove signature
                      let currentBody = composeEditorRef.current.innerHTML;
                      const separatorHTML = '<br><br>---<br>';
                      const separatorIndex = currentBody.indexOf(separatorHTML);
                      if (separatorIndex !== -1) {
                        currentBody = currentBody.substring(0, separatorIndex);
                        setComposeForm({ ...composeForm, body: currentBody });
                        composeEditorRef.current.innerHTML = currentBody;
                      }
                    }
                  }}
                  className="flex-1 px-4 py-2.5 bg-[#262624] border border-[#3a3a38] rounded-lg text-white focus:ring-2 focus:ring-[#D97757] focus:border-[#D97757] outline-none hover:border-[#4a4a48] transition-all cursor-pointer appearance-none"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23999'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 0.5rem center',
                    backgroundSize: '1.5em 1.5em',
                    paddingRight: '2.5rem'
                  }}
                >
                  <option value="" className="bg-[#262624] text-white py-2">No signature</option>
                  {signatures.map(sig => (
                    <option key={sig.id} value={sig.id} className="bg-[#262624] text-white py-2">
                      {sig.name} {sig.isDefault ? '(Default)' : ''}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setShowSignatureManager(true)}
                  className="px-4 py-2.5 bg-[#3a3a38] text-gray-300 rounded-lg hover:bg-[#4a4a48] transition-all text-sm flex items-center gap-2 font-medium whitespace-nowrap"
                >
                  <FileSignature className="w-4 h-4" />
                  Manage
                </button>
              </div>

              {/* Attachments Section */}
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={handleFileSelect}
                    className="hidden"
                    accept="image/*,.pdf,.doc,.docx,.txt,.zip,.rar"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2 bg-[#3a3a38] text-gray-300 rounded-lg hover:bg-[#4a4a48] transition-all text-sm flex items-center gap-2"
                  >
                    <Paperclip className="w-4 h-4" />
                    Attach Files
                  </button>
                  {attachments.length > 0 && (
                    <span className="text-sm text-gray-400">
                      {attachments.length} file{attachments.length > 1 ? 's' : ''} attached
                    </span>
                  )}
                </div>

                {/* Attachment Preview List */}
                {attachments.length > 0 && (
                  <div className="bg-[#262624] rounded-xl border border-[#3a3a38] p-3 space-y-2">
                    {attachments.map((attachment, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-3 p-2 bg-[#30302E] rounded-lg hover:bg-[#3a3a38] transition-colors group"
                      >
                        <div className="flex-shrink-0 text-[#D97757]">
                          {getFileIcon(attachment.type, attachment.name)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white truncate">{attachment.name}</p>
                          <p className="text-xs text-gray-500">{formatFileSize(attachment.size)}</p>
                        </div>
                        <button
                          onClick={() => removeAttachment(index)}
                          className="flex-shrink-0 p-1 hover:bg-red-500/20 rounded transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <X className="w-4 h-4 text-red-400" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* AI Validation & Generation */}
              <div className="flex items-center gap-3">
                <button
                  onClick={validateEmail}
                  disabled={isValidating || (!composeForm.subject && !composeForm.body)}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isValidating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Validating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Check Deliverability
                    </>
                  )}
                </button>

                <button
                  onClick={generateEmail}
                  disabled={isGenerating}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-4 h-4" />
                      AI Improve
                    </>
                  )}
                </button>
              </div>

              {/* Validation Score Header */}
              {emailValidation && (
                <div className="bg-[#262624] rounded-xl border border-[#3a3a38] p-4">
                  <div className="flex items-center gap-3">
                    <div className={`flex items-center gap-2 ${
                      emailValidation.score >= 80 ? 'text-emerald-400' :
                      emailValidation.score >= 60 ? 'text-yellow-400' :
                      'text-red-400'
                    }`}>
                      {emailValidation.score >= 80 ? <ThumbsUp className="w-6 h-6" /> : <ThumbsDown className="w-6 h-6" />}
                      <span className="font-bold text-2xl">{emailValidation.score}/100</span>
                      <span className="text-sm font-medium">({emailValidation.rating})</span>
                    </div>
                    <div className="flex-1 border-l border-[#3a3a38] pl-3">
                      <p className="text-sm text-gray-300">{emailValidation.summary}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Validation Issues & Improvements */}
              {emailValidation && emailValidation.issues && emailValidation.issues.length > 0 && (
                <div className="bg-[#262624] rounded-xl border border-[#3a3a38] p-4 max-h-60 overflow-y-auto custom-scrollbar">
                  <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-yellow-400" />
                    Issues Found ({emailValidation.issues.length})
                  </h4>
                  <div className="space-y-2">
                    {emailValidation.issues.map((issue: any, idx: number) => (
                      <div
                        key={idx}
                        className={`p-3 rounded-lg border ${
                          issue.severity === 'high' ? 'bg-red-500/10 border-red-500/30' :
                          issue.severity === 'medium' ? 'bg-yellow-500/10 border-yellow-500/30' :
                          'bg-blue-500/10 border-blue-500/30'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`text-xs font-bold uppercase ${
                                issue.severity === 'high' ? 'text-red-400' :
                                issue.severity === 'medium' ? 'text-yellow-400' :
                                'text-blue-400'
                              }`}>
                                {issue.severity}
                              </span>
                              <span className="text-xs text-gray-500">in {issue.location}</span>
                            </div>
                            <p className="text-sm text-white mb-1">{issue.issue}</p>
                            {issue.badText && (
                              <p className="text-xs text-gray-400 mb-1">
                                Problem: "<span className="text-red-400">{issue.badText}</span>"
                              </p>
                            )}
                            <p className="text-xs text-gray-300">{issue.suggestion}</p>
                            {issue.betterText && (
                              <p className="text-xs text-emerald-400 mt-1">
                                Better: "{issue.betterText}"
                              </p>
                            )}
                          </div>
                          {issue.betterText && issue.badText && (
                            <button
                              onClick={() => applyImprovement(issue.betterText, issue.location, issue.badText)}
                              className="px-3 py-1 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700 transition-all flex-shrink-0"
                            >
                              Apply Fix
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            </div>

            {/* Footer with action buttons */}
            <div className="p-4 border-t border-[#3a3a38] bg-[#30302E] flex justify-end gap-3">
              <button
                onClick={() => setShowCompose(false)}
                className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={sendEmail}
                disabled={isLoading}
                className="px-6 py-2 bg-[#D97757] text-white rounded-xl font-medium hover:bg-[#c26848] transition-all flex items-center gap-2 disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                {isLoading ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mail Header with Back Button */}
      {onBack && (
        <div className="px-6 py-3 border-b border-[#3a3a38] flex items-center gap-3 flex-shrink-0 bg-[#262624]">
          <button
            onClick={onBack}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to Vault
          </button>
          <div className="h-4 w-px bg-[#3a3a38]"></div>
          {selectedAccount ? (
            <div className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-[#D97757]" />
              <h2 className="text-lg font-bold text-white">{selectedAccount.email}</h2>
              <span className="text-xs text-gray-500">({selectedAccount.name || 'Mail Account'})</span>
            </div>
          ) : (
            <h2 className="text-lg font-bold text-white">Mail</h2>
          )}
        </div>
      )}

      {/* Main Mail Interface */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - Folders (Fixed Like App Sidebar) */}
        <div className="w-64 border-r border-[#3a3a38] flex flex-col bg-[#30302E] flex-shrink-0 h-full">
          {/* Account Selector - Custom Dropdown */}
          <div className="p-4 border-b border-[#3a3a38] relative account-dropdown-container">
            <button
              onClick={() => setShowAccountDropdown(!showAccountDropdown)}
              className="w-full px-3 py-2.5 bg-[#262624] border border-[#3a3a38] rounded-xl text-white text-sm hover:bg-[#1f1f1d] transition-all flex items-center justify-between group"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Mail className="w-4 h-4 text-[#D97757] flex-shrink-0" />
                <span className="truncate">{selectedAccount ? (selectedAccount.name || selectedAccount.email) : 'Select Account'}</span>
              </div>
              <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${showAccountDropdown ? 'rotate-90' : ''}`} />
            </button>

            {/* Dropdown Menu */}
            {showAccountDropdown && (
              <div className="absolute top-full left-4 right-4 mt-2 bg-[#30302E] border border-[#3a3a38] rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                {accounts.map((account) => (
                  <button
                    key={account.id}
                    onClick={() => {
                      setSelectedAccount(account);
                      setShowAccountDropdown(false);
                    }}
                    className={`w-full px-4 py-3 text-left hover:bg-[#262624] transition-colors border-b border-[#3a3a38] last:border-0 ${
                      selectedAccount?.id === account.id ? 'bg-[#D97757]/10' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Mail className={`w-4 h-4 ${selectedAccount?.id === account.id ? 'text-[#D97757]' : 'text-gray-400'}`} />
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-medium truncate ${selectedAccount?.id === account.id ? 'text-[#D97757]' : 'text-white'}`}>
                          {account.name || 'Mail Account'}
                        </div>
                        <div className="text-xs text-gray-500 truncate">{account.email}</div>
                      </div>
                      {selectedAccount?.id === account.id && (
                        <CheckCircle className="w-4 h-4 text-[#D97757] flex-shrink-0" />
                      )}
                    </div>
                  </button>
                ))}

                {/* Add Account Button */}
                <button
                  onClick={() => {
                    setShowAccountDropdown(false);
                    setShowAccountSetup(true);
                  }}
                  className="w-full px-4 py-3 text-left hover:bg-[#262624] transition-colors border-t border-[#3a3a38]"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 flex items-center justify-center">
                      <Plus className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div className="text-sm font-medium text-emerald-400">Add New Account</div>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* Compose Button & Signature Manager */}
          <div className="p-4 border-b border-[#3a3a38] space-y-2">
            <button
              onClick={() => setShowCompose(true)}
              className="w-full py-2.5 bg-[#D97757] text-white rounded-lg font-medium hover:bg-[#c26848] transition-all flex items-center justify-center gap-2 shadow-md hover:shadow-lg"
            >
              <Plus className="w-5 h-5" />
              Compose
            </button>
            <button
              onClick={() => setShowSignatureManager(true)}
              className="w-full py-2 bg-[#30302E] text-gray-300 rounded-lg font-medium hover:bg-[#3a3a38] transition-all flex items-center justify-center gap-2 border border-[#3a3a38]"
            >
              <FileSignature className="w-4 h-4" />
              Manage Signatures
            </button>
          </div>

          {/* Folders Header */}
          <div className="px-4 py-3 border-b border-[#3a3a38]">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Folders
            </h3>
          </div>

          {/* Folders List - Scrollable with Custom Scrollbar */}
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <div className="py-2">
              {folders.length > 0 ? (
                folders.map((folder) => {
                  const hasNewMail = foldersWithNewMail.has(folder.path);
                  const isLoadingThisFolder = isLoading && selectedFolder === folder.path;
                  return (
                    <button
                      key={folder.id}
                      onClick={() => setSelectedFolder(folder.path)}
                      disabled={isLoadingThisFolder}
                      className={`w-full px-4 py-2.5 text-left text-sm transition-all flex items-center gap-3 group relative ${
                        selectedFolder === folder.path
                          ? 'bg-[#D97757] text-white font-medium'
                          : 'text-gray-300 hover:bg-[#3a3a38] hover:text-white'
                      } ${hasNewMail ? 'animate-pulse bg-[#D97757]/20 ring-2 ring-[#D97757]' : ''} ${
                        isLoadingThisFolder ? 'opacity-75 cursor-wait' : ''
                      }`}
                    >
                      {/* Active Indicator */}
                      {selectedFolder === folder.path && (
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-white"></div>
                      )}

                      {/* New Mail Glow Effect */}
                      {hasNewMail && (
                        <div className="absolute inset-0 bg-gradient-to-r from-[#D97757]/30 via-[#D97757]/10 to-transparent animate-pulse"></div>
                      )}

                      {/* Folder Icon - Show spinner when loading */}
                      {isLoadingThisFolder ? (
                        <Loader2 className="w-4 h-4 flex-shrink-0 relative z-10 text-white animate-spin" />
                      ) : (
                        <Inbox className={`w-4 h-4 flex-shrink-0 relative z-10 ${
                          selectedFolder === folder.path ? 'text-white' : hasNewMail ? 'text-[#D97757]' : 'text-gray-400 group-hover:text-[#D97757]'
                        }`} />
                      )}

                      {/* Folder Name */}
                      <span className={`flex-1 truncate relative z-10 ${hasNewMail ? 'font-bold text-white' : ''}`}>
                        {folder.name}
                      </span>

                      {/* Unread Badge - Enhanced Gmail/Thunderbird style */}
                      {folder.unread_messages > 0 && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-bold min-w-[24px] text-center relative z-10 ${
                          selectedFolder === folder.path
                            ? 'bg-white text-[#D97757]'
                            : hasNewMail
                            ? 'bg-[#D97757] text-white shadow-lg shadow-[#D97757]/50 animate-bounce'
                            : 'bg-[#D97757] text-white shadow-lg shadow-[#D97757]/30'
                        }`}>
                          {folder.unread_messages}
                        </span>
                      )}
                    </button>
                  );
                })
              ) : (
                <div className="px-4 py-8 text-center text-sm text-gray-500">
                  <Inbox className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p>No folders available</p>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Buttons - Fixed at Bottom */}
          {selectedAccount && (
            <div className="p-3 border-t border-[#3a3a38] flex-shrink-0 space-y-2">
              {/* Check Reputation Button */}
              <button
                onClick={checkReputation}
                className="w-full flex items-center gap-2 px-3 py-2 bg-[#2c2c2a] hover:bg-[#3a3a38] rounded transition-colors group text-left"
              >
                <Shield className="w-4 h-4 text-gray-400 group-hover:text-[#D97757] transition-colors flex-shrink-0" />
                <span className="text-xs text-gray-400 group-hover:text-white transition-colors">Check Reputation</span>
              </button>

              {/* Remove Account Button */}
              <button
                onClick={async () => {
                  if (confirm(`Remove mail account "${selectedAccount.name || selectedAccount.email}"?\n\nThis will delete the account from the app but won't delete emails from the server.`)) {
                    try {
                      await window.electronAPI.mail.deleteAccount(selectedAccount.id);
                      addToast('Mail account removed', 'success');
                      loadAccounts();
                      setSelectedAccount(null);
                    } catch (error: any) {
                      addToast('Failed to remove account', 'error');
                    }
                  }
                }}
                className="w-full flex items-center gap-2 px-3 py-2 bg-[#2c2c2a] hover:bg-[#3a3a38] rounded transition-colors group text-left"
              >
                <X className="w-4 h-4 text-gray-400 group-hover:text-red-400 transition-colors flex-shrink-0" />
                <span className="text-xs text-gray-400 group-hover:text-white transition-colors">Remove Account</span>
              </button>
            </div>
          )}
        </div>

        {/* Email List (Fixed Width, ONLY This Section Scrolls) */}
        <div className="w-96 border-r border-[#3a3a38] flex flex-col bg-[#262624] flex-shrink-0 h-full">
          {/* Header - Fixed */}
          <div className="p-4 border-b border-[#3a3a38] flex items-center justify-between flex-shrink-0">
            <h2 className="text-lg font-bold text-white">
              {selectedFolder}
            </h2>
            <button
              onClick={() => selectedAccount && loadEmails(selectedAccount.id, selectedFolder)}
              className="p-2 hover:bg-[#30302E] rounded-lg transition-colors"
              disabled={isLoading}
            >
              <RefreshCw className={`w-4 h-4 text-gray-400 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Email List - Optimized with Memoization */}
          <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
            {isLoading && emails.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-8 h-8 text-[#D97757] animate-spin" />
              </div>
            ) : emails.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500 px-6">
                <Mail className="w-12 h-12 mb-3 opacity-50" />
                <p className="text-sm text-center">No messages in this folder</p>
              </div>
            ) : (
              emails.map((email) => (
                <EmailListItem
                  key={email.id}
                  email={email}
                  isSelected={selectedEmail?.id === email.id}
                  onEmailClick={handleEmailClick}
                />
              ))
            )}
          </div>
        </div>

        {/* Email Reader (Flexible, Contained) */}
        <div className="flex-1 flex flex-col bg-[#262624] min-w-0 overflow-hidden">
          {selectedEmail ? (
            <>
              {/* Email Header */}
              <div className="p-6 border-b border-[#3a3a38] bg-[#30302E]">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <h1
                      className={`text-2xl font-bold text-white cursor-pointer hover:text-[#D97757] transition-colors ${
                        !expandedSubjects.has(selectedEmail.id) ? 'line-clamp-2' : ''
                      }`}
                      onClick={() => {
                        setExpandedSubjects(prev => {
                          const next = new Set(prev);
                          if (next.has(selectedEmail.id)) {
                            next.delete(selectedEmail.id);
                          } else {
                            next.add(selectedEmail.id);
                          }
                          return next;
                        });
                      }}
                      title={expandedSubjects.has(selectedEmail.id) ? 'Click to collapse' : 'Click to expand'}
                    >
                      {selectedEmail.subject || '(No Subject)'}
                    </h1>
                    {!expandedSubjects.has(selectedEmail.id) && (selectedEmail.subject || '').length > 100 && (
                      <span className="text-sm text-gray-500 italic">Click to expand...</span>
                    )}
                  </div>
                  <button
                    onClick={handleReply}
                    className="ml-4 px-4 py-2 bg-[#D97757] text-white rounded-lg hover:bg-[#c26848] transition-all flex items-center gap-2"
                  >
                    <Reply className="w-4 h-4" />
                    Reply
                  </button>
                </div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#D97757] rounded-full flex items-center justify-center text-white font-semibold">
                      {(selectedEmail.from[0]?.name || selectedEmail.from[0]?.address)?.[0]?.toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-white">
                        {selectedEmail.from[0]?.name || selectedEmail.from[0]?.address}
                      </div>
                      <div className="text-xs text-gray-500">
                        {selectedEmail.from[0]?.address}
                      </div>
                    </div>
                  </div>
                  <div className="text-sm text-gray-500">
                    {new Date(selectedEmail.date).toLocaleString()}
                  </div>
                </div>
                <div className="text-xs text-gray-500">
                  To: {selectedEmail.to.map((t: any) => t.address).join(', ')}
                </div>
              </div>

              {/* Security Warning Banner */}
              {selectedEmail.isSuspicious && (
                <div className={`p-4 border-b border-[#3a3a38] ${
                  selectedEmail.securityRating === 'dangerous'
                    ? 'bg-red-900/30 border-red-500/50'
                    : selectedEmail.securityRating === 'suspicious'
                    ? 'bg-yellow-900/30 border-yellow-500/50'
                    : 'bg-orange-900/30 border-orange-500/50'
                }`}>
                  <div className="flex items-start gap-3">
                    <ShieldAlert
                      className={`flex-shrink-0 ${
                        selectedEmail.securityRating === 'dangerous'
                          ? 'text-red-400'
                          : selectedEmail.securityRating === 'suspicious'
                          ? 'text-yellow-400'
                          : 'text-orange-400'
                      }`}
                      size={24}
                    />
                    <div className="flex-1">
                      <div className={`font-bold text-sm mb-1 ${
                        selectedEmail.securityRating === 'dangerous'
                          ? 'text-red-300'
                          : selectedEmail.securityRating === 'suspicious'
                          ? 'text-yellow-300'
                          : 'text-orange-300'
                      }`}>
                        {selectedEmail.securityRating === 'dangerous'
                          ? '⚠️ DANGEROUS EMAIL - Exercise Extreme Caution'
                          : selectedEmail.securityRating === 'suspicious'
                          ? '⚠️ SUSPICIOUS EMAIL - Be Careful'
                          : '⚠️ SECURITY WARNING'}
                      </div>
                      <div className="text-xs text-gray-300 mb-2">
                        {selectedEmail.securitySummary || 'This email has security issues that require your attention.'}
                      </div>
                      <div className="text-xs text-gray-400 mb-2">
                        Security Score: {selectedEmail.securityScore}/10
                      </div>
                      <button
                        onClick={() => {
                          try {
                            const issues = JSON.parse(selectedEmail.securityIssues || '[]');
                            setSelectedEmailSecurity({
                              score: selectedEmail.securityScore,
                              rating: selectedEmail.securityRating,
                              summary: selectedEmail.securitySummary,
                              issues
                            });
                            setShowSecurityReport(true);
                          } catch (e) {
                            addToast('Failed to load security report', 'error');
                          }
                        }}
                        className={`px-3 py-1 rounded text-xs font-medium hover:opacity-80 transition-opacity ${
                          selectedEmail.securityRating === 'dangerous'
                            ? 'bg-red-500 text-white'
                            : selectedEmail.securityRating === 'suspicious'
                            ? 'bg-yellow-500 text-black'
                            : 'bg-orange-500 text-white'
                        }`}
                      >
                        View Security Report
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Attachments Section */}
              {selectedEmail.hasAttachments && selectedEmail.attachments && selectedEmail.attachments.length > 0 && (
                <div className="px-6 py-4 border-b border-[#3a3a38] bg-[#272725]">
                  <div className="flex items-center gap-2 mb-3">
                    <Paperclip className="w-4 h-4 text-[#D97757]" />
                    <h4 className="text-sm font-semibold text-white">
                      Attachments ({selectedEmail.attachments.length})
                    </h4>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {selectedEmail.attachments.map((attachment: any, index: number) => (
                      <div
                        key={index}
                        className="flex items-center gap-3 p-3 bg-[#30302E] rounded-lg hover:bg-[#3a3a38] transition-colors group"
                      >
                        <div className="flex-shrink-0 text-[#D97757]">
                          {getFileIcon(attachment.contentType || attachment.type || '', attachment.filename || attachment.name || 'file')}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white truncate">{attachment.filename || attachment.name || 'Unnamed'}</p>
                          <p className="text-xs text-gray-500">
                            {attachment.size ? formatFileSize(attachment.size) : 'Unknown size'}
                          </p>
                        </div>
                        {attachment.content && (
                          <button
                            onClick={() => {
                              try {
                                // Download attachment - convert base64 to blob
                                const binaryString = atob(attachment.content);
                                const bytes = new Uint8Array(binaryString.length);
                                for (let i = 0; i < binaryString.length; i++) {
                                  bytes[i] = binaryString.charCodeAt(i);
                                }
                                const blob = new Blob([bytes], {
                                  type: attachment.contentType || 'application/octet-stream'
                                });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = attachment.filename || 'download';
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                                URL.revokeObjectURL(url);
                                addToast('Attachment downloaded', 'success');
                              } catch (error) {
                                console.error('Download error:', error);
                                addToast('Failed to download attachment', 'error');
                              }
                            }}
                            className="flex-shrink-0 px-3 py-1.5 bg-[#D97757] text-white rounded text-xs hover:bg-[#c26848] transition-colors"
                          >
                            Download
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Email Body - White Background with Proper Spacing */}
              <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
                <div className="bg-white rounded-lg p-6 mx-2 my-2 shadow-sm">
                  {selectedEmail.htmlBody ? (
                    /* Sandboxed iframe for HTML emails to prevent layout disruption */
                    <iframe
                      srcDoc={`
                        <!DOCTYPE html>
                        <html>
                          <head>
                            <meta charset="utf-8">
                            <meta name="viewport" content="width=device-width, initial-scale=1.0">
                            <!-- Tailwind CSS CDN for email signature support -->
                            <script src="https://cdn.tailwindcss.com"></script>
                            <style>
                              body {
                                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                                font-size: 14px;
                                line-height: 1.6;
                                color: #1f2937;
                                background: #ffffff;
                                margin: 0;
                                padding: 16px;
                                overflow-wrap: break-word;
                                word-wrap: break-word;
                              }
                              a { color: #D97757; text-decoration: underline; cursor: pointer; }
                              img { max-width: 100%; height: auto; }
                              table { border-collapse: collapse; width: 100%; }
                              * { max-width: 100%; box-sizing: border-box; }
                            </style>
                          </head>
                          <body>
                            ${selectedEmail.htmlBody}
                            <script>
                              // Intercept all link clicks and send to parent window
                              document.addEventListener('DOMContentLoaded', function() {
                                document.addEventListener('click', function(e) {
                                  const target = e.target.closest('a');
                                  if (target && target.href) {
                                    e.preventDefault();
                                    window.parent.postMessage({ type: 'open-external-link', url: target.href }, '*');
                                  }
                                });
                              });
                            </script>
                          </body>
                        </html>
                      `}
                    sandbox="allow-same-origin allow-scripts"
                      className="w-full min-h-[600px] border-0 bg-transparent"
                      style={{ height: 'calc(100vh - 300px)' }}
                    />
                  ) : selectedEmail.textBody ? (
                    <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800 m-0 leading-relaxed">
                      {selectedEmail.textBody}
                    </pre>
                  ) : (
                    /* No body loaded yet - show placeholder */
                    <div className="flex items-center justify-center py-12">
                      <p className="text-gray-500 italic">Email body not loaded yet</p>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-500">
              <div className="text-center">
                <Mail className="w-16 h-16 mx-auto mb-4 opacity-30" />
                <p>Select an email to read</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Security Report Modal */}
      {showSecurityReport && selectedEmailSecurity && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowSecurityReport(false)}>
          <div
            className="bg-[#262624] rounded-lg max-w-3xl w-full max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-6 border-b border-[#3a3a38] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ShieldAlert
                  className={`${
                    selectedEmailSecurity.rating === 'dangerous'
                      ? 'text-red-400'
                      : selectedEmailSecurity.rating === 'suspicious'
                      ? 'text-yellow-400'
                      : 'text-orange-400'
                  }`}
                  size={28}
                />
                <div>
                  <h2 className="text-xl font-bold text-white">Email Security Report</h2>
                  <p className="text-sm text-gray-400">Detailed analysis of security issues</p>
                </div>
              </div>
              <button
                onClick={() => setShowSecurityReport(false)}
                className="p-2 hover:bg-[#30302E] rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              {/* Score Summary */}
              <div className={`p-4 rounded-lg mb-6 ${
                selectedEmailSecurity.rating === 'dangerous'
                  ? 'bg-red-900/30 border border-red-500/50'
                  : selectedEmailSecurity.rating === 'suspicious'
                  ? 'bg-yellow-900/30 border border-yellow-500/50'
                  : 'bg-orange-900/30 border border-orange-500/50'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-2xl font-bold text-white">
                    Score: {selectedEmailSecurity.score}/10
                  </div>
                  <div className={`px-3 py-1 rounded text-sm font-medium ${
                    selectedEmailSecurity.rating === 'dangerous'
                      ? 'bg-red-500 text-white'
                      : selectedEmailSecurity.rating === 'suspicious'
                      ? 'bg-yellow-500 text-black'
                      : 'bg-orange-500 text-white'
                  }`}>
                    {selectedEmailSecurity.rating.toUpperCase()}
                  </div>
                </div>
                <p className="text-gray-300 text-sm">{selectedEmailSecurity.summary}</p>
              </div>

              {/* Security Issues */}
              {selectedEmailSecurity.issues && selectedEmailSecurity.issues.length > 0 ? (
                <div className="space-y-3">
                  <h3 className="text-lg font-bold text-white mb-3">Security Issues Found</h3>
                  {selectedEmailSecurity.issues.map((issue: any, index: number) => (
                    <div
                      key={index}
                      className={`p-4 rounded-lg border ${
                        issue.severity === 'critical'
                          ? 'bg-red-900/20 border-red-500/40'
                          : issue.severity === 'high'
                          ? 'bg-orange-900/20 border-orange-500/40'
                          : issue.severity === 'medium'
                          ? 'bg-yellow-900/20 border-yellow-500/40'
                          : 'bg-blue-900/20 border-blue-500/40'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`px-2 py-1 rounded text-xs font-bold uppercase flex-shrink-0 ${
                          issue.severity === 'critical'
                            ? 'bg-red-500 text-white'
                            : issue.severity === 'high'
                            ? 'bg-orange-500 text-white'
                            : issue.severity === 'medium'
                            ? 'bg-yellow-500 text-black'
                            : 'bg-blue-500 text-white'
                        }`}>
                          {issue.severity}
                        </div>
                        <div className="flex-1">
                          <div className="text-sm font-bold text-white mb-1">{issue.category}</div>
                          <div className="text-sm text-gray-300 mb-2">{issue.description}</div>
                          {issue.details && (
                            <div className="text-xs text-gray-400 italic">{issue.details}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center text-gray-500 py-8">
                  <Shield className="w-16 h-16 mx-auto mb-4 opacity-30" />
                  <p>No security issues detected</p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-6 border-t border-[#3a3a38] flex justify-end">
              <button
                onClick={() => setShowSecurityReport(false)}
                className="px-6 py-2 bg-[#D97757] text-white rounded-lg hover:bg-[#c26848] transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reputation Check Modal */}
      {showReputationModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-[#2c2c2a] rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="sticky top-0 bg-[#2c2c2a] border-b border-[#3a3a38] p-6 flex items-center justify-between z-10">
              <div className="flex items-center gap-3">
                <Shield className="w-8 h-8 text-blue-500" />
                <div>
                  <h2 className="text-2xl font-bold text-white">Email Reputation Dashboard</h2>
                  <p className="text-sm text-gray-400 mt-1">
                    {selectedAccount ? selectedAccount.email : 'Checking...'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowReputationModal(false)}
                className="p-2 hover:bg-[#3a3a38] rounded-lg transition-colors"
              >
                <X className="w-6 h-6 text-gray-400" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6">
              {isCheckingReputation ? (
                <div className="text-center py-16">
                  <div className="inline-block animate-spin rounded-full h-16 w-16 border-4 border-[#D97757] border-t-transparent mb-4"></div>
                  <p className="text-lg text-gray-300 font-medium">Checking reputation globally...</p>
                  <p className="text-sm text-gray-500 mt-2">This may take a few seconds</p>
                </div>
              ) : reputationData && reputationData.overallScore !== undefined ? (
                <>
                  {/* Overall Score */}
                  <div className="bg-[#1e1e1c] rounded-lg p-6 border border-[#3a3a38]">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-white">Overall Deliverability Score</h3>
                      <div className={`px-3 py-1.5 rounded-lg text-sm font-bold ${
                        reputationData.overallRating === 'healthy' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
                        reputationData.overallRating === 'needs_attention' ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' :
                        'bg-red-500/10 text-red-400 border border-red-500/20'
                      }`}>
                        {reputationData.overallRating === 'healthy' ? 'HEALTHY' :
                         reputationData.overallRating === 'needs_attention' ? 'NEEDS ATTENTION' : 'CRITICAL'}
                      </div>
                    </div>

                    <div className="relative h-3 bg-[#2c2c2a] rounded-full overflow-hidden mb-3">
                      <div
                        className={`absolute inset-y-0 left-0 rounded-full transition-all duration-1000 ${
                          reputationData.overallScore >= 80 ? 'bg-[#D97757]' :
                          reputationData.overallScore >= 60 ? 'bg-yellow-500' :
                          'bg-red-500'
                        }`}
                        style={{ width: `${reputationData.overallScore}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-2xl font-bold text-white">{reputationData.overallScore}<span className="text-gray-500 text-lg">/100</span></span>
                      <p className="text-gray-400 text-sm">
                        {reputationData.overallScore >= 80 ? 'Excellent deliverability' :
                         reputationData.overallScore >= 60 ? 'Good deliverability' :
                         reputationData.overallScore >= 40 ? 'Fair deliverability' :
                         'Poor deliverability'}
                      </p>
                    </div>
                  </div>

                  {/* Domain Reputation */}
                  {reputationData.domainReputation && (
                  <div className="bg-[#1e1e1c] rounded-lg p-6 border border-[#3a3a38]">
                    <div className="flex items-center gap-3 mb-5">
                      <Globe className="w-5 h-5 text-[#D97757]" />
                      <h3 className="text-lg font-semibold text-white">Domain Reputation</h3>
                      <div className="ml-auto px-3 py-1 rounded-lg text-sm font-bold bg-[#2c2c2a] text-gray-300 border border-[#3a3a38]">
                        {reputationData.domainReputation?.score || 0}/100
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* DNS Configuration */}
                      <div className="space-y-3">
                        <h4 className="text-sm font-bold text-gray-400 uppercase">DNS Configuration</h4>

                        {/* SPF */}
                        <div className="flex items-center justify-between p-3 bg-[#2c2c2a] rounded-lg">
                          <span className="text-gray-300 flex items-center gap-2">
                            <Mail className="w-4 h-4" />
                            SPF Record
                          </span>
                          <span className={`px-2 py-1 rounded text-xs font-bold ${
                            reputationData.domainReputation?.dnsConfig?.spf ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                          }`}>
                            {reputationData.domainReputation?.dnsConfig?.spf ? 'CONFIGURED' : 'MISSING'}
                          </span>
                        </div>

                        {/* DKIM */}
                        <div className="flex items-center justify-between p-3 bg-[#2c2c2a] rounded-lg">
                          <span className="text-gray-300 flex items-center gap-2">
                            <Key className="w-4 h-4" />
                            DKIM Record
                          </span>
                          <span className={`px-2 py-1 rounded text-xs font-bold ${
                            reputationData.domainReputation?.dnsConfig?.dkim ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
                          }`}>
                            {reputationData.domainReputation?.dnsConfig?.dkim ? 'CONFIGURED' : 'NOT VERIFIED'}
                          </span>
                        </div>

                        {/* DMARC */}
                        <div className="flex items-center justify-between p-3 bg-[#2c2c2a] rounded-lg">
                          <span className="text-gray-300 flex items-center gap-2">
                            <Shield className="w-4 h-4" />
                            DMARC Policy
                          </span>
                          <span className={`px-2 py-1 rounded text-xs font-bold ${
                            reputationData.domainReputation?.dnsConfig?.dmarc ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                          }`}>
                            {reputationData.domainReputation?.dnsConfig?.dmarc ? 'CONFIGURED' : 'MISSING'}
                          </span>
                        </div>

                        {/* MX Records */}
                        <div className="flex items-center justify-between p-3 bg-[#2c2c2a] rounded-lg">
                          <span className="text-gray-300 flex items-center gap-2">
                            <Server className="w-4 h-4" />
                            MX Records
                          </span>
                          <span className={`px-2 py-1 rounded text-xs font-bold ${
                            reputationData.domainReputation?.dnsConfig?.mx ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                          }`}>
                            {reputationData.domainReputation?.dnsConfig?.mx ? 'VALID' : 'INVALID'}
                          </span>
                        </div>

                        {/* SSL Certificate */}
                        <div className="flex items-center justify-between p-3 bg-[#2c2c2a] rounded-lg">
                          <span className="text-gray-300 flex items-center gap-2">
                            <Lock className="w-4 h-4" />
                            SSL Certificate
                          </span>
                          <span className={`px-2 py-1 rounded text-xs font-bold ${
                            reputationData.domainReputation?.dnsConfig?.ssl ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
                          }`}>
                            {reputationData.domainReputation?.dnsConfig?.ssl ? 'VALID' : 'NOT CHECKED'}
                          </span>
                        </div>
                      </div>

                      {/* Domain Blacklists */}
                      <div className="space-y-3">
                        <h4 className="text-sm font-bold text-gray-400 uppercase">Domain Blacklists</h4>
                        {reputationData.domainReputation?.blacklists && reputationData.domainReputation.blacklists.length > 0 ? (
                          reputationData.domainReputation.blacklists.map((bl: any, index: number) => (
                            <div key={index} className="flex items-center justify-between p-3 bg-[#2c2c2a] rounded-lg">
                              <span className="text-gray-300">{bl.name}</span>
                              <span className={`px-2 py-1 rounded text-xs font-bold ${
                                bl.listed ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
                              }`}>
                                {bl.listed ? 'LISTED' : 'CLEAN'}
                              </span>
                            </div>
                          ))
                        ) : (
                          <div className="p-8 text-center">
                            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
                            <p className="text-gray-400 text-sm">Not listed on any blacklists</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  )}

                  {/* IP Reputation */}
                  {reputationData.ipReputation && (
                    <div className="bg-[#1e1e1c] rounded-lg p-6 border border-[#3a3a38]">
                      <div className="flex items-center gap-3 mb-5">
                        <Server className="w-5 h-5 text-[#D97757]" />
                        <h3 className="text-lg font-semibold text-white">IP Reputation</h3>
                        <div className="ml-auto px-3 py-1 rounded-lg text-sm font-bold bg-[#2c2c2a] text-gray-300 border border-[#3a3a38]">
                          {reputationData.ipReputation?.score || 0}/100
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between p-3 bg-[#2c2c2a] rounded-lg">
                          <span className="text-gray-300">Reverse DNS</span>
                          <span className={`px-2 py-1 rounded text-xs font-bold ${
                            reputationData.ipReputation?.reverseDns ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                          }`}>
                            {reputationData.ipReputation?.reverseDns ? 'CONFIGURED' : 'MISSING'}
                          </span>
                        </div>

                        {reputationData.ipReputation?.blacklists && reputationData.ipReputation.blacklists.length > 0 && (
                          <div className="space-y-2">
                            <h4 className="text-sm font-bold text-gray-400 uppercase">IP Blacklists</h4>
                            {reputationData.ipReputation.blacklists.map((bl: any, index: number) => (
                              <div key={index} className="flex items-center justify-between p-3 bg-[#2c2c2a] rounded-lg">
                                <span className="text-gray-300">{bl.name}</span>
                                <span className={`px-2 py-1 rounded text-xs font-bold ${
                                  bl.listed ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
                                }`}>
                                  {bl.listed ? 'LISTED' : 'CLEAN'}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Issues */}
                  {reputationData.issues && reputationData.issues.length > 0 && (
                    <div className="bg-[#1e1e1c] rounded-lg p-6 border border-[#3a3a38]">
                      <div className="flex items-center gap-3 mb-4">
                        <AlertTriangle className="w-5 h-5 text-[#D97757]" />
                        <h3 className="text-lg font-semibold text-white">Issues Detected</h3>
                      </div>
                      <div className="space-y-2">
                        {reputationData.issues.map((issue: string, index: number) => (
                          <div key={index} className="flex items-start gap-3 p-3 bg-[#2c2c2a] border border-[#3a3a38] rounded-lg">
                            <XCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                            <p className="text-gray-300 text-sm">{issue}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Recommendations */}
                  {reputationData.recommendations && reputationData.recommendations.length > 0 && (
                    <div className="bg-[#1e1e1c] rounded-lg p-6 border border-[#3a3a38]">
                      <div className="flex items-center gap-3 mb-4">
                        <CheckCircle className="w-5 h-5 text-[#D97757]" />
                        <h3 className="text-lg font-semibold text-white">Recommendations</h3>
                      </div>
                      <div className="space-y-2">
                        {reputationData.recommendations.map((rec: string, index: number) => (
                          <div key={index} className="flex items-start gap-3 p-3 bg-[#2c2c2a] border border-[#3a3a38] rounded-lg">
                            <ArrowRight className="w-4 h-4 text-[#D97757] flex-shrink-0 mt-0.5" />
                            <p className="text-gray-300 text-sm">{rec}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-16">
                  <XCircle className="w-16 h-16 text-[#D97757] mx-auto mb-4" />
                  <p className="text-lg text-gray-300 font-medium">Failed to load reputation data</p>
                  {reputationError && (
                    <div className="mt-4 p-4 bg-[#2c2c2a] border border-[#3a3a38] rounded-lg max-w-md mx-auto">
                      <p className="text-sm text-gray-400">{reputationError}</p>
                    </div>
                  )}
                  <button
                    onClick={checkReputation}
                    className="mt-4 px-6 py-2 bg-[#D97757] hover:bg-[#c26848] text-white rounded-lg transition-colors"
                  >
                    Try Again
                  </button>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="sticky bottom-0 bg-[#2c2c2a] p-6 border-t border-[#3a3a38] flex justify-end">
              <button
                onClick={() => setShowReputationModal(false)}
                className="px-6 py-2 bg-[#D97757] text-white rounded-lg hover:bg-[#c26848] transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Signature Manager Modal */}
      {showSignatureManager && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-8">
          <div className="bg-[#30302E] rounded-2xl w-full max-w-4xl shadow-2xl border border-[#3a3a38] max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="p-6 border-b border-[#3a3a38] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileSignature className="w-6 h-6 text-[#D97757]" />
                <h3 className="text-xl font-bold text-white">
                  {showSignatureEditor ? (editingSignature ? 'Edit Signature' : 'New Signature') : 'Manage Email Signatures'}
                </h3>
              </div>
              <button
                onClick={() => {
                  setShowSignatureManager(false);
                  setShowSignatureEditor(false);
                  setEditingSignature(null);
                  setSignatureForm({ name: '', htmlContent: '', isDefault: false });
                }}
                className="p-2 hover:bg-[#3a3a38] rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            {!showSignatureEditor ? (
              /* Signature List View */
              <div className="flex-1 overflow-hidden flex flex-col">
                <div className="p-6 flex-1 overflow-y-auto">
                  {signatures.length === 0 ? (
                    <div className="text-center py-12">
                      <FileSignature className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                      <p className="text-gray-400 mb-4">No signatures yet</p>
                      <button
                        onClick={() => {
                          setSignatureForm({ name: '', htmlContent: '', isDefault: signatures.length === 0 });
                          setEditingSignature(null);
                          setShowSignatureEditor(true);
                        }}
                        className="px-6 py-2 bg-[#D97757] text-white rounded-lg hover:bg-[#c26848] transition-all inline-flex items-center gap-2"
                      >
                        <Plus className="w-4 h-4" />
                        Create Your First Signature
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {signatures.map((sig) => (
                        <div
                          key={sig.id}
                          className="bg-[#272725] border border-[#3a3a38] rounded-lg p-4 hover:border-[#D97757] transition-all"
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <h4 className="text-white font-semibold">{sig.name}</h4>
                                {sig.isDefault && (
                                  <span className="px-2 py-0.5 bg-[#D97757] text-white text-xs rounded-full">
                                    Default
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-gray-500 mt-1">
                                Created {new Date(sig.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  setEditingSignature(sig);
                                  setSignatureForm({
                                    name: sig.name,
                                    htmlContent: sig.htmlContent,
                                    isDefault: sig.isDefault
                                  });
                                  setShowSignatureEditor(true);
                                }}
                                className="px-3 py-1.5 bg-[#3a3a38] text-gray-300 rounded-lg hover:bg-[#4a4a48] transition-all text-sm flex items-center gap-1"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                                Edit
                              </button>
                              <button
                                onClick={() => {
                                  if (confirm(`Delete signature "${sig.name}"?`)) {
                                    deleteSignature(sig.id);
                                  }
                                }}
                                className="px-3 py-1.5 bg-red-900/20 text-red-400 rounded-lg hover:bg-red-900/30 transition-all text-sm flex items-center gap-1"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                Delete
                              </button>
                            </div>
                          </div>
                          <div className="bg-white rounded-lg overflow-hidden">
                            <iframe
                              srcDoc={`
                                <!DOCTYPE html>
                                <html>
                                  <head>
                                    <meta charset="utf-8">
                                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                                    <script src="https://cdn.tailwindcss.com"></script>
                                    <style>
                                      body {
                                        margin: 0;
                                        padding: 12px;
                                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                                        background: white;
                                        font-size: 14px;
                                      }
                                    </style>
                                  </head>
                                  <body>${sig.htmlContent}</body>
                                </html>
                              `}
                              sandbox="allow-same-origin"
                              className="w-full border-0"
                              style={{ minHeight: '100px', height: '150px' }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {signatures.length > 0 && (
                  <div className="p-6 border-t border-[#3a3a38]">
                    <button
                      onClick={() => {
                        setSignatureForm({ name: '', htmlContent: '', isDefault: false });
                        setEditingSignature(null);
                        setShowSignatureEditor(true);
                      }}
                      className="w-full py-2.5 bg-[#D97757] text-white rounded-lg hover:bg-[#c26848] transition-all flex items-center justify-center gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      Create New Signature
                    </button>
                  </div>
                )}
              </div>
            ) : (
              /* Signature Editor View */
              <div className="flex-1 overflow-hidden flex flex-col">
                <div className="p-6 flex-1 overflow-y-auto space-y-4">
                  {/* Signature Name */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Signature Name
                    </label>
                    <input
                      type="text"
                      value={signatureForm.name}
                      onChange={(e) => setSignatureForm({ ...signatureForm, name: e.target.value })}
                      placeholder="e.g., Professional, Personal, Work"
                      className="w-full px-4 py-2.5 bg-[#272725] border border-[#3a3a38] rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#D97757]"
                    />
                  </div>

                  {/* Signature Content */}
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-gray-300">
                        Signature Content
                      </label>
                      <button
                        onClick={() => {
                          setShowSignatureHTMLMode(!showSignatureHTMLMode);
                          // Sync content between modes
                          if (!showSignatureHTMLMode && signatureEditorRef.current) {
                            setSignatureForm({ ...signatureForm, htmlContent: signatureEditorRef.current.innerHTML });
                          } else if (showSignatureHTMLMode && signatureEditorRef.current) {
                            signatureEditorRef.current.innerHTML = signatureForm.htmlContent;
                          }
                        }}
                        className="px-3 py-1 bg-[#3a3a38] text-gray-300 rounded text-xs hover:bg-[#4a4a48] transition-colors"
                      >
                        {showSignatureHTMLMode ? '📝 Visual Editor' : '🔧 HTML/CSS Mode'}
                      </button>
                    </div>

                    {showSignatureHTMLMode ? (
                      /* HTML/CSS Mode */
                      <textarea
                        value={signatureForm.htmlContent}
                        onChange={(e) => setSignatureForm({ ...signatureForm, htmlContent: e.target.value })}
                        placeholder={`Enter HTML, CSS, and Tailwind classes...

Examples:

<!-- Simple with Tailwind -->
<div class="font-sans text-gray-800">
  <p class="font-bold">Best regards,</p>
  <p class="text-sm">Your Name</p>
</div>

<!-- With inline styles -->
<div style="font-family: Arial, sans-serif; color: #333;">
  <p style="font-weight: bold; margin: 0;">John Doe</p>
  <p style="color: #666; font-size: 14px;">CEO | Company Inc.</p>
  <p style="color: #999; font-size: 12px;">📧 john@company.com | 📱 +1234567890</p>
</div>

<!-- Advanced with Tailwind and custom CSS -->
<div class="p-4 border-l-4 border-blue-500 bg-gray-50">
  <div class="flex items-center gap-3">
    <div class="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold">JD</div>
    <div>
      <h3 class="font-bold text-lg text-gray-900">Jane Doe ✨</h3>
      <p class="text-sm text-gray-600">Senior Developer</p>
    </div>
  </div>
  <div class="mt-3 text-xs text-gray-500">
    <a href="mailto:jane@example.com" class="text-blue-600 hover:underline">jane@example.com</a>
  </div>
</div>`}
                        className="w-full h-80 px-4 py-3 bg-[#272725] border border-[#3a3a38] rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#D97757] font-mono text-sm resize-none"
                        spellCheck={false}
                      />
                    ) : (
                      /* WYSIWYG Visual Editor */
                      <div
                        ref={signatureEditorRef}
                        contentEditable
                        suppressContentEditableWarning
                        onInput={(e) => {
                          const htmlContent = (e.target as HTMLDivElement).innerHTML;
                          setSignatureForm({ ...signatureForm, htmlContent });
                        }}
                        onPaste={(e) => {
                          e.preventDefault();
                          const text = e.clipboardData.getData('text/html') || e.clipboardData.getData('text/plain');
                          document.execCommand('insertHTML', false, text);
                        }}
                        className="w-full h-80 px-4 py-3 bg-white border border-[#3a3a38] rounded-lg text-gray-900 focus:outline-none focus:border-[#D97757] overflow-y-auto"
                        style={{ minHeight: '320px' }}
                        data-placeholder="Type your signature here... You can format text, add colors, insert images, etc."
                      />
                    )}

                    <p className="text-xs text-gray-500 mt-2">
                      {showSignatureHTMLMode
                        ? '💡 Tip: Use Tailwind CSS classes or inline styles. All HTML tags and CSS are supported.'
                        : '💡 Tip: Format text naturally. Switch to HTML mode for advanced styling with Tailwind CSS.'}
                    </p>
                  </div>

                  {/* Preview */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Live Preview
                    </label>
                    <div className="bg-white rounded-lg overflow-hidden min-h-[150px]">
                      {signatureForm.htmlContent ? (
                        <iframe
                          srcDoc={`
                            <!DOCTYPE html>
                            <html>
                              <head>
                                <meta charset="utf-8">
                                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                                <!-- Tailwind CSS CDN for preview -->
                                <script src="https://cdn.tailwindcss.com"></script>
                                <style>
                                  body {
                                    margin: 0;
                                    padding: 16px;
                                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                                    background: white;
                                  }
                                  * {
                                    box-sizing: border-box;
                                  }
                                </style>
                              </head>
                              <body>${signatureForm.htmlContent}</body>
                            </html>
                          `}
                          sandbox="allow-same-origin"
                          className="w-full border-0"
                          style={{ minHeight: '150px', height: '250px' }}
                        />
                      ) : (
                        <div className="p-4">
                          <p className="text-gray-400 text-sm italic">Preview will appear here...</p>
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      ✨ Live preview with Tailwind CSS support
                    </p>
                  </div>

                  {/* Default Checkbox */}
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="defaultSignature"
                      checked={signatureForm.isDefault}
                      onChange={(e) => setSignatureForm({ ...signatureForm, isDefault: e.target.checked })}
                      className="w-4 h-4 rounded border-[#3a3a38] bg-[#272725] text-[#D97757] focus:ring-[#D97757] focus:ring-offset-0"
                    />
                    <label htmlFor="defaultSignature" className="text-sm text-gray-300 cursor-pointer">
                      Set as default signature (auto-inserted in new emails)
                    </label>
                  </div>
                </div>

                {/* Editor Footer */}
                <div className="p-6 border-t border-[#3a3a38] flex gap-3">
                  <button
                    onClick={() => {
                      setShowSignatureEditor(false);
                      setEditingSignature(null);
                      setSignatureForm({ name: '', htmlContent: '', isDefault: false });
                    }}
                    className="px-6 py-2.5 bg-[#3a3a38] text-gray-300 rounded-lg hover:bg-[#4a4a48] transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      if (!signatureForm.name.trim()) {
                        addToast('Please enter a signature name', 'error');
                        return;
                      }
                      if (!signatureForm.htmlContent.trim()) {
                        addToast('Please enter signature content', 'error');
                        return;
                      }

                      const success = await saveSignature(
                        signatureForm.name,
                        signatureForm.htmlContent,
                        signatureForm.isDefault,
                        editingSignature?.id
                      );

                      if (success) {
                        setShowSignatureEditor(false);
                        setEditingSignature(null);
                        setSignatureForm({ name: '', htmlContent: '', isDefault: false });
                      }
                    }}
                    className="flex-1 py-2.5 bg-[#D97757] text-white rounded-lg hover:bg-[#c26848] transition-all font-medium"
                  >
                    {editingSignature ? 'Update Signature' : 'Create Signature'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
