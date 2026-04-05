import { useEffect, useState, useCallback, useMemo } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Toolbar } from '@/components/Toolbar/Toolbar';
import { Canvas } from '@/components/Canvas/Canvas';
import { Inspector } from '@/components/Inspector/Inspector';
import { InsertPanel } from '@/components/InsertPanel/InsertPanel';
import { StatusBar } from '@/components/StatusBar/StatusBar';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useAutoSave } from '@/hooks/useAutoSave';
import { api } from '@/api/client';
import { toPng } from 'html-to-image';
import type { DirEntry } from '@/types/board';
import { getLastDirectory, saveLastDirectory } from '@/utils/helpers';
import {
  Folder, ArrowLeft, Home, HardDrive,
  FileText, RefreshCw, FolderPlus, Plus, X, Clock,
  LayoutGrid, Image as ImageIcon, Layers, Trash2,
} from 'lucide-react';
import type { WorkspaceBoardSummary } from '@/api/client';

// ---------------------------------------------------------------------------
// Recent boards (persisted in localStorage)
// ---------------------------------------------------------------------------
interface RecentBoard {
  name: string;
  path: string;
  openedAt: string; // ISO timestamp
}

const RECENT_KEY = 'sdraw_recent_boards';
const MAX_RECENT = 10;

function getRecentBoards(): RecentBoard[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function addRecentBoard(name: string, path: string) {
  const boards = getRecentBoards().filter(b => b.path !== path);
  boards.unshift({ name, path, openedAt: new Date().toISOString() });
  localStorage.setItem(RECENT_KEY, JSON.stringify(boards.slice(0, MAX_RECENT)));
}

function removeRecentBoard(path: string) {
  const boards = getRecentBoards().filter(b => b.path !== path);
  localStorage.setItem(RECENT_KEY, JSON.stringify(boards));
}

// ---------------------------------------------------------------------------
// Folder browser used both for picking a save location and opening files
// ---------------------------------------------------------------------------
function FileBrowserDialog({
  mode,
  onPickFolder,
  onPickFile,
  onNewBoard,
}: {
  mode: 'save' | 'open';
  onPickFolder?: (path: string) => void;
  onPickFile?: (path: string) => void;
  onNewBoard?: (folderPath: string) => void;
}) {
  const [currentPath, setCurrentPath] = useState('');
  const [parentPath, setParentPath] = useState('');
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingPath, setEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [folderError, setFolderError] = useState('');

  const navigate = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const result = await api.browse(path);
      setCurrentPath(result.path);
      setParentPath(result.parent);
      setPathInput(result.path);
      setEntries(result.entries);
      setEditingPath(false);
      setCreatingFolder(false);
      setFolderError('');
      saveLastDirectory(result.path);
    } catch {
      setEntries([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { navigate(getLastDirectory()); }, [navigate]);

  const handleCreateFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      setFolderError('');
      const result = await api.mkdir(`${currentPath}/${name}`);
      setNewFolderName('');
      setCreatingFolder(false);
      navigate(result.path);
    } catch (err: any) {
      setFolderError(err.message || 'Failed to create folder');
    }
  }, [newFolderName, currentPath, navigate]);

  const dirs = entries.filter(e => e.is_dir);
  const jsonFiles = entries.filter(e => !e.is_dir && e.name.endsWith('.sdraw'));

  return (
    <div className="space-y-2">
      {/* Path bar */}
      <div className="flex items-center gap-1">
        {editingPath ? (
          <input
            type="text"
            value={pathInput}
            onChange={e => setPathInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') navigate(pathInput);
              if (e.key === 'Escape') { setEditingPath(false); setPathInput(currentPath); }
            }}
            onBlur={() => { setEditingPath(false); setPathInput(currentPath); }}
            autoFocus
            className="flex-1 px-2 py-1.5 text-xs border border-blue-400 rounded bg-white focus:outline-none min-w-0"
          />
        ) : (
          <button
            onClick={() => setEditingPath(true)}
            className="flex-1 px-2 py-1.5 text-xs text-gray-600 bg-gray-50 rounded border border-gray-200 hover:border-gray-300 truncate text-left min-w-0"
            title={currentPath}
          >
            {currentPath || 'Click to enter path...'}
          </button>
        )}
      </div>

      {/* Nav buttons */}
      <div className="flex items-center gap-1">
        <NavBtn icon={ArrowLeft} title="Back" onClick={() => parentPath && parentPath !== currentPath && navigate(parentPath)} disabled={!parentPath || parentPath === currentPath} />
        <NavBtn icon={Home} title="Home" onClick={() => navigate(getLastDirectory())} />
        <NavBtn icon={HardDrive} title="Root" onClick={() => navigate('/')} />
        <NavBtn icon={RefreshCw} title="Refresh" onClick={() => currentPath && navigate(currentPath)} />
        <NavBtn icon={FolderPlus} title="New Folder" onClick={() => { setCreatingFolder(true); setNewFolderName(''); setFolderError(''); }} />
        {onNewBoard && (
          <>
            <div className="flex-1" />
            <button
              onClick={() => currentPath && onNewBoard(currentPath)}
              disabled={!currentPath}
              className="flex items-center gap-1 px-2.5 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus size={14} />
              New Board
            </button>
          </>
        )}
      </div>

      {/* New folder input */}
      {creatingFolder && (
        <div className="flex items-center gap-1">
          <Folder size={16} className="text-blue-400 shrink-0" />
          <input
            type="text"
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleCreateFolder();
              if (e.key === 'Escape') setCreatingFolder(false);
            }}
            placeholder="New folder name..."
            autoFocus
            className="flex-1 px-2 py-1 text-xs border border-blue-400 rounded bg-white focus:outline-none min-w-0"
          />
          <button onClick={handleCreateFolder} className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600">Create</button>
          <button onClick={() => setCreatingFolder(false)} className="px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 rounded">Cancel</button>
        </div>
      )}
      {folderError && (
        <div className="text-xs text-red-500 px-1">{folderError}</div>
      )}

      {/* Listing */}
      <div className="h-64 overflow-y-auto border border-gray-200 rounded bg-white">
        {loading ? (
          <div className="px-3 py-4 text-xs text-gray-400 text-center">Loading...</div>
        ) : dirs.length === 0 && jsonFiles.length === 0 ? (
          <div className="px-3 py-4 text-xs text-gray-400 text-center">
            {mode === 'open' ? 'No folders or .sdraw board files here' : 'Empty folder'}
          </div>
        ) : (
          <>
            {dirs.map(entry => (
              <button
                key={entry.path}
                onClick={() => navigate(entry.path)}
                className="flex items-center gap-2 w-full px-2.5 py-1.5 text-xs text-gray-700 hover:bg-blue-50 truncate"
                title={entry.path}
              >
                <Folder size={16} className="text-blue-400 shrink-0" />
                <span className="truncate">{entry.name}</span>
              </button>
            ))}
            {jsonFiles.map(entry => (
              <button
                key={entry.path}
                onClick={() => onPickFile?.(entry.path)}
                className="flex items-center gap-2 w-full px-2.5 py-1.5 text-xs text-gray-700 hover:bg-green-50 truncate"
                title={entry.path}
              >
                <FileText size={16} className="text-green-500 shrink-0" />
                <span className="truncate">{entry.name}</span>
              </button>
            ))}
          </>
        )}
      </div>

      {/* Save mode: pick current folder */}
      {mode === 'save' && onPickFolder && (
        <div className="flex justify-end">
          <button
            onClick={() => currentPath && onPickFolder(currentPath)}
            disabled={!currentPath}
            className="px-3 py-1.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save here
          </button>
        </div>
      )}
    </div>
  );
}

function NavBtn({ icon: Icon, title, onClick, disabled }: { icon: any; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded ${disabled ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'}`}
    >
      <Icon size={16} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Welcome screen
// ---------------------------------------------------------------------------
function NewBoardDialog({
  folderPath,
  onClose,
  onCreate,
}: {
  folderPath: string;
  onClose: () => void;
  onCreate: (name: string, filePath: string, width: number, height: number) => void;
}) {
  const [boardName, setBoardName] = useState('');
  const [canvasWidth, setCanvasWidth] = useState(2400);
  const [canvasHeight, setCanvasHeight] = useState(1600);

  const safeFileName = useMemo(() => {
    const name = boardName.trim() || 'Untitled Board';
    return name.replace(/[^a-zA-Z0-9_\- ]/g, '_') + '.sdraw';
  }, [boardName]);

  const handleSubmit = () => {
    const name = boardName.trim() || 'Untitled Board';
    onCreate(name, `${folderPath}/${safeFileName}`, canvasWidth, canvasHeight);
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[420px]" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800">New Board</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
        </div>
        <div className="px-4 py-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Board name</label>
            <div className="flex items-center gap-0">
              <input
                type="text"
                value={boardName}
                onChange={e => setBoardName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
                placeholder="e.g. Figure 3 — Dose Response"
                className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-200 rounded-l-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
                autoFocus
              />
              <span className="px-2.5 py-2 text-sm text-gray-400 bg-gray-50 border border-l-0 border-gray-200 rounded-r-md select-none">.sdraw</span>
            </div>
            <div className="mt-1 text-2xs text-gray-400 truncate">
              {folderPath}/{safeFileName}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1.5">Canvas size</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {[
                { label: 'Single column', w: 1200, h: 1600 },
                { label: '1.5 column', w: 1800, h: 1200 },
                { label: 'Full page', w: 2400, h: 1600 },
                { label: 'Wide', w: 3200, h: 1200 },
                { label: 'Poster', w: 4800, h: 3200 },
              ].map(p => {
                const active = canvasWidth === p.w && canvasHeight === p.h;
                return (
                  <button
                    key={p.label}
                    onClick={() => { setCanvasWidth(p.w); setCanvasHeight(p.h); }}
                    className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                      active
                        ? 'bg-blue-50 border-blue-400 text-blue-600'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <span className="text-xs text-gray-500">W</span>
                <input
                  type="number"
                  value={canvasWidth}
                  onChange={e => setCanvasWidth(Math.max(100, parseInt(e.target.value) || 100))}
                  className="w-20 px-2 py-1 text-xs border border-gray-200 rounded focus:border-blue-500 focus:outline-none text-center"
                />
              </div>
              <span className="text-gray-400 text-xs">&times;</span>
              <div className="flex items-center gap-1">
                <span className="text-xs text-gray-500">H</span>
                <input
                  type="number"
                  value={canvasHeight}
                  onChange={e => setCanvasHeight(Math.max(100, parseInt(e.target.value) || 100))}
                  className="w-20 px-2 py-1 text-xs border border-gray-200 rounded focus:border-blue-500 focus:outline-none text-center"
                />
              </div>
              <span className="text-2xs text-gray-400">px</span>
            </div>
          </div>
        </div>
        <div className="px-4 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
          <button onClick={handleSubmit} className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600">
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

function BoardCard({ board, onClick, onDelete }: { board: WorkspaceBoardSummary; onClick: () => void; onDelete: () => void }) {
  const timeAgo = useMemo(() => {
    try {
      const d = new Date(board.updated_at);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return 'Just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHr = Math.floor(diffMin / 60);
      if (diffHr < 24) return `${diffHr}h ago`;
      const diffDay = Math.floor(diffHr / 24);
      if (diffDay < 30) return `${diffDay}d ago`;
      return d.toLocaleDateString();
    } catch { return ''; }
  }, [board.updated_at]);

  return (
    <div
      onClick={onClick}
      className="group relative flex flex-col bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-md transition-all duration-150 overflow-hidden text-left cursor-pointer"
    >
      {/* Delete button */}
      <button
        onClick={e => { e.stopPropagation(); onDelete(); }}
        className="absolute top-2 right-2 z-10 p-1 rounded-md bg-white/80 text-gray-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all shadow-sm"
        title="Delete board"
      >
        <Trash2 size={14} />
      </button>
      {/* Preview area */}
      <div className="relative w-full aspect-[3/2] bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center overflow-hidden">
        {board.thumbnail ? (
          <img src={board.thumbnail} alt={board.name} className="w-full h-full object-cover" />
        ) : board.image_count > 0 ? (
          <div className="flex items-center gap-3 text-gray-300">
            <LayoutGrid size={32} strokeWidth={1.5} />
            <div className="text-left">
              <div className="text-2xl font-semibold text-gray-400">{board.image_count}</div>
              <div className="text-[10px] uppercase tracking-wider text-gray-400">panels</div>
            </div>
          </div>
        ) : (
          <div className="text-gray-300">
            <Layers size={28} strokeWidth={1.5} />
          </div>
        )}
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      {/* Info */}
      <div className="px-3 py-2.5 border-t border-gray-100 flex-1 flex flex-col gap-0.5">
        <div className="text-sm font-medium text-gray-800 truncate">{board.name}</div>
        <div className="flex items-center gap-2 text-[11px] text-gray-400">
          <span>{board.element_count} element{board.element_count !== 1 ? 's' : ''}</span>
          <span className="text-gray-200">|</span>
          <span>{timeAgo}</span>
        </div>
      </div>
    </div>
  );
}

function CreateBoardCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col bg-white rounded-xl border-2 border-dashed border-gray-200 hover:border-blue-400 hover:bg-blue-50/30 transition-all duration-150 overflow-hidden text-left"
    >
      {/* Preview area — same aspect ratio as BoardCard */}
      <div className="w-full aspect-[3/2] flex items-center justify-center">
        <div className="w-12 h-12 rounded-full bg-gray-100 group-hover:bg-blue-100 flex items-center justify-center transition-colors">
          <Plus size={24} className="text-gray-400 group-hover:text-blue-500 transition-colors" />
        </div>
      </div>
      {/* Info — matches BoardCard's bottom section */}
      <div className="px-3 py-2.5 border-t border-gray-100 flex-1 flex flex-col justify-center">
        <div className="text-sm font-medium text-gray-500 group-hover:text-blue-600 transition-colors">New Board</div>
        <div className="text-[11px] text-gray-300">Create a new figure board</div>
      </div>
    </button>
  );
}

function DeleteBoardDialog({ boardName, onConfirm, onCancel }: {
  boardName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-white rounded-lg shadow-xl w-[380px]" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-800">Delete Board</h2>
        </div>
        <div className="px-4 py-4 space-y-2">
          <p className="text-sm text-gray-600">
            Are you sure you want to delete <strong>{boardName}</strong>?
          </p>
          <p className="text-xs text-gray-400">
            The board file and any associated auto-exports will be permanently removed. This cannot be undone.
          </p>
        </div>
        <div className="px-4 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded">
            Cancel
          </button>
          <button onClick={onConfirm} className="px-3 py-1.5 text-sm bg-red-500 text-white rounded hover:bg-red-600">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function WelcomeScreen() {
  const newBoard = useBoardStore(s => s.newBoard);
  const openBoard = useBoardStore(s => s.openBoard);
  const [error, setError] = useState('');
  const [recentBoards, setRecentBoards] = useState<RecentBoard[]>(getRecentBoards);
  const [workspaceBoards, setWorkspaceBoards] = useState<WorkspaceBoardSummary[]>([]);
  const [loadingBoards, setLoadingBoards] = useState(true);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newBoardFolder, setNewBoardFolder] = useState('');
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ name: string; path: string } | null>(null);

  const loadBoards = useCallback(() => {
    setLoadingBoards(true);
    api.listWorkspaceBoards()
      .then(setWorkspaceBoards)
      .catch(() => setWorkspaceBoards([]))
      .finally(() => setLoadingBoards(false));
  }, []);

  // Load workspace boards on mount
  useEffect(() => { loadBoards(); }, [loadBoards]);

  const handleCreate = useCallback(async (name: string, filePath: string, width: number, height: number) => {
    try {
      setError('');
      await newBoard(name, filePath, { width, height });
      addRecentBoard(name, filePath);
    } catch (err: any) {
      setError(err.message || 'Failed to create board');
    }
  }, [newBoard]);

  const handleOpen = useCallback(async (filePath: string) => {
    try {
      setError('');
      await openBoard(filePath);
      const board = useBoardStore.getState().board;
      addRecentBoard(board?.name || 'Untitled', filePath);
    } catch (err: any) {
      // Auto-remove stale recent entry if file not found
      if (err.message?.includes('404')) {
        removeRecentBoard(filePath);
        setRecentBoards(getRecentBoards());
      }
      setError(err.message || 'Failed to open board');
    }
  }, [openBoard]);

  const handleRemoveRecent = useCallback((path: string) => {
    removeRecentBoard(path);
    setRecentBoards(getRecentBoards());
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      setError('');
      // Remove from recent boards first (always succeeds)
      removeRecentBoard(deleteTarget.path);
      setRecentBoards(getRecentBoards());
      // Try to delete the file — ignore 404 (already gone)
      try {
        await api.deleteBoardFile(deleteTarget.path);
      } catch {
        // File may already be deleted, that's fine
      }
      setDeleteTarget(null);
      // Refresh board list
      api.listWorkspaceBoards()
        .then(setWorkspaceBoards)
        .catch(() => setWorkspaceBoards([]));
    } catch (err: any) {
      setError(err.message || 'Failed to delete board');
      setDeleteTarget(null);
    }
  }, [deleteTarget]);

  // Merge all boards into a single list: workspace boards first, then recent-only boards as cards
  const allBoardCards = useMemo(() => {
    const wsPathSet = new Set(workspaceBoards.map(b => b.path));
    const recentOnly = recentBoards
      .filter(b => !wsPathSet.has(b.path))
      .map(b => ({
        id: b.path,
        name: b.name,
        updated_at: b.openedAt,
        path: b.path,
        element_count: 0,
        image_count: 0,
        canvas: {},
      } as WorkspaceBoardSummary));
    return [...workspaceBoards, ...recentOnly];
  }, [workspaceBoards, recentBoards]);

  return (
    <div className="h-screen w-screen flex flex-col bg-gradient-to-br from-gray-50 to-gray-100 overflow-auto">
      <div className="max-w-[960px] w-full mx-auto px-6 py-12 flex flex-col flex-1">
        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <img src="/logo_title.png" alt="sDraw" className="h-32 object-contain mb-3" />
          <p className="text-sm text-gray-500">Arrange and compose scientific figure panels</p>
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
            {error}
          </div>
        )}

        {/* Board grid */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Your Boards</h2>
            <button
              onClick={() => setShowFileBrowser(true)}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 transition-colors"
            >
              <Folder size={13} />
              Open from file...
            </button>
          </div>

          {loadingBoards ? (
            <div className="text-sm text-gray-400 text-center py-12">Loading boards...</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {/* Create new card */}
              <CreateBoardCard onClick={() => setShowFileBrowser(true)} />

              {/* All boards */}
              {allBoardCards.map(board => (
                <BoardCard
                  key={board.path}
                  board={board}
                  onClick={() => handleOpen(board.path)}
                  onDelete={() => setDeleteTarget({ name: board.name, path: board.path })}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* File browser overlay — shown when + is clicked or "Open from file" */}
      {showFileBrowser && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowFileBrowser(false)}>
          <div className="bg-white rounded-lg shadow-xl w-[520px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">Browse Files</h2>
              <button onClick={() => setShowFileBrowser(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
            </div>
            <div className="p-3 flex-1 overflow-auto">
              <FileBrowserDialog
                mode="open"
                onPickFile={(path) => { setShowFileBrowser(false); handleOpen(path); }}
                onNewBoard={(folderPath) => { setShowFileBrowser(false); setNewBoardFolder(folderPath); setShowNewDialog(true); }}
              />
            </div>
          </div>
        </div>
      )}

      {showNewDialog && (
        <NewBoardDialog
          folderPath={newBoardFolder}
          onClose={() => setShowNewDialog(false)}
          onCreate={(name, path, w, h) => { setShowNewDialog(false); handleCreate(name, path, w, h); }}
        />
      )}

      {deleteTarget && (
        <DeleteBoardDialog
          boardName={deleteTarget.name}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export dialog
// ---------------------------------------------------------------------------
function ExportDialog() {
  const showExportDialog = useUIStore(s => s.showExportDialog);
  const setShowExportDialog = useUIStore(s => s.setShowExportDialog);
  const boardName = useBoardStore(s => s.board?.name || 'board');
  const [dpi, setDpi] = useState(2);
  const [transparent, setTransparent] = useState(false);
  const [exporting, setExporting] = useState(false);

  if (!showExportDialog) return null;

  const handleExport = async () => {
    setExporting(true);
    try {
      const el = document.querySelector('.react-flow__viewport') as HTMLElement;
      if (!el) throw new Error('Canvas not found');
      const dataUrl = await toPng(el, {
        pixelRatio: dpi,
        backgroundColor: transparent ? undefined : '#ffffff',
      });
      const link = document.createElement('a');
      link.download = `${boardName.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Export failed:', err);
      alert('Export failed. See console for details.');
    }
    setExporting(false);
    setShowExportDialog(false);
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowExportDialog(false)}>
      <div className="bg-white rounded-lg shadow-xl w-[360px]" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800">Export PNG</h2>
          <button onClick={() => setShowExportDialog(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
        </div>
        <div className="px-4 py-4 space-y-3">
          <div>
            <label className="text-xs text-gray-600 block mb-1">Pixel Ratio (DPI multiplier)</label>
            <select value={dpi} onChange={e => setDpi(Number(e.target.value))} className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded">
              <option value={1}>1x (72 DPI)</option>
              <option value={2}>2x (144 DPI)</option>
              <option value={3}>3x (216 DPI)</option>
              <option value={4}>4x (288 DPI)</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={transparent} onChange={e => setTransparent(e.target.checked)} className="rounded" />
            Transparent background
          </label>
        </div>
        <div className="px-4 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={() => setShowExportDialog(false)} className="px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
          <button onClick={handleExport} disabled={exporting} className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50">
            {exporting ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------
function Editor() {
  useWebSocket();
  useKeyboardShortcuts();
  useAutoSave();

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-canvas-bg">
      <Toolbar />
      <div className="flex flex-1 min-h-0">
        <InsertPanel />
        <Canvas />
        <Inspector />
      </div>
      <StatusBar />
      <ExportDialog />
    </div>
  );
}

// ---------------------------------------------------------------------------
// App root
// ---------------------------------------------------------------------------
function AppContent() {
  const board = useBoardStore(s => s.board);
  const boardFilePath = useBoardStore(s => s.boardFilePath);
  const openBoard = useBoardStore(s => s.openBoard);
  const [initializing, setInitializing] = useState(true);

  // On mount, check URL for board param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const boardPath = params.get('board');
    if (boardPath && !board) {
      // Timeout after 3s to avoid stuck loading
      const timeout = setTimeout(() => setInitializing(false), 3000);
      openBoard(boardPath)
        .catch(() => {
          // Clear bad URL param
          const url = new URL(window.location.href);
          url.searchParams.delete('board');
          window.history.replaceState({}, '', url.toString());
        })
        .finally(() => { clearTimeout(timeout); setInitializing(false); });
    } else {
      setInitializing(false);
    }
  }, []);

  // Sync URL and page title when board changes
  const boardName = useBoardStore(s => s.board?.name);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (boardFilePath) {
      url.searchParams.set('board', boardFilePath);
      document.title = `${boardName || 'Untitled'} | sDraw`;
    } else {
      url.searchParams.delete('board');
      document.title = 'sDraw | Scientific Figure Board';
    }
    window.history.replaceState({}, '', url.toString());
  }, [boardFilePath, boardName]);

  if (initializing) return (
    <div className="h-screen w-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="text-sm text-gray-400">Loading...</div>
    </div>
  );
  return board ? <Editor /> : <WelcomeScreen />;
}

export default function App() {
  return (
    <ReactFlowProvider>
      <AppContent />
    </ReactFlowProvider>
  );
}
