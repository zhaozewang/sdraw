import { memo, useCallback, useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import { groupResizeUpdates, type ElementRect } from '@/utils/groupResize';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';

interface ResizerProps {
  isVisible: boolean;
  /** The React Flow node ID (needed to update RF directly during drag) */
  nodeId: string;
  minWidth?: number;
  minHeight?: number;
  /** Called with absolute target rect (on mouseup only) */
  onResizeAbsolute: (x: number, y: number, w: number, h: number) => void;
  onResizeEnd: () => void;
  /** Return current element rect */
  getRect: () => { x: number; y: number; width: number; height: number };
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

function proportionalRect(pos: HandlePosition, rect: ElementRect, dx: number, dy: number, minW: number, minH: number): ElementRect {
  const [fx, fy] = handleFracs[pos];
  const vx = (2 * fx - 1) * rect.width;
  const vy = (2 * fy - 1) * rect.height;
  // Project the pointer onto the handle's axis and keep the opposite handle fixed.
  const factor = Math.max(minW / rect.width, minH / rect.height, 1 + (dx * vx + dy * vy) / (vx * vx + vy * vy));
  const width = rect.width * factor;
  const height = rect.height * factor;
  return { x: rect.x + (1 - fx) * (rect.width - width), y: rect.y + (1 - fy) * (rect.height - height), width, height };
}

function computeRect(
  pos: HandlePosition,
  orig: { x: number; y: number; width: number; height: number },
  totalDx: number,
  totalDy: number,
  minW: number,
  minH: number,
): { x: number; y: number; width: number; height: number } {
  let { x, y, width: w, height: h } = orig;
  const right = x + w;
  const bottom = y + h;

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

function ResizerComponent({
  isVisible, nodeId, minWidth = 20, minHeight = 20,
  onResizeAbsolute, onResizeEnd, getRect,
}: ResizerProps) {
  const zoom = useUIStore(s => s.zoom);
  const { setNodes } = useReactFlow();
  const setNodesRef = useRef(setNodes);
  setNodesRef.current = setNodes;
  const onResizeRef = useRef(onResizeAbsolute);
  onResizeRef.current = onResizeAbsolute;
  const onResizeEndRef = useRef(onResizeEnd);
  onResizeEndRef.current = onResizeEnd;
  const getRectRef = useRef(getRect);
  getRectRef.current = getRect;
  const nodeIdRef = useRef(nodeId);
  nodeIdRef.current = nodeId;

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

    const elements = useBoardStore.getState().board?.elements ?? [];
    const element = elements.find(el => el.id === nodeIdRef.current);
    const group = element?.type === 'group' ? element : undefined;
    const proportional = !!group || element?.type === 'image';

    // Suppress Canvas board→node sync so it doesn't fight our updates
    useUIStore.getState().setSuppressPositionSync(true);

    let lastRect = origRect;

    const onMove = (ev: PointerEvent) => {
      const totalDx = (ev.clientX - startX) / scale;
      const totalDy = (ev.clientY - startY) / scale;
      lastRect = (proportional ? proportionalRect : computeRect)(pos, origRect, totalDx, totalDy, minWidth, minHeight);

      // Update React Flow directly — this is the fastest path, no store roundtrip
      const rects = new Map<string, ElementRect>(group
        ? groupResizeUpdates(group, elements, lastRect).map(({ id, changes }) => [id, changes])
        : [[nodeIdRef.current, lastRect]]);
      setNodesRef.current(nodes => nodes.map(node => {
        const rect = rects.get(node.id);
        if (!rect) return node;
        return {
          ...node,
          position: { x: rect.x, y: rect.y },
          width: rect.width,
          height: rect.height,
          style: { ...node.style, width: rect.width, height: rect.height },
        };
      }));
    };

    const onPointerUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      // Commit final rect to the board store
      if (group) {
        useBoardStore.getState().updateElements(groupResizeUpdates(group, elements, lastRect));
      } else {
        onResizeRef.current(lastRect.x, lastRect.y, lastRect.width, lastRect.height);
      }

      // Re-enable sync
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
      {(Object.keys(handleFracs) as HandlePosition[]).map(pos => {
        const [fx, fy] = handleFracs[pos];
        return (
          <div
            key={pos}
            onPointerDown={handlePointerDown(pos)}
            className="absolute nodrag"
            style={{
              width: handleSize,
              height: handleSize,
              backgroundColor: 'white',
              border: `${handleBorder}px solid #3b82f6`,
              borderRadius: 1,
              cursor: handleCursors[pos],
              zIndex: 10,
              left: `${fx * 100}%`,
              top: `${fy * 100}%`,
              transform: 'translate(-50%, -50%)',
            }}
          />
        );
      })}
    </>
  );
}

export const Resizer = memo(ResizerComponent);
