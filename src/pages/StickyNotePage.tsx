import { useParams } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import { X, Minimize, Pin } from 'lucide-react';
import { apiClient } from '../lib/api-client';

interface Note {
  id: number;
  title: string;
  content: string;
  color: string;
  is_pinned: boolean;
  position_x: number | null;
  position_y: number | null;
  width: number | null;
  height: number | null;
}

// Debounce function
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export default function StickyNotePage() {
  const params = useParams();
  const noteId = params.id as string;

  const [note, setNote] = useState<Note | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);

  // Debug logging
  useEffect(() => {
    console.log('=== StickyNotePage Mounted ===');
    console.log('noteId:', noteId);
    console.log('URL:', window.location.href);
    console.log('Hash:', window.location.hash);
    console.log('Pathname:', window.location.pathname);
  }, [noteId]);

  // Electron API
  const getElectronAPI = () => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI;
    }
    return null;
  };

  // Load note data
  useEffect(() => {
    if (noteId) {
      console.log('Loading note with ID:', noteId);
      loadNote();
    }
  }, [noteId]);

  // Auto-save content (debounced)
  const debouncedSave = useCallback(
    debounce(async (newContent: string) => {
      if (!noteId) return;

      setSaving(true);
      try {
        await apiClient.updateNote(parseInt(noteId), {
          content: newContent
        });
        setLastSaved(new Date());
      } catch (error) {
        console.error('Failed to save note:', error);
      } finally {
        setSaving(false);
      }
    }, 2000),
    [noteId]
  );

  // Save on content change
  useEffect(() => {
    if (note && content !== note.content) {
      debouncedSave(content);
    }
  }, [content, note, debouncedSave]);

  // Listen for window bounds changes
  useEffect(() => {
    const electronAPI = getElectronAPI();
    if (!electronAPI) return;

    const cleanupBounds = electronAPI.onWindowBoundsChanged?.((bounds: any) => {
      try {
        apiClient.updateNote(parseInt(noteId), {
          position_x: bounds.x,
          position_y: bounds.y,
          width: bounds.width,
          height: bounds.height
        });
      } catch (error) {
        console.error('Failed to save window bounds:', error);
      }
    });

    const cleanupAlwaysOnTop = electronAPI.onAlwaysOnTopChanged?.((isOnTop: boolean) => {
      setAlwaysOnTop(isOnTop);
    });

    // Cleanup listeners on unmount
    return () => {
      cleanupBounds?.();
      cleanupAlwaysOnTop?.();
    };
  }, [noteId]);

  const loadNote = async () => {
    try {
      const data = await apiClient.fetchNotes();
      const foundNote = data.notes.find((n: Note) => n.id === parseInt(noteId));
      if (foundNote) {
        setNote(foundNote);
        setContent(foundNote.content || '');
      }
    } catch (error) {
      console.error('Failed to load note:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMinimize = () => {
    getElectronAPI()?.stickyNoteMinimize();
  };

  const handleClose = () => {
    getElectronAPI()?.stickyNoteClose();
  };

  const handleTogglePinned = () => {
    getElectronAPI()?.stickyNoteToggleAlwaysOnTop();
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ backgroundColor: note?.color || '#fbbf24' }}>
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  if (!note) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-900">
        <div className="text-white">Note not found</div>
      </div>
    );
  }

  return (
    // Modern sticky note design with compact header
    <div className="h-screen flex flex-col shadow-2xl"
      style={{ backgroundColor: note.color }}>
      
      {/* Custom Scrollbar Styles for Sticky Note */}
      <style>{`
        .sticky-note-textarea::-webkit-scrollbar {
          width: 8px;
        }
        .sticky-note-textarea::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.1);
          border-radius: 4px;
        }
        .sticky-note-textarea::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.3);
          border-radius: 4px;
        }
        .sticky-note-textarea::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 0, 0, 0.4);
        }
      `}</style>

      {/* Compact header bar - draggable */}
      <div className="drag flex items-center justify-between px-3 py-2 border-b border-black/20 bg-black/5">
        {/* Title section - compact */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {/* Color indicator dot */}
          <div 
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: `rgba(0,0,0,0.3)` }}
          />
          <h2 className="text-xs font-bold text-gray-900 truncate">
            {note.title}
          </h2>
          {/* Save status - compact */}
          {saving && (
            <span className="text-[10px] text-gray-700 font-medium">
              •••
            </span>
          )}
        </div>

        {/* Control buttons - compact */}
        <div className="flex items-center gap-0.5 no-drag">
          <button
            onClick={handleTogglePinned}
            className={`p-1.5 rounded transition-all ${alwaysOnTop
              ? 'bg-black/20 text-gray-900'
              : 'hover:bg-black/10 text-gray-600'
              }`}
            title={alwaysOnTop ? 'Unpin' : 'Pin on top'}
          >
            <Pin className="w-3 h-3" />
          </button>
          <button
            onClick={handleMinimize}
            className="p-1.5 hover:bg-black/10 rounded transition-colors text-gray-700"
            title="Minimize"
          >
            <Minimize className="w-3 h-3" />
          </button>
          <button
            onClick={handleClose}
            className="p-1.5 hover:bg-red-500 hover:text-white rounded transition-colors text-gray-700"
            title="Close"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Main content area - full space for writing */}
      <div className="flex-1 relative">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="sticky-note-textarea absolute inset-0 p-4 bg-transparent text-gray-900 
           resize-none focus:outline-none placeholder-gray-600
           text-sm leading-relaxed selection:bg-black/20"
          placeholder="Type your note..."
          style={{
            fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
          }}
        />
      </div>

      {/* Minimal footer - only shows on hover or when there's content */}
      {(content.length > 0 || lastSaved) && (
        <div className="px-3 py-1.5 border-t border-black/10 bg-black/5 flex items-center justify-between">
          {lastSaved && !saving && (
            <span className="text-[10px] text-gray-700 font-medium">
              {lastSaved.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit'
              })}
            </span>
          )}
          <span className="text-[10px] text-gray-600 ml-auto">
            {content.length} chars
          </span>
        </div>
      )}
    </div>
  );
}

