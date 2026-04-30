import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import { PythonEnvPicker } from '@/components/PythonEnvPicker/PythonEnvPicker';
import { deriveBoardName } from '@/utils/boardName';
import {
  Save,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize,
  Image,
  Type,
  Square,
  ArrowRight,
  Code2,
  Grid3x3,
  Magnet,
  FileOutput,
  Home,
  AlignStartVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignEndHorizontal,
  AlignCenterVertical,
  AlignCenterHorizontal,
  Group,
  Ungroup,
  Lock,
  ArrowUpToLine,
  ArrowDownToLine,
  Columns,
  Rows,
  PanelLeft,
  PanelRight,
  Sun,
  Moon,
  Settings,
  Braces,
  PlayCircle,
  Loader2,
  AlertTriangle,
  RotateCw,
  ChevronDown,
} from 'lucide-react';

function RunAllConfirmDialog({ plotCount, onConfirm, onCancel }: {
  plotCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onCancel}>
      <div
        className="rounded-lg shadow-xl w-[420px] border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-rose-200 dark:border-rose-900/60 flex items-center gap-2">
          <AlertTriangle size={16} className="text-rose-600 dark:text-rose-400 shrink-0" />
          <h2 className="text-sm font-semibold text-rose-800 dark:text-rose-200">
            Run All will overwrite current plot outputs
          </h2>
        </div>
        <div className="px-4 py-4 space-y-2">
          <p className="text-sm text-rose-900/90 dark:text-rose-100/90">
            This runs Python Setup, then every plot cell on the board in order.
            Each plot's current rendered output (and any unsaved crops) will be
            replaced with a fresh run.
          </p>
          <p className="text-xs text-rose-700 dark:text-rose-300/80">
            {plotCount === 0
              ? 'No plot cells found on this board.'
              : `Plot cells to run: ${plotCount}. This may take a while if your plots are slow.`}
          </p>
        </div>
        <div className="px-4 py-3 border-t border-rose-200 dark:border-rose-900/60 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-rose-900/80 dark:text-rose-200/80 hover:bg-rose-100 dark:hover:bg-rose-900/40 rounded"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={plotCount === 0}
            className={`px-3 py-1.5 text-sm rounded text-white font-medium ${
              plotCount === 0
                ? 'bg-rose-300 cursor-not-allowed'
                : 'bg-rose-600 hover:bg-rose-700'
            }`}
          >
            Run All anyway
          </button>
        </div>
      </div>
    </div>
  );
}

function SavePromptDialog({ onSave, onDiscard, onCancel }: {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-white dark:bg-surface-primary rounded-lg shadow-xl w-[360px]" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-200 dark:border-border">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-on-surface-primary">Unsaved Changes</h2>
        </div>
        <div className="px-4 py-4">
          <p className="text-sm text-gray-600 dark:text-on-surface-secondary">You have unsaved changes. Would you like to save before leaving?</p>
        </div>
        <div className="px-4 py-3 border-t border-gray-100 dark:border-border flex justify-end gap-2">
          <button onClick={onDiscard} className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded">
            Don't Save
          </button>
          <button onClick={onCancel} className="px-3 py-1.5 text-sm text-gray-600 dark:text-on-surface-secondary hover:bg-gray-100 dark:hover:bg-surface-tertiary rounded">
            Cancel
          </button>
          <button onClick={onSave} className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export function Toolbar() {
  const board = useBoardStore(s => s.board);
  const isDirty = useBoardStore(s => s.isDirty);
  const kernelStatus = useBoardStore(s => s.kernelStatus);
  const runAllStatus = useBoardStore(s => s.runAllStatus);
  const runAllPlots = useBoardStore(s => s.runAllPlots);
  const reloadKernelModules = useBoardStore(s => s.reloadKernelModules);
  const saveBoard = useBoardStore(s => s.saveBoard);
  const undo = useBoardStore(s => s.undo);
  const redo = useBoardStore(s => s.redo);
  const [runAllConfirmOpen, setRunAllConfirmOpen] = useState(false);
  const [reloadStatus, setReloadStatus] = useState<'idle' | 'running' | 'ok' | 'error'>('idle');
  const historyIndex = useBoardStore(s => s.historyIndex);
  const historyLength = useBoardStore(s => s.history.length);
  const addElement = useBoardStore(s => s.addElement);
  const updateCanvas = useBoardStore(s => s.updateCanvas);
  const alignElements = useBoardStore(s => s.alignElements);
  const distributeElements = useBoardStore(s => s.distributeElements);
  const groupElements = useBoardStore(s => s.groupElements);
  const ungroupElements = useBoardStore(s => s.ungroupElements);
  const toggleLock = useBoardStore(s => s.toggleLock);
  const bringToFront = useBoardStore(s => s.bringToFront);
  const sendToBack = useBoardStore(s => s.sendToBack);

  const selectedIds = useUIStore(s => s.selectedIds);
  const zoom = useUIStore(s => s.zoom);
  const setZoom = useUIStore(s => s.setZoom);
  const closeBoard = useBoardStore(s => s.closeBoard);
  const setShowExportDialog = useUIStore(s => s.setShowExportDialog);
  const setShowSettings = useUIStore(s => s.setShowSettings);

  const showInsertPanel = useUIStore(s => s.showInsertPanel);
  const toggleInsertPanel = useUIStore(s => s.toggleInsertPanel);
  const showInspector = useUIStore(s => s.showInspector);
  const exportStatus = useUIStore(s => s.exportStatus);
  const toggleInspector = useUIStore(s => s.toggleInspector);
  const theme = useUIStore(s => s.theme);
  const setTheme = useUIStore(s => s.setTheme);
  const [showSavePrompt, setShowSavePrompt] = useState(false);

  // --- Board name == filename --------------------------------------------
  // The filename is the single source of truth. The input shows the derived
  // name and keeps a local buffer only while focused; on blur (or Enter) we
  // call renameBoardFile, which moves the file on disk and updates the MRU +
  // URL. If the rename fails, we surface an inline error and drop the buffer.
  const boardFilePath = useBoardStore(s => s.boardFilePath);
  const renameBoardFile = useBoardStore(s => s.renameBoardFile);
  const currentFileBase = useMemo(() => deriveBoardName(boardFilePath), [boardFilePath]);
  const [nameBuffer, setNameBuffer] = useState<string | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState('');

  const handleNameFocus = useCallback(() => {
    setNameBuffer(currentFileBase);
    setRenameError('');
  }, [currentFileBase]);

  const handleNameBlur = useCallback(async () => {
    const buffer = nameBuffer;
    setNameBuffer(null);
    if (buffer === null) return;
    if (!boardFilePath) return;
    const now = buffer.trim();
    if (!now) return; // empty → silently revert to current filename
    if (now === currentFileBase) return;
    const sanitized = now.replace(/[^a-zA-Z0-9_\- ]/g, '_').trim();
    if (!sanitized || sanitized === currentFileBase) return;
    setRenameBusy(true);
    setRenameError('');
    try {
      await renameBoardFile(sanitized);
      // Filename changed; currentFileBase updates via the subscription.
    } catch (err: any) {
      const raw = err?.message || '';
      const friendly =
        raw.includes('409') ? 'A file with that name already exists'
        : raw.includes('405') || raw.includes('404') ? 'Rename endpoint unavailable — restart the backend'
        : raw.includes('400') ? 'Invalid filename'
        : (raw || 'Rename failed');
      setRenameError(friendly);
      setTimeout(() => setRenameError(''), 6000);
    } finally {
      setRenameBusy(false);
    }
  }, [nameBuffer, boardFilePath, currentFileBase, renameBoardFile]);

  const hasSelection = selectedIds.length > 0;
  const multiSelect = selectedIds.length >= 2;

  // --- Overflow-driven compaction ----------------------------------------
  // When the toolbar would overflow (narrow window, Inspector open, multi-
  // select adding the alignment row, etc.), fold the Python stack (env
  // picker + Python Setup + Reload modules) into a single dropdown. Run All
  // stays visible since it's the primary action. On wide screens everything
  // renders at full width.
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [pythonCollapsed, setPythonCollapsed] = useState(false);
  const [pythonMenuOpen, setPythonMenuOpen] = useState(false);
  const pythonMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const measure = () => {
      // Width budget of the Python stack at full render ~= 510px; folding
      // it saves ~330px. Collapse when the toolbar would overflow; expand
      // with a buffer so we don't flap on ±1px drifts.
      const required = 1200
        + (multiSelect ? 280 : 0)
        + (hasSelection && !multiSelect ? 180 : 0);
      const w = el.clientWidth;
      setPythonCollapsed(prev => {
        if (!prev && w < required) return true;
        if (prev && w > required + 80) return false;
        return prev;
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [multiSelect, hasSelection]);

  // Close the collapsed Python menu on outside click / escape.
  useEffect(() => {
    if (!pythonMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (pythonMenuRef.current && !pythonMenuRef.current.contains(e.target as Node)) {
        setPythonMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPythonMenuOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [pythonMenuOpen]);

  const handleReloadModules = useCallback(async () => {
    if (reloadStatus === 'running') return;
    setReloadStatus('running');
    const r = await reloadKernelModules();
    if (!r.kernelRunning) {
      // No kernel to reload against — nothing to complain about, nothing
      // to celebrate. Silently drop back to idle.
      setReloadStatus('idle');
      return;
    }
    if (r.errors.length > 0) {
      setReloadStatus('error');
      console.warn('[sdraw] reloadKernelModules errors:', r.errors);
    } else {
      setReloadStatus('ok');
      console.info(
        `[sdraw] reloaded ${r.reloaded.length} module(s), rebound ${r.rebound} reference(s):`,
        r.reloaded,
      );
    }
    // Flash the status briefly, then revert.
    setTimeout(() => setReloadStatus('idle'), 2000);
  }, [reloadKernelModules, reloadStatus]);

  const handleGoHome = useCallback(() => {
    if (useBoardStore.getState().isDirty) {
      setShowSavePrompt(true);
    } else {
      closeBoard();
    }
  }, [closeBoard]);

  const handleSaveAndLeave = useCallback(async () => {
    await saveBoard();
    setShowSavePrompt(false);
    closeBoard();
  }, [saveBoard, closeBoard]);

  const handleDiscardAndLeave = useCallback(async () => {
    setShowSavePrompt(false);
    await useBoardStore.getState().deleteCheckpoint();
    closeBoard();
  }, [closeBoard]);

  const handleShowFileBrowser = useCallback(() => {
    if (!useUIStore.getState().showInsertPanel) {
      useUIStore.getState().toggleInsertPanel();
    }
  }, []);

  const handleInsertText = useCallback(() => {
    useUIStore.getState().setInsertPayload(null);
    const el = useBoardStore.getState().addElement('text', {
      text: 'Text',
      width: 100,
      height: 32,
      style: { fontSize: 16, fontWeight: 700, color: '#111111', background: 'transparent', padding: 4, textAlign: 'left' },
    });
    useUIStore.getState().setSelectedIds([el.id]);
  }, []);

  const handleInsertRect = useCallback(() => {
    useUIStore.getState().setInsertPayload(null);
    const el = useBoardStore.getState().addElement('rectangle', { width: 200, height: 150 });
    useUIStore.getState().setSelectedIds([el.id]);
  }, []);

  const handleInsertArrow = useCallback(() => {
    useUIStore.getState().setInsertPayload(null);
    const el = useBoardStore.getState().addElement('arrow', { width: 200, height: 4 });
    useUIStore.getState().setSelectedIds([el.id]);
  }, []);

  const handleInsertPlot = useCallback(() => {
    useUIStore.getState().setInsertPayload({ type: 'plot', overrides: {} });
  }, []);

  const handleGroup = useCallback(() => {
    if (multiSelect) {
      const groupId = useBoardStore.getState().groupElements(selectedIds);
      if (groupId) useUIStore.getState().setSelectedIds([groupId]);
    }
  }, [selectedIds, multiSelect]);

  const handleUngroup = useCallback(() => {
    if (selectedIds.length === 1) {
      const el = useBoardStore.getState().board?.elements.find(e => e.id === selectedIds[0]);
      if (el?.type === 'group') {
        const children = el.children || [];
        useBoardStore.getState().ungroupElements(selectedIds[0]);
        useUIStore.getState().setSelectedIds(children);
      }
    }
  }, [selectedIds]);

  if (!board) return null;

  const ToolButton = ({ onClick, icon: Icon, title, active, disabled, className: extraClass }: {
    onClick: () => void;
    icon: any;
    title: string;
    active?: boolean;
    disabled?: boolean;
    className?: string;
  }) => (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`p-1.5 rounded transition-colors ${
        active
          ? 'bg-accent/10 text-accent'
          : disabled
          ? 'text-gray-300 dark:text-on-surface-disabled cursor-not-allowed'
          : 'text-gray-600 dark:text-on-surface-secondary hover:bg-toolbar-hover hover:text-gray-900 dark:hover:text-on-surface-primary'
      } ${extraClass || ''}`}

    >
      <Icon size={16} />
    </button>
  );

  const Separator = () => <div className="w-px h-5 bg-toolbar-border mx-0.5" />;

  return (
    <>
      <div ref={toolbarRef} className="h-10 bg-toolbar-bg border-b border-toolbar-border flex items-center px-2 gap-0.5 select-none shrink-0 overflow-hidden">
        {/* Logo + Home */}
        <button
          onClick={handleGoHome}
          title="Back to Home"
          className="p-1 rounded text-gray-600 dark:text-on-surface-secondary hover:bg-toolbar-hover transition-colors shrink-0"
    
        >
          <img src="/logo_title_zoomed_in.png" alt="sDraw" style={{ height: 50, paddingTop: 8, paddingBottom: 14 }} className="object-contain" />
        </button>


        {/* Board name (editable) — the filename IS the name. Blur renames. */}
        <div className="flex items-center mx-1 relative" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <input
            type="text"
            value={nameBuffer ?? currentFileBase}
            onChange={e => setNameBuffer(e.target.value)}
            onFocus={handleNameFocus}
            onBlur={handleNameBlur}
            onKeyDown={e => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setNameBuffer(null);
                (e.target as HTMLInputElement).blur();
              }
            }}
            disabled={renameBusy}
            className={`text-xs text-gray-700 dark:text-on-surface-secondary bg-transparent border rounded px-1.5 py-0.5 hover:border-gray-300 dark:hover:border-on-surface-disabled focus:border-accent focus:outline-none w-28 min-w-[50px] truncate ${
              renameError
                ? 'border-red-400'
                : 'border-gray-200 dark:border-border'
            }`}
            title={renameError ? renameError : `Editing the name renames the file on disk. Current: ${currentFileBase}.sdraw`}
          />
          <span className="text-2xs text-gray-400 dark:text-on-surface-muted shrink-0 ml-0.5">.sdraw</span>
          {renameBusy && (
            <Loader2 size={12} className="animate-spin text-gray-400 dark:text-on-surface-muted shrink-0 ml-1" />
          )}
          {renameError && !renameBusy && (
            <div className="absolute top-full left-0 mt-1 z-50 px-2 py-1 bg-red-50 border border-red-200 rounded text-2xs text-red-700 whitespace-nowrap shadow-sm flex items-center gap-1">
              <AlertTriangle size={10} className="shrink-0" />
              <span>{renameError}</span>
            </div>
          )}
          {nameBuffer !== null && nameBuffer.trim() !== currentFileBase && !renameBusy && !renameError && (
            <div className="absolute top-full left-0 mt-1 z-50 px-2 py-1 bg-amber-50 border border-amber-200 rounded text-2xs text-amber-700 whitespace-nowrap shadow-sm flex items-center gap-1">
              <AlertTriangle size={10} className="shrink-0" />
              <span>This will rename the .sdraw file on disk. Press Enter to confirm, Esc to cancel.</span>
            </div>
          )}
        </div>

        {/* File actions */}
        <ToolButton onClick={() => saveBoard()} icon={Save} title="Save (Cmd+S)" disabled={!isDirty} />
        <div className="relative">
          <ToolButton onClick={() => setShowExportDialog(true)} icon={FileOutput}
            title={exportStatus === 'error' ? 'Auto Export — last export failed (click to configure)' : 'Auto Export'} />
          {board.autoExport?.enabled && board.autoExport?.outputPath && (
            <div
              className={`absolute rounded-full ${
                exportStatus === 'error'
                  ? 'top-0 right-0 w-2.5 h-2.5 bg-red-500 animate-pulse'
                  : exportStatus === 'exporting'
                    ? 'top-0 right-0 w-1.5 h-1.5 bg-yellow-400 animate-pulse'
                  : exportStatus === 'success'
                    ? 'top-0 right-0 w-1.5 h-1.5 bg-green-500'
                    : 'top-0 right-0 w-1.5 h-1.5 bg-green-500 animate-pulse'
              }`}
              title={exportStatus === 'error' ? 'Export failed' : exportStatus === 'exporting' ? 'Exporting...' : 'Auto-export active'}
            />
          )}
        </div>

        <Separator />

        {/* Undo/Redo */}
        <ToolButton onClick={undo} icon={Undo2} title="Undo (Cmd+Z)" disabled={historyIndex <= 0} />
        <ToolButton onClick={redo} icon={Redo2} title="Redo (Cmd+Shift+Z)" disabled={historyIndex >= historyLength - 1} />

        <Separator />

        {/* Python controls — full on wide, collapsed into a menu when narrow */}
        {!pythonCollapsed ? (
          <>
            <PythonEnvPicker />

            {/* Python Setup — shared imports/data that run once per board. */}
            <button
              onClick={() => useUIStore.getState().openSetupEditor()}
              title="Python Setup — shared code that runs before every plot on this board (⌘;)"
              className={`flex items-center gap-1 h-6 px-2 rounded border text-2xs font-medium transition-colors ${
                board.setup?.code
                  ? 'border-accent/40 bg-accent/10 text-accent hover:bg-accent/15'
                  : 'border-toolbar-border text-gray-600 dark:text-on-surface-secondary hover:bg-toolbar-hover hover:text-gray-900 dark:hover:text-on-surface-primary'
              }`}
            >
              <Braces size={12} className="shrink-0" />
              <span>Python Setup</span>
              {board.setup?.code && (
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    kernelStatus === 'running' ? 'bg-blue-400 animate-pulse'
                    : kernelStatus === 'ok' ? 'bg-green-500'
                    : kernelStatus === 'error' ? 'bg-red-500'
                    : 'bg-gray-400'
                  }`}
                />
              )}
            </button>

            {/* Reload modules — force-reloads every project-local .py file. */}
            <button
              onClick={handleReloadModules}
              disabled={kernelStatus !== 'ok' && kernelStatus !== 'running'}
              title={
                kernelStatus !== 'ok' && kernelStatus !== 'running'
                  ? 'Reload Python modules — run Python Setup first to start the kernel'
                  : 'Force-reload all project-local modules (autoreload runs automatically on every plot)'
              }
              className={`flex items-center gap-1 h-6 px-2 rounded border text-2xs font-medium transition-colors ${
                reloadStatus === 'running'
                  ? 'border-blue-400/40 bg-blue-400/10 text-blue-500 cursor-wait'
                  : reloadStatus === 'ok'
                  ? 'border-green-400/40 bg-green-400/10 text-green-600 dark:text-green-400'
                  : reloadStatus === 'error'
                  ? 'border-red-400/40 bg-red-400/10 text-red-600 dark:text-red-400'
                  : (kernelStatus !== 'ok' && kernelStatus !== 'running')
                  ? 'border-toolbar-border text-gray-300 dark:text-on-surface-disabled cursor-not-allowed'
                  : 'border-toolbar-border text-gray-600 dark:text-on-surface-secondary hover:bg-toolbar-hover hover:text-gray-900 dark:hover:text-on-surface-primary'
              }`}
            >
              {reloadStatus === 'running' ? (
                <Loader2 size={12} className="shrink-0 animate-spin" />
              ) : (
                <RotateCw size={12} className="shrink-0" />
              )}
              <span>
                {reloadStatus === 'running' ? 'Reloading…'
                  : reloadStatus === 'ok' ? 'Reloaded'
                  : reloadStatus === 'error' ? 'Reload failed'
                  : 'Reload modules'}
              </span>
            </button>
          </>
        ) : (
          <div className="relative" ref={pythonMenuRef}>
            <button
              onClick={() => setPythonMenuOpen(v => !v)}
              title="Python controls (narrow — expanded inline on wider screens)"
              className={`flex items-center gap-1 h-6 px-2 rounded border text-2xs font-medium transition-colors ${
                pythonMenuOpen
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-toolbar-border text-gray-600 dark:text-on-surface-secondary hover:bg-toolbar-hover hover:text-gray-900 dark:hover:text-on-surface-primary'
              }`}
            >
              <Braces size={12} className="shrink-0" />
              <span>Python</span>
              {/* Status dot: the most-important signal bubbled out of the menu. */}
              {board.setup?.code && (
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    kernelStatus === 'running' ? 'bg-blue-400 animate-pulse'
                    : kernelStatus === 'ok' ? 'bg-green-500'
                    : kernelStatus === 'error' ? 'bg-red-500'
                    : reloadStatus === 'error' ? 'bg-red-500'
                    : 'bg-gray-400'
                  }`}
                />
              )}
              <ChevronDown size={10} className="shrink-0 opacity-60" />
            </button>
            {pythonMenuOpen && (
              <div className="absolute top-full left-0 mt-1 z-50 w-60 bg-white dark:bg-surface-primary border border-gray-200 dark:border-border rounded-lg shadow-xl py-1">
                <button
                  onClick={() => { setPythonMenuOpen(false); useUIStore.getState().openSetupEditor(); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-2xs text-gray-700 dark:text-on-surface-secondary hover:bg-gray-100 dark:hover:bg-surface-tertiary"
                >
                  <Braces size={12} className="shrink-0" />
                  <span className="flex-1 text-left">Python Setup</span>
                  {board.setup?.code && (
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        kernelStatus === 'running' ? 'bg-blue-400 animate-pulse'
                        : kernelStatus === 'ok' ? 'bg-green-500'
                        : kernelStatus === 'error' ? 'bg-red-500'
                        : 'bg-gray-400'
                      }`}
                    />
                  )}
                </button>
                <button
                  onClick={() => { setPythonMenuOpen(false); handleReloadModules(); }}
                  disabled={kernelStatus !== 'ok' && kernelStatus !== 'running'}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-2xs text-gray-700 dark:text-on-surface-secondary hover:bg-gray-100 dark:hover:bg-surface-tertiary disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  {reloadStatus === 'running' ? (
                    <Loader2 size={12} className="shrink-0 animate-spin" />
                  ) : (
                    <RotateCw size={12} className="shrink-0" />
                  )}
                  <span className="flex-1 text-left">
                    {reloadStatus === 'running' ? 'Reloading…'
                      : reloadStatus === 'ok' ? 'Reloaded ✓'
                      : reloadStatus === 'error' ? 'Reload failed'
                      : 'Reload modules'}
                  </span>
                </button>
                <div className="border-t border-gray-100 dark:border-border my-1" />
                <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-gray-400 dark:text-on-surface-muted">Interpreter</div>
                <div className="px-2 pb-1">
                  <PythonEnvPicker />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Run All — runs Python Setup then every plot cell source element
            in z-order. Asks for confirmation before executing. */}
        <button
          onClick={() => setRunAllConfirmOpen(true)}
          disabled={runAllStatus.state === 'running'}
          title="Run Python Setup and every plot cell on this board in order"
          className={`flex items-center gap-1 h-6 px-2 rounded border text-2xs font-medium transition-colors ${
            runAllStatus.state === 'running'
              ? 'border-blue-400/40 bg-blue-400/10 text-blue-500 cursor-wait'
              : 'border-toolbar-border text-gray-600 dark:text-on-surface-secondary hover:bg-toolbar-hover hover:text-gray-900 dark:hover:text-on-surface-primary'
          }`}
        >
          {runAllStatus.state === 'running' ? (
            <Loader2 size={12} className="shrink-0 animate-spin" />
          ) : (
            <PlayCircle size={12} className="shrink-0" />
          )}
          <span>
            {runAllStatus.state === 'running'
              ? `Running ${runAllStatus.current}/${runAllStatus.total}`
              : 'Run All'}
          </span>
        </button>

        <Separator />

        {/* Alignment (visible when multi-select) */}
        {multiSelect && (
          <>
            <ToolButton onClick={() => alignElements(selectedIds, 'left')} icon={AlignStartVertical} title="Align Left" />
            <ToolButton onClick={() => alignElements(selectedIds, 'centerH')} icon={AlignCenterVertical} title="Align Center H" />
            <ToolButton onClick={() => alignElements(selectedIds, 'right')} icon={AlignEndVertical} title="Align Right" />
            <ToolButton onClick={() => alignElements(selectedIds, 'top')} icon={AlignStartHorizontal} title="Align Top" />
            <ToolButton onClick={() => alignElements(selectedIds, 'centerV')} icon={AlignCenterHorizontal} title="Align Center V" />
            <ToolButton onClick={() => alignElements(selectedIds, 'bottom')} icon={AlignEndHorizontal} title="Align Bottom" />
            {selectedIds.length >= 3 && (
              <>
                <ToolButton onClick={() => distributeElements(selectedIds, 'horizontal')} icon={Columns} title="Distribute Horizontally" />
                <ToolButton onClick={() => distributeElements(selectedIds, 'vertical')} icon={Rows} title="Distribute Vertically" />
              </>
            )}
            <Separator />
          </>
        )}

        {/* Grouping & Z-order */}
        {hasSelection && (
          <>
            <ToolButton onClick={handleGroup} icon={Group} title="Group (Cmd+G)" disabled={!multiSelect} />
            <ToolButton onClick={handleUngroup} icon={Ungroup} title="Ungroup (Cmd+Shift+G)" />
            <ToolButton onClick={() => toggleLock(selectedIds)} icon={Lock} title="Toggle Lock (Cmd+L)" />
            <ToolButton onClick={() => bringToFront(selectedIds)} icon={ArrowUpToLine} title="Bring to Front" />
            <ToolButton onClick={() => sendToBack(selectedIds)} icon={ArrowDownToLine} title="Send to Back" />
            <Separator />
          </>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Panel toggles */}
        <ToolButton onClick={toggleInsertPanel} icon={PanelLeft} title="Toggle Insert Panel" active={showInsertPanel} />
        <ToolButton onClick={toggleInspector} icon={PanelRight} title="Toggle Properties" active={showInspector} />

        <Separator />

        {/* Canvas toggles */}
        <ToolButton
          onClick={() => updateCanvas({ grid_enabled: !board.canvas.grid_enabled })}
          icon={Grid3x3}
          title="Toggle Grid"
          active={board.canvas.grid_enabled}
        />
        <ToolButton
          onClick={() => updateCanvas({ snap_enabled: !board.canvas.snap_enabled })}
          icon={Magnet}
          title="Toggle Snap"
          active={board.canvas.snap_enabled}
        />

        <Separator />

        {/* Settings & Theme */}
        <ToolButton onClick={() => setShowSettings(true)} icon={Settings} title="Preferences (Cmd+,)" />
        <ToolButton
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          icon={theme === 'dark' ? Sun : Moon}
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        />

        <Separator />

        {/* Zoom */}
        <ToolButton onClick={() => {
          const fn = useUIStore.getState().zoomTo;
          if (fn) fn(zoom / 1.5);
        }} icon={ZoomOut} title="Zoom Out" />
        <button
          onClick={() => {
            const fn = useUIStore.getState().zoomTo;
            if (fn) fn(1);
          }}
          className="text-xs text-gray-500 dark:text-on-surface-muted w-12 text-center tabular-nums hover:text-blue-600 dark:hover:text-blue-400"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title="Reset to 100%"
        >
          {Math.round(zoom * 100)}%
        </button>
        <ToolButton onClick={() => {
          const fn = useUIStore.getState().zoomTo;
          if (fn) fn(zoom * 1.5);
        }} icon={ZoomIn} title="Zoom In" />
        <ToolButton onClick={() => {
          const fn = useUIStore.getState().fitView;
          if (fn) fn();
        }} icon={Maximize} title="Fit View" />

      </div>

      {showSavePrompt && (
        <SavePromptDialog
          onSave={handleSaveAndLeave}
          onDiscard={handleDiscardAndLeave}
          onCancel={() => setShowSavePrompt(false)}
        />
      )}


      {runAllConfirmOpen && (
        <RunAllConfirmDialog
          plotCount={
            (() => {
              // Count unique plot code entries on this board that have
              // non-empty code AND at least one referencing element.
              const referenced = new Set<string>();
              for (const el of board.elements) {
                if (el.type !== 'plot') continue;
                const pcid = el.metadata?.plotCodeId;
                if (typeof pcid === 'string') referenced.add(pcid);
              }
              let count = 0;
              for (const id of referenced) {
                const code = String(board.plotCodes?.[id]?.code ?? '');
                if (code.trim().length > 0) count++;
              }
              return count;
            })()
          }
          onConfirm={() => {
            setRunAllConfirmOpen(false);
            runAllPlots();
          }}
          onCancel={() => setRunAllConfirmOpen(false)}
        />
      )}
    </>
  );
}
