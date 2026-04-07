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
  const shape = element.metadata?.shape as string | undefined;
  const isNonRectShape = element.type === 'rectangle'
    && (shape === 'triangle' || shape === 'diamond');
  const passThrough = isArrow || isNonRectShape;

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
    if (selectedNodes.length >= 1) {
      const selMinX = Math.min(...selectedNodes.map(n => n.position.x));
      const selMinY = Math.min(...selectedNodes.map(n => n.position.y));
      const selMaxX = Math.max(...selectedNodes.map(n => n.position.x + (n.width || 0)));
      const selMaxY = Math.max(...selectedNodes.map(n => n.position.y + (n.height || 0)));

      for (const el of b.elements) {
        if (ids.includes(el.id)) continue;
        if (!el.visible) continue;
        const isArrow = el.type === 'arrow';
        const shape = el.metadata?.shape as string | undefined;
        const isNonRect = el.type === 'rectangle' && (shape === 'triangle' || shape === 'diamond');
        if (!isArrow && !isNonRect) continue;

        // Check overlap
        const eR = el.x + el.width;
        const eB = el.y + el.height;
        if (el.x < selMaxX && eR > selMinX && el.y < selMaxY && eB > selMinY) {
          ids.push(el.metadata?.groupId ? el.metadata.groupId as string : el.id);
        }
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

    if (!isArrow) {
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
    const el = useBoardStore.getState().addElement(payload.type, initialOverrides);
    drawElementIdRef.current = el.id;
    useUIStore.getState().setSelectedIds([el.id]);

    const onMove = (ev: PointerEvent) => {
      const start = drawStartRef.current;
      const elId = drawElementIdRef.current;
      if (!start || !elId) return;
      const cur = clientToCanvas(ev.clientX, ev.clientY);
      if (!cur) return;

      if (isArrow) {
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
