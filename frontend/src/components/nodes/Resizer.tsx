import { memo, useCallback, useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useUIStore } from '@/store/uiStore';
import { useBoardStore } from '@/store/boardStore';
import { computeAlignmentGuides, type Rect } from '@/utils/alignmentGuides';

interface ResizerProps {
  isVisible: boolean;
  /** The React Flow node ID (needed to update RF directly during drag) */
  nodeId: string;
  minWidth?: number;
  minHeight?: number;
  /** Called with absolute target rect (on mouseup only) */
  onResizeAbsolute: (x: number, y: number, w: number, h: number) => void;
  /** Called during resize drag with current rect (for alignment guides etc.) */
  onResizeMove?: (x: number, y: number, w: number, h: number) => void;
  onResizeEnd: () => void;
  /** Return current element rect */
  getRect: () => { x: number; y: number; width: number; height: number };
  /** Lock aspect ratio — width/height. If set, only corner handles are shown. */
  aspectRatio?: number;
  /** Only show corner handles (NE, NW, SE, SW) */
  cornersOnly?: boolean;
  /** Called during rotation drag with new angle in degrees */
  onRotate?: (rotation: number) => void;
  /** Called when rotation drag ends */
  onRotateEnd?: () => void;
  /** Current rotation in degrees */
  rotation?: number;
}

type HandlePosition = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const BASE_HANDLE = 8;
const BASE_BORDER = 1.5;

const handleCursors: Record<HandlePosition, string> = {
  nw: 'nw-resize', n: 'n-resize', ne: 'ne-resize', e: 'e-resize',
  se: 'se-resize', s: 's-resize', sw: 'sw-resize', w: 'w-resize',
};

const handleFracs: Record<HandlePosition, [number, number]> = {
  nw: [0, 0], n: [0.5, 0], ne: [1, 0],
  w: [0, 0.5],              e: [1, 0.5],
  sw: [0, 1], s: [0.5, 1], se: [1, 1],
};

function computeRect(
  pos: HandlePosition,
  orig: { x: number; y: number; width: number; height: number },
  totalDx: number,
  totalDy: number,
  minW: number,
  minH: number,
  ratio?: number,
): { x: number; y: number; width: number; height: number } {
  let { x, y, width: w, height: h } = orig;
  const right = x + w;
  const bottom = y + h;

  if (ratio && (pos === 'nw' || pos === 'ne' || pos === 'sw' || pos === 'se')) {
    // Aspect-ratio-locked corner resize
    // Use the axis with the larger absolute delta to drive the resize
    const absDx = Math.abs(totalDx);
    const absDy = Math.abs(totalDy);
    let newW: number, newH: number;

    if (absDx / ratio > absDy) {
      // Width-driven
      if (pos === 'ne' || pos === 'se') {
        newW = Math.max(minW, orig.width + totalDx);
      } else {
        newW = Math.max(minW, orig.width - totalDx);
      }
      newH = newW / ratio;
    } else {
      // Height-driven
      if (pos === 'se' || pos === 'sw') {
        newH = Math.max(minH, orig.height + totalDy);
      } else {
        newH = Math.max(minH, orig.height - totalDy);
      }
      newW = newH * ratio;
    }

    newW = Math.max(minW, newW);
    newH = Math.max(minH, newH);

    // Anchor the opposite corner
    if (pos === 'se') { /* top-left anchored */ }
    else if (pos === 'sw') { x = right - newW; }
    else if (pos === 'ne') { y = bottom - newH; }
    else if (pos === 'nw') { x = right - newW; y = bottom - newH; }

    return { x, y, width: newW, height: newH };
  }

  // Standard free resize
  if (pos === 'e' || pos === 'ne' || pos === 'se') {
    w = Math.max(minW, orig.width + totalDx);
  }
  if (pos === 'w' || pos === 'nw' || pos === 'sw') {
    const newLeft = Math.min(right - minW, orig.x + totalDx);
    w = right - newLeft;
    x = newLeft;
  }
  if (pos === 's' || pos === 'se' || pos === 'sw') {
    h = Math.max(minH, orig.height + totalDy);
  }
  if (pos === 'n' || pos === 'nw' || pos === 'ne') {
    const newTop = Math.min(bottom - minH, orig.y + totalDy);
    h = bottom - newTop;
    y = newTop;
  }

  return { x, y, width: w, height: h };
}

const CORNER_HANDLES: HandlePosition[] = ['nw', 'ne', 'sw', 'se'];
const ALL_HANDLES: HandlePosition[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function ResizerComponent({
  isVisible, nodeId, minWidth = 20, minHeight = 20,
  onResizeAbsolute, onResizeMove, onResizeEnd, getRect, aspectRatio, cornersOnly,
  onRotate, onRotateEnd, rotation = 0,
}: ResizerProps) {
  const zoom = useUIStore(s => s.zoom);
  const { setNodes } = useReactFlow();
  const setNodesRef = useRef(setNodes);
  setNodesRef.current = setNodes;
  const onResizeRef = useRef(onResizeAbsolute);
  onResizeRef.current = onResizeAbsolute;
  const onResizeMoveRef = useRef(onResizeMove);
  onResizeMoveRef.current = onResizeMove;
  const onResizeEndRef = useRef(onResizeEnd);
  onResizeEndRef.current = onResizeEnd;
  const getRectRef = useRef(getRect);
  getRectRef.current = getRect;
  const nodeIdRef = useRef(nodeId);
  nodeIdRef.current = nodeId;

  const onRotateRef = useRef(onRotate);
  onRotateRef.current = onRotate;
  const onRotateEndRef = useRef(onRotateEnd);
  onRotateEndRef.current = onRotateEnd;

  const handleRotateDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!onRotateRef.current) return;

    const rect = getRectRef.current();
    const viewport = document.querySelector('.react-flow__viewport') as HTMLElement;
    if (!viewport) return;
    const container = viewport.parentElement!.getBoundingClientRect();
    const match = viewport.style.transform.match(/translate\((.+?)px,\s*(.+?)px\)\s*scale\((.+?)\)/);
    if (!match) return;
    const tx = parseFloat(match[1]);
    const ty = parseFloat(match[2]);
    const scale = parseFloat(match[3]);

    // Element center in screen coords
    const cx = container.left + tx + (rect.x + rect.width / 2) * scale;
    const cy = container.top + ty + (rect.y + rect.height / 2) * scale;

    // Starting angle
    const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI);
    const startRotation = rotation;

    const onMove = (ev: PointerEvent) => {
      const angle = Math.atan2(ev.clientY - cy, ev.clientX - cx) * (180 / Math.PI);
      let newRotation = startRotation + (angle - startAngle);
      // Clamp to -180..180
      while (newRotation > 180) newRotation -= 360;
      while (newRotation < -180) newRotation += 360;
      // Snap to 0, 90, -90, 180 when within 3 degrees
      for (const snap of [0, 90, -90, 180, -180]) {
        if (Math.abs(newRotation - snap) < 3) { newRotation = snap; break; }
      }
      onRotateRef.current?.(Math.round(newRotation));
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      onRotateEndRef.current?.();
    };

    document.body.style.cursor = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns=\\"http://www.w3.org/2000/svg\\" width=\\"20\\" height=\\"20\\" viewBox=\\"0 0 24 24\\"><path d=\\"M12 4V1L8 5l4 4V6a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z\\" fill=\\"%23333\\"/></svg>')}") 10 10, grab`;
    document.body.style.userSelect = 'none';
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [rotation]);

  const handlePointerDown = useCallback((pos: HandlePosition) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();

    const viewport = document.querySelector('.react-flow__viewport') as HTMLElement;
    const scale = viewport
      ? parseFloat(viewport.style.transform.match(/scale\((.+?)\)/)?.[1] || '1')
      : 1;

    const startX = e.clientX;
    const startY = e.clientY;
    const origRect = getRectRef.current();

    // Suppress Canvas board→node sync so it doesn't fight our updates
    useUIStore.getState().setSuppressPositionSync(true);

    let lastRect = origRect;

    const onMove = (ev: PointerEvent) => {
      const totalDx = (ev.clientX - startX) / scale;
      const totalDy = (ev.clientY - startY) / scale;
      lastRect = computeRect(pos, origRect, totalDx, totalDy, minWidth, minHeight, aspectRatio);

      // Compute alignment guides during resize
      const board = useBoardStore.getState().board;
      if (board) {
        const draggingRect: Rect = { id: nodeIdRef.current, x: lastRect.x, y: lastRect.y, width: lastRect.width, height: lastRect.height };
        const otherRects = board.elements
          .filter(e => e.id !== nodeIdRef.current && e.visible)
          .map(e => ({ id: e.id, x: e.x, y: e.y, width: e.width, height: e.height }));
        const result = computeAlignmentGuides(draggingRect, otherRects);
        useUIStore.getState().setResizeGuides(result.guides as any, result.spacing as any);
      }

      // Notify parent
      onResizeMoveRef.current?.(lastRect.x, lastRect.y, lastRect.width, lastRect.height);

      // Update React Flow directly — this is the fastest path, no store roundtrip
      const nid = nodeIdRef.current;
      const r = lastRect;
      setNodesRef.current(nds => nds.map(n =>
        n.id === nid
          ? {
              ...n,
              position: { x: r.x, y: r.y },
              width: r.width,
              height: r.height,
              style: { ...n.style, width: r.width, height: r.height },
            }
          : n
      ));
    };

    const onPointerUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      // Commit final rect to the board store
      onResizeRef.current(lastRect.x, lastRect.y, lastRect.width, lastRect.height);

      // Clear resize guides and re-enable sync
      useUIStore.getState().setResizeGuides([], []);
      useUIStore.getState().setSuppressPositionSync(false);
      onResizeEndRef.current();
    };

    document.body.style.cursor = handleCursors[pos];
    document.body.style.userSelect = 'none';
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onPointerUp);
  }, [minWidth, minHeight]);

  if (!isVisible) return null;

  const invZoom = 1 / Math.max(zoom, 0.1);
  const handleSize = BASE_HANDLE * invZoom;
  const borderWidth = BASE_BORDER * invZoom;
  const handleBorder = 2 * invZoom;

  return (
    <>
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ border: `${borderWidth}px solid #3b82f6` }}
      />
      {((cornersOnly || aspectRatio) ? CORNER_HANDLES : ALL_HANDLES).map(pos => {
        const [fx, fy] = handleFracs[pos];
        return (
          <div
            key={pos}
            onPointerDown={handlePointerDown(pos)}
            className="absolute"
            style={{
              width: handleSize,
              height: handleSize,
              backgroundColor: 'white',
              border: `${handleBorder}px solid #3b82f6`,
              borderRadius: 1,
              cursor: handleCursors[pos],
              zIndex: 10,
              pointerEvents: 'auto',
              left: `${fx * 100}%`,
              top: `${fy * 100}%`,
              transform: 'translate(-50%, -50%)',
            }}
          />
        );
      })}
      {/* Rotation zones — outside each corner */}
      {onRotate && CORNER_HANDLES.map(pos => {
        const [fx, fy] = handleFracs[pos];
        // Offset outward from the corner
        const offX = fx === 0 ? -1 : 1;
        const offY = fy === 0 ? -1 : 1;
        const rotSize = handleSize * 1.5;
        return (
          <div
            key={`rot-${pos}`}
            onPointerDown={handleRotateDown}
            className="absolute"
            style={{
              width: rotSize,
              height: rotSize,
              cursor: `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><path d="M12 4V1L8 5l4 4V6a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z" fill="%23333"/></svg>')}") 10 10, grab`,
              zIndex: 9,
              pointerEvents: 'auto',
              left: `${fx * 100}%`,
              top: `${fy * 100}%`,
              transform: `translate(${offX * rotSize * 0.6}px, ${offY * rotSize * 0.6}px) translate(-50%, -50%)`,
            }}
          />
        );
      })}
    </>
  );
}

export const Resizer = memo(ResizerComponent);
