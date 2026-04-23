import { useEffect, useState, useCallback, useMemo } from 'react';
import { Folder, Sun, Moon } from 'lucide-react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import { api } from '@/api/client';
import type { WorkspaceBoardSummary } from '@/api/client';
import {
  getRecentBoards,
  addRecentBoard,
  removeRecentBoard,
  type RecentBoard,
} from '@/utils/localStorage';
import { FileBrowserDialog } from '@/screens/dialogs/FileBrowserDialog';
import { NewBoardDialog } from '@/screens/dialogs/NewBoardDialog';
import { DeleteBoardDialog } from '@/screens/dialogs/DeleteBoardDialog';
import { BoardCard } from '@/screens/components/BoardCard';
import { CreateBoardCard } from '@/screens/components/CreateBoardCard';

export function WelcomeScreen() {
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

  // Preserved verbatim from pre-extraction App.tsx; not currently called by render but
  // retained to keep this phase a behavior-preserving structural refactor. Safe to remove
  // in a future cleanup pass that explicitly owns the dead-code finding.
  const handleRemoveRecent = useCallback((path: string) => {
    removeRecentBoard(path);
    setRecentBoards(getRecentBoards());
  }, []);
  void handleRemoveRecent;

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
