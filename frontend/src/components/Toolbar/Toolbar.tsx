import { useCallback, useState } from 'react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import { PythonEnvPicker } from '@/components/PythonEnvPicker/PythonEnvPicker';
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
} from 'lucide-react';

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
  const saveBoard = useBoardStore(s => s.saveBoard);
  const undo = useBoardStore(s => s.undo);
  const redo = useBoardStore(s => s.redo);
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

  const hasSelection = selectedIds.length > 0;
  const multiSelect = selectedIds.length >= 2;

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
    const el = useBoardStore.getState().addElement('text', {
      text: 'Text',
      width: 100,
      height: 32,
      style: { fontSize: 16, fontWeight: 700, color: '#111111', background: 'transparent', padding: 4, textAlign: 'left' },
    });
    useUIStore.getState().setSelectedIds([el.id]);
  }, []);

  const handleInsertRect = useCallback(() => {
    const el = useBoardStore.getState().addElement('rectangle', { width: 200, height: 150 });
    useUIStore.getState().setSelectedIds([el.id]);
  }, []);

  const handleInsertArrow = useCallback(() => {
    const el = useBoardStore.getState().addElement('arrow', { width: 200, height: 4 });
    useUIStore.getState().setSelectedIds([el.id]);
  }, []);

  const handleInsertPlot = useCallback(() => {
    let overrides: Record<string, any> = {};
    // Place at viewport center
    const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null;
    const container = viewport?.parentElement;
    if (viewport && container) {
      const transform = viewport.style.transform;
      const match = transform.match(/translate\((.+?)px,\s*(.+?)px\)\s*scale\((.+?)\)/);
      if (match) {
        const tx = parseFloat(match[1]);
        const ty = parseFloat(match[2]);
        const scale = parseFloat(match[3]);
        const rect = container.getBoundingClientRect();
        const w = 480, h = 520;
        overrides.x = Math.round((rect.width / 2 - tx) / scale - w / 2);
        overrides.y = Math.round((rect.height / 2 - ty) / scale - h / 2);
      }
    }
    const el = useBoardStore.getState().addElement('plot', overrides);
    useUIStore.getState().setSelectedIds([el.id]);
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
      <div className="h-10 bg-toolbar-bg border-b border-toolbar-border flex items-center px-2 gap-0.5 select-none shrink-0">
        {/* Logo + Home */}
        <button
          onClick={handleGoHome}
          title="Back to Home"
          className="p-1 rounded text-gray-600 dark:text-on-surface-secondary hover:bg-toolbar-hover transition-colors shrink-0"
    
        >
          <img src="/logo_title_zoomed_in.png" alt="sDraw" style={{ height: 50, paddingTop: 8, paddingBottom: 14 }} className="object-contain" />
        </button>


        {/* Board name (editable) */}
        <div className="flex items-center mx-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <input
            type="text"
            value={board.name}
            onChange={e => useBoardStore.getState().setBoardName(e.target.value)}
            className="text-xs text-gray-700 dark:text-on-surface-secondary bg-transparent border border-gray-200 dark:border-border rounded px-1.5 py-0.5 hover:border-gray-300 dark:hover:border-on-surface-disabled focus:border-accent focus:outline-none w-28 min-w-[50px] truncate"
            title={`${board.name}.sdraw`}
          />
          <span className="text-2xs text-gray-400 dark:text-on-surface-muted shrink-0 ml-0.5">.sdraw</span>
        </div>

        {/* File actions */}
        <ToolButton onClick={() => saveBoard()} icon={Save} title="Save (Cmd+S)" disabled={!isDirty} />
        <div className="relative">
          <ToolButton onClick={() => setShowExportDialog(true)} icon={FileOutput} title="Auto Export" />
          {board.autoExport?.enabled && board.autoExport?.outputPath && (
            <div className={`absolute top-0 right-0 w-1.5 h-1.5 rounded-full ${
              exportStatus === 'exporting' ? 'bg-yellow-400 animate-pulse' :
              exportStatus === 'error' ? 'bg-red-500' :
              exportStatus === 'success' ? 'bg-green-500' :
              'bg-green-500 animate-pulse'
            }`} />
          )}
        </div>

        <Separator />

        {/* Undo/Redo */}
        <ToolButton onClick={undo} icon={Undo2} title="Undo (Cmd+Z)" disabled={historyIndex <= 0} />
        <ToolButton onClick={redo} icon={Redo2} title="Redo (Cmd+Shift+Z)" disabled={historyIndex >= historyLength - 1} />

        <Separator />

        {/* Python env picker */}
        <PythonEnvPicker />

        {/* Python Setup — shared imports/data that run once per board.
            Labeled pill (not just an icon) to make the feature discoverable
            and distinct from the Terminal-icon Python env picker next to it. */}
        <button
          onClick={() => useUIStore.getState().openSetupEditor()}
          title="Python Setup — shared code that runs before every plot on this board (⌘;)"
          className={`flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-xs font-medium transition-colors ${
            board.setup?.code
              ? 'border-accent/40 bg-accent/10 text-accent hover:bg-accent/15'
              : 'border-toolbar-border text-gray-600 dark:text-on-surface-secondary hover:bg-toolbar-hover hover:text-gray-900 dark:hover:text-on-surface-primary'
          }`}
        >
          <Braces size={14} className="shrink-0" />
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
    </>
  );
}
