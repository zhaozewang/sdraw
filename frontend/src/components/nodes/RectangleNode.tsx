import { memo, useCallback } from 'react';
import { NodeProps } from '@xyflow/react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import { Resizer } from './Resizer';

interface RectNodeData {
  elementId: string;
  [key: string]: unknown;
}

function RectangleNodeComponent({ id, data, selected }: NodeProps) {
  const elementId = (data as RectNodeData).elementId;
  const element = useBoardStore(s => s.board?.elements.find(el => el.id === elementId));
  const updateElement = useBoardStore(s => s.updateElement);
  const pushHistory = useBoardStore(s => s.pushHistory);
  const zoom = useUIStore(s => s.zoom);

  const onResizeAbsolute = useCallback((x: number, y: number, w: number, h: number) => {
    updateElement(elementId, { x, y, width: w, height: h });
  }, [elementId, updateElement]);

  const onResizeEnd = useCallback(() => {
    pushHistory('Resize');
  }, [pushHistory]);

  const getRect = useCallback(() => {
    const el = useBoardStore.getState().board?.elements.find(e => e.id === elementId);
    return el ? { x: el.x, y: el.y, width: el.width, height: el.height } : { x: 0, y: 0, width: 100, height: 100 };
  }, [elementId]);

  if (!element || (element.type !== 'rectangle' && element.type !== 'group')) return null;

  const isGroup = element.type === 'group';
  const { style, metadata } = element;
  const shape = metadata?.shape as string | undefined;

  const clipPath = shape === 'diamond'
    ? 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)'
    : shape === 'triangle'
    ? 'polygon(50% 0%, 100% 100%, 0% 100%)'
    : undefined;

  const invZoom = 1 / Math.max(zoom, 0.1);

  return (
    <>
      <Resizer
        isVisible={selected && !element.locked}
        nodeId={id}
        minWidth={20}
        minHeight={20}
        onResizeAbsolute={onResizeAbsolute}
        onResizeEnd={onResizeEnd}
        getRect={getRect}
      />
      {isGroup ? (
        /* Group: dashed bounding box, no fill */
        <div
          className="w-full h-full"
          style={{
            border: `${Math.max(1, 1.5 * invZoom)}px dashed ${selected ? '#3b82f6' : '#94a3b8'}`,
            borderRadius: 2,
            backgroundColor: selected ? 'rgba(59,130,246,0.04)' : 'transparent',
            opacity: style.opacity ?? 1,
          }}
        />
      ) : (
        <>
          <div
            className="w-full h-full"
            style={{
              backgroundColor: style.fill || 'transparent',
              borderColor: clipPath ? 'transparent' : (style.strokeColor || '#333333'),
              borderWidth: clipPath ? 0 : (style.strokeWidth ?? 2),
              borderStyle: style.strokeStyle || 'solid',
              borderRadius: clipPath ? 0 : (style.borderRadius ?? 0),
              opacity: style.opacity ?? 1,
              clipPath,
            }}
          />
          {clipPath && (
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
              <polygon
                points={shape === 'diamond' ? '50,0 100,50 50,100 0,50' : '50,0 100,100 0,100'}
                fill="none"
                stroke={style.strokeColor || '#333333'}
                strokeWidth={(style.strokeWidth ?? 2) * 2}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          )}
        </>
      )}
    </>
  );
}

export const RectangleNode = memo(RectangleNodeComponent);
