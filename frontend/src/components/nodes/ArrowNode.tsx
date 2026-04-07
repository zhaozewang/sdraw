import { memo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { NodeProps } from '@xyflow/react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import { findSnapTarget, toRelativeAnchor } from '@/utils/snapToShape';

interface ArrowNodeData {
  elementId: string;
  [key: string]: unknown;
}

/** Base sizes in screen pixels (will be scaled by 1/zoom) */
const BASE_HANDLE_R = 5;
const BASE_CTRL_R = 4;
const BASE_STROKE_W = 2;
const BASE_CTRL_STROKE = 1.5;
const BASE_GUIDE_W = 1;

export type LineType = 'straight' | 'quadratic' | 'cubic' | 'arc' | 'step' | 'step-rounded' | 'smooth';
export type MarkerType = 'none' | 'arrow' | 'arrow-open' | 'dot' | 'diamond' | 'bar';

/* ------------------------------------------------------------------ */
/*  Geometry helpers                                                   */
/* ------------------------------------------------------------------ */

/** Auto-compute default control points for a curve */
function defaultControlPoints(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  lineType: LineType,
): Array<{ x: number; y: number }> {
  const mx = (p0.x + p1.x) / 2;
  const my = (p0.y + p1.y) / 2;
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const offX = (-dy / len) * len * 0.3;
  const offY = (dx / len) * len * 0.3;

  switch (lineType) {
    case 'quadratic':
    case 'arc':
      return [{ x: mx + offX, y: my + offY }];
    case 'smooth':
      // Gentle curve — small perpendicular offset (12%)
      return [{ x: mx + offX * 0.4, y: my + offY * 0.4 }];
    case 'cubic':
      return [
        { x: p0.x + dx * 0.25 + offX, y: p0.y + dy * 0.25 + offY },
        { x: p0.x + dx * 0.75 - offX, y: p0.y + dy * 0.75 - offY },
      ];
    default:
      return [];
  }
}

/** Build SVG path d-string */
function buildPath(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  lineType: LineType,
  ctrl: Array<{ x: number; y: number }>,
  opts?: { stepRadius?: number },
): string {
  switch (lineType) {
    case 'quadratic':
    case 'arc': {
      const c = ctrl[0] || { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      return `M ${p0.x},${p0.y} Q ${c.x},${c.y} ${p1.x},${p1.y}`;
    }
    case 'smooth': {
      // Gentle auto-curve using a cubic bezier that leaves/arrives tangent to the horizontal
      if (ctrl.length > 0) {
        const c = ctrl[0];
        return `M ${p0.x},${p0.y} Q ${c.x},${c.y} ${p1.x},${p1.y}`;
      }
      // Auto: smooth cubic with horizontal-ish tangents
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const tension = Math.min(Math.abs(dx), Math.abs(dy)) * 0.5 + Math.abs(dx) * 0.25;
      return `M ${p0.x},${p0.y} C ${p0.x + tension},${p0.y} ${p1.x - tension},${p1.y} ${p1.x},${p1.y}`;
    }
    case 'cubic': {
      const c1 = ctrl[0] || { x: p0.x + (p1.x - p0.x) * 0.25, y: p0.y };
      const c2 = ctrl[1] || { x: p0.x + (p1.x - p0.x) * 0.75, y: p1.y };
      return `M ${p0.x},${p0.y} C ${c1.x},${c1.y} ${c2.x},${c2.y} ${p1.x},${p1.y}`;
    }
    case 'step': {
      const mx = (p0.x + p1.x) / 2;
      return `M ${p0.x},${p0.y} L ${mx},${p0.y} L ${mx},${p1.y} L ${p1.x},${p1.y}`;
    }
    case 'step-rounded': {
      // Orthogonal connector with rounded corners
      const mx = (p0.x + p1.x) / 2;
      const dy = p1.y - p0.y;
      const desiredR = opts?.stepRadius ?? 20;
      const maxR = Math.min(Math.abs(mx - p0.x), Math.abs(dy) / 2, desiredR);
      const r = Math.max(maxR, 0);
      if (r < 1) {
        // Degenerate: fall back to sharp step
        return `M ${p0.x},${p0.y} L ${mx},${p0.y} L ${mx},${p1.y} L ${p1.x},${p1.y}`;
      }
      const sy = dy > 0 ? 1 : -1;
      return [
        `M ${p0.x},${p0.y}`,
        `L ${mx - r},${p0.y}`,
        `Q ${mx},${p0.y} ${mx},${p0.y + r * sy}`,
        `L ${mx},${p1.y - r * sy}`,
        `Q ${mx},${p1.y} ${mx + r * (p1.x > p0.x ? 1 : -1)},${p1.y}`,
        `L ${p1.x},${p1.y}`,
      ].join(' ');
    }
    default: // straight
      return `M ${p0.x},${p0.y} L ${p1.x},${p1.y}`;
  }
}

/* ------------------------------------------------------------------ */
/*  SVG marker definitions                                             */
/* ------------------------------------------------------------------ */

function MarkerDefs({ id, color, startMarker, endMarker, headSize = 1 }: {
  id: string; color: string; startMarker: MarkerType; endMarker: MarkerType; headSize?: number;
}) {
  const markers: React.ReactNode[] = [];
  const s = headSize; // scale factor

  const addArrow = (key: string, isStart: boolean) => {
    const w = 10 * s, h = 8 * s, mid = 4 * s;
    // refX exactly at the tip — arrowhead is precisely at the endpoint
    markers.push(
      <marker
        key={key}
        id={key}
        markerWidth={w}
        markerHeight={h}
        refX={isStart ? 0 : w}
        refY={mid}
        orient="auto"
        markerUnits="strokeWidth"
      >
        <polygon
          points={isStart ? `${w} 0, 0 ${mid}, ${w} ${h}` : `0 0, ${w} ${mid}, 0 ${h}`}
          fill={color}
        />
      </marker>
    );
  };

  const addArrowOpen = (key: string, isStart: boolean) => {
    const w = 10 * s, h = 8 * s, mid = 4 * s;
    markers.push(
      <marker
        key={key}
        id={key}
        markerWidth={w}
        markerHeight={h}
        refX={isStart ? 0 : w}
        refY={mid}
        orient="auto"
        markerUnits="strokeWidth"
      >
        <polyline
          points={isStart ? `${w} 0, 0 ${mid}, ${w} ${h}` : `0 0, ${w} ${mid}, 0 ${h}`}
          fill="none"
          stroke={color}
          strokeWidth={1.5 * s}
        />
      </marker>
    );
  };

  const addDot = (key: string) => {
    const d = 6 * s, c = 3 * s, r = 2.5 * s;
    markers.push(
      <marker
        key={key}
        id={key}
        markerWidth={d}
        markerHeight={d}
        refX={c}
        refY={c}
        orient="auto"
        markerUnits="strokeWidth"
      >
        <circle cx={c} cy={c} r={r} fill={color} />
      </marker>
    );
  };

  const addDiamond = (key: string) => {
    const d = 8 * s, mid = 4 * s;
    markers.push(
      <marker
        key={key}
        id={key}
        markerWidth={d}
        markerHeight={d}
        refX={mid}
        refY={mid}
        orient="auto"
        markerUnits="strokeWidth"
      >
        <polygon points={`${mid} 0, ${d} ${mid}, ${mid} ${d}, 0 ${mid}`} fill={color} />
      </marker>
    );
  };

  const addBar = (key: string) => {
    const w = 2 * s, h = 8 * s, cx = 1 * s;
    markers.push(
      <marker
        key={key}
        id={key}
        markerWidth={w}
        markerHeight={h}
        refX={cx}
        refY={h / 2}
        orient="auto"
        markerUnits="strokeWidth"
      >
        <line x1={cx} y1="0" x2={cx} y2={h} stroke={color} strokeWidth={2 * s} />
      </marker>
    );
  };

  const addMarker = (type: MarkerType, suffix: string, isStart: boolean) => {
    const key = `${id}-${suffix}`;
    switch (type) {
      case 'arrow': addArrow(key, isStart); break;
      case 'arrow-open': addArrowOpen(key, isStart); break;
      case 'dot': addDot(key); break;
      case 'diamond': addDiamond(key); break;
      case 'bar': addBar(key); break;
    }
  };

  if (startMarker !== 'none') addMarker(startMarker, 'start', true);
  if (endMarker !== 'none') addMarker(endMarker, 'end', false);

  if (markers.length === 0) return null;
  return <defs>{markers}</defs>;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

function ArrowNodeComponent({ id, data, selected: rfSelected }: NodeProps) {
  const elementId = (data as ArrowNodeData).elementId;
  const element = useBoardStore(s => s.board?.elements.find(el => el.id === elementId));
  const updateElement = useBoardStore(s => s.updateElement);
  const pushHistory = useBoardStore(s => s.pushHistory);
  const zoom = useUIStore(s => s.zoom);
  // Arrow nodes have selectable:false on the wrapper, so check UI store directly
  const isSelectedInStore = useUIStore(s => s.selectedIds.includes(elementId));
  const selected = rfSelected || isSelectedInStore;
  const draggingRef = useRef<string | null>(null);
  const anchorAbsRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const origPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const getCanvasCoords = useCallback((ev: PointerEvent) => {
    const viewport = document.querySelector('.react-flow__viewport') as HTMLElement;
    if (!viewport) return null;
    const transform = viewport.style.transform;
    const match = transform.match(/translate\((.+?)px,\s*(.+?)px\)\s*scale\((.+?)\)/);
    if (!match) return null;
    const tx = parseFloat(match[1]);
    const ty = parseFloat(match[2]);
    const scale = parseFloat(match[3]);
    const container = viewport.parentElement!.getBoundingClientRect();
    return {
      x: (ev.clientX - container.left - tx) / scale,
      y: (ev.clientY - container.top - ty) / scale,
    };
  }, []);

  /** Recalculate bounding box from absolute coordinates of all points */
  const recalcBBox = useCallback(() => {
    const orig = origPosRef.current;
    const el = useBoardStore.getState().board?.elements.find(e => e.id === elementId);
    if (!el) return;
    const pts = el.points || [];
    const ctrl = (el.metadata?.controlPoints as Array<{ x: number; y: number }>) || [];
    const allPts = [...pts, ...ctrl];
    if (allPts.length === 0) return;

    const allX = allPts.map(p => orig.x + p.x);
    const allY = allPts.map(p => orig.y + p.y);
    const minX = Math.min(...allX);
    const minY = Math.min(...allY);
    const w = Math.max(Math.max(...allX) - minX, 1);
    const h = Math.max(Math.max(...allY) - minY, 1);

    updateElement(elementId, {
      x: minX, y: minY, width: w, height: h,
      points: pts.map(p => ({ x: orig.x + p.x - minX, y: orig.y + p.y - minY })),
      metadata: {
        ...el.metadata,
        controlPoints: ctrl.length > 0
          ? ctrl.map(c => ({ x: orig.x + c.x - minX, y: orig.y + c.y - minY }))
          : undefined,
      },
    });
  }, [elementId, updateElement]);

  /** Handle dragging a start/end endpoint */
  const handleEndpointDown = useCallback((endpoint: 'start' | 'end') => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    draggingRef.current = endpoint;

    const el = useBoardStore.getState().board?.elements.find(e => e.id === elementId);
    if (!el) return;
    const pts = el.points && el.points.length >= 2
      ? el.points
      : [{ x: 0, y: el.height / 2 }, { x: el.width, y: el.height / 2 }];

    origPosRef.current = { x: el.x, y: el.y };
    const anchorIdx = endpoint === 'start' ? 1 : 0;
    anchorAbsRef.current = { x: el.x + pts[anchorIdx].x, y: el.y + pts[anchorIdx].y };

    useUIStore.getState().setSuppressPositionSync(true);

    let lastSnapId: string | null = null;

    const onMove = (ev: PointerEvent) => {
      if (!draggingRef.current) return;
      const coords = getCanvasCoords(ev);
      if (!coords) return;
      const anchor = anchorAbsRef.current;
      const orig = origPosRef.current;
      const board = useBoardStore.getState().board;

      // Snap to shape boundary
      let snapped = coords;
      lastSnapId = null;
      if (board) {
        const excludeIds = new Set([elementId]);
        const snap = findSnapTarget(coords, board.elements, excludeIds);
        if (snap) {
          snapped = snap.point;
          lastSnapId = snap.elementId;
        }
      }
      useUIStore.getState().setSnapTargetId(lastSnapId);

      const sAbs = draggingRef.current === 'start' ? snapped : anchor;
      const eAbs = draggingRef.current === 'start' ? anchor : snapped;
      updateElement(elementId, {
        points: [
          { x: sAbs.x - orig.x, y: sAbs.y - orig.y },
          { x: eAbs.x - orig.x, y: eAbs.y - orig.y },
        ],
      });
    };

    const onUp = () => {
      const ep = draggingRef.current;
      draggingRef.current = null;
      useUIStore.getState().setSuppressPositionSync(false);
      useUIStore.getState().setSnapTargetId(null);

      // Store connection metadata with pinned anchor
      const el = useBoardStore.getState().board?.elements.find(e => e.id === elementId);
      if (el) {
        const connKey = ep === 'start' ? 'startConnection' : 'endConnection';
        const anchorKey = ep === 'start' ? 'startAnchor' : 'endAnchor';
        const newMeta = { ...el.metadata, [connKey]: lastSnapId || undefined };
        if (!lastSnapId) {
          delete newMeta[connKey];
          delete newMeta[anchorKey];
        } else {
          // Compute and store the relative anchor position
          const snapEl = useBoardStore.getState().board?.elements.find(e => e.id === lastSnapId);
          if (snapEl) {
            const pts = el.points && el.points.length >= 2
              ? el.points : [{ x: 0, y: el.height / 2 }, { x: el.width, y: el.height / 2 }];
            const orig = origPosRef.current;
            const ptIdx = ep === 'start' ? 0 : 1;
            const absPoint = { x: orig.x + pts[ptIdx].x, y: orig.y + pts[ptIdx].y };
            newMeta[anchorKey] = toRelativeAnchor(absPoint, snapEl);
          }
        }
        updateElement(elementId, { metadata: newMeta });
      }

      recalcBBox();
      pushHistory('Move endpoint');
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
    };

    document.body.style.cursor = 'crosshair';
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [elementId, updateElement, pushHistory, getCanvasCoords, recalcBBox]);

  /** Handle dragging a control point */
  const handleCtrlDown = useCallback((idx: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();

    const el = useBoardStore.getState().board?.elements.find(e => e.id === elementId);
    if (!el) return;
    origPosRef.current = { x: el.x, y: el.y };
    useUIStore.getState().setSuppressPositionSync(true);

    const onMove = (ev: PointerEvent) => {
      const coords = getCanvasCoords(ev);
      if (!coords) return;
      const orig = origPosRef.current;
      const el = useBoardStore.getState().board?.elements.find(e => e.id === elementId);
      const ctrl = [...((el?.metadata?.controlPoints as Array<{ x: number; y: number }>) || [])];
      ctrl[idx] = { x: coords.x - orig.x, y: coords.y - orig.y };
      updateElement(elementId, { metadata: { ...el?.metadata, controlPoints: ctrl } });
    };

    const onUp = () => {
      useUIStore.getState().setSuppressPositionSync(false);
      recalcBBox();
      pushHistory('Move control point');
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
    };

    document.body.style.cursor = 'move';
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [elementId, updateElement, pushHistory, getCanvasCoords, recalcBBox]);

  if (!element || element.type !== 'arrow') return null;

  const { style, metadata } = element;
  const strokeColor = style.strokeColor || '#333333';
  const strokeWidth = style.strokeWidth ?? 2;
  const dashArray = style.strokeStyle === 'dashed' ? '8,4' : style.strokeStyle === 'dotted' ? '2,4' : undefined;

  const lineType: LineType = (metadata?.lineType as LineType) || 'straight';

  // Start/end markers (backwards-compat: old arrowHead → endMarker:'arrow')
  const startMarker: MarkerType = (metadata?.startMarker as MarkerType) || 'none';
  const endMarker: MarkerType = (metadata?.endMarker as MarkerType)
    || (metadata?.arrowHead === false ? 'none' : 'arrow');

  const pts = element.points && element.points.length >= 2
    ? element.points
    : [{ x: 0, y: element.height / 2 }, { x: element.width, y: element.height / 2 }];

  const ctrl: Array<{ x: number; y: number }> = (metadata?.controlPoints as any) || [];
  const hasCurveCtrl = lineType === 'quadratic' || lineType === 'cubic' || lineType === 'arc' || lineType === 'smooth';
  const effectiveCtrl = hasCurveCtrl && ctrl.length === 0
    ? defaultControlPoints(pts[0], pts[1], lineType)
    : ctrl;

  const stepRadius = (metadata?.stepRadius as number) || 20;
  const pathD = buildPath(pts[0], pts[1], lineType, effectiveCtrl, { stepRadius });

  const mStart = startMarker !== 'none' ? `url(#${elementId}-start)` : undefined;
  const mEnd = endMarker !== 'none' ? `url(#${elementId}-end)` : undefined;

  return (
    <>
      {/* Bounding div — pointer-events: none so clicks pass through empty space */}
      <div className="absolute inset-0 pointer-events-none" style={{ minHeight: 16, minWidth: 16 }} />
      <svg
        className="overflow-visible absolute inset-0"
        style={{ opacity: style.opacity ?? 1, width: '100%', height: '100%', pointerEvents: 'none' }}
      >
        <MarkerDefs
          id={elementId}
          color={strokeColor}
          startMarker={startMarker}
          endMarker={endMarker}
          headSize={(metadata?.arrowHeadSize as number) || 1}
        />

        {/* Invisible thick path for easier clicking — this is the only hit area */}
        <path
          d={pathD} fill="none" stroke="transparent"
          strokeWidth={Math.max(14, strokeWidth + 10)}
          style={{ pointerEvents: 'stroke', cursor: element.locked ? 'default' : 'pointer' }}
          onPointerDown={(e) => {
            e.stopPropagation();
            // Select
            const shiftKey = e.shiftKey;
            const sel = useUIStore.getState().selectedIds;
            if (shiftKey) {
              if (sel.includes(elementId)) useUIStore.getState().removeFromSelection(elementId);
              else useUIStore.getState().addToSelection(elementId);
            } else if (!sel.includes(elementId)) {
              useUIStore.getState().setSelectedIds([elementId]);
            }

            // Drag support
            if (element.locked) return;
            const startX = e.clientX;
            const startY = e.clientY;
            const origEl = useBoardStore.getState().board?.elements.find(el => el.id === elementId);
            if (!origEl) return;
            const origPos = { x: origEl.x, y: origEl.y };
            const viewport = document.querySelector('.react-flow__viewport') as HTMLElement;
            const scale = viewport
              ? parseFloat(viewport.style.transform.match(/scale\((.+?)\)/)?.[1] || '1')
              : 1;
            let moved = false;

            const onMove = (ev: PointerEvent) => {
              moved = true;
              const dx = (ev.clientX - startX) / scale;
              const dy = (ev.clientY - startY) / scale;
              updateElement(elementId, { x: origPos.x + dx, y: origPos.y + dy });
            };
            const onUp = () => {
              document.removeEventListener('pointermove', onMove);
              document.removeEventListener('pointerup', onUp);
              if (moved) {
                // Clear cached absolute positions since the arrow moved
                const el = useBoardStore.getState().board?.elements.find(el => el.id === elementId);
                if (el?.metadata?.startAbsPos || el?.metadata?.endAbsPos) {
                  const meta = { ...el.metadata };
                  delete meta.startAbsPos;
                  delete meta.endAbsPos;
                  updateElement(elementId, { metadata: meta });
                }
                pushHistory('Move');
              }
            };
            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
          }}
        />

        {/* Visible path with stroke and markers */}
        <path
          d={pathD}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={dashArray}
          markerStart={mStart}
          markerEnd={mEnd}
          style={{ pointerEvents: 'none' }}
        />

      </svg>

      {/* Endpoint handles — rendered via portal to sit above all nodes */}
      {selected && !element.locked && (() => {
        const viewport = document.querySelector('.react-flow__viewport');
        if (!viewport) return null;
        const iz = 1 / Math.max(zoom, 0.1);
        const hr = BASE_HANDLE_R * iz;
        const hs = BASE_STROKE_W * iz;
        const cr = BASE_CTRL_R * iz;
        const cs = BASE_CTRL_STROKE * iz;
        const gw = BASE_GUIDE_W * iz;
        const gd = `${3 * iz},${2 * iz}`;
        // Absolute canvas positions for the handles
        const ax = element.x;
        const ay = element.y;
        return createPortal(
          <svg
            className="overflow-visible"
            style={{
              position: 'absolute',
              left: 0, top: 0,
              width: 1, height: 1,
              zIndex: 999999,
              pointerEvents: 'none',
            }}
          >
            {/* Control point guide lines */}
            {effectiveCtrl.map((c, i) => (
              <line
                key={`guide-${i}`}
                x1={ax + (i === 0 ? pts[0].x : pts[1].x)}
                y1={ay + (i === 0 ? pts[0].y : pts[1].y)}
                x2={ax + c.x} y2={ay + c.y}
                stroke="#a78bfa" strokeWidth={gw} strokeDasharray={gd}
              />
            ))}
            {/* Start endpoint */}
            <circle
              cx={ax + pts[0].x} cy={ay + pts[0].y} r={hr}
              fill="white" stroke="#3b82f6" strokeWidth={hs}
              style={{ cursor: 'crosshair', pointerEvents: 'auto' }}
              onPointerDown={handleEndpointDown('start')}
            />
            {/* End endpoint */}
            <circle
              cx={ax + pts[1].x} cy={ay + pts[1].y} r={hr}
              fill="white" stroke="#3b82f6" strokeWidth={hs}
              style={{ cursor: 'crosshair', pointerEvents: 'auto' }}
              onPointerDown={handleEndpointDown('end')}
            />
            {/* Control point handles */}
            {effectiveCtrl.map((c, i) => (
              <circle
                key={`ctrl-${i}`}
                cx={ax + c.x} cy={ay + c.y} r={cr}
                fill="#a78bfa" stroke="white" strokeWidth={cs}
                style={{ cursor: 'move', pointerEvents: 'auto' }}
                onPointerDown={handleCtrlDown(i)}
              />
            ))}
          </svg>,
          viewport,
        );
      })()}
    </>
  );
}

export const ArrowNode = memo(ArrowNodeComponent);
