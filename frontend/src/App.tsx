import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Toolbar } from '@/components/Toolbar/Toolbar';
import { Canvas } from '@/components/Canvas/Canvas';
import { Inspector } from '@/components/Inspector/Inspector';
import { InsertPanel } from '@/components/InsertPanel/InsertPanel';
import { StatusBar } from '@/components/StatusBar/StatusBar';
import { Settings } from '@/components/Settings/Settings';
import { PlotEditor } from '@/components/PlotEditor/PlotEditor';
import { SetupEditor } from '@/components/SetupEditor/SetupEditor';
import { ExternalChangeModal } from '@/components/ExternalChangeModal';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useAutoSave } from '@/hooks/useAutoSave';
import { useVSCodeBridge } from '@/hooks/useVSCodeBridge';
import { api } from '@/api/client';
import type { DirEntry } from '@/types/board';
import { getLastDirectory, saveLastDirectory, fetchUserHome, getLastDirectoryOrHome } from '@/utils/helpers';
import {
  Folder, ArrowLeft, Home, HardDrive,
  FileText, RefreshCw, FolderPlus, Plus, X, Clock,
  LayoutGrid, Image as ImageIcon, Layers, Trash2,
  Sun, Moon,
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
  compact,
  onPickFolder,
  onPickFile,
  onNewBoard,
  onPathChange,
  onFileNamePick,
}: {
  mode: 'save' | 'open';
  compact?: boolean;
  onPickFolder?: (path: string) => void;
  onPickFile?: (path: string) => void;
  onNewBoard?: (folderPath: string) => void;
  onPathChange?: (path: string) => void;
  onFileNamePick?: (name: string) => void;
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

  const onPathChangeRef = useRef(onPathChange);
  onPathChangeRef.current = onPathChange;

  const navigateRaw = useCallback(async (path: string) => {
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
      onPathChangeRef.current?.(result.path);
      setLoading(false);
      return true;
    } catch {
      setEntries([]);
      setLoading(false);
      return false;
    }
  }, []);

  const navigate = useCallback(async (path: string) => {
    const ok = await navigateRaw(path);
    if (!ok) {
      // Fallback to home directory from backend
      const home = await fetchUserHome();
      if (home !== path) {
        await navigateRaw(home);
      }
    }
  }, [navigateRaw]);

  useEffect(() => {
    const last = getLastDirectory();
    if (last) {
      navigate(last);
    } else {
      fetchUserHome().then(home => navigate(home));
    }
  }, [navigate]);

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
  const jsonFiles = compact
    ? entries.filter(e => !e.is_dir)  // show all files in compact mode
    : entries.filter(e => !e.is_dir && e.name.endsWith('.sdraw'));

  return (
    <div className={compact ? 'space-y-1' : 'space-y-2'}>
      {/* Nav buttons + path */}
      <div className="flex items-center gap-1">
        <NavBtn icon={ArrowLeft} title="Back" onClick={() => parentPath && parentPath !== currentPath && navigate(parentPath)} disabled={!parentPath || parentPath === currentPath} />
        <NavBtn icon={Home} title="Home" onClick={() => fetchUserHome().then(navigate)} />
        {!compact && <NavBtn icon={HardDrive} title="Root" onClick={() => navigate('/')} />}
        <NavBtn icon={RefreshCw} title="Refresh" onClick={() => currentPath && navigate(currentPath)} />
        <NavBtn icon={FolderPlus} title="New Folder" onClick={() => { setCreatingFolder(true); setNewFolderName(''); setFolderError(''); }} />
        {onNewBoard && !compact && (
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

      {/* Path bar (full mode only) */}
      {compact ? null : (
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
              className="flex-1 px-2 py-1.5 text-xs border border-blue-400 rounded bg-white dark:bg-surface-tertiary dark:text-on-surface-primary focus:outline-none min-w-0 font-mono"
            />
          ) : (
            <button
              onClick={() => setEditingPath(true)}
              className="flex-1 px-2 py-1.5 text-xs text-gray-500 dark:text-on-surface-muted bg-gray-50 dark:bg-surface-tertiary rounded border border-gray-200 dark:border-border hover:border-gray-300 truncate text-left min-w-0 font-mono"
              title={currentPath}
            >
              {currentPath || 'Click to enter path...'}
            </button>
          )}
        </div>
      )}

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
            className="flex-1 px-2 py-1 text-xs border border-blue-400 rounded bg-white dark:bg-surface-tertiary dark:text-on-surface-primary focus:outline-none min-w-0"
          />
          <button onClick={handleCreateFolder} className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600">Create</button>
          <button onClick={() => setCreatingFolder(false)} className="px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 rounded">Cancel</button>
        </div>
      )}
      {folderError && (
        <div className="text-xs text-red-500 px-1">{folderError}</div>
      )}

      {/* Listing */}
      <div className={`${compact ? 'h-36' : 'h-64'} overflow-y-auto ${compact ? '' : 'border border-gray-200 dark:border-border rounded'} bg-white dark:bg-surface-secondary`}>
        {loading ? (
          <div className={`px-3 ${compact ? 'py-2' : 'py-4'} text-xs text-gray-400 dark:text-on-surface-muted text-center`}>Loading...</div>
        ) : dirs.length === 0 && jsonFiles.length === 0 ? (
          <div className={`px-3 ${compact ? 'py-2' : 'py-4'} text-xs text-gray-400 dark:text-on-surface-muted text-center`}>
            {mode === 'open' ? 'No folders or .sdraw board files here' : 'Empty folder'}
          </div>
        ) : (
          <>
            {dirs.map(entry => (
              <button
                key={entry.path}
                onClick={() => navigate(entry.path)}
                className={`flex items-center gap-2 w-full px-2 ${compact ? 'py-1.5 text-xs' : 'py-1.5 text-xs'} text-gray-700 dark:text-on-surface-secondary hover:bg-blue-50 dark:hover:bg-blue-900/20 truncate`}
                title={entry.path}
              >
                <Folder size={compact ? 15 : 16} className="text-blue-400 shrink-0" />
                <span className="truncate">{entry.name}</span>
              </button>
            ))}
            {jsonFiles.map(entry => (
              compact ? (
                <button
                  key={entry.path}
                  onClick={() => onFileNamePick?.(entry.name)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-gray-400 dark:text-on-surface-muted hover:bg-gray-50 dark:hover:bg-surface-tertiary hover:text-gray-600 dark:hover:text-on-surface-secondary truncate"
                  title={`Click to use name: ${entry.name}`}
                >
                  <FileText size={15} className="text-gray-300 shrink-0" />
                  <span className="truncate">{entry.name}</span>
                </button>
              ) : (
                <button
                  key={entry.path}
                  onClick={() => onPickFile?.(entry.path)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-gray-700 dark:text-on-surface-secondary hover:bg-green-50 dark:hover:bg-green-900/20 truncate"
                  title={entry.path}
                >
                  <FileText size={16} className="text-green-500 shrink-0" />
                  <span className="truncate">{entry.name}</span>
                </button>
              )
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function NavBtn({ icon: Icon, title, onClick, disabled }: { icon: any; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded ${disabled ? 'text-gray-300 dark:text-on-surface-disabled cursor-not-allowed' : 'text-gray-500 dark:text-on-surface-muted hover:bg-gray-100 dark:hover:bg-surface-tertiary hover:text-gray-700 dark:hover:text-on-surface-primary'}`}
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
  onCreate: (name: string, filePath: string, width: number, height: number, infinite: boolean) => void;
}) {
  const [boardName, setBoardName] = useState('');
  const [canvasWidth, setCanvasWidth] = useState(2400);
  const [canvasHeight, setCanvasHeight] = useState(1600);
  const [infinite, setInfinite] = useState(true);

  const safeFileName = useMemo(() => {
    const name = boardName.trim() || 'Untitled Board';
    return name.replace(/[^a-zA-Z0-9_\- ]/g, '_') + '.sdraw';
  }, [boardName]);

  const handleSubmit = () => {
    const name = boardName.trim() || 'Untitled Board';
    onCreate(name, `${folderPath}/${safeFileName}`, canvasWidth, canvasHeight, infinite);
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white dark:bg-surface-primary rounded-lg shadow-xl w-[420px]" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-200 dark:border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-on-surface-primary">New Board</h2>
          <button onClick={onClose} className="text-gray-400 dark:text-on-surface-muted hover:text-gray-600 dark:hover:text-on-surface-primary text-lg leading-none">&times;</button>
        </div>
        <div className="px-4 py-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600 dark:text-on-surface-secondary block mb-1">Board name</label>
            <div className="flex items-center gap-0">
              <input
                type="text"
                value={boardName}
                onChange={e => setBoardName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
                placeholder="e.g. Figure 3 — Dose Response"
                className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-200 dark:border-border dark:bg-surface-tertiary dark:text-on-surface-primary rounded-l-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
                autoFocus
              />
              <span className="px-2.5 py-2 text-sm text-gray-400 dark:text-on-surface-muted bg-gray-50 dark:bg-surface-secondary border border-l-0 border-gray-200 dark:border-border rounded-r-md select-none">.sdraw</span>
            </div>
            <div className="mt-1 text-2xs text-gray-400 truncate">
              {folderPath}/{safeFileName}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 dark:text-on-surface-secondary block mb-1.5">Canvas size</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              <button
                onClick={() => setInfinite(true)}
                className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                  infinite
                    ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-400 text-blue-600 dark:text-blue-400'
                    : 'border-gray-200 dark:border-border text-gray-600 dark:text-on-surface-secondary hover:border-gray-300 hover:bg-gray-50 dark:hover:bg-surface-tertiary'
                }`}
              >
                Infinite
              </button>
              {[
                { label: 'Single column', w: 1200, h: 1600 },
                { label: '1.5 column', w: 1800, h: 1200 },
                { label: 'Full page', w: 2400, h: 1600 },
                { label: 'Wide', w: 3200, h: 1200 },
                { label: 'Poster', w: 4800, h: 3200 },
              ].map(p => {
                const active = !infinite && canvasWidth === p.w && canvasHeight === p.h;
                return (
                  <button
                    key={p.label}
                    onClick={() => { setInfinite(false); setCanvasWidth(p.w); setCanvasHeight(p.h); }}
                    className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                      active
                        ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-400 text-blue-600 dark:text-blue-400'
                        : 'border-gray-200 dark:border-border text-gray-600 dark:text-on-surface-secondary hover:border-gray-300 hover:bg-gray-50 dark:hover:bg-surface-tertiary'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            {!infinite && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <span className="text-xs text-gray-500">W</span>
                <input
                  type="number"
                  value={canvasWidth}
                  onChange={e => setCanvasWidth(Math.max(100, parseInt(e.target.value) || 100))}
                  className="w-20 px-2 py-1 text-xs border border-gray-200 dark:border-border dark:bg-surface-tertiary dark:text-on-surface-primary rounded focus:border-blue-500 focus:outline-none text-center"
                />
              </div>
              <span className="text-gray-400 dark:text-on-surface-muted text-xs">&times;</span>
              <div className="flex items-center gap-1">
                <span className="text-xs text-gray-500">H</span>
                <input
                  type="number"
                  value={canvasHeight}
                  onChange={e => setCanvasHeight(Math.max(100, parseInt(e.target.value) || 100))}
                  className="w-20 px-2 py-1 text-xs border border-gray-200 dark:border-border dark:bg-surface-tertiary dark:text-on-surface-primary rounded focus:border-blue-500 focus:outline-none text-center"
                />
              </div>
              <span className="text-2xs text-gray-400">px</span>
            </div>
            )}
          </div>
        </div>
        <div className="px-4 py-3 border-t border-gray-100 dark:border-border flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-gray-600 dark:text-on-surface-secondary hover:bg-gray-100 dark:hover:bg-surface-tertiary rounded">Cancel</button>
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
      className="group relative flex flex-col bg-white dark:bg-surface-primary rounded-xl border border-gray-200 dark:border-border hover:border-blue-300 dark:hover:border-blue-500/50 hover:shadow-md transition-all duration-150 overflow-hidden text-left cursor-pointer"
    >
      {/* Delete button */}
      <button
        onClick={e => { e.stopPropagation(); onDelete(); }}
        className="absolute top-2 right-2 z-10 p-1 rounded-md bg-white/80 dark:bg-surface-tertiary/80 text-gray-400 dark:text-on-surface-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 opacity-0 group-hover:opacity-100 transition-all shadow-sm"
        title="Delete board"
      >
        <Trash2 size={14} />
      </button>
      {/* Preview area */}
      <div className="relative w-full aspect-[3/2] bg-gradient-to-br from-gray-50 to-gray-100 dark:from-surface-secondary dark:to-surface-tertiary flex items-center justify-center overflow-hidden">
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
      <div className="px-3 py-2.5 border-t border-gray-100 dark:border-border flex-1 flex flex-col gap-0.5">
        <div className="text-sm font-medium text-gray-800 dark:text-on-surface-primary truncate">{board.name}</div>
        <div className="flex items-center gap-2 text-[11px] text-gray-400 dark:text-on-surface-muted">
          <span>{board.element_count} element{board.element_count !== 1 ? 's' : ''}</span>
          <span className="text-gray-200 dark:text-on-surface-disabled">|</span>
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
      className="group flex flex-col bg-white dark:bg-surface-primary rounded-xl border-2 border-dashed border-gray-200 dark:border-border hover:border-blue-400 hover:bg-blue-50/30 dark:hover:bg-blue-900/10 transition-all duration-150 overflow-hidden text-left"
    >
      {/* Preview area — same aspect ratio as BoardCard */}
      <div className="w-full aspect-[3/2] flex items-center justify-center">
        <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-surface-tertiary group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30 flex items-center justify-center transition-colors">
          <Plus size={24} className="text-gray-400 dark:text-on-surface-muted group-hover:text-blue-500 transition-colors" />
        </div>
      </div>
      {/* Info — matches BoardCard's bottom section */}
      <div className="px-3 py-2.5 border-t border-gray-100 dark:border-border flex-1 flex flex-col justify-center">
        <div className="text-sm font-medium text-gray-500 dark:text-on-surface-muted group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">New Board</div>
        <div className="text-[11px] text-gray-300 dark:text-on-surface-disabled">Create a new figure board</div>
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
      <div className="bg-white dark:bg-surface-primary rounded-lg shadow-xl w-[380px]" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-on-surface-primary">Delete Board</h2>
        </div>
        <div className="px-4 py-4 space-y-2">
          <p className="text-sm text-gray-600 dark:text-on-surface-secondary">
            Are you sure you want to delete <strong>{boardName}</strong>?
          </p>
          <p className="text-xs text-gray-400 dark:text-on-surface-muted">
            The board file and any associated auto-exports will be permanently removed. This cannot be undone.
          </p>
        </div>
        <div className="px-4 py-3 border-t border-gray-100 dark:border-border flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm text-gray-600 dark:text-on-surface-secondary hover:bg-gray-100 dark:hover:bg-surface-tertiary rounded">
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
  const [recoveryTarget, setRecoveryTarget] = useState<string | null>(null); // board file path with a checkpoint
  const theme = useUIStore(s => s.theme);
  const setTheme = useUIStore(s => s.setTheme);

  const loadBoards = useCallback(() => {
    setLoadingBoards(true);
    api.listWorkspaceBoards()
      .then(setWorkspaceBoards)
      .catch(() => setWorkspaceBoards([]))
      .finally(() => setLoadingBoards(false));
  }, []);

  // Load workspace boards on mount
  useEffect(() => { loadBoards(); }, [loadBoards]);

  const handleCreate = useCallback(async (name: string, filePath: string, width: number, height: number, infinite: boolean) => {
    try {
      setError('');
      await newBoard(name, filePath, { width, height, infinite });
      addRecentBoard(name, filePath);
    } catch (err: any) {
      setError(err.message || 'Failed to create board');
    }
  }, [newBoard]);

  const doOpen = useCallback(async (filePath: string) => {
    try {
      setError('');
      await openBoard(filePath);
      const board = useBoardStore.getState().board;
      addRecentBoard(board?.name || 'Untitled', filePath);
    } catch (err: any) {
      if (err.message?.includes('404')) {
        removeRecentBoard(filePath);
        setRecentBoards(getRecentBoards());
      }
      setError(err.message || 'Failed to open board');
    }
  }, [openBoard]);

  const handleOpen = useCallback(async (filePath: string) => {
    // Check for a crash-recovery checkpoint
    try {
      const check = await api.checkCheckpoint(filePath);
      if (check.exists && check.newer) {
        setRecoveryTarget(filePath);
        return;
      }
    } catch {
      // No checkpoint or check failed — proceed normally
    }
    doOpen(filePath);
  }, [doOpen]);

  const handleRecover = useCallback(async () => {
    if (!recoveryTarget) return;
    try {
      setError('');
      const result = await api.loadCheckpoint(recoveryTarget);
      // Load the recovered board directly into the store
      useBoardStore.setState({
        board: result.board as any,
        boardFilePath: recoveryTarget,
        isDirty: true, // Mark dirty so user can save
        history: [{
          elements: structuredClone((result.board as any).elements || []),
          plotCodes: structuredClone((result.board as any).plotCodes || {}),
          description: 'Recovered',
        }],
        historyIndex: 0,
      });
      const board = useBoardStore.getState().board;
      addRecentBoard(board?.name || 'Untitled', recoveryTarget);
    } catch (err: any) {
      setError(err.message || 'Failed to recover from checkpoint');
    }
    setRecoveryTarget(null);
  }, [recoveryTarget]);

  const handleDiscardRecovery = useCallback(async () => {
    if (!recoveryTarget) return;
    try { await api.deleteCheckpoint(recoveryTarget); } catch {}
    doOpen(recoveryTarget);
    setRecoveryTarget(null);
  }, [recoveryTarget, doOpen]);

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

  // Load summaries (including thumbnails) for recent boards opened from external files
  const [recentSummaries, setRecentSummaries] = useState<Map<string, WorkspaceBoardSummary>>(new Map());
  useEffect(() => {
    const wsPathSet = new Set(workspaceBoards.map(b => b.path));
    const externalRecent = recentBoards.filter(b => !wsPathSet.has(b.path));
    if (externalRecent.length === 0) return;

    const loadSummaries = async () => {
      const entries: [string, WorkspaceBoardSummary][] = [];
      for (const b of externalRecent) {
        try {
          const summary = await api.boardSummary(b.path);
          entries.push([b.path, summary]);
        } catch {
          // File may have been deleted — skip
        }
      }
      setRecentSummaries(new Map(entries));
    };
    loadSummaries();
  }, [recentBoards, workspaceBoards]);

  // Merge all boards into a single list: workspace boards first, then recent-only boards as cards
  const allBoardCards = useMemo(() => {
    const wsPathSet = new Set(workspaceBoards.map(b => b.path));
    const recentOnly = recentBoards
      .filter(b => !wsPathSet.has(b.path))
      .map(b => recentSummaries.get(b.path) || ({
        id: b.path,
        name: b.name,
        updated_at: b.openedAt,
        path: b.path,
        element_count: 0,
        image_count: 0,
        canvas: {},
      } as WorkspaceBoardSummary));
    return [...workspaceBoards, ...recentOnly];
  }, [workspaceBoards, recentBoards, recentSummaries]);

  return (
    <div className="h-screen w-screen flex flex-col bg-gradient-to-br from-gray-50 to-gray-100 dark:from-[#1e1f22] dark:to-[#2b2d31] overflow-auto">
      {/* Theme toggle on welcome screen */}
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="p-2 rounded-lg text-gray-500 dark:text-on-surface-muted hover:bg-white/50 dark:hover:bg-surface-tertiary transition-colors"
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
      <div className="max-w-[960px] w-full mx-auto px-6 py-12 flex flex-col flex-1">
        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <img src="/logo_title.png" alt="sDraw" className="h-32 object-contain mb-3" />
          <p className="text-sm text-gray-500 dark:text-on-surface-muted">Arrange and compose scientific figure panels</p>
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
            {error}
          </div>
        )}

        {/* Board grid */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-gray-500 dark:text-on-surface-muted uppercase tracking-wider">Your Boards</h2>
            <button
              onClick={() => setShowFileBrowser(true)}
              className="flex items-center gap-1 text-xs text-gray-500 dark:text-on-surface-muted hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            >
              <Folder size={13} />
              Open from file...
            </button>
          </div>

          {loadingBoards ? (
            <div className="text-sm text-gray-400 dark:text-on-surface-muted text-center py-12">Loading boards...</div>
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
          <div className="bg-white dark:bg-surface-primary rounded-lg shadow-xl w-[520px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-gray-200 dark:border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800 dark:text-on-surface-primary">Browse Files</h2>
              <button onClick={() => setShowFileBrowser(false)} className="text-gray-400 dark:text-on-surface-muted hover:text-gray-600 dark:hover:text-on-surface-primary text-lg leading-none">&times;</button>
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
          onCreate={(name, path, w, h, inf) => { setShowNewDialog(false); handleCreate(name, path, w, h, inf); }}
        />
      )}

      {deleteTarget && (
        <DeleteBoardDialog
          boardName={deleteTarget.name}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {recoveryTarget && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => { setRecoveryTarget(null); doOpen(recoveryTarget); }}>
          <div className="bg-white dark:bg-surface-primary rounded-lg shadow-xl w-[400px]" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-gray-200 dark:border-border">
              <h2 className="text-sm font-semibold text-gray-800 dark:text-on-surface-primary">Recover Unsaved Changes?</h2>
            </div>
            <div className="px-4 py-4 space-y-2">
              <p className="text-sm text-gray-600 dark:text-on-surface-secondary">
                A recovery checkpoint with unsaved changes was found for this board.
              </p>
              <p className="text-xs text-gray-400 dark:text-on-surface-muted">
                Would you like to recover the unsaved changes or discard them and open the last saved version?
              </p>
            </div>
            <div className="px-4 py-3 border-t border-gray-100 dark:border-border flex justify-end gap-2">
              <button onClick={handleDiscardRecovery} className="px-3 py-1.5 text-sm text-gray-600 dark:text-on-surface-secondary hover:bg-gray-100 dark:hover:bg-surface-tertiary rounded">
                Discard
              </button>
              <button onClick={handleRecover} className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600">
                Recover
              </button>
            </div>
          </div>
        </div>
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
  const board = useBoardStore(s => s.board);
  const updateAutoExport = useBoardStore(s => s.updateAutoExport);
  const triggerAutoExport = useBoardStore(s => s.triggerAutoExport);
  const saveBoard = useBoardStore(s => s.saveBoard);
  const boardName = board?.name || 'board';
  const autoExport = board?.autoExport || { enabled: false, outputPath: '', format: 'png' as const, dpi: 2, transparent: false, sizeMode: 'fit' as const, fixedWidth: 1920, fixedHeight: 1080 };
  // Capture the original path when dialog opens — never changes during the dialog session
  const [originalSettings] = useState(() => ({
    path: autoExport.outputPath || '',
    format: autoExport.format || 'png',
    dpi: autoExport.dpi || 2,
    transparent: autoExport.transparent || false,
  }));
  const [exporting, setExporting] = useState(false);
  const [lastExportTime, setLastExportTime] = useState('');
  const [browsedFolder, setBrowsedFolder] = useState(() => {
    if (autoExport.outputPath) {
      return autoExport.outputPath.substring(0, autoExport.outputPath.lastIndexOf('/'));
    }
    return '';
  });
  const [format, setFormat] = useState<string>(autoExport.format || 'png');
  const [fileName, setFileName] = useState(() => {
    if (autoExport.outputPath) {
      return autoExport.outputPath.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
    }
    return boardName.replace(/[^a-zA-Z0-9_\- ]/g, '_');
  });
  const [dpi, setDpi] = useState(autoExport.dpi || 2);
  const [transparent, setTransparent] = useState(autoExport.transparent || false);
  const [sizeMode, setSizeMode] = useState<'fit' | 'fixed' | 'canvas'>(autoExport.sizeMode || 'fit');
  const [fixedWidth, setFixedWidth] = useState(autoExport.fixedWidth || 1920);
  const [fixedHeight, setFixedHeight] = useState(autoExport.fixedHeight || 1080);
  const [showConfirm, setShowConfirm] = useState<'change' | 'overwrite' | null>(null);

  if (!showExportDialog) return null;

  const isAlreadyExporting = !!originalSettings.path;
  const oldPath = originalSettings.path;

  const fullFileName = `${fileName}.${format}`;
  const newPath = browsedFolder ? `${browsedFolder}/${fullFileName}` : '';
  const hasChanges = isAlreadyExporting && !!(
    newPath !== oldPath ||
    format !== originalSettings.format ||
    dpi !== originalSettings.dpi ||
    transparent !== originalSettings.transparent
  );

  const handleBrowsePathChange = (path: string) => {
    setBrowsedFolder(path);
  };

  const handleExportNow = async () => {
    setExporting(true);
    try {
      // Pass current board snapshot to ensure we export the right board
      const currentBoard = useBoardStore.getState().board;
      if (currentBoard) {
        await triggerAutoExport(currentBoard);
      }
      setLastExportTime(new Date().toLocaleTimeString());
    } catch (err) {
      console.error('Export failed:', err);
    }
    setExporting(false);
  };

  const captureCanvas = async (opts: {
    scale: number; transparent: boolean; mode: 'fit' | 'fixed' | 'canvas';
    fixedW?: number; fixedH?: number;
  }) => {
    const { captureOffscreen } = await import('@/utils/captureOffscreen');
    const { useBoardStore } = await import('@/store/boardStore');
    const board = useBoardStore.getState().board;
    if (!board) throw new Error('No board loaded');
    return captureOffscreen(board, opts);
  };

  const handleDownload = async () => {
    setExporting(true);
    try {
      const canvas = await captureCanvas({
        scale: dpi, transparent, mode: sizeMode,
        fixedW: fixedWidth, fixedH: fixedHeight,
      });
      const dataUrl = canvas.toDataURL(format === 'jpg' ? 'image/jpeg' : 'image/png', 0.95);
      const link = document.createElement('a');
      link.download = `${fileName}.${format}`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Download failed:', err);
    }
    setExporting(false);
  };

  const handleSave = async () => {
    if (!browsedFolder || !fileName) return;

    // If auto-export is already active and anything changed, confirm first
    if (hasChanges) {
      setShowConfirm('change');
      return;
    }

    // If target file already exists (new setup), confirm overwrite
    if (!isAlreadyExporting) {
      try {
        const check = await api.validatePath(newPath);
        if (check.exists && check.is_file) {
          setShowConfirm('overwrite');
          return;
        }
      } catch {}
    }

    await doSave();
  };

  const doSave = async () => {
    if (!browsedFolder || !fileName) return;
    setShowConfirm(null);

    // Delete old export file if path changed
    if (isAlreadyExporting && oldPath && newPath !== oldPath) {
      try {
        await api.deleteBoardFile(oldPath);
      } catch { /* file may not exist */ }
    }

    // Also clean up any stale files with the same base name but different extension
    if (browsedFolder && fileName) {
      const extensions = ['png', 'jpg', 'jpeg', 'pdf', 'svg'];
      for (const ext of extensions) {
        if (ext === format) continue;
        const stalePath = `${browsedFolder}/${fileName}.${ext}`;
        if (stalePath !== newPath) {
          try { await api.deleteBoardFile(stalePath); } catch {}
        }
      }
    }

    // Write all settings at once — single source of truth
    const boardState = useBoardStore.getState();
    const updatedBoard = {
      ...boardState.board!,
      autoExport: {
        enabled: true,
        outputPath: newPath,
        format: format as any,
        dpi,
        transparent,
        sizeMode,
        fixedWidth: sizeMode === 'fixed' ? fixedWidth : undefined,
        fixedHeight: sizeMode === 'fixed' ? fixedHeight : undefined,
      },
    };
    useBoardStore.setState({ board: updatedBoard, isDirty: true });
    await new Promise(r => setTimeout(r, 50));
    await useBoardStore.getState().saveBoard();
    const savedBoard = useBoardStore.getState().board;
    if (savedBoard) {
      await useBoardStore.getState().triggerAutoExport(savedBoard);
    }
    setLastExportTime(new Date().toLocaleTimeString());
    setShowExportDialog(false);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowExportDialog(false)}>
        <div className="bg-white dark:bg-surface-primary rounded-lg shadow-xl w-[480px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
          <div className="px-4 py-3 border-b border-gray-200 dark:border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800 dark:text-on-surface-primary">Auto Export</h2>
            <button onClick={() => setShowExportDialog(false)} className="text-gray-400 dark:text-on-surface-muted hover:text-gray-600 dark:hover:text-on-surface-primary text-lg leading-none">&times;</button>
          </div>
          <div className="px-4 py-4 space-y-3 overflow-y-auto">
            {/* Active export indicator */}
            {isAlreadyExporting && (
              <div className="bg-green-50 border border-green-200 rounded px-3 py-2 text-xs text-green-700">
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shrink-0" />
                  <span className="font-medium">Auto-export active</span>
                </div>
                <div className="font-mono text-2xs text-green-600 mt-0.5 break-all">
                  {autoExport.outputPath}
                </div>
                {lastExportTime && <div className="text-2xs text-green-500 mt-0.5">Last: {lastExportTime}</div>}
              </div>
            )}

            {/* File name + format */}
            <div>
              <label className="text-xs text-gray-600 dark:text-on-surface-secondary block mb-1">File name</label>
              <div className="flex items-center gap-0">
                <input
                  type="text"
                  value={fileName}
                  onChange={e => setFileName(e.target.value.replace(/[^a-zA-Z0-9_\- ]/g, '_'))}
                  className="flex-1 min-w-0 px-2 py-1.5 text-xs border border-gray-200 dark:border-border dark:bg-surface-tertiary dark:text-on-surface-primary rounded-l font-mono focus:border-accent focus:outline-none"
                />
                <select
                  value={format}
                  onChange={e => setFormat(e.target.value)}
                  className="px-1.5 py-1.5 text-xs text-gray-500 dark:text-on-surface-muted bg-gray-50 dark:bg-surface-secondary border border-l-0 border-gray-200 dark:border-border rounded-r focus:outline-none cursor-pointer"
                >
                  <option value="png">.png</option>
                  <option value="jpg">.jpg</option>
                  <option value="pdf">.pdf</option>
                  <option value="svg">.svg</option>
                </select>
              </div>
            </div>

            {/* Export destination browser */}
            <div>
              <label className="text-xs text-gray-600 dark:text-on-surface-secondary block mb-1">Export destination</label>
              <div className="border border-gray-200 dark:border-border rounded p-1.5">
                <FileBrowserDialog
                  mode="save"
                  compact
                  onPathChange={handleBrowsePathChange}
                  onFileNamePick={(name) => {
                    const base = name.replace(/\.[^.]+$/, '');
                    setFileName(base);
                  }}
                />
              </div>
            </div>

            {/* Size mode */}
            <div>
              <label className="text-xs text-gray-600 dark:text-on-surface-secondary block mb-1">Size</label>
              <div className="flex gap-1">
                {([
                  { value: 'fit', label: 'Fit content' },
                  { value: 'canvas', label: 'Full canvas' },
                  { value: 'fixed', label: 'Fixed size' },
                ] as const).map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setSizeMode(opt.value)}
                    className={`flex-1 px-2 py-1 text-xs rounded border transition-colors ${
                      sizeMode === opt.value
                        ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-400 text-blue-600 dark:text-blue-400'
                        : 'border-gray-200 dark:border-border text-gray-600 dark:text-on-surface-secondary hover:bg-gray-50 dark:hover:bg-surface-tertiary'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {sizeMode === 'fixed' && (
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="flex items-center gap-1">
                    <span className="text-2xs text-gray-500">W</span>
                    <input
                      type="number"
                      value={fixedWidth}
                      onChange={e => setFixedWidth(Math.max(100, parseInt(e.target.value) || 100))}
                      className="w-16 px-1.5 py-1 text-xs border border-gray-200 dark:border-border dark:bg-surface-tertiary dark:text-on-surface-primary rounded text-center"
                      min={100}
                    />
                  </div>
                  <span className="text-gray-400 text-xs">&times;</span>
                  <div className="flex items-center gap-1">
                    <span className="text-2xs text-gray-500">H</span>
                    <input
                      type="number"
                      value={fixedHeight}
                      onChange={e => setFixedHeight(Math.max(100, parseInt(e.target.value) || 100))}
                      className="w-16 px-1.5 py-1 text-xs border border-gray-200 dark:border-border dark:bg-surface-tertiary dark:text-on-surface-primary rounded text-center"
                      min={100}
                    />
                  </div>
                  <span className="text-2xs text-gray-400">px</span>
                </div>
              )}
            </div>

            {/* DPI + Transparent */}
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="text-xs text-gray-600 dark:text-on-surface-secondary block mb-1">DPI</label>
                <select
                  value={dpi}
                  onChange={e => setDpi(Number(e.target.value))}
                  className="w-full px-2 py-1.5 text-xs border border-gray-200 dark:border-border dark:bg-surface-tertiary dark:text-on-surface-primary rounded"
                >
                  <option value={1}>1x</option>
                  <option value={2}>2x</option>
                  <option value={3}>3x</option>
                  <option value={4}>4x</option>
                </select>
              </div>
              {format === 'png' && (
                <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-on-surface-secondary pt-4">
                  <input
                    type="checkbox"
                    checked={transparent}
                    onChange={e => setTransparent(e.target.checked)}
                    className="rounded"
                  />
                  Transparent BG
                </label>
              )}
            </div>

          </div>
          <div className="px-4 py-3 border-t border-gray-100 dark:border-border flex justify-between">
            <button onClick={handleDownload} disabled={exporting} className="px-3 py-1.5 text-xs text-gray-600 dark:text-on-surface-secondary hover:bg-gray-100 dark:hover:bg-surface-tertiary rounded border border-gray-200 dark:border-border">
              Download
            </button>
            <div className="flex gap-2">
              {isAlreadyExporting && (
                <button onClick={handleExportNow} disabled={exporting} className="px-3 py-1.5 text-xs text-gray-600 dark:text-on-surface-secondary hover:bg-gray-100 dark:hover:bg-surface-tertiary rounded border border-gray-200 dark:border-border disabled:opacity-50">
                  {exporting ? 'Exporting...' : 'Export Now'}
                </button>
              )}
              <button onClick={handleSave} disabled={!browsedFolder || !fileName} className="px-4 py-1.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50">
                {isAlreadyExporting ? 'Update' : 'Save & Export'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation dialog */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]">
          <div className="bg-white dark:bg-surface-primary rounded-lg shadow-xl w-[400px]" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-gray-200 dark:border-border">
              <h2 className="text-sm font-semibold text-gray-800 dark:text-on-surface-primary">
                {showConfirm === 'change' ? 'Update Auto Export' : 'File Already Exists'}
              </h2>
            </div>
            <div className="px-4 py-4 space-y-2">
              {showConfirm === 'change' ? (
                <>
                  <p className="text-sm text-gray-600 dark:text-on-surface-secondary">
                    Auto-export is currently active. Saving will:
                  </p>
                  <ul className="text-xs text-gray-500 list-disc pl-4 space-y-1">
                    <li>Delete the previous export file</li>
                    <li>Start exporting to the new location</li>
                  </ul>
                  <div className="mt-2 space-y-1">
                    <div className="text-2xs text-gray-400 font-mono truncate flex items-center gap-1.5">
                      <span className="text-red-400 shrink-0">Old:</span> {oldPath}
                    </div>
                    <div className="text-2xs text-gray-400 font-mono truncate flex items-center gap-1.5">
                      <span className="text-green-500 shrink-0">New:</span> {newPath}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-gray-600 dark:text-on-surface-secondary">
                    A file already exists at this location. Auto-export will continuously overwrite it.
                  </p>
                  <div className="text-2xs text-gray-400 font-mono truncate mt-1">
                    {newPath}
                  </div>
                </>
              )}
            </div>
            <div className="px-4 py-3 border-t border-gray-100 dark:border-border flex justify-end gap-2">
              <button onClick={() => setShowConfirm(null)} className="px-3 py-1.5 text-sm text-gray-600 dark:text-on-surface-secondary hover:bg-gray-100 dark:hover:bg-surface-tertiary rounded">
                Cancel
              </button>
              <button onClick={doSave} className="px-3 py-1.5 text-sm bg-red-100 text-red-600 rounded hover:bg-red-200">
                {showConfirm === 'change' ? 'Delete Old & Export' : 'Overwrite'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Error boundary
// ---------------------------------------------------------------------------
import React from 'react';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('React error boundary caught:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-screen w-screen flex items-center justify-center bg-gray-50 dark:bg-[#1e1f22]">
          <div className="max-w-lg p-6 bg-white dark:bg-surface-primary rounded-lg shadow-lg border border-red-200 dark:border-red-800">
            <h2 className="text-lg font-semibold text-red-600 mb-2">Something went wrong</h2>
            <pre className="text-xs text-gray-600 dark:text-on-surface-secondary bg-gray-50 dark:bg-surface-secondary rounded p-3 overflow-auto max-h-48 mb-4">
              {this.state.error.message}
            </pre>
            <button
              onClick={() => { this.setState({ error: null }); window.location.reload(); }}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------
function Editor() {
  useWebSocket();
  useKeyboardShortcuts();
  useAutoSave();

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-canvas-bg text-gray-800 dark:text-on-surface-primary">
      <Toolbar />
      <div className="flex flex-1 min-h-0">
        <InsertPanel />
        <Canvas />
        <Inspector />
      </div>
      <StatusBar />
      <ExportDialog />
      <Settings />
      <PlotEditor />
      <SetupEditor />
      <ExternalChangeModal />
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

  // VS Code webview bridge (no-op when not in VS Code)
  useVSCodeBridge();

  // Best-effort kernel shutdown on tab close. The backend's shutdown_all
  // hook is the real safety net; this just avoids orphaned kernels in the
  // common case where the process keeps running (dev server, etc.).
  useEffect(() => {
    const handler = () => {
      const b = useBoardStore.getState().board;
      if (!b) return;
      try {
        const url = '/api/plot/kernel/shutdown';
        const payload = JSON.stringify({ board_id: b.id });
        navigator.sendBeacon?.(url, new Blob([payload], { type: 'application/json' }));
      } catch {
        // best-effort
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // Listen for Electron "show-preferences" IPC event (Cmd+,)
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (api?.onShowPreferences) {
      api.onShowPreferences(() => {
        useUIStore.getState().setShowSettings(true);
      });
    }
    // Also support Cmd+, in browser mode
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        useUIStore.getState().setShowSettings(true);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

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
    <div className="h-screen w-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-[#1e1f22] dark:to-[#2b2d31]">
      <div className="text-sm text-gray-400 dark:text-on-surface-muted">Loading...</div>
    </div>
  );
  return (
    <>
      {board ? <Editor /> : <WelcomeScreen />}
      {/* Settings dialog available on all screens */}
      {!board && <Settings />}
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ReactFlowProvider>
        <AppContent />
      </ReactFlowProvider>
    </ErrorBoundary>
  );
}
