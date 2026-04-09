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
import { findSnapTarget, toRelativeAnchor } from '@/utils/snapToShape';

function elementToNode(element: BoardElement): Node {
  // Arrow nodes and unfilled shapes need pointer-events:none on the wrapper
  // so that clicks in empty space pass through. The SVG content inside
  // handles its own click events to trigger selection.
  const isArrow = element.type === 'arrow';
  const isPen = element.type === 'pen';
  const shape = element.metadata?.shape as string | undefined;
  const isNonRectShape = element.type === 'rectangle'
    && (shape === 'triangle' || shape === 'diamond');
  const passThrough = isArrow || isPen || isNonRectShape;

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
      ...(passThrough ? { pointerEvents: 'none' as const } : {}),
    },
    zIndex: element.z_index,
    draggable: !element.locked && !passThrough,
    selectable: !passThrough,
    hidden: !element.visible,
  };
}

/** Renders alignment guide lines and spacing indicators as an SVG overlay.
 *  Uses the viewport transform to convert canvas coords to screen coords. */
function AlignmentOverlay({
  guides,
  spacing,
}: {
  guides: GuideLine[];
  spacing: SpacingIndicator[];
}) {
  // Read the viewport transform directly from the DOM
  const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null;
  if (!viewport) return null;
  const transform = viewport.style.transform;
  const match = transform.match(/translate\((.+?)px,\s*(.+?)px\)\s*scale\((.+?)\)/);
  if (!match) return null;
  const tx = parseFloat(match[1]);
  const ty = parseFloat(match[2]);
  const scale = parseFloat(match[3]);

  if (guides.length === 0 && spacing.length === 0) return null;

  // Convert canvas coord to screen coord
  const toScreen = (cx: number, cy: number) => ({
    x: cx * scale + tx,
    y: cy * scale + ty,
  });

  return (
    <svg className="pointer-events-none absolute inset-0 w-full h-full overflow-visible" style={{ zIndex: 9999 }}>
      {/* Alignment guide lines */}
      {guides.map((g, i) => {
        if (g.orientation === 'vertical') {
          const p1 = toScreen(g.position, g.from);
          const p2 = toScreen(g.position, g.to);
          return (
            <line
              key={`g-${i}`}
              x1={p1.x} y1={p1.y}
              x2={p2.x} y2={p2.y}
              stroke="#f43f5e"
              strokeWidth={0.5}
              strokeDasharray="4 3"
            />
          );
        } else {
          const p1 = toScreen(g.from, g.position);
          const p2 = toScreen(g.to, g.position);
          return (
            <line
              key={`g-${i}`}
              x1={p1.x} y1={p1.y}
              x2={p2.x} y2={p2.y}
              stroke="#f43f5e"
              strokeWidth={0.5}
              strokeDasharray="4 3"
            />
          );
        }
      })}

      {/* Equal spacing indicators */}
      {spacing.map((s, i) => {
        const arrowSize = 3;
        const fontSize = 9;
        if (s.orientation === 'horizontal') {
          const p1 = toScreen(s.x, s.y);
          const p2 = toScreen(s.x + s.length, s.y);
          const mid = toScreen(s.x + s.length / 2, s.y);
          return (
            <g key={`s-${i}`}>
              <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#8b5cf6" strokeWidth={0.8} />
              <polygon points={`${p1.x},${p1.y} ${p1.x + arrowSize},${p1.y - arrowSize} ${p1.x + arrowSize},${p1.y + arrowSize}`} fill="#8b5cf6" />
              <polygon points={`${p2.x},${p2.y} ${p2.x - arrowSize},${p2.y - arrowSize} ${p2.x - arrowSize},${p2.y + arrowSize}`} fill="#8b5cf6" />
              <text x={mid.x} y={mid.y - 4} textAnchor="middle" fill="#8b5cf6" fontSize={fontSize} fontFamily="system-ui, sans-serif">
                {s.gap}
              </text>
            </g>
          );
        } else {
          const p1 = toScreen(s.x, s.y);
          const p2 = toScreen(s.x, s.y + s.length);
          const mid = toScreen(s.x, s.y + s.length / 2);
          return (
            <g key={`s-${i}`}>
              <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#8b5cf6" strokeWidth={0.8} />
              <polygon points={`${p1.x},${p1.y} ${p1.x - arrowSize},${p1.y + arrowSize} ${p1.x + arrowSize},${p1.y + arrowSize}`} fill="#8b5cf6" />
              <polygon points={`${p2.x},${p2.y} ${p2.x - arrowSize},${p2.y - arrowSize} ${p2.x + arrowSize},${p2.y - arrowSize}`} fill="#8b5cf6" />
              <text x={mid.x + 6} y={mid.y + fontSize / 3} fill="#8b5cf6" fontSize={fontSize} fontFamily="system-ui, sans-serif">
                {s.gap}
              </text>
            </g>
          );
        }
      })}
    </svg>
  );
}

/** Dashed selection box overlay shown during drag-to-draw */
function DrawPreview({ rect }: { rect: { x: number; y: number; w: number; h: number } }) {
  const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null;
  if (!viewport) return null;
  const transform = viewport.style.transform;
  const match = transform.match(/translate\((.+?)px,\s*(.+?)px\)\s*scale\((.+?)\)/);
  if (!match) return null;
  const tx = parseFloat(match[1]);
  const ty = parseFloat(match[2]);
  const scale = parseFloat(match[3]);
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: rect.x * scale + tx,
        top: rect.y * scale + ty,
        width: rect.w * scale,
        height: rect.h * scale,
        border: '1.5px dashed #3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.05)',
        zIndex: 9998,
      }}
    />
  );
}

/** Glowing outline on snap target shape */
function SnapHighlight({ elementId }: { elementId: string }) {
  const element = useBoardStore(s => s.board?.elements.find(el => el.id === elementId));
  if (!element) return null;

  const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null;
  if (!viewport) return null;
  const transform = viewport.style.transform;
  const match = transform.match(/translate\((.+?)px,\s*(.+?)px\)\s*scale\((.+?)\)/);
  if (!match) return null;
  const tx = parseFloat(match[1]);
  const ty = parseFloat(match[2]);
  const scale = parseFloat(match[3]);

  const { x, y, width: w, height: h, style, metadata } = element;
  const shape = metadata?.shape as string | undefined;
  const br = style.borderRadius ?? 0;

  // Build SVG path for the shape outline
  let shapePath: string;
  if (shape === 'diamond') {
    shapePath = `M${w / 2},0 L${w},${h / 2} L${w / 2},${h} L0,${h / 2}Z`;
  } else if (shape === 'triangle') {
    shapePath = `M${w / 2},0 L${w},${h} L0,${h}Z`;
  } else if (br >= Math.min(w, h) / 2) {
    // Ellipse
    const rx = w / 2, ry = h / 2;
    shapePath = `M${rx},0 A${rx},${ry} 0 1,1 ${rx},${h} A${rx},${ry} 0 1,1 ${rx},0Z`;
  } else {
    // Rectangle (possibly rounded)
    const r = Math.min(br, w / 2, h / 2);
    if (r > 0) {
      shapePath = `M${r},0 L${w - r},0 Q${w},0 ${w},${r} L${w},${h - r} Q${w},${h} ${w - r},${h} L${r},${h} Q0,${h} 0,${h - r} L0,${r} Q0,0 ${r},0Z`;
    } else {
      shapePath = `M0,0 L${w},0 L${w},${h} L0,${h}Z`;
    }
  }

  return (
    <svg
      className="absolute pointer-events-none"
      style={{
        left: x * scale + tx,
        top: y * scale + ty,
        width: w * scale,
        height: h * scale,
        zIndex: 9999,
        overflow: 'visible',
      }}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
    >
      {/* Subtle glow */}
      <path
        d={shapePath}
        fill="none"
        stroke="rgba(59, 130, 246, 0.2)"
        strokeWidth={4 / scale}
        vectorEffect="non-scaling-stroke"
      />
      {/* Bright edge */}
      <path
        d={shapePath}
        fill="none"
        stroke="#3b82f6"
        strokeWidth={1.5 / scale}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function Canvas() {
  const board = useBoardStore(s => s.board);
  const updateElement = useBoardStore(s => s.updateElement);
  const pushHistory = useBoardStore(s => s.pushHistory);
  const addElement = useBoardStore(s => s.addElement);

  // Stable ref for board so onNodesChange doesn't recreate on every board update
  const boardRef = useRef(board);
  boardRef.current = board;

  const setSelectedIds = useUIStore(s => s.setSelectedIds);
  const setZoom = useUIStore(s => s.setZoom);
  const zoom = useUIStore(s => s.zoom);
  const insertMode = useUIStore(s => s.insertMode);
  const setInsertMode = useUIStore(s => s.setInsertMode);
  const insertPayload = useUIStore(s => s.insertPayload);
  const setInsertPayload = useUIStore(s => s.setInsertPayload);
  const snapTargetId = useUIStore(s => s.snapTargetId);
  const theme = useUIStore(s => s.theme);
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

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

  // Drag-to-draw state
  const drawStartRef = useRef<{ canvasX: number; canvasY: number } | null>(null);
  const [drawPreview, setDrawPreview] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Use React Flow's own state management
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<Node>([]);

  // When suppressPositionSync turns off, invalidate fingerprints to force a full sync
  const suppressPositionSync = useUIStore(s => s.suppressPositionSync);
  useEffectReact(() => {
    if (!suppressPositionSync) {
      // Reset fingerprints so the next sync picks up the final state
      prevPosRef.current = '';
    }
  }, [suppressPositionSync]);

  // Sync board elements → RF nodes when board changes
  const prevBoardRef = useRef<string>('');
  const prevPosRef = useRef<string>('');
  const prevZRef = useRef<string>('');
  useEffect(() => {
    if (!board) {
      setNodes([]);
      return;
    }

    // Skip sync entirely during endpoint drags / resizes
    if (useUIStore.getState().suppressPositionSync) return;

    // Structural fingerprint: things that require a full node rebuild
    const structFingerprint = board.elements
      .map(el => `${el.id}:${el.visible}:${el.locked}:${el.type}:${el.source?.path || ''}:${el.text || ''}:${el.metadata?.shape || ''}:${el.style?.fill || ''}`)
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

    const b = boardRef.current;
    if (!b) return;
    if (useUIStore.getState().suppressPositionSync) return;

    let isDragging = false;

    for (const change of changes) {
      if (change.type === 'position' && change.position && change.id) {
        let el = b.elements.find(e => e.id === change.id);
        // If this element belongs to a group, move the group instead
        const groupId = el?.metadata?.groupId as string | undefined;
        if (groupId) {
          const groupEl = b.elements.find(e => e.id === groupId);
          if (groupEl) {
            const dx = change.position.x - (el?.x ?? 0);
            const dy = change.position.y - (el?.y ?? 0);
            if (!groupEl.locked && (dx !== 0 || dy !== 0)) {
              updateElement(groupId, { x: groupEl.x + dx, y: groupEl.y + dy });
            }
            continue;
          }
        }
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
            const otherRects: Rect[] = b.elements
              .filter(e => e.id !== change.id && e.visible)
              .map(e => ({ id: e.id, x: e.x, y: e.y, width: e.width, height: e.height }));

            const result = computeAlignmentGuides(draggingRect, otherRects);

            // If alignment snapped, use that position; otherwise fall back to grid snap
            const didAlignX = result.snappedX !== x;
            const didAlignY = result.snappedY !== y;
            x = result.snappedX;
            y = result.snappedY;

            if (!didAlignX && b.canvas.snap_enabled) {
              const snap = b.canvas.grid_size;
              x = Math.round(x / snap) * snap;
            }
            if (!didAlignY && b.canvas.snap_enabled) {
              const snap = b.canvas.grid_size;
              y = Math.round(y / snap) * snap;
            }

            alignedRef.current = didAlignX || didAlignY;
            setGuides(result.guides);
            setSpacing(result.spacing);
          }

          updateElement(change.id, { x, y });

          // Auto-update connected arrow endpoints when a shape moves
          if (change.dragging) {
            useBoardStore.getState().updateConnectedArrows(change.id);
          }

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
        const el = b.elements.find(e => e.id === change.id);
        if (el && !el.locked) {
          // Skip no-op dimension updates (React Flow fires these on initial measure)
          const newW = change.dimensions.width;
          const newH = change.dimensions.height;
          if (Math.abs(el.width - newW) > 0.5 || Math.abs(el.height - newH) > 0.5) {
            updateElement(change.id, { width: newW, height: newH });
          }
        }
      }
    }
  }, [onNodesChangeBase, updateElement, pushHistory]);

  // Track the drag-selection rectangle in canvas coordinates so we can
  // also select passthrough elements (arrows, triangles, diamonds) that
  // React Flow skips because they have selectable=false.
  const selectionRectRef = useRef<{ x: number; y: number; x2: number; y2: number } | null>(null);
  const { screenToFlowPosition } = useReactFlow();

  const onSelectionStart = useCallback((event: React.MouseEvent) => {
    // Record the starting corner in flow/canvas coordinates
    const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    selectionRectRef.current = { x: pos.x, y: pos.y, x2: pos.x, y2: pos.y };
  }, [screenToFlowPosition]);

  const onSelectionEnd = useCallback((event: React.MouseEvent) => {
    if (selectionRectRef.current) {
      const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      selectionRectRef.current.x2 = pos.x;
      selectionRectRef.current.y2 = pos.y;
    }
  }, [screenToFlowPosition]);

  const onSelectionChange = useCallback(({ nodes: selectedNodes }: { nodes: Node[] }) => {
    const b = boardRef.current;
    if (!b) return;

    // If a child of a group is selected, select the group instead
    const ids = selectedNodes.map(n => {
      const el = b.elements.find(e => e.id === n.id);
      if (el?.metadata?.groupId) {
        return el.metadata.groupId as string;
      }
      return n.id;
    });

    // Also include passthrough nodes (arrows, triangles, diamonds) that overlap
    // the selection bounds. React Flow skips them because selectable=false.
    // Use the tracked drag rectangle when available (covers the full area the
    // user dragged, not just the bounds of already-selected nodes).
    const rect = selectionRectRef.current;
    const hasDragRect = rect && (rect.x !== rect.x2 || rect.y !== rect.y2);

    let selMinX: number, selMinY: number, selMaxX: number, selMaxY: number;
    if (hasDragRect) {
      selMinX = Math.min(rect.x, rect.x2);
      selMinY = Math.min(rect.y, rect.y2);
      selMaxX = Math.max(rect.x, rect.x2);
      selMaxY = Math.max(rect.y, rect.y2);
    } else if (selectedNodes.length >= 1) {
      selMinX = Math.min(...selectedNodes.map(n => n.position.x));
      selMinY = Math.min(...selectedNodes.map(n => n.position.y));
      selMaxX = Math.max(...selectedNodes.map(n => n.position.x + (n.width || 0)));
      selMaxY = Math.max(...selectedNodes.map(n => n.position.y + (n.height || 0)));
    } else {
      setSelectedIds([]);
      return;
    }

    for (const el of b.elements) {
      if (ids.includes(el.id)) continue;
      if (!el.visible) continue;
      const isArrow = el.type === 'arrow';
      const isPenEl = el.type === 'pen';
      const shape = el.metadata?.shape as string | undefined;
      const isNonRect = el.type === 'rectangle' && (shape === 'triangle' || shape === 'diamond');
      if (!isArrow && !isPenEl && !isNonRect) continue;

      // For arrows, compute visual bounds including curve control points
      let eMinX = el.x, eMinY = el.y;
      let eMaxX = el.x + el.width, eMaxY = el.y + el.height;

      if (isArrow) {
        const pts = el.points && el.points.length >= 2
          ? el.points
          : [{ x: 0, y: el.height / 2 }, { x: el.width, y: el.height / 2 }];
        const storedCtrl = el.metadata?.controlPoints as Array<{ x: number; y: number }> | undefined;
        const lineType = (el.metadata?.lineType as string) || 'straight';
        // Auto-generate control points for curves (same logic as ArrowNode)
        let ctrl = storedCtrl || [];
        const hasCurve = lineType === 'quadratic' || lineType === 'cubic' || lineType === 'arc' || lineType === 'smooth';
        if (ctrl.length === 0 && hasCurve) {
          const p0 = pts[0], p1 = pts[1];
          const mx = (p0.x + p1.x) / 2;
          const my = (p0.y + p1.y) / 2;
          const dx = p1.x - p0.x;
          const dy = p1.y - p0.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const offX = (-dy / len) * len * 0.3;
          const offY = (dx / len) * len * 0.3;
          if (lineType === 'quadratic' || lineType === 'arc') {
            ctrl = [{ x: mx + offX, y: my + offY }];
          } else if (lineType === 'smooth') {
            ctrl = [{ x: mx + offX * 0.4, y: my + offY * 0.4 }];
          } else if (lineType === 'cubic') {
            ctrl = [
              { x: p0.x + dx * 0.25 + offX, y: p0.y + dy * 0.25 + offY },
              { x: p0.x + dx * 0.75 - offX, y: p0.y + dy * 0.75 - offY },
            ];
          }
        }
        // Expand bounds to include all points and control points
        for (const p of [...pts, ...ctrl]) {
          eMinX = Math.min(eMinX, el.x + p.x);
          eMinY = Math.min(eMinY, el.y + p.y);
          eMaxX = Math.max(eMaxX, el.x + p.x);
          eMaxY = Math.max(eMaxY, el.y + p.y);
        }
      }

      // AABB overlap check
      if (eMinX < selMaxX && eMaxX > selMinX && eMinY < selMaxY && eMaxY > selMinY) {
        ids.push(el.metadata?.groupId ? el.metadata.groupId as string : el.id);
      }
    }

    setSelectedIds([...new Set(ids)]);
  }, [setSelectedIds]);

  const onPaneClick = useCallback(() => {
    // Clear selection when clicking empty canvas
    if (!useUIStore.getState().insertPayload) {
      useUIStore.getState().setSelectedIds([]);
    }
  }, []);

  /** Convert client coords to canvas coords */
  const clientToCanvas = useCallback((clientX: number, clientY: number) => {
    const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null;
    if (!viewport) return null;
    const transform = viewport.style.transform;
    const match = transform.match(/translate\((.+?)px,\s*(.+?)px\)\s*scale\((.+?)\)/);
    if (!match) return null;
    const tx = parseFloat(match[1]);
    const ty = parseFloat(match[2]);
    const scale = parseFloat(match[3]);
    const container = viewport.parentElement!.getBoundingClientRect();
    return {
      x: (clientX - container.left - tx) / scale,
      y: (clientY - container.top - ty) / scale,
    };
  }, []);

  /** Pointer down on the wrapper — start drag-to-draw if in insert mode.
   *  Creates the element immediately so it renders live during drag. */
  const drawElementIdRef = useRef<string | null>(null);

  const handleDrawPointerDown = useCallback((e: React.PointerEvent) => {
    const payload = useUIStore.getState().insertPayload;
    if (!payload) return;

    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // Allow drawing on the pane or through passthrough nodes.
    // Reject clicks on interactive UI elements (minimap, panels, controls).
    if (target.closest('.react-flow__minimap') || target.closest('.react-flow__controls')) return;

    e.stopPropagation();
    e.preventDefault();

    const coords = clientToCanvas(e.clientX, e.clientY);
    if (!coords) return;

    const isRect = payload.type === 'rectangle';
    const isArrow = payload.type === 'arrow';
    const isPen = payload.type === 'pen';

    // Snap start point for arrows
    let startX = coords.x, startY = coords.y;
    let startSnapId: string | null = null;
    let endSnapId: string | null = null;
    if (isArrow) {
      const board = useBoardStore.getState().board;
      if (board) {
        const snap = findSnapTarget({ x: startX, y: startY }, board.elements, new Set());
        if (snap) {
          startX = snap.point.x; startY = snap.point.y; startSnapId = snap.elementId;
          useUIStore.getState().setSnapTargetId(startSnapId);
        }
      }
    }

    drawStartRef.current = { canvasX: startX, canvasY: startY };

    if (!isArrow && !isPen) {
      setDrawPreview({ x: coords.x, y: coords.y, w: 0, h: 0 });
    }

    const initialOverrides: any = {
      ...(payload.overrides || {}),
      x: Math.round(startX),
      y: Math.round(startY),
      width: 1,
      height: 1,
    };
    if (isArrow) {
      initialOverrides.points = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
    }
    if (isPen) {
      initialOverrides.points = [{ x: 0, y: 0 }];
    }
    const el = useBoardStore.getState().addElement(payload.type, initialOverrides);
    drawElementIdRef.current = el.id;
    useUIStore.getState().setSelectedIds([el.id]);

    const onMove = (ev: PointerEvent) => {
      const start = drawStartRef.current;
      const elId = drawElementIdRef.current;
      if (!start || !elId) return;
      const cur = clientToCanvas(ev.clientX, ev.clientY);
      if (!cur) return;

      if (isPen) {
        // Pen: just accumulate points relative to start position.
        // Don't recalculate bounding box during drawing — that shifts the
        // element origin and makes the stroke jump around. The bbox is
        // computed once on pointer up.
        const sx = start.canvasX, sy = start.canvasY;
        const newPt = { x: cur.x - sx, y: cur.y - sy };
        const el = useBoardStore.getState().board?.elements.find(e => e.id === elId);
        const pts = el?.points ? [...el.points, newPt] : [{ x: 0, y: 0 }, newPt];
        useBoardStore.getState().updateElement(elId, { points: pts });
      } else if (isArrow) {
        // Lines/arrows: start→end point logic with snap-to-shape
        const sx = start.canvasX, sy = start.canvasY;
        let ex = cur.x, ey = cur.y;

        // Snap end point to shape boundaries
        const board = useBoardStore.getState().board;
        endSnapId = null;
        if (board) {
          const excludeIds = new Set([elId]);
          const snap = findSnapTarget({ x: ex, y: ey }, board.elements, excludeIds);
          if (snap) { ex = snap.point.x; ey = snap.point.y; endSnapId = snap.elementId; }
        }
        useUIStore.getState().setSnapTargetId(endSnapId);

        const minX = Math.min(sx, ex);
        const minY = Math.min(sy, ey);
        const w = Math.max(Math.abs(ex - sx), 1);
        const h = Math.max(Math.abs(ey - sy), 1);

        useBoardStore.getState().updateElement(elId, {
          x: Math.round(minX), y: Math.round(minY),
          width: Math.round(w), height: Math.round(h),
          points: [
            { x: Math.round(sx - minX), y: Math.round(sy - minY) },
            { x: Math.round(ex - minX), y: Math.round(ey - minY) },
          ],
        });
      } else {
        // Rectangles: bounding box with optional square constraint
        let w = Math.abs(cur.x - start.canvasX);
        let h = Math.abs(cur.y - start.canvasY);

        if (isRect && !ev.shiftKey) {
          const side = Math.max(w, h);
          w = side;
          h = side;
        }

        const x = cur.x >= start.canvasX ? start.canvasX : start.canvasX - w;
        const y = cur.y >= start.canvasY ? start.canvasY : start.canvasY - h;

        useBoardStore.getState().updateElement(elId, {
          x: Math.round(x), y: Math.round(y),
          width: Math.max(1, Math.round(w)),
          height: Math.max(1, Math.round(h)),
        });
        setDrawPreview({ x, y, w, h });
      }
    };

    const onUp = (ev: PointerEvent) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);

      const start = drawStartRef.current;
      const elId = drawElementIdRef.current;
      drawStartRef.current = null;
      drawElementIdRef.current = null;
      setDrawPreview(null);

      if (!start || !elId) return;
      const cur = clientToCanvas(ev.clientX, ev.clientY);
      if (!cur) return;

      const dist = Math.sqrt((cur.x - start.canvasX) ** 2 + (cur.y - start.canvasY) ** 2);
      const MIN_DRAW = 10;

      if (dist < MIN_DRAW) {
        if (isPen) {
          // Too small for a pen stroke — remove it
          useBoardStore.getState().removeElements([elId]);
          useUIStore.getState().setInsertPayload(null);
          return;
        }
        // Barely dragged — apply defaults
        if (isArrow) {
          useBoardStore.getState().updateElement(elId, {
            x: Math.round(start.canvasX), y: Math.round(start.canvasY),
            width: 200, height: 1,
            points: [{ x: 0, y: 0 }, { x: 200, y: 0 }],
          });
        } else {
          useBoardStore.getState().updateElement(elId, {
            x: Math.round(start.canvasX), y: Math.round(start.canvasY),
            width: 150, height: 150,
          });
        }
      }

      // Finalize pen stroke: remove if too few points, else compute tight bbox
      if (isPen) {
        const el = useBoardStore.getState().board?.elements.find(e => e.id === elId);
        if (!el?.points || el.points.length < 2) {
          useBoardStore.getState().removeElements([elId]);
          useUIStore.getState().setInsertPayload(null);
          return;
        }
        if (el.points.length >= 2) {
          const pts = el.points;
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const p of pts) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
          }
          const w = Math.max(maxX - minX, 1);
          const h = Math.max(maxY - minY, 1);
          const shifted = pts.map(p => ({ x: p.x - minX, y: p.y - minY }));
          useBoardStore.getState().updateElement(elId, {
            x: Math.round(el.x + minX),
            y: Math.round(el.y + minY),
            width: Math.round(w),
            height: Math.round(h),
            points: shifted,
          });
        }
      }

      useUIStore.getState().setSnapTargetId(null);

      // Store connection metadata for arrows with pinned anchors
      if (isArrow && (startSnapId || endSnapId)) {
        const el = useBoardStore.getState().board?.elements.find(e => e.id === elId);
        const boardElements = useBoardStore.getState().board?.elements || [];
        if (el) {
          const meta = { ...el.metadata };
          const finalPts = el.points && el.points.length >= 2
            ? el.points : [{ x: 0, y: 0 }, { x: el.width, y: 0 }];
          if (startSnapId) {
            meta.startConnection = startSnapId;
            const snapEl = boardElements.find(e => e.id === startSnapId);
            if (snapEl) {
              const absPoint = { x: el.x + finalPts[0].x, y: el.y + finalPts[0].y };
              meta.startAnchor = toRelativeAnchor(absPoint, snapEl);
            }
          }
          if (endSnapId) {
            meta.endConnection = endSnapId;
            const snapEl = boardElements.find(e => e.id === endSnapId);
            if (snapEl) {
              const absPoint = { x: el.x + finalPts[1].x, y: el.y + finalPts[1].y };
              meta.endAnchor = toRelativeAnchor(absPoint, snapEl);
            }
          }
          useBoardStore.getState().updateElement(elId, { metadata: meta });
        }
      }

      useBoardStore.getState().pushHistory(`Draw ${payload.type}`);
      useUIStore.getState().setInsertPayload(null);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [clientToCanvas]);

  const onMoveEnd = useCallback((_event: any, viewport: { zoom: number }) => {
    setZoom(viewport.zoom);
  }, [setZoom]);

  if (!board) {
    return (
      <div className="flex-1 flex items-center justify-center bg-canvas-bg text-gray-400 dark:text-on-surface-muted">
        <div className="text-center">
          <div className="text-lg font-medium mb-2">No board open</div>
          <div className="text-sm">Create or open a board to get started</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex-1 relative${insertPayload ? ' drawing-mode' : ''}`}
      style={{ cursor: insertPayload ? 'crosshair' : undefined }}
      onPointerDown={insertPayload ? handleDrawPointerDown : undefined}
    >
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onSelectionChange={onSelectionChange}
        onSelectionStart={onSelectionStart}
        onSelectionEnd={onSelectionEnd}
        onPaneClick={onPaneClick}
        onMoveEnd={onMoveEnd}
        selectionMode={SelectionMode.Partial}
        selectNodesOnDrag={false}
        selectionOnDrag={!insertPayload}
        panOnDrag={false}
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        minZoom={0.1}
        maxZoom={5}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        snapToGrid={false}
        elevateNodesOnSelect={false}
        deleteKeyCode={null}
        multiSelectionKeyCode="Shift"
        disableKeyboardA11y
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
              color={isDark ? '#3f4147' : '#d1d5db'}
            />
            <Background
              id="grid-major"
              variant={BackgroundVariant.Dots}
              gap={board.canvas.grid_size * 5}
              size={5}
              color={isDark ? '#565960' : '#9ca3af'}
            />
          </>
        )}

        <MiniMap
          position="bottom-right"
          style={{ width: 140, height: 90 }}
          maskColor={isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.08)'}
          nodeColor={isDark ? '#6b7280' : '#94a3b8'}
          pannable
          zoomable
        />
        <Panel position="top-left">
          <div className="text-2xs text-gray-400 dark:text-on-surface-muted bg-white/60 dark:bg-surface-primary/60 px-1.5 py-0.5 rounded">
            {board.canvas.infinite ? 'Infinite canvas' : `${board.canvas.width} × ${board.canvas.height}`}
          </div>
        </Panel>
      </ReactFlow>

      <AlignmentOverlay guides={guides} spacing={spacing} />

      {/* Selection box overlay during drag-to-draw */}
      {drawPreview && (drawPreview.w > 2 || drawPreview.h > 2) && (
        <DrawPreview rect={drawPreview} />
      )}

      {/* Snap target highlight */}
      {snapTargetId && <SnapHighlight elementId={snapTargetId} />}

      {insertPayload && !drawPreview && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-accent text-white px-3 py-1 rounded text-xs shadow-lg">
          Drag to draw {insertPayload.type} — ESC to cancel
        </div>
      )}
    </div>
  );
}
