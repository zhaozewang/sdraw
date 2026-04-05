import { useCallback, useState } from 'react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
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
  Grid3x3,
  Magnet,
  Download,
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
} from 'lucide-react';

function SavePromptDialog({ onSave, onDiscard, onCancel }: {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-white rounded-lg shadow-xl w-[360px]" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-800">Unsaved Changes</h2>
        </div>
        <div className="px-4 py-4">
          <p className="text-sm text-gray-600">You have unsaved changes. Would you like to save before leaving?</p>
        </div>
        <div className="px-4 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onDiscard} className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded">
            Don't Save
          </button>
          <button onClick={onCancel} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded">
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

  const showInsertPanel = useUIStore(s => s.showInsertPanel);
  const toggleInsertPanel = useUIStore(s => s.toggleInsertPanel);
  const showInspector = useUIStore(s => s.showInspector);
  const toggleInspector = useUIStore(s => s.toggleInspector);

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

  const handleDiscardAndLeave = useCallback(() => {
    setShowSavePrompt(false);
    closeBoard();
  }, [closeBoard]);

  const handleShowFileBrowser = useCallback(() => {
    if (!useUIStore.getState().showInsertPanel) {
      useUIStore.getState().toggleInsertPanel();
    }
  }, []);

  const handleInsertText = useCallback(() => {
    const el = useBoardStore.getState().addElement('text', {
      text: 'Label',
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
          ? 'text-gray-300 cursor-not-allowed'
          : 'text-gray-600 hover:bg-toolbar-hover hover:text-gray-900'
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
          className="p-1 rounded text-gray-600 hover:bg-toolbar-hover transition-colors shrink-0"
        >
          <img src="/logo_title_zoomed_in.png" alt="sDraw" style={{ height: 50, paddingTop: 8, paddingBottom: 14 }} className="object-contain" />
        </button>


        {/* Board name (editable) */}
        <div className="flex items-center mx-1">
          <input
            type="text"
            value={board.name}
            onChange={e => useBoardStore.getState().setBoardName(e.target.value)}
            className="text-xs text-gray-700 bg-transparent border border-gray-200 rounded px-1.5 py-0.5 hover:border-gray-300 focus:border-accent focus:outline-none w-28 min-w-[50px] truncate"
            title={`${board.name}.sdraw`}
          />
          <span className="text-2xs text-gray-400 shrink-0 ml-0.5">.sdraw</span>
        </div>

        {/* File actions */}
        <ToolButton onClick={() => saveBoard()} icon={Save} title="Save (Cmd+S)" disabled={!isDirty} />
        <ToolButton onClick={() => setShowExportDialog(true)} icon={Download} title="Export" />

        <Separator />

        {/* Undo/Redo */}
        <ToolButton onClick={undo} icon={Undo2} title="Undo (Cmd+Z)" disabled={historyIndex <= 0} />
        <ToolButton onClick={redo} icon={Redo2} title="Redo (Cmd+Shift+Z)" disabled={historyIndex >= historyLength - 1} />

        <Separator />

        {/* Insert tools */}
        <ToolButton onClick={handleShowFileBrowser} icon={Image} title="Browse & Insert Image" active={showInsertPanel} />
        <ToolButton onClick={handleInsertText} icon={Type} title="Insert Text" />
        <ToolButton onClick={handleInsertRect} icon={Square} title="Insert Rectangle" />
        <ToolButton onClick={handleInsertArrow} icon={ArrowRight} title="Insert Arrow" />

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

        {/* Zoom */}
        <ToolButton onClick={() => {
          const fn = useUIStore.getState().zoomTo;
          if (fn) fn(zoom - 0.1);
        }} icon={ZoomOut} title="Zoom Out" />
        <span className="text-xs text-gray-500 w-12 text-center tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <ToolButton onClick={() => {
          const fn = useUIStore.getState().zoomTo;
          if (fn) fn(zoom + 0.1);
        }} icon={ZoomIn} title="Zoom In" />
        <ToolButton onClick={() => {
          const fn = useUIStore.getState().fitView;
          if (fn) fn();
        }} icon={Maximize} title="Fit View" />

        {/* Dirty indicator */}
        {isDirty && (
          <div className="ml-1 w-2 h-2 rounded-full bg-amber-400" title="Unsaved changes" />
        )}
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
