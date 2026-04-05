import { memo, useCallback, useRef } from 'react';
import { NodeProps } from '@xyflow/react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';

interface ArrowNodeData {
  elementId: string;
  [key: string]: unknown;
}

const HANDLE_R = 5;

function ArrowNodeComponent({ id, data, selected }: NodeProps) {
  const elementId = (data as ArrowNodeData).elementId;
  const element = useBoardStore(s => s.board?.elements.find(el => el.id === elementId));
  const updateElement = useBoardStore(s => s.updateElement);
  const pushHistory = useBoardStore(s => s.pushHistory);
  const draggingRef = useRef<'start' | 'end' | null>(null);
  const anchorAbsRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const origPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const handlePointerDown = useCallback((endpoint: 'start' | 'end') => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    draggingRef.current = endpoint;

    const el = useBoardStore.getState().board?.elements.find(el => el.id === elementId);
    if (!el) return;

    const pts = el.points && el.points.length >= 2
      ? el.points
      : [{ x: 0, y: el.height / 2 }, { x: el.width, y: el.height / 2 }];

    // Remember the original node position (won't change during drag)
    origPosRef.current = { x: el.x, y: el.y };

    // Anchor = the absolute position of the end NOT being dragged
    const anchorIdx = endpoint === 'start' ? 1 : 0;
    anchorAbsRef.current = {
      x: el.x + pts[anchorIdx].x,
      y: el.y + pts[anchorIdx].y,
    };

    useUIStore.getState().setSuppressPositionSync(true);

    const getCanvasCoords = (ev: PointerEvent) => {
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
    };

    const onPointerMove = (ev: PointerEvent) => {
      if (!draggingRef.current) return;
      const coords = getCanvasCoords(ev);
      if (!coords) return;

      const anchor = anchorAbsRef.current;
      const orig = origPosRef.current;

      // Compute points relative to the ORIGINAL (unchanged) node position
      const startAbs = draggingRef.current === 'start' ? coords : anchor;
      const endAbs = draggingRef.current === 'start' ? anchor : coords;

      updateElement(elementId, {
        // x, y, width, height stay unchanged during drag
        points: [
          { x: startAbs.x - orig.x, y: startAbs.y - orig.y },
          { x: endAbs.x - orig.x, y: endAbs.y - orig.y },
        ],
      });
    };

    const onPointerUp = (ev: PointerEvent) => {
      if (!draggingRef.current) return;
      const coords = getCanvasCoords(ev);
      draggingRef.current = null;

      useUIStore.getState().setSuppressPositionSync(false);

      // Now finalize: recalculate bounding box from absolute positions
      if (coords) {
        const anchor = anchorAbsRef.current;
        const orig = origPosRef.current;
        const el = useBoardStore.getState().board?.elements.find(el => el.id === elementId);
        const pts = el?.points;
        if (pts && pts.length >= 2) {
          const startAbs = { x: orig.x + pts[0].x, y: orig.y + pts[0].y };
          const endAbs = { x: orig.x + pts[1].x, y: orig.y + pts[1].y };

          const minX = Math.min(startAbs.x, endAbs.x);
          const minY = Math.min(startAbs.y, endAbs.y);
          const w = Math.max(Math.abs(endAbs.x - startAbs.x), 1);
          const h = Math.max(Math.abs(endAbs.y - startAbs.y), 1);

          updateElement(elementId, {
            x: minX,
            y: minY,
            width: w,
            height: h,
            points: [
              { x: startAbs.x - minX, y: startAbs.y - minY },
              { x: endAbs.x - minX, y: endAbs.y - minY },
            ],
          });
        }
      }

      pushHistory('Move endpoint');
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.body.style.cursor = '';
    };

    document.body.style.cursor = 'crosshair';
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  }, [elementId, updateElement, pushHistory]);

  if (!element || element.type !== 'arrow') return null;

  const { style, metadata } = element;
  const strokeColor = style.strokeColor || '#333333';
  const strokeWidth = style.strokeWidth ?? 2;
  const dashArray = style.strokeStyle === 'dashed' ? '8,4' : style.strokeStyle === 'dotted' ? '2,4' : undefined;
  const hasArrowHead = metadata?.arrowHead !== false;

  const pts = element.points && element.points.length >= 2
    ? element.points
    : [{ x: 0, y: element.height / 2 }, { x: element.width, y: element.height / 2 }];

  return (
    <>
      {/* Invisible hit area */}
      <div className="absolute inset-0" style={{ minHeight: 16, minWidth: 16 }} />
      <svg
        className="overflow-visible absolute inset-0"
        style={{ opacity: style.opacity ?? 1, width: '100%', height: '100%' }}
      >
        {hasArrowHead && (
          <defs>
            <marker
              id={`arrowhead-${elementId}`}
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill={strokeColor} />
            </marker>
          </defs>
        )}
        {/* Invisible thick line for easier clicking */}
        <line
          x1={pts[0].x}
          y1={pts[0].y}
          x2={pts[1].x}
          y2={pts[1].y}
          stroke="transparent"
          strokeWidth={Math.max(12, strokeWidth + 8)}
        />
        {/* Visible line */}
        <line
          x1={pts[0].x}
          y1={pts[0].y}
          x2={pts[1].x}
          y2={pts[1].y}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={dashArray}
          markerEnd={hasArrowHead ? `url(#arrowhead-${elementId})` : undefined}
        />
        {/* Endpoint handles when selected */}
        {selected && !element.locked && (
          <>
            <circle
              cx={pts[0].x}
              cy={pts[0].y}
              r={HANDLE_R}
              fill="white"
              stroke="#3b82f6"
              strokeWidth={2}
              style={{ cursor: 'crosshair' }}
              onPointerDown={handlePointerDown('start')}
            />
            <circle
              cx={pts[1].x}
              cy={pts[1].y}
              r={HANDLE_R}
              fill="white"
              stroke="#3b82f6"
              strokeWidth={2}
              style={{ cursor: 'crosshair' }}
              onPointerDown={handlePointerDown('end')}
            />
          </>
        )}
      </svg>
    </>
  );
}

export const ArrowNode = memo(ArrowNodeComponent);
