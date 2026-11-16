import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Folder, ArrowLeft, Home, HardDrive,
  FileText, RefreshCw, FolderPlus, Plus,
} from 'lucide-react';
import { api } from '@/api/client';
import type { DirEntry } from '@/types/board';
import { getLastDirectory, saveLastDirectory, fetchUserHome } from '@/utils/helpers';

// ---------------------------------------------------------------------------
// Folder browser used both for picking a save location and opening files
// ---------------------------------------------------------------------------
export function FileBrowserDialog({
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
    : entries.filter(e => !e.is_dir && /\.(sdraw|json|html|htm)$/i.test(e.name));

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
            {mode === 'open' ? 'No folders or HTML / JSON boards here' : 'Empty folder'}
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
