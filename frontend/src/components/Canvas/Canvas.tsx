import { useCallback, useRef, useState, useEffect as useEffectReact } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
  type Node,
  type NodeChange,
  type OnNodesChange,
  SelectionMode,
  Panel,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { nodeTypes } from '@/components/nodes';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import type { BoardElement } from '@/types/board';
import { useEffect } from 'react';
import {
  computeAlignmentGuides,
  type GuideLine,
  type SpacingIndicator,
  type Rect,
} from '@/utils/alignmentGuides';

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

/** Renders alignment guide lines and spacing indicators as an SVG overlay. */
function AlignmentOverlay({
  guides,
  spacing,
  zoom,
}: {
  guides: GuideLine[];
  spacing: SpacingIndicator[];
  zoom: number;
}) {
  if (guides.length === 0 && spacing.length === 0) return null;

  return (
    <svg className="pointer-events-none absolute inset-0 w-full h-full overflow-visible" style={{ zIndex: 9999 }}>
      <defs>
        <pattern id="guide-dash" patternUnits="userSpaceOnUse" width="8" height="1">
          <rect width="4" height="1" fill="#f43f5e" />
        </pattern>
      </defs>

      {/* Alignment guide lines — thin dashed, constant screen width */}
      {guides.map((g, i) => {
        const sw = 0.5 / zoom;
        const dash = `${4 / zoom} ${3 / zoom}`;
        if (g.orientation === 'vertical') {
          return (
            <line
              key={`g-${i}`}
              x1={g.position}
              y1={g.from}
              x2={g.position}
              y2={g.to}
              stroke="#f43f5e"
              strokeWidth={sw}
              strokeDasharray={dash}
            />
          );
        } else {
          return (
            <line
              key={`g-${i}`}
              x1={g.from}
              y1={g.position}
              x2={g.to}
              y2={g.position}
              stroke="#f43f5e"
              strokeWidth={sw}
              strokeDasharray={dash}
            />
          );
        }
      })}

      {/* Equal spacing indicators */}
      {spacing.map((s, i) => {
        const lw = 0.8 / zoom;
        const fontSize = 8 / zoom;
        const arrowSize = 2.5 / zoom;
        if (s.orientation === 'horizontal') {
          const x1 = s.x;
          const x2 = s.x + s.length;
          const y = s.y;
          return (
            <g key={`s-${i}`}>
              {/* Line */}
              <line x1={x1} y1={y} x2={x2} y2={y} stroke="#8b5cf6" strokeWidth={lw} />
              {/* Arrows */}
              <polygon points={`${x1},${y} ${x1 + arrowSize},${y - arrowSize} ${x1 + arrowSize},${y + arrowSize}`} fill="#8b5cf6" />
              <polygon points={`${x2},${y} ${x2 - arrowSize},${y - arrowSize} ${x2 - arrowSize},${y + arrowSize}`} fill="#8b5cf6" />
              {/* Label */}
              <text
                x={(x1 + x2) / 2}
                y={y - 4 / zoom}
                textAnchor="middle"
                fill="#8b5cf6"
                fontSize={fontSize}
                fontFamily="system-ui, sans-serif"
              >
                {s.gap}
              </text>
            </g>
          );
        } else {
          const y1 = s.y;
          const y2 = s.y + s.length;
          const x = s.x;
          return (
            <g key={`s-${i}`}>
              <line x1={x} y1={y1} x2={x} y2={y2} stroke="#8b5cf6" strokeWidth={lw} />
              <polygon points={`${x},${y1} ${x - arrowSize},${y1 + arrowSize} ${x + arrowSize},${y1 + arrowSize}`} fill="#8b5cf6" />
              <polygon points={`${x},${y2} ${x - arrowSize},${y2 - arrowSize} ${x + arrowSize},${y2 - arrowSize}`} fill="#8b5cf6" />
              <text
                x={x + 6 / zoom}
                y={(y1 + y2) / 2 + fontSize / 3}
                fill="#8b5cf6"
                fontSize={fontSize}
                fontFamily="system-ui, sans-serif"
              >
                {s.gap}
              </text>
            </g>
          );
        }
      })}
    </svg>
  );
}

export function Canvas() {
  const board = useBoardStore(s => s.board);
  const updateElement = useBoardStore(s => s.updateElement);
  const pushHistory = useBoardStore(s => s.pushHistory);
  const addElement = useBoardStore(s => s.addElement);

  const setSelectedIds = useUIStore(s => s.setSelectedIds);
  const setZoom = useUIStore(s => s.setZoom);
  const zoom = useUIStore(s => s.zoom);
  const insertMode = useUIStore(s => s.insertMode);
  const setInsertMode = useUIStore(s => s.setInsertMode);

  const reactFlow = useReactFlow();
  const setZoomTo = useUIStore(s => s.setZoomTo);
  const setFitViewFn = useUIStore(s => s.setFitView);

  // Register zoom/fitView callbacks for toolbar
  useEffectReact(() => {
    setZoomTo((z: number) => {
      reactFlow.zoomTo(z, { duration: 200 });
    });
    setFitViewFn(() => {
      reactFlow.fitView({ duration: 200 });
    });
    return () => {
      setZoomTo(null);
      setFitViewFn(null);
    };
  }, [reactFlow, setZoomTo, setFitViewFn]);

  const dragStartRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const alignedRef = useRef(false); // track if alignment snap was active
  const [guides, setGuides] = useState<GuideLine[]>([]);
  const [spacing, setSpacing] = useState<SpacingIndicator[]>([]);

  // Use React Flow's own state management
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<Node>([]);

  // Sync board elements → RF nodes when board changes
  const prevBoardRef = useRef<string>('');
  const prevPosRef = useRef<string>('');
  const prevZRef = useRef<string>('');
  useEffect(() => {
    if (!board) {
      setNodes([]);
      return;
    }

    // Skip sync entirely during endpoint drags
    if (useUIStore.getState().suppressPositionSync) return;

    // Structural fingerprint: things that require a full node rebuild
    const structFingerprint = board.elements
      .map(el => `${el.id}:${el.visible}:${el.locked}:${el.type}:${el.source?.path || ''}:${el.text || ''}`)
      .join('|');
    // Position/size fingerprint
    const posFingerprint = board.elements
      .map(el => `${el.id}:${el.x}:${el.y}:${el.width}:${el.height}`)
      .join('|');
    const zFingerprint = board.elements.map(el => `${el.id}:${el.z_index}`).join('|');

    if (structFingerprint !== prevBoardRef.current) {
      // Full rebuild needed (element added/removed, type changed, etc.)
      prevBoardRef.current = structFingerprint;
      prevPosRef.current = posFingerprint;
      prevZRef.current = zFingerprint;
      const newNodes = board.elements
        .filter(el => el.visible)
        .sort((a, b) => a.z_index - b.z_index)
        .map(elementToNode);
      setNodes(newNodes);
    } else {
      // In-place updates that preserve selection
      let needsUpdate = false;
      const posChanged = posFingerprint !== prevPosRef.current;
      const zChanged = zFingerprint !== prevZRef.current;
      if (posChanged || zChanged) {
        prevPosRef.current = posFingerprint;
        prevZRef.current = zFingerprint;
        setNodes(nds => {
          let updated = nds.map(n => {
            const el = board.elements.find(e => e.id === n.id);
            if (!el) return n;
            return {
              ...n,
              position: { x: el.x, y: el.y },
              width: el.width,
              height: el.height,
              style: { width: el.width, height: el.height },
              zIndex: el.z_index,
            };
          });
          if (zChanged) {
            updated = updated.sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
          }
          return updated;
        });
      }
    }
  }, [board, setNodes]);

  const onNodesChange: OnNodesChange = useCallback((changes: NodeChange[]) => {
    onNodesChangeBase(changes);

    if (!board) return;
    if (useUIStore.getState().suppressPositionSync) return;

    let isDragging = false;

    for (const change of changes) {
      if (change.type === 'position' && change.position && change.id) {
        const el = board.elements.find(e => e.id === change.id);
        if (el && !el.locked) {
          if (change.dragging && !dragStartRef.current.has(change.id)) {
            dragStartRef.current.set(change.id, { x: el.x, y: el.y });
          }

          let x = change.position.x;
          let y = change.position.y;

          if (change.dragging) {
            isDragging = true;

            // Compute alignment guides
            const draggingRect: Rect = {
              id: change.id,
              x,
              y,
              width: el.width,
              height: el.height,
            };
            const otherRects: Rect[] = board.elements
              .filter(e => e.id !== change.id && e.visible)
              .map(e => ({ id: e.id, x: e.x, y: e.y, width: e.width, height: e.height }));

            const result = computeAlignmentGuides(draggingRect, otherRects);

            // If alignment snapped, use that position; otherwise fall back to grid snap
            const didAlignX = result.snappedX !== x;
            const didAlignY = result.snappedY !== y;
            x = result.snappedX;
            y = result.snappedY;

            if (!didAlignX && board.canvas.snap_enabled) {
              const snap = board.canvas.grid_size;
              x = Math.round(x / snap) * snap;
            }
            if (!didAlignY && board.canvas.snap_enabled) {
              const snap = board.canvas.grid_size;
              y = Math.round(y / snap) * snap;
            }

            alignedRef.current = didAlignX || didAlignY;
            setGuides(result.guides);
            setSpacing(result.spacing);
          }

          updateElement(change.id, { x, y });

          if (!change.dragging && dragStartRef.current.has(change.id)) {
            pushHistory('Move');
            dragStartRef.current.delete(change.id);
            alignedRef.current = false;
            setGuides([]);
            setSpacing([]);
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
        snapToGrid={false}
        elevateNodesOnSelect={false}
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
              size={5}
              color="#9ca3af"
            />
          </>
        )}

        {/* Alignment guides overlay — rendered inside React Flow's viewport so it transforms with zoom/pan */}
        <Panel position="top-left" style={{ margin: 0, padding: 0, position: 'absolute', inset: 0, pointerEvents: 'none', width: '100%', height: '100%' }}>
          <AlignmentOverlay guides={guides} spacing={spacing} zoom={zoom} />
        </Panel>

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
