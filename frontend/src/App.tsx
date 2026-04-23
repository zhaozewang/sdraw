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
import { getLastDirectoryOrHome } from '@/utils/helpers';
import { WelcomeScreen } from '@/screens/WelcomeScreen';
import { FileBrowserDialog } from '@/screens/dialogs/FileBrowserDialog';
import {
  X, Clock,
  Image as ImageIcon,
} from 'lucide-react';


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
// Save/upload progress no longer commandeers a full-width blue strip at the
// top. It lives in the bottom StatusBar next to the other persistent state
// (connection, selection count, dirty chip) so a routine autosave doesn't
// steal visual priority from whatever the user is actually working on.

function Editor() {
  useWebSocket();
  useKeyboardShortcuts();
  useAutoSave();

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-canvas-bg text-gray-800 dark:text-on-surface-primary relative">
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
  // Captured once at mount so the render guard below stays stable across
  // re-renders even if the URL sync effect briefly strips the `?board=`
  // param while the initial openBoard is still in-flight.
  const hadBoardInUrl = useRef(
    !!new URLSearchParams(window.location.search).get('board'),
  ).current;
  // Only true if the initial openBoard attempt actually failed (network
  // error, bad path, migrate threw, etc.). Until then, we never render
  // the welcome screen — avoids the "home page flash then editor" bug.
  const [openFailed, setOpenFailed] = useState(false);

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

  // On mount, check URL for board param. Keep the "Loading…" screen up
  // until openBoard resolves or rejects — otherwise a slow load (big
  // board over an SSH port-forward) drops the user onto the welcome
  // screen and then snaps back to the editor, which looks broken.
  // `openBoardFromFile`'s own request timeout is the upper bound.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const boardPath = params.get('board');
    if (boardPath && !board) {
      openBoard(boardPath)
        .catch(() => {
          // Clear bad URL param so the welcome screen doesn't loop on a
          // stale path, and unlock the welcome render path.
          setOpenFailed(true);
          const url = new URL(window.location.href);
          url.searchParams.delete('board');
          window.history.replaceState({}, '', url.toString());
        })
        .finally(() => { setInitializing(false); });
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

  // Show the loading screen while the initial openBoard is in-flight,
  // AND also whenever the URL said we should have a board but we don't
  // yet (and the attempt hasn't explicitly failed). This covers any
  // race where `initializing` could briefly flip to false before the
  // board state has been committed, which previously caused the welcome
  // screen to flash for one frame before the editor took over.
  if (initializing || (hadBoardInUrl && !board && !openFailed)) return (
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
