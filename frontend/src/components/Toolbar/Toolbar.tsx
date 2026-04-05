import { useCallback } from 'react';
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
  FolderOpen,
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
} from 'lucide-react';

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
  const insertMode = useUIStore(s => s.insertMode);
  const setInsertMode = useUIStore(s => s.setInsertMode);
  const closeBoard = useBoardStore(s => s.closeBoard);
  const setShowExportDialog = useUIStore(s => s.setShowExportDialog);
  const setSelectedIds = useUIStore(s => s.setSelectedIds);

  const hasSelection = selectedIds.length > 0;
  const multiSelect = selectedIds.length >= 2;

  const showInsertPanel = useUIStore(s => s.showInsertPanel);
  const toggleInsertPanel = useUIStore(s => s.toggleInsertPanel);

  const handleShowFileBrowser = useCallback(() => {
    // Ensure the insert panel (which contains the file browser) is visible
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
    const el = useBoardStore.getState().addElement('rectangle', {
      width: 200,
      height: 150,
    });
    useUIStore.getState().setSelectedIds([el.id]);
  }, []);

  const handleInsertArrow = useCallback(() => {
    const el = useBoardStore.getState().addElement('arrow', {
      width: 200,
      height: 4,
    });
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

  const ToolButton = ({ onClick, icon: Icon, title, active, disabled }: {
    onClick: () => void;
    icon: any;
    title: string;
    active?: boolean;
    disabled?: boolean;
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
      }`}
    >
      <Icon size={16} />
    </button>
  );

  const Separator = () => <div className="w-px h-5 bg-toolbar-border mx-0.5" />;

  return (
    <div className="h-10 bg-toolbar-bg border-b border-toolbar-border flex items-center px-2 gap-0.5 select-none shrink-0">
      {/* Board actions */}
      <ToolButton onClick={() => closeBoard()} icon={FolderOpen} title="Close Board" />
      <ToolButton onClick={() => saveBoard()} icon={Save} title="Save (Cmd+S)" disabled={!isDirty} />

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
      <ToolButton onClick={() => setZoom(zoom - 0.1)} icon={ZoomOut} title="Zoom Out" />
      <span className="text-xs text-gray-500 w-12 text-center tabular-nums">
        {Math.round(zoom * 100)}%
      </span>
      <ToolButton onClick={() => setZoom(zoom + 0.1)} icon={ZoomIn} title="Zoom In" />
      <ToolButton onClick={() => setZoom(1)} icon={Maximize} title="Reset Zoom" />

      <Separator />

      {/* Export */}
      <ToolButton onClick={() => setShowExportDialog(true)} icon={Download} title="Export" />

      {/* Dirty indicator */}
      {isDirty && (
        <div className="ml-1 w-2 h-2 rounded-full bg-amber-400" title="Unsaved changes" />
      )}
    </div>
  );
}
