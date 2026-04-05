import { useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
  type Node,
  type NodeChange,
  type OnNodesChange,
  applyNodeChanges,
  SelectionMode,
  Panel,
  useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { nodeTypes } from '@/components/nodes';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import type { BoardElement } from '@/types/board';
import { useEffect } from 'react';

function elementToNode(element: BoardElement): Node {
  return {
    id: element.id,
    type: element.type === 'group' ? 'rectangle' : element.type,
    position: { x: element.x, y: element.y },
    data: { elementId: element.id },
    width: element.width,
    height: element.height,
    style: {
      width: element.width,
      height: element.height,
    },
    zIndex: element.z_index,
    draggable: !element.locked,
    selectable: true,
    hidden: !element.visible,
  };
}

export function Canvas() {
  const board = useBoardStore(s => s.board);
  const updateElement = useBoardStore(s => s.updateElement);
  const pushHistory = useBoardStore(s => s.pushHistory);
  const addElement = useBoardStore(s => s.addElement);

  const setSelectedIds = useUIStore(s => s.setSelectedIds);
  const setZoom = useUIStore(s => s.setZoom);
  const insertMode = useUIStore(s => s.insertMode);
  const setInsertMode = useUIStore(s => s.setInsertMode);

  const dragStartRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Use React Flow's own state management
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<Node>([]);

  // Sync board elements → RF nodes when board changes
  const prevBoardRef = useRef<string>('');
  useEffect(() => {
    if (!board) {
      setNodes([]);
      return;
    }

    // Build a fingerprint to detect real board changes vs RF-triggered re-renders
    const fingerprint = board.elements
      .map(el => `${el.id}:${el.x}:${el.y}:${el.width}:${el.height}:${el.z_index}:${el.visible}:${el.locked}:${el.type}:${el.source?.path || ''}:${el.text || ''}`)
      .join('|');

    if (fingerprint !== prevBoardRef.current) {
      prevBoardRef.current = fingerprint;
      const newNodes = board.elements
        .filter(el => el.visible)
        .sort((a, b) => a.z_index - b.z_index)
        .map(elementToNode);
      setNodes(newNodes);
    }
  }, [board, setNodes]);

  const onNodesChange: OnNodesChange = useCallback((changes: NodeChange[]) => {
    // Let RF handle all changes internally (selection, dimensions, etc.)
    onNodesChangeBase(changes);

    if (!board) return;

    for (const change of changes) {
      if (change.type === 'position' && change.position && change.id) {
        const el = board.elements.find(e => e.id === change.id);
        if (el && !el.locked) {
          if (change.dragging && !dragStartRef.current.has(change.id)) {
            dragStartRef.current.set(change.id, { x: el.x, y: el.y });
          }

          let x = change.position.x;
          let y = change.position.y;

          if (board.canvas.snap_enabled) {
            const snap = board.canvas.snap_size || board.canvas.grid_size;
            x = Math.round(x / snap) * snap;
            y = Math.round(y / snap) * snap;
          }

          updateElement(change.id, { x, y });

          if (!change.dragging && dragStartRef.current.has(change.id)) {
            pushHistory('Move');
            dragStartRef.current.delete(change.id);
          }
        }
      }

      if (change.type === 'dimensions' && change.id && change.dimensions) {
        const el = board.elements.find(e => e.id === change.id);
        if (el && !el.locked) {
          updateElement(change.id, {
            width: change.dimensions.width,
            height: change.dimensions.height,
          });
        }
      }
    }
  }, [board, onNodesChangeBase, updateElement, pushHistory]);

  const onSelectionChange = useCallback(({ nodes: selectedNodes }: { nodes: Node[] }) => {
    setSelectedIds(selectedNodes.map(n => n.id));
  }, [setSelectedIds]);

  const onPaneClick = useCallback(() => {
    if (insertMode) {
      if (insertMode === 'text') {
        const el = addElement('text', { text: 'Label', width: 100, height: 32 });
        setSelectedIds([el.id]);
      } else if (insertMode === 'rectangle') {
        const el = addElement('rectangle', { width: 200, height: 150 });
        setSelectedIds([el.id]);
      } else if (insertMode === 'arrow') {
        const el = addElement('arrow', { width: 200, height: 4 });
        setSelectedIds([el.id]);
      }
      setInsertMode(null);
    }
  }, [insertMode, addElement, setSelectedIds, setInsertMode]);

  const onMoveEnd = useCallback((_event: any, viewport: { zoom: number }) => {
    setZoom(viewport.zoom);
  }, [setZoom]);

  if (!board) {
    return (
      <div className="flex-1 flex items-center justify-center bg-canvas-bg text-gray-400">
        <div className="text-center">
          <div className="text-lg font-medium mb-2">No board open</div>
          <div className="text-sm">Create or open a board to get started</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 relative">
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onSelectionChange={onSelectionChange}
        onPaneClick={onPaneClick}
        onMoveEnd={onMoveEnd}
        selectionMode={SelectionMode.Partial}
        selectNodesOnDrag={false}
        selectionOnDrag
        panOnDrag={false}
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        minZoom={0.1}
        maxZoom={5}
        fitView
        snapToGrid={board.canvas.snap_enabled}
        snapGrid={[board.canvas.grid_size, board.canvas.grid_size]}
        deleteKeyCode={null}
        multiSelectionKeyCode="Shift"
        className="bg-canvas-bg"
        proOptions={{ hideAttribution: true }}
      >
        {board.canvas.grid_enabled && (
          <>
            <Background
              id="grid-minor"
              variant={BackgroundVariant.Dots}
              gap={board.canvas.grid_size}
              size={3}
              color="#d1d5db"
            />
            <Background
              id="grid-major"
              variant={BackgroundVariant.Dots}
              gap={board.canvas.grid_size * 5}
              size={6}
              color="#9ca3af"
            />
          </>
        )}
        <MiniMap
          position="bottom-right"
          style={{ width: 140, height: 90 }}
          maskColor="rgba(0,0,0,0.08)"
          nodeColor="#94a3b8"
          pannable
          zoomable
        />
        <Panel position="top-left">
          <div className="text-2xs text-gray-400 bg-white/60 px-1.5 py-0.5 rounded">
            {board.canvas.width} x {board.canvas.height}
          </div>
        </Panel>
      </ReactFlow>

      {insertMode && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-accent text-white px-3 py-1 rounded text-xs shadow-lg">
          Click to place {insertMode} — ESC to cancel
        </div>
      )}
    </div>
  );
}
