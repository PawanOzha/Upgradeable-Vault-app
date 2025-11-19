import { useNavigate } from 'react-router-dom'
import {
  Eye, EyeOff, Plus, Edit2, Trash2, X, Search, User,
  Lock, FolderPlus, Copy, ExternalLink, CheckCircle, AlertCircle,
  LogOut, Minus, StickyNote, Maximize2
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useEffect, useState, useRef } from 'react';



// ============================================================================
// TOAST COMPONENT
// ============================================================================
interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

const ToastContainer = ({ toasts, removeToast }: { toasts: Toast[]; removeToast: (id: string) => void }) => (
  <div className="fixed bottom-6 right-6 z-50 space-y-2 pointer-events-none">
    {toasts.map(toast => (
      <div
        key={toast.id}
        className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl backdrop-blur border animate-in slide-in-from-right duration-200 text-sm font-medium ${toast.type === 'success'
          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
          : toast.type === 'error'
            ? 'bg-red-500/10 border-red-500/20 text-red-400'
            : 'bg-[#D97757]/10 border-[#D97757]/20 text-[#D97757]'
          }`}
      >
        {toast.type === 'success' && <CheckCircle className="w-4 h-4 flex-shrink-0" />}
        {toast.type === 'error' && <AlertCircle className="w-4 h-4 flex-shrink-0" />}
        {toast.type === 'info' && <Search className="w-4 h-4 flex-shrink-0" />}
        <span>{toast.message}</span>
      </div>
    ))}
  </div>
);

// ============================================================================
// DELETE CONFIRMATION MODAL
// ============================================================================
const DeleteConfirmModal = ({
  isOpen,
  title,
  onConfirm,
  onCancel
}: {
  isOpen: boolean;
  title: string;
  onConfirm: () => void;
  onCancel: () => void;
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#30302E] rounded-2xl w-full max-w-sm shadow-2xl border border-[#3a3a38] animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-[#3a3a38]">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-red-500/10 rounded-lg mt-0.5">
              <AlertCircle className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">Confirm Delete</h3>
              <p className="text-sm text-gray-400 mt-1">
                Delete <span className="font-medium text-white">{title}</span>? This cannot be undone.
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 border border-[#3a3a38] rounded-xl hover:bg-[#262624] transition-colors font-medium text-gray-300"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors font-medium"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// CATEGORY PRESETS
// ============================================================================
const CATEGORY_PRESETS = [
  { id: 'vault', label: 'Password Vault', color: '#D97757' },
  { id: 'social', label: 'Social Media', color: '#2563eb' },
  { id: 'website', label: 'Website', color: '#7c3aed' },
  { id: 'work', label: 'Work', color: '#0891b2' },
  { id: 'notes', label: 'Notes', color: '#db2777' },
];

// NOTE COLORS
const NOTE_COLORS = [
  { id: 'yellow', color: '#fbbf24', name: 'Yellow' },
  { id: 'green', color: '#10b981', name: 'Green' },
  { id: 'blue', color: '#3b82f6', name: 'Blue' },
  { id: 'purple', color: '#a855f7', name: 'Purple' },
  { id: 'pink', color: '#ec4899', name: 'Pink' },
  { id: 'orange', color: '#D97757', name: 'Orange' },
];

// ============================================================================
// TYPES
// ============================================================================
interface Category {
  id: number;
  name: string;
  color: string;
  icon?: string;
}

interface Credential {
  id: number;
  title: string;
  site_link: string;
  username: string;
  password: string;
  description: string;
  category_id: number | null;
  category_name: string | null;
  category_color: string | null;
  created_at: string;
}

interface Note {
  id: number;
  title: string;
  content: string;
  color: string;
  is_pinned: boolean;
  is_floating: boolean;
  position_x: number | null;
  position_y: number | null;
  width: number | null;
  height: number | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function DashboardPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<{ username: string; salt: string } | null>(null);
  const [masterPassword, setMasterPassword] = useState<string>('');
  const [showMasterPasswordPrompt, setShowMasterPasswordPrompt] = useState(false);
  const [appId, setAppId] = useState<string>('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [filteredCredentials, setFilteredCredentials] = useState<Credential[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | null | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const [showPassword, setShowPassword] = useState<{ [key: number]: boolean }>({});
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [showBrowserPicker, setShowBrowserPicker] = useState<number | null>(null);

  // Notes state
  const [notes, setNotes] = useState<Note[]>([]);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [noteForm, setNoteForm] = useState({
    title: '',
    content: '',
    color: '#fbbf24'
  });
  const [showAllNotes, setShowAllNotes] = useState(false);

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([]);
  
  // Custom dropdown states
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);

  // Context menu for categories
  const [categoryContextMenu, setCategoryContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    category: Category | null;
  }>({
    visible: false,
    x: 0,
    y: 0,
    category: null
  });

  // Modals
  const [showCredentialModal, setShowCredentialModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'credential' | 'category' | 'note'; id: number; title: string } | null>(null);
  const [editingCredential, setEditingCredential] = useState<Credential | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);

  // Form states
  const [credentialForm, setCredentialForm] = useState({
    title: '',
    siteLink: '',
    username: '',
    password: '',
    description: '',
    categoryId: null as number | null
  });

  const [showModalPassword, setShowModalPassword] = useState(false);

  const [categoryForm, setCategoryForm] = useState({
    name: '',
    preset: 'vault'
  });

  const dataLoadedRef = useRef(false);

  // ========== TOAST HELPER ==========
  const addToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => removeToast(id), 3500);
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

    // ========== ELECTRON API ==========
    const getElectronAPI = () => {
      if (typeof window !== 'undefined' && window.electronAPI) {
        return window.electronAPI;
      }
      return null;
    };

  // ========== GLOBAL SEARCH KEYBOARD SHORTCUT ==========
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // "/" activates search
      if (e.key === '/' && !searchActive) {
        e.preventDefault();
        setSearchActive(true);
      }
      // "Escape" closes search
      if (e.key === 'Escape' && searchActive) {
        setSearchActive(false);
        setSearchTerm('');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchActive]);

  // ========== AUTH CHECK ==========
  useEffect(() => {
    checkAuth();
    
    // Fetch permanent app ID for browser extension
    if (window.electronAPI && window.electronAPI.getAppId) {
      window.electronAPI.getAppId().then((result: any) => {
        if (result.success) {
          setAppId(result.appId);
        }
      });
    }
  }, []);

  // ========== LOAD DATA WHEN UNLOCKED ==========
  useEffect(() => {
    if (user && masterPassword && !dataLoadedRef.current) {
      dataLoadedRef.current = true;
      loadData();
    }
  }, [user]);

  // ========== DEBUG LOGGER ==========
  useEffect(() => {
    console.log('Current state:', {
      user: user?.username,
      hasMasterPassword: !!masterPassword,
      categoriesCount: categories.length,
      credentialsCount: credentials.length,
      notesCount: notes.length
    });
  }, [user, masterPassword, categories, credentials, notes]);

  // ========== FILTER CREDENTIALS ==========
  useEffect(() => {
    filterCredentials();
  }, [selectedCategory, searchTerm, credentials]);
  
  // ========== CLOSE DROPDOWN ON OUTSIDE CLICK ==========
  useEffect(() => {
    const handleClickOutside = () => {
      setShowCategoryDropdown(false);
    };

    if (showCategoryDropdown) {
      document.addEventListener('click', handleClickOutside);
    }

    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [showCategoryDropdown]);

  // ========== CLOSE CONTEXT MENU ON CLICK OUTSIDE ==========
  useEffect(() => {
    const handleClickOutside = () => {
      handleCloseCategoryContextMenu();
    };

    if (categoryContextMenu.visible) {
      document.addEventListener('click', handleClickOutside);
    }

    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [categoryContextMenu.visible]);

  // ========== CLOSE BROWSER PICKER ON OUTSIDE CLICK ==========
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Check if click is outside browser picker
      if (!target.closest('.browser-picker-container')) {
        setShowBrowserPicker(null);
      }
    };

    if (showBrowserPicker !== null) {
      document.addEventListener('click', handleClickOutside);
    }

    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [showBrowserPicker]);

  // ========== API CALLS ==========
  const checkAuth = async () => {
    try {
      const authRes = await apiClient.verify();

      if (!authRes.success) {
        navigate('/');
        return;
      }

      console.log('Auth data received:', authRes);

      setUser(authRes.user!);

      const sessionMP = sessionStorage.getItem('mp');
      console.log('Master password in session:', !!sessionMP);

      if (sessionMP) {
        setMasterPassword(sessionMP);
      } else {
        console.log('No master password found, showing prompt');
        setShowMasterPasswordPrompt(true);
      }

      setLoading(false);
    } catch (error) {
      console.error('Auth error:', error);
      navigate('/');
    }
  };

  const loadData = async () => {
    if (!masterPassword) {
      console.error('loadData called without master password');
      return;
    }

    try {
      setError(null);
      setLoading(true);

      console.log('Loading categories, credentials, and notes...');
      sessionStorage.setItem('mp', masterPassword);

      // Use apiClient instead of fetch
      const [catData, credData, notesData] = await Promise.all([
        apiClient.fetchCategories(),
        apiClient.fetchCredentials(),
        apiClient.fetchNotes()
      ]);

      console.log('Categories loaded:', catData.categories?.length || 0);
      console.log('Credentials loaded:', credData.credentials?.length || 0);
      console.log('Notes loaded:', notesData.notes?.length || 0);

      setCategories(catData.categories || []);
      setCredentials(credData.credentials || []);
      setNotes(notesData.notes || []);

      setShowMasterPasswordPrompt(false);
      addToast('Vault unlocked', 'success');
    } catch (error: any) {
      console.error('Load data error:', error);
      setError(error.message);
      addToast('Invalid master password', 'error');
      setShowMasterPasswordPrompt(true);
      setMasterPassword('');
      sessionStorage.removeItem('mp');
      dataLoadedRef.current = false;
    } finally {
      setLoading(false);
    }
  };

  const filterCredentials = () => {
    let filtered = credentials;

    if (selectedCategory !== 'all') {
      filtered = credentials.filter(c => c.category_id === selectedCategory);
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(c =>
        c.title.toLowerCase().includes(term) ||
        c.description?.toLowerCase().includes(term) ||
        c.category_name?.toLowerCase().includes(term) ||
        c.site_link?.toLowerCase().includes(term)
      );
    }

    setFilteredCredentials(filtered);
  };

  const handleLogout = async () => {
    try {
      await apiClient.logout();
      sessionStorage.removeItem('mp');
      setMasterPassword('');
      navigate('/');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };



  const handleMinimize = () => {
    getElectronAPI()?.minimize();
  };

  const handleClose = () => {
    getElectronAPI()?.close();
  };

  // ========== CREDENTIAL HANDLERS ==========
  const handleCreateCredential = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!masterPassword) {
      addToast('Please unlock your vault first', 'error');
      return;
    }

    if (!credentialForm.title || !credentialForm.password) {
      addToast('Title and password are required', 'error');
      return;
    }

    try {
      await apiClient.createCredential({
        categoryId: credentialForm.categoryId,
        title: credentialForm.title,
        siteLink: credentialForm.siteLink,
        username: credentialForm.username,
        password: credentialForm.password,
        description: credentialForm.description,
      });

      setShowCredentialModal(false);
      resetCredentialForm();
      
      const credData = await apiClient.fetchCredentials();
      setCredentials(credData.credentials || []);
      
      addToast('Credential created', 'success');
    } catch (error: any) {
      addToast(error.message || 'Failed to create', 'error');
    }
  };

  const handleUpdateCredential = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCredential) return;

    if (!masterPassword) {
      addToast('Please unlock your vault first', 'error');
      return;
    }

    try {
      await apiClient.updateCredential(editingCredential.id, {
        categoryId: credentialForm.categoryId,
        title: credentialForm.title,
        siteLink: credentialForm.siteLink,
        username: credentialForm.username,
        password: credentialForm.password,
        description: credentialForm.description,
      });

      setShowCredentialModal(false);
      setEditingCredential(null);
      resetCredentialForm();
      
      const credData = await apiClient.fetchCredentials();
      setCredentials(credData.credentials || []);
      
      addToast('Credential updated', 'success');
    } catch (error: any) {
      addToast(error.message || 'Failed to update', 'error');
    }
  };

  const handleDeleteCredential = async () => {
    if (!deleteTarget || deleteTarget.type !== 'credential') return;

    try {
      await apiClient.deleteCredential(deleteTarget.id);
      
      const credData = await apiClient.fetchCredentials();
      setCredentials(credData.credentials || []);
      
      addToast('Credential deleted', 'success');
    } catch (error: any) {
      addToast(error.message || 'Failed to delete', 'error');
    } finally {
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
    }
  };

  // ========== CATEGORY HANDLERS ==========
  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!categoryForm.name) {
      addToast('Category name is required', 'error');
      return;
    }

    try {
      const preset = CATEGORY_PRESETS.find(p => p.id === categoryForm.preset);
      const response = await apiClient.createCategory({
        name: categoryForm.name,
        color: preset?.color || '#D97757'
      });

      setShowCategoryModal(false);
      setCategoryForm({ name: '', preset: 'vault' });

      // Refresh categories list
      const catData = await apiClient.fetchCategories();
      setCategories(catData.categories || []);

      // Auto-select the newly created category
      if (response.id) {
        setSelectedCategory(response.id as number);
      }

      addToast('Category created', 'success');
    } catch (error: any) {
      addToast(error.message || 'Failed to create category', 'error');
    }
  };

  const handleUpdateCategory = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!editingCategory || !categoryForm.name) {
      addToast('Category name is required', 'error');
      return;
    }

    try {
      const preset = CATEGORY_PRESETS.find(p => p.id === categoryForm.preset);
      await apiClient.updateCategory({
        id: editingCategory.id,
        name: categoryForm.name,
        color: preset?.color || editingCategory.color
      });

      setShowCategoryModal(false);
      setEditingCategory(null);
      setCategoryForm({ name: '', preset: 'vault' });

      // Refresh categories list
      const catData = await apiClient.fetchCategories();
      setCategories(catData.categories || []);

      addToast('Category updated', 'success');
    } catch (error: any) {
      addToast(error.message || 'Failed to update category', 'error');
    }
  };

  const handleDeleteCategory = async () => {
    if (!deleteTarget || deleteTarget.type !== 'category') return;

    try {
      await apiClient.deleteCategory(deleteTarget.id);
      
      // Refresh categories list
      const catData = await apiClient.fetchCategories();
      setCategories(catData.categories || []);

      // If the deleted category was selected, switch to "All"
      if (selectedCategory === deleteTarget.id) {
        setSelectedCategory('all');
      }

      // Refresh credentials to update the display
      const credData = await apiClient.fetchCredentials();
      setCredentials(credData.credentials || []);
      
      addToast('Category deleted', 'success');
    } catch (error: any) {
      addToast(error.message || 'Failed to delete category', 'error');
    } finally {
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
    }
  };

  const handleCategoryContextMenu = (e: React.MouseEvent, category: Category) => {
    e.preventDefault();
    e.stopPropagation();
    
    setCategoryContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      category
    });
  };

  const handleCloseCategoryContextMenu = () => {
    setCategoryContextMenu({
      visible: false,
      x: 0,
      y: 0,
      category: null
    });
  };

  const handleEditCategoryFromContext = () => {
    if (!categoryContextMenu.category) return;
    
    setEditingCategory(categoryContextMenu.category);
    setCategoryForm({
      name: categoryContextMenu.category.name,
      preset: 'vault' // Default, user can change
    });
    setShowCategoryModal(true);
    handleCloseCategoryContextMenu();
  };

  const handleDeleteCategoryFromContext = () => {
    if (!categoryContextMenu.category) return;
    
    setDeleteTarget({
      type: 'category',
      id: categoryContextMenu.category.id,
      title: categoryContextMenu.category.name
    });
    setShowDeleteConfirm(true);
    handleCloseCategoryContextMenu();
  };

  // ========== NOTE HANDLERS ==========
  const handleCreateNote = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!noteForm.title) {
      addToast('Note title is required', 'error');
      return;
    }

    try {
      await apiClient.createNote({
        title: noteForm.title,
        content: noteForm.content,
        color: noteForm.color
      });

      setShowNoteModal(false);
      resetNoteForm();
      
      const notesData = await apiClient.fetchNotes();
      setNotes(notesData.notes || []);
      
      addToast('Note created', 'success');
    } catch (error: any) {
      addToast(error.message || 'Failed to create note', 'error');
    }
  };

  const handleUpdateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingNote) return;

    try {
      await apiClient.updateNote(editingNote.id, {
        title: noteForm.title,
        content: noteForm.content,
        color: noteForm.color
      });

      setShowNoteModal(false);
      setEditingNote(null);
      resetNoteForm();
      
      const notesData = await apiClient.fetchNotes();
      setNotes(notesData.notes || []);
      
      addToast('Note updated', 'success');
    } catch (error: any) {
      addToast(error.message || 'Failed to update note', 'error');
    }
  };
  
  const handleDeleteNote = async () => {
    if (!deleteTarget || deleteTarget.type !== 'note') return;

    try {
      await apiClient.deleteNote(deleteTarget.id);
      
      const notesData = await apiClient.fetchNotes();
      setNotes(notesData.notes || []);
      
      addToast('Note deleted', 'success');
    } catch (error: any) {
      addToast(error.message || 'Failed to delete note', 'error');
    } finally {
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
    }
  };

  const handlePopOutNote = (note: Note) => {
    const electronAPI = getElectronAPI();
    if (electronAPI && electronAPI.openStickyNote) {
      electronAPI.openStickyNote(note.id.toString(), {
        x: note.position_x || undefined,
        y: note.position_y || undefined,
        width: note.width || undefined,
        height: note.height || undefined,
        alwaysOnTop: true
      });
      addToast('Note popped out', 'success');
    } else {
      addToast('Pop-out only works in desktop app', 'error');
    }
  };

  // ========== FORM HELPERS ==========
  const openEditModal = (credential: Credential) => {
    setEditingCredential(credential);
    setCredentialForm({
      title: credential.title,
      siteLink: credential.site_link,
      username: credential.username,
      password: credential.password,
      description: credential.description,
      categoryId: credential.category_id
    });
    setShowCredentialModal(true);
  };

  const openEditNoteModal = (note: Note) => {
    setEditingNote(note);
    setNoteForm({
      title: note.title,
      content: note.content,
      color: note.color
    });
    setShowNoteModal(true);
  };

  const resetCredentialForm = (preselectedCategory?: number | null) => {
    setCredentialForm({
      title: '',
      siteLink: '',
      username: '',
      password: '',
      description: '',
      categoryId: preselectedCategory ?? null
    });
    setEditingCredential(null);
  };

  const resetNoteForm = () => {
    setNoteForm({
      title: '',
      content: '',
      color: '#fbbf24'
    });
    setEditingNote(null);
  };

  const togglePasswordVisibility = (id: number) => {
    setShowPassword(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const copyToClipboard = (text: string, id: number) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    addToast('Copied', 'success');
    setTimeout(() => setCopiedId(null), 1500);
  };

  const openInBrowser = (url: string, browser: 'chrome' | 'brave' | 'edge', credentialId?: number) => {
    const electronAPI = getElectronAPI();
    if (electronAPI && electronAPI.openInBrowser) {
      electronAPI.openInBrowser(url, browser, credentialId);
      addToast(`Opening in ${browser.charAt(0).toUpperCase() + browser.slice(1)}`, 'success');
      setShowBrowserPicker(null);
    } else {
      addToast('Browser launch only works in desktop app', 'error');
    }
  };

  // ========== GET MOST RECENT NOTE ==========
  const getMostRecentNote = () => {
    if (notes.length === 0) return null;
    // Sort by updated_at descending and get the first one
    return [...notes].sort((a, b) => 
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    )[0];
  };

  // ========== LOADING STATE ==========
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#262624]">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 mb-4 bg-[#30302E] rounded-xl">
            <Lock className="w-6 h-6 text-[#D97757] animate-pulse" />
          </div>
          <div className="text-sm font-medium text-gray-400">Loading vault...</div>
        </div>
      </div>
    );
  }


  const mostRecentNote = getMostRecentNote();

  // ========== RENDER ==========
  return (
      <div className="min-h-screen bg-[#262624]">
        {/* Custom Scrollbar Styles */}
        <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #262624;
          border-radius: 4px;
        }
        
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #3a3a38;
          border-radius: 4px;
          transition: background 0.2s;
        }
        
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #D97757;
        }
        
        /* Firefox */
        .custom-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: #3a3a38 #262624;
        }
        
        /* Hidden Scrollbar (for All Sticky Notes cards only) */
        .scrollbar-hidden::-webkit-scrollbar {
          display: none;
        }
        
        .scrollbar-hidden {
          -ms-overflow-style: none;  /* IE and Edge */
          scrollbar-width: none;  /* Firefox */
        }

        /* Note Modal Textarea Scrollbar */
        .note-modal-textarea::-webkit-scrollbar {
          width: 8px;
        }
        
        .note-modal-textarea::-webkit-scrollbar-track {
          background: transparent;
          border-radius: 4px;
          margin: 4px 0;
        }
        
        .note-modal-textarea::-webkit-scrollbar-thumb {
          background: #4a4a48;
          border-radius: 4px;
          border: 2px solid #262624;
          background-clip: padding-box;
        }
        
        .note-modal-textarea::-webkit-scrollbar-thumb:hover {
          background: #D97757;
          border: 2px solid #262624;
          background-clip: padding-box;
        }
      `}</style>

      {/* ===== HEADER / TITLE BAR ===== */}
      <header className="fixed top-0 drag left-0 right-0 h-14 bg-[#30302E] border-b border-[#3a3a38] z-40">
        <div className="flex items-center justify-between h-full px-4">
          <div className="flex items-center gap-3 min-w-fit">
            <div className="flex items-center justify-center w-8 h-8 bg-[#D97757] rounded-lg">
              <Lock className="w-4 h-4 text-white" />
            </div>
            <div className="text-sm font-bold text-white">EsPass</div>
          </div>

          <div className="flex-1 no-drag max-w-xl mx-8">
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onFocus={() => setSearchActive(true)}
                placeholder="Search credentials..."
                className="w-full pl-10 pr-3 py-2 bg-[#262624] border border-[#3a3a38] rounded-lg focus:ring-1 focus:ring-[#D97757] focus:border-[#D97757] outline-none text-sm text-gray-300 placeholder-gray-600 transition-all"
              />
              {searchActive && searchTerm && (
                <button
                  onClick={() => {
                    setSearchTerm('');
                    setSearchActive(false);
                  }}
                  className="absolute no-drag right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-300"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          <div className="flex no-drag items-center gap-4">
            {/* Permanent App ID Display */}
            {appId && (
              <>
                <div className="px-3 py-1 bg-[#D97757]/10 border border-[#D97757]/30 rounded-lg group relative my-2">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mb-0.5">
                    App ID (256-bit)
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-bold text-[#D97757] font-mono">
                      {appId.substring(0, 5)}...
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(appId);
                        setCopiedId('appId');
                        setTimeout(() => setCopiedId(null), 2000);
                      }}
                      className="p-1 hover:bg-[#D97757]/20 rounded transition-colors"
                      title="Copy full App ID"
                    >
                      {copiedId === 'appId' ? (
                        <CheckCircle className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Copy className="w-4 h-4 text-[#D97757]" />
                      )}
                    </button>
                  </div>
                  <div className="absolute hidden group-hover:block bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-[#262624] border border-[#3a3a38] rounded-lg text-xs text-gray-300 whitespace-nowrap shadow-xl z-10">
                    <div className="font-semibold mb-1">Click to copy full App ID</div>
                    <div className="text-gray-400">Use this to pair your browser extension</div>
                    <div className="text-gray-500 mt-1">64 characters · Ultra secure</div>
                  </div>
                </div>
                {copiedId === 'appId' && (
                  <div className="fixed top-20 right-4 bg-emerald-500 text-white px-4 py-2 rounded-lg shadow-lg z-50 animate-in slide-in-from-right">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4" />
                      <span className="text-sm font-medium">App ID copied!</span>
                    </div>
                  </div>
                )}
                <div className="h-8 w-px bg-[#3a3a38]"></div>
              </>
            )}

            <div className="text-right">
              <div className="text-sm font-medium text-white">Welcome, {user?.username}</div>
              <div className="text-xs text-emerald-400 font-medium">● Vault Unlocked</div>
            </div>

            <div className="h-8 w-px bg-[#3a3a38]"></div>

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
      <div className="flex pt-14 h-screen">
        {/* Sidebar - Fixed, no scroll */}
        <aside className="w-64 border-r border-[#3a3a38] h-[calc(100vh-3.5rem)] flex flex-col bg-[#30302E]">
          <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
            {/* User Info */}
            <div className="p-3 bg-[#262624] rounded-xl border border-[#3a3a38]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-[#D97757] rounded-lg flex items-center justify-center">
                  <User className="w-4 h-4 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white truncate">{user?.username}</div>
                  <div className="text-xs text-emerald-400 font-medium">● Unlocked</div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <button
              onClick={() => {
                // Preselect the current category if one is selected (not 'all')
                const categoryToPreselect = selectedCategory === 'all' || selectedCategory === null ? null : selectedCategory;
                resetCredentialForm(categoryToPreselect);
                setShowCredentialModal(true);
              }}
              className="w-full bg-[#D97757] text-white py-2.5 px-4 rounded-xl hover:bg-[#c26848] transition-colors flex items-center justify-center gap-2 font-medium text-sm"
            >
              <Plus className="w-4 h-4" />
              New Password
            </button>

            <button
              onClick={() => setShowCategoryModal(true)}
              className="w-full bg-[#262624] text-gray-300 py-2.5 px-4 rounded-xl hover:bg-[#1f1f1d] border border-[#3a3a38] transition-colors flex items-center justify-center gap-2 font-medium text-sm"
            >
              <FolderPlus className="w-4 h-4" />
              New Category
            </button>

            {/* Categories */}
            <div className="pt-3 border-t border-[#3a3a38]">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 px-1">Categories</h3>

              <button
                onClick={() => setSelectedCategory('all')}
                className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors text-sm font-medium mb-2 ${selectedCategory === 'all'
                  ? 'bg-[#D97757] text-white'
                  : 'text-gray-400 hover:bg-[#262624]'
                  }`}
              >
                <div className="flex items-center justify-between">
                  <span>All Passwords</span>
                  <span className="text-xs bg-[#262624] px-2 py-0.5 rounded-lg font-semibold">{credentials.length}</span>
                </div>
              </button>

              <button
                onClick={() => setSelectedCategory(null)}
                className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors text-sm font-medium mb-3 ${selectedCategory === null
                  ? 'bg-[#D97757] text-white'
                  : 'text-gray-400 hover:bg-[#262624]'
                  }`}
              >
                <div className="flex items-center justify-between">
                  <span>Uncategorized</span>
                  <span className="text-xs bg-[#262624] px-2 py-0.5 rounded-lg font-semibold">
                    {credentials.filter(c => !c.category_id).length}
                  </span>
                </div>
              </button>

              <div className="space-y-1">
                {categories.map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(cat.id)}
                    onContextMenu={(e) => handleCategoryContextMenu(e, cat)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors text-sm font-medium ${selectedCategory === cat.id
                      ? 'bg-[#D97757] text-white'
                      : 'text-gray-400 hover:bg-[#262624]'
                      }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: cat.color }}
                        />
                        <span>{cat.name}</span>
                      </div>
                      <span className="text-xs bg-[#262624] px-2 py-0.5 rounded-lg font-semibold">
                        {credentials.filter(c => c.category_id === cat.id).length}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* ===== NOTES SECTION (UPDATED) ===== */}
            <div className="pt-3 border-t border-[#3a3a38]">
              <div className="flex items-center justify-between mb-3 px-1">
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Sticky Notes</h3>
                <button
                  onClick={() => {
                    resetNoteForm();
                    setShowNoteModal(true);
                  }}
                  className="p-1 hover:bg-[#262624] rounded-lg transition-colors text-gray-500 hover:text-[#D97757]"
                  title="New Note"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2">
                {notes.length === 0 ? (
                  <div className="text-center py-4 px-3">
                    <StickyNote className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                    <p className="text-xs text-gray-500">No notes yet</p>
                    <button
                      onClick={() => {
                        resetNoteForm();
                        setShowNoteModal(true);
                      }}
                      className="text-xs text-[#D97757] hover:text-[#c26848] mt-2"
                    >
                      Create your first note
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Show only the most recent note */}
                    {mostRecentNote && (
                      <div className="group p-2.5 bg-[#262624] border border-[#3a3a38] rounded-xl hover:border-[#D97757]/30 transition-all">
                        <div className="flex items-start gap-2">
                          <div
                            className="w-2 h-2 rounded-full mt-1 flex-shrink-0"
                            style={{ backgroundColor: mostRecentNote.color }}
                          />
                          <div className="flex-1 min-w-0">
                            <h4 className="text-xs font-medium text-white truncate">{mostRecentNote.title}</h4>
                            <p className="text-[10px] text-gray-500 line-clamp-1 mt-0.5">
                              {mostRecentNote.content || 'Empty note'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => handlePopOutNote(mostRecentNote)}
                            className="flex-1 px-1.5 py-1 text-[10px] bg-[#30302E] hover:bg-[#3a3a38] text-gray-400 hover:text-white rounded-lg transition-colors flex items-center justify-center gap-1"
                            title="Pop Out"
                          >
                            <Maximize2 className="w-2.5 h-2.5" />
                            <span>Pop Out</span>
                          </button>
                          <button
                            onClick={() => openEditNoteModal(mostRecentNote)}
                            className="p-1 text-gray-500 hover:text-[#D97757] hover:bg-[#30302E] rounded-lg transition-colors"
                            title="Edit"
                          >
                            <Edit2 className="w-2.5 h-2.5" />
                          </button>
                          <button
                            onClick={() => {
                              setDeleteTarget({ type: 'note', id: mostRecentNote.id, title: mostRecentNote.title });
                              setShowDeleteConfirm(true);
                            }}
                            className="p-1 text-gray-500 hover:text-red-400 hover:bg-[#30302E] rounded-lg transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      </div>
                    )}
                    
                    {/* View All button */}
                    {notes.length > 0 && (
                      <button
                        onClick={() => setShowAllNotes(true)}
                        className="w-full px-3 py-2 text-xs font-medium text-[#D97757] hover:text-[#c26848] bg-[#262624] hover:bg-[#1f1f1d] border border-[#3a3a38] rounded-xl transition-colors flex items-center justify-center gap-1"
                      >
                        <StickyNote className="w-3 h-3" />
                        <span>View All {notes.length} Notes</span>
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Fixed Logout at Bottom (SINGLE BUTTON) */}
          <div className="p-4 border-t border-[#3a3a38] bg-[#30302E]">
            <button
              onClick={handleLogout}
              className="w-full bg-[#262624] text-gray-300 py-2.5 px-4 rounded-xl hover:bg-[#1f1f1d] border border-[#3a3a38] transition-colors flex items-center justify-center gap-2 font-medium text-sm"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        </aside>

        {/* Main Content - Scrollable with custom scrollbar */}
        <main className="flex-1 h-[calc(100vh-3.5rem)] overflow-y-auto custom-scrollbar">
          <div className="p-6">
            <div className="max-w-6xl">
              {/* Page Header */}
              <div className="mb-6">
                <h1 className="text-2xl font-bold text-white mb-1">
                  {showAllNotes ? 'All Sticky Notes' :
                    selectedCategory === 'all' ? 'All Passwords' :
                      selectedCategory === null ? 'Uncategorized' :
                        categories.find(c => c.id === selectedCategory)?.name || 'Passwords'}
                </h1>
                <p className="text-sm text-gray-500">
                  {showAllNotes ? `${notes.length} notes` : `${filteredCredentials.length} credentials`}
                </p>
              </div>

              {/* Notes Grid View */}
              {showAllNotes ? (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <button
                      onClick={() => setShowAllNotes(false)}
                      className="text-sm text-[#D97757] hover:text-[#c26848] flex items-center gap-2"
                    >
                      ← Back to Passwords
                    </button>
                    <button
                      onClick={() => {
                        resetNoteForm();
                        setShowNoteModal(true);
                      }}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-[#D97757] text-white rounded-xl hover:bg-[#c26848] transition-colors font-medium text-sm"
                    >
                      <Plus className="w-4 h-4" />
                      New Note
                    </button>
                  </div>

                  {notes.length === 0 ? (
                    <div className="text-center py-16 bg-[#30302E] rounded-2xl border border-[#3a3a38]">
                      <StickyNote className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                      <h3 className="text-lg font-semibold text-white mb-1">No notes yet</h3>
                      <p className="text-sm text-gray-500 mb-6">Create your first sticky note</p>
                      <button
                        onClick={() => {
                          resetNoteForm();
                          setShowNoteModal(true);
                        }}
                        className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#D97757] text-white rounded-xl hover:bg-[#c26848] transition-colors font-medium text-sm"
                      >
                        <Plus className="w-4 h-4" />
                        Create Note
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {notes.map(note => (
                        <div
                          key={note.id}
                          className="group bg-[#30302E] border border-[#3a3a38] rounded-2xl overflow-hidden hover:border-[#D97757]/30 transition-all duration-300 h-[280px] flex flex-col"
                          style={{ backgroundColor: `${note.color}20` }}
                        >
                          {/* Header - Fixed height */}
                          <div className="p-4 border-b border-[#3a3a38] flex-shrink-0">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <div
                                  className="w-3 h-3 rounded-full flex-shrink-0"
                                  style={{ backgroundColor: note.color }}
                                />
                                <h3 className="font-semibold text-white text-sm truncate">{note.title}</h3>
                              </div>
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => handlePopOutNote(note)}
                                  className="p-1.5 text-gray-500 hover:text-[#D97757] hover:bg-[#262624] rounded-lg transition-colors"
                                  title="Pop Out"
                                >
                                  <Maximize2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => openEditNoteModal(note)}
                                  className="p-1.5 text-gray-500 hover:text-[#D97757] hover:bg-[#262624] rounded-lg transition-colors"
                                  title="Edit"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => {
                                    setDeleteTarget({ type: 'note', id: note.id, title: note.title });
                                    setShowDeleteConfirm(true);
                                  }}
                                  className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-[#262624] rounded-lg transition-colors"
                                  title="Delete"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                          
                          {/* Content - Flexible, scrollable */}
                          <div className="p-4 flex-1 overflow-y-auto scrollbar-hidden">
                            <p className="text-sm text-gray-300 whitespace-pre-wrap">
                              {note.content || 'Empty note'}
                            </p>
                          </div>
                          
                          {/* Footer - Fixed at bottom */}
                          <div className="px-4 py-3 bg-[#262624] border-t border-[#3a3a38] flex-shrink-0">
                            <p className="text-xs text-gray-600">
                              Updated {new Date(note.updated_at).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric'
                              })}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {/* Credentials Grid */}
              {filteredCredentials.length === 0 ? (
                <div className="text-center py-16 bg-[#30302E] rounded-2xl border border-[#3a3a38]">
                  <Lock className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-white mb-1">No passwords found</h3>
                  <p className="text-sm text-gray-500 mb-6">Start by adding your first password</p>
                  <button
                    onClick={() => {
                      // Preselect the current category if one is selected (not 'all')
                      const categoryToPreselect = selectedCategory === 'all' || selectedCategory === null ? null : selectedCategory;
                      resetCredentialForm(categoryToPreselect);
                      setShowCredentialModal(true);
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#D97757] text-white rounded-xl hover:bg-[#c26848] transition-colors font-medium text-sm"
                  >
                    <Plus className="w-4 h-4" />
                    Add Password
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-2 gap-4">
                  {filteredCredentials.map(cred => (
                    <div
                      key={cred.id}
                      className="bg-[#30302E] border border-[#3a3a38] rounded-2xl overflow-hidden hover:border-[#D97757]/30 transition-all duration-300 group"
                    >
                      {/* Card Header */}
                      <div className="p-5 border-b border-[#3a3a38]">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="font-semibold text-white text-base truncate">{cred.title}</h3>
                              {cred.category_name && (
                                <span
                                  className="text-xs px-2 py-0.5 rounded-lg text-white font-medium flex-shrink-0"
                                  style={{ backgroundColor: cred.category_color || '#D97757' }}
                                >
                                  {cred.category_name}
                                </span>
                              )}
                            </div>
                            {cred.site_link && (
                              <div className="relative browser-picker-container">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShowBrowserPicker(showBrowserPicker === cred.id ? null : cred.id);
                                  }}
                                  className="text-xs text-[#D97757] hover:text-[#c26848] flex items-center gap-1 w-fit transition-colors"
                                >
                                  <span className="truncate">{cred.site_link}</span>
                                  <ExternalLink className="w-3 h-3 flex-shrink-0" />
                                </button>

                                {showBrowserPicker === cred.id && (
                                  <div className="absolute z-50 mt-2 left-0 bg-[#30302E] border border-[#3a3a38] rounded-xl shadow-2xl p-3 animate-in zoom-in-95 duration-200 min-w-[200px]">
                                    <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mb-3">Open in Browser</p>
                                    <div className="flex gap-2">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openInBrowser(cred.site_link, 'chrome', cred.id);
                                        }}
                                        className="group flex flex-col items-center gap-1.5 p-2.5 hover:bg-[#262624] rounded-lg transition-all"
                                        title="Google Chrome"
                                      >
                                        <div className="w-9 h-9 rounded-full bg-[#262624] border border-[#3a3a38] flex items-center justify-center group-hover:border-[#D97757]/50 transition-all group-hover:scale-110">
                                          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                                            <circle cx="12" cy="12" r="10" fill="url(#chrome-gradient)" />
                                            <circle cx="12" cy="12" r="4" fill="#fff" />
                                            <defs>
                                              <linearGradient id="chrome-gradient" x1="0" y1="0" x2="24" y2="24">
                                                <stop offset="0%" stopColor="#EA4335" />
                                                <stop offset="33%" stopColor="#FBBC04" />
                                                <stop offset="66%" stopColor="#34A853" />
                                                <stop offset="100%" stopColor="#4285F4" />
                                              </linearGradient>
                                            </defs>
                                          </svg>
                                        </div>
                                        <span className="text-[9px] text-gray-400 font-medium group-hover:text-gray-300">Chrome</span>
                                      </button>

                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openInBrowser(cred.site_link, 'brave', cred.id);
                                        }}
                                        className="group flex flex-col items-center gap-1.5 p-2.5 hover:bg-[#262624] rounded-lg transition-all"
                                        title="Brave Browser"
                                      >
                                        <div className="w-9 h-9 rounded-full bg-[#262624] border border-[#3a3a38] flex items-center justify-center group-hover:border-[#D97757]/50 transition-all group-hover:scale-110">
                                          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                                            <path d="M12 2L4 8L6 18L12 22L18 18L20 8L12 2Z" fill="url(#brave-gradient)" />
                                            <path d="M12 8L10 12L12 16L14 12L12 8Z" fill="#fff" />
                                            <defs>
                                              <linearGradient id="brave-gradient" x1="4" y1="2" x2="20" y2="22">
                                                <stop offset="0%" stopColor="#FB542B" />
                                                <stop offset="100%" stopColor="#F50" />
                                              </linearGradient>
                                            </defs>
                                          </svg>
                                        </div>
                                        <span className="text-[9px] text-gray-400 font-medium group-hover:text-gray-300">Brave</span>
                                      </button>

                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openInBrowser(cred.site_link, 'edge', cred.id);
                                        }}
                                        className="group flex flex-col items-center gap-1.5 p-2.5 hover:bg-[#262624] rounded-lg transition-all"
                                        title="Microsoft Edge"
                                      >
                                        <div className="w-9 h-9 rounded-full bg-[#262624] border border-[#3a3a38] flex items-center justify-center group-hover:border-[#D97757]/50 transition-all group-hover:scale-110">
                                          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                                            <path d="M4 12C4 7.58 7.58 4 12 4C14.5 4 16.7 5.2 18 7C16.5 5 14.3 4 12 4C7.6 4 4 7.6 4 12C4 16.4 7.6 20 12 20C16.4 20 20 16.4 20 12C20 10.5 19.5 9.1 18.7 8L20.5 9C20.8 9.9 21 10.9 21 12C21 16.9 16.9 21 12 21C7.1 21 3 16.9 3 12C3 7.1 7.1 3 12 3C15 3 17.6 4.5 19.2 6.8L17 8.5C15.8 6.7 14 5.5 12 5.5C8.4 5.5 5.5 8.4 5.5 12C5.5 15.6 8.4 18.5 12 18.5C15.6 18.5 18.5 15.6 18.5 12C18.5 11.2 18.3 10.4 18 9.7L19.5 8.2C20.2 9.3 20.5 10.6 20.5 12C20.5 16.1 17.1 19.5 13 19.5" fill="url(#edge-gradient)" />
                                            <defs>
                                              <linearGradient id="edge-gradient" x1="3" y1="3" x2="21" y2="21">
                                                <stop offset="0%" stopColor="#0078D4" />
                                                <stop offset="100%" stopColor="#00BCF2" />
                                              </linearGradient>
                                            </defs>
                                          </svg>
                                        </div>
                                        <span className="text-[9px] text-gray-400 font-medium group-hover:text-gray-300">Edge</span>
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex gap-1 ml-3 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => openEditModal(cred)}
                              className="p-2 text-gray-500 hover:text-[#D97757] hover:bg-[#262624] rounded-lg transition-colors"
                              title="Edit"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => {
                                setDeleteTarget({ type: 'credential', id: cred.id, title: cred.title });
                                setShowDeleteConfirm(true);
                              }}
                              className="p-2 text-gray-500 hover:text-red-400 hover:bg-[#262624] rounded-lg transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Card Content */}
                      <div className="p-5 space-y-3">
                        {cred.username && (
                          <div className="space-y-1">
                            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Username</label>
                            <div className="flex items-center justify-between p-2.5 bg-[#262624] rounded-lg group/field border border-[#3a3a38]">
                              <span className="text-sm text-gray-300 font-mono truncate flex-1">{cred.username}</span>
                              <button
                                onClick={() => copyToClipboard(cred.username, cred.id * 1000)}
                                className="p-1.5 text-gray-500 hover:text-[#D97757] hover:bg-[#30302E] rounded transition-colors opacity-0 group-hover/field:opacity-100"
                                title="Copy"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        )}

                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Password</label>
                          <div className="flex items-center justify-between p-2.5 bg-[#262624] rounded-lg group/field border border-[#3a3a38]">
                            <span className="text-sm text-gray-300 font-mono flex-1 truncate">
                              {showPassword[cred.id] ? cred.password : '••••••••••••'}
                            </span>
                            <div className="flex gap-1">
                              <button
                                onClick={() => copyToClipboard(cred.password, cred.id * 2000)}
                                className="p-1.5 text-gray-500 hover:text-[#D97757] hover:bg-[#30302E] rounded transition-colors opacity-0 group-hover/field:opacity-100"
                                title="Copy"
                              >
                                {copiedId === cred.id * 2000 ? (
                                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                              <button
                                onClick={() => togglePasswordVisibility(cred.id)}
                                className="p-1.5 text-gray-500 hover:text-[#D97757] hover:bg-[#30302E] rounded transition-colors"
                                title={showPassword[cred.id] ? "Hide" : "Show"}
                              >
                                {showPassword[cred.id] ?
                                  <EyeOff className="w-3.5 h-3.5" /> :
                                  <Eye className="w-3.5 h-3.5" />
                                }
                              </button>
                            </div>
                          </div>
                        </div>

                        {cred.description && (
                          <div className="space-y-1 pt-1">
                            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Notes</label>
                            <p className="text-sm text-gray-400 leading-relaxed bg-[#262624] p-2.5 rounded-lg border border-[#3a3a38]">{cred.description}</p>
                          </div>
                        )}
                      </div>

                      {/* Card Footer */}
                      <div className="px-5 py-3 bg-[#262624] border-t border-[#3a3a38]">
                        <p className="text-xs text-gray-600">
                          Created {new Date(cred.created_at).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
                </>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* ===== CREDENTIAL MODAL ===== */}
      {showCredentialModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#30302E] rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl border border-[#3a3a38] animate-in zoom-in-95 duration-200">
            <div className="sticky top-0 bg-[#30302E] border-b border-[#3a3a38] p-5 flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">
                {editingCredential ? 'Edit Password' : 'New Password'}
              </h3>
              <button
                onClick={() => {
                  setShowCredentialModal(false);
                  resetCredentialForm();
                }}
                className="p-2 hover:bg-[#262624] rounded-lg transition-colors text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={editingCredential ? handleUpdateCredential : handleCreateCredential} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">Title *</label>
                <input
                  type="text"
                  value={credentialForm.title}
                  onChange={(e) => setCredentialForm({ ...credentialForm, title: e.target.value })}
                  className="w-full px-4 py-2.5 bg-[#262624] border border-[#3a3a38] rounded-xl focus:ring-1 focus:ring-[#D97757] focus:border-[#D97757] outline-none transition-colors text-white placeholder-gray-600"
                  placeholder="Gmail Account"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">Category</label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowCategoryDropdown(!showCategoryDropdown);
                    }}
                    className="w-full px-4 py-2.5 bg-[#262624] border border-[#3a3a38] rounded-xl focus:ring-1 focus:ring-[#D97757] focus:border-[#D97757] outline-none transition-colors text-white text-left flex items-center justify-between"
                  >
                    <span className="flex items-center gap-2">
                      {credentialForm.categoryId ? (
                        <>
                          <span 
                            className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{ backgroundColor: categories.find(c => c.id === credentialForm.categoryId)?.color }}
                          />
                          <span>{categories.find(c => c.id === credentialForm.categoryId)?.name}</span>
                        </>
                      ) : (
                        <span className="text-gray-500">None</span>
                      )}
                    </span>
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  {showCategoryDropdown && (
                    <div className="absolute z-10 w-full mt-2 bg-[#30302E] border border-[#3a3a38] rounded-xl shadow-2xl overflow-hidden max-h-60 overflow-y-auto custom-scrollbar">
                      <button
                        type="button"
                        onClick={() => {
                          setCredentialForm({ ...credentialForm, categoryId: null });
                          setShowCategoryDropdown(false);
                        }}
                        className="w-full px-4 py-2.5 text-left hover:bg-[#262624] transition-colors text-gray-400 border-b border-[#3a3a38]"
                      >
                        None
                      </button>
                      {categories.map(cat => (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => {
                            setCredentialForm({ ...credentialForm, categoryId: cat.id });
                            setShowCategoryDropdown(false);
                          }}
                          className={`w-full px-4 py-2.5 text-left hover:bg-[#262624] transition-colors flex items-center gap-2 ${
                            credentialForm.categoryId === cat.id ? 'bg-[#262624]' : ''
                          }`}
                        >
                          <span 
                            className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{ backgroundColor: cat.color }}
                          />
                          <span className="text-white">{cat.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">Site Link</label>
                <input
                  type="url"
                  value={credentialForm.siteLink}
                  onChange={(e) => setCredentialForm({ ...credentialForm, siteLink: e.target.value })}
                  className="w-full px-4 py-2.5 bg-[#262624] border border-[#3a3a38] rounded-xl focus:ring-1 focus:ring-[#D97757] focus:border-[#D97757] outline-none transition-colors text-white placeholder-gray-600"
                  placeholder="https://gmail.com"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">Username</label>
                <input
                  type="text"
                  value={credentialForm.username}
                  onChange={(e) => setCredentialForm({ ...credentialForm, username: e.target.value })}
                  className="w-full px-4 py-2.5 bg-[#262624] border border-[#3a3a38] rounded-xl focus:ring-1 focus:ring-[#D97757] focus:border-[#D97757] outline-none transition-colors text-white placeholder-gray-600"
                  placeholder="user@example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">Password *</label>
                <div className="relative">
                  <input
                    type={showModalPassword ? "text" : "password"}
                    value={credentialForm.password}
                    onChange={(e) => setCredentialForm({ ...credentialForm, password: e.target.value })}
                    className="w-full px-4 py-2.5 pr-12 bg-[#262624] border border-[#3a3a38] rounded-xl focus:ring-1 focus:ring-[#D97757] focus:border-[#D97757] outline-none transition-colors text-white placeholder-gray-600 font-mono"
                    placeholder="••••••••••••"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowModalPassword(!showModalPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 hover:bg-[#3a3a38] rounded-lg transition-colors text-gray-400 hover:text-white"
                  >
                    {showModalPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">Notes</label>
                <textarea
                  value={credentialForm.description}
                  onChange={(e) => setCredentialForm({ ...credentialForm, description: e.target.value })}
                  className="w-full px-4 py-2.5 bg-[#262624] border border-[#3a3a38] rounded-xl focus:ring-1 focus:ring-[#D97757] focus:border-[#D97757] outline-none transition-colors resize-none text-white placeholder-gray-600"
                  rows={3}
                  placeholder="Add any notes..."
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowCredentialModal(false);
                    resetCredentialForm();
                  }}
                  className="flex-1 px-4 py-2.5 border border-[#3a3a38] rounded-xl hover:bg-[#262624] transition-colors font-medium text-gray-300 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 bg-[#D97757] text-white rounded-xl hover:bg-[#c26848] transition-colors font-medium text-sm"
                >
                  {editingCredential ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===== CATEGORY MODAL ===== */}
      {showCategoryModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#30302E] rounded-2xl w-full max-w-md shadow-2xl border border-[#3a3a38] animate-in zoom-in-95 duration-200">
            <div className="border-b border-[#3a3a38] p-5 flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">
                {editingCategory ? 'Update Category' : 'New Category'}
              </h3>
              <button
                onClick={() => {
                  setShowCategoryModal(false);
                  setEditingCategory(null);
                  setCategoryForm({ name: '', preset: 'vault' });
                }}
                className="p-2 hover:bg-[#262624] rounded-lg transition-colors text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={editingCategory ? handleUpdateCategory : handleCreateCategory} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-3">Select Type *</label>
                <div className="grid grid-cols-2 gap-3">
                  {CATEGORY_PRESETS.map(preset => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setCategoryForm({ ...categoryForm, preset: preset.id })}
                      className={`p-4 rounded-xl border-2 transition-colors text-center ${categoryForm.preset === preset.id
                        ? 'border-[#D97757] bg-[#D97757]/10'
                        : 'border-[#3a3a38] bg-[#262624] hover:border-[#4a4a48]'
                        }`}
                    >
                      <div
                        className="w-6 h-6 rounded-full mx-auto mb-2"
                        style={{ backgroundColor: preset.color }}
                      />
                      <span className="text-xs font-medium text-gray-300">{preset.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">Name *</label>
                <input
                  type="text"
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                  className="w-full px-4 py-2.5 bg-[#262624] border border-[#3a3a38] rounded-xl focus:ring-1 focus:ring-[#D97757] focus:border-[#D97757] outline-none transition-colors text-white placeholder-gray-600"
                  placeholder="My Category"
                  required
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowCategoryModal(false);
                    setEditingCategory(null);
                    setCategoryForm({ name: '', preset: 'vault' });
                  }}
                  className="flex-1 px-4 py-2.5 border border-[#3a3a38] rounded-xl hover:bg-[#262624] transition-colors font-medium text-gray-300 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 bg-[#D97757] text-white rounded-xl hover:bg-[#c26848] transition-colors font-medium text-sm"
                >
                  {editingCategory ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===== NOTE MODAL ===== */}
      {showNoteModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#30302E] rounded-2xl w-full max-w-lg shadow-2xl border border-[#3a3a38] animate-in zoom-in-95 duration-200">
            <div className="border-b border-[#3a3a38] p-5 flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">
                {editingNote ? 'Edit Note' : 'New Sticky Note'}
              </h3>
              <button
                onClick={() => {
                  setShowNoteModal(false);
                  resetNoteForm();
                }}
                className="p-2 hover:bg-[#262624] rounded-lg transition-colors text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={editingNote ? handleUpdateNote : handleCreateNote} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">Title *</label>
                <input
                  type="text"
                  value={noteForm.title}
                  onChange={(e) => setNoteForm({ ...noteForm, title: e.target.value })}
                  className="w-full px-4 py-2.5 bg-[#262624] border border-[#3a3a38] rounded-xl focus:ring-1 focus:ring-[#D97757] focus:border-[#D97757] outline-none transition-colors text-white placeholder-gray-600"
                  placeholder="My Note"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">Color</label>
                <div className="grid grid-cols-6 gap-2">
                  {NOTE_COLORS.map(colorOption => (
                    <button
                      key={colorOption.id}
                      type="button"
                      onClick={() => setNoteForm({ ...noteForm, color: colorOption.color })}
                      className={`w-10 h-10 rounded-lg transition-all ${noteForm.color === colorOption.color
                        ? 'ring-2 ring-white ring-offset-2 ring-offset-[#30302E] scale-110'
                        : 'hover:scale-105'
                        }`}
                      style={{ backgroundColor: colorOption.color }}
                      title={colorOption.name}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">Content</label>
                <textarea
                  value={noteForm.content}
                  onChange={(e) => setNoteForm({ ...noteForm, content: e.target.value })}
                  className="note-modal-textarea w-full px-4 py-2.5 bg-[#262624] border border-[#3a3a38] rounded-xl focus:ring-1 focus:ring-[#D97757] focus:border-[#D97757] outline-none transition-colors resize-none text-white placeholder-gray-600"
                  rows={5}
                  placeholder="Write your note here..."
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowNoteModal(false);
                    resetNoteForm();
                  }}
                  className="flex-1 px-4 py-2.5 border border-[#3a3a38] rounded-xl hover:bg-[#262624] transition-colors font-medium text-gray-300 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 bg-[#D97757] text-white rounded-xl hover:bg-[#c26848] transition-colors font-medium text-sm"
                >
                  {editingNote ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===== MASTER PASSWORD PROMPT ===== */}
      {showMasterPasswordPrompt && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <header className="h-14 drag absolute w-full top-0 bg-[#30302E] border-b border-[#3a3a38]">
            <div className="flex items-center justify-between h-full px-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-8 h-8 bg-[#D97757] rounded-lg">
                  <Lock className="w-4 h-4 text-white" />
                </div>
                <div className="text-sm font-bold text-white">EsPass</div>
              </div>

              {appId && (
                <div className="px-3 py-1 bg-[#D97757]/10 border border-[#D97757]/30 rounded-lg group relative my-2">
                  <div className="text-[9px] text-gray-500 uppercase tracking-wider font-semibold mb-0.5">
                    App ID
                  </div>
                  <div className="text-xs font-bold text-[#D97757] tracking-wider font-mono">
                    {appId}
                  </div>
                  <div className="absolute hidden group-hover:block bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-[#262624] border border-[#3a3a38] rounded-lg text-xs text-gray-300 whitespace-nowrap shadow-xl z-10">
                    <div className="font-semibold mb-1">Permanent App ID</div>
                    <div className="text-gray-400">Use this to pair your browser extension</div>
                  </div>
                </div>
              )}

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

          <div className="bg-[#30302E] rounded-2xl w-full max-w-sm shadow-2xl border border-[#3a3a38]">
            <div className="p-6 border-b border-[#3a3a38] text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-[#D97757]/10 rounded-xl mb-4">
                <Lock className="w-6 h-6 text-[#D97757]" />
              </div>
              <h3 className="text-lg font-bold text-white mb-1">Unlock Your Vault</h3>
              <p className="text-sm text-gray-400">Enter your password to decrypt your vault</p>
            </div>

            <form onSubmit={(e) => {
              e.preventDefault();
              if (!masterPassword) {
                addToast('Please enter your master password', 'error');
                return;
              }
              sessionStorage.setItem('mp', masterPassword);
              loadData();
            }} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">Password</label>
                <input
                  type="password"
                  value={masterPassword}
                  onChange={(e) => {
                    setMasterPassword(e.target.value);
                  }}
                  className="w-full px-4 py-2.5 bg-[#262624] border border-[#3a3a38] rounded-xl focus:ring-1 focus:ring-[#D97757] focus:border-[#D97757] outline-none transition-colors text-white placeholder-gray-600 font-mono"
                  placeholder="••••••••••••"
                  autoFocus
                  required
                />
              </div>

              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                  <p className="text-sm text-red-400 font-medium flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    {error}
                  </p>
                </div>
              )}

              <button
                type="submit"
                disabled={!masterPassword}
                className="w-full px-4 py-2.5 bg-[#D97757] text-white rounded-xl hover:bg-[#c26848] transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Unlock Vault
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ===== DELETE CONFIRMATION ===== */}
      <DeleteConfirmModal
        isOpen={showDeleteConfirm}
        title={deleteTarget?.title || ''}
        onConfirm={
          deleteTarget?.type === 'credential'
            ? handleDeleteCredential
            : deleteTarget?.type === 'note'
              ? handleDeleteNote
              : deleteTarget?.type === 'category'
                ? handleDeleteCategory
                : () => { }
        }
        onCancel={() => {
          setShowDeleteConfirm(false);
          setDeleteTarget(null);
        }}
      />

      {/* ===== CATEGORY CONTEXT MENU ===== */}
      {categoryContextMenu.visible && (
        <div
          className="fixed bg-[#262624] border border-[#3a3a38] rounded-xl shadow-2xl py-2 z-50 min-w-[180px]"
          style={{
            left: `${categoryContextMenu.x}px`,
            top: `${categoryContextMenu.y}px`,
          }}
        >
          <button
            onClick={handleEditCategoryFromContext}
            className="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-[#30302E] transition-colors flex items-center gap-2"
          >
            <Edit2 className="w-4 h-4" />
            Update Name
          </button>
          <div className="h-px bg-[#3a3a38] my-1"></div>
          <button
            onClick={handleDeleteCategoryFromContext}
            className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Remove
          </button>
        </div>
      )}

      {/* ===== TOAST ===== */}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
}