import { memo } from 'react';
import { NodeProps, NodeResizer } from '@xyflow/react';
import { useBoardStore } from '@/store/boardStore';

interface RectNodeData {
  elementId: string;
  [key: string]: unknown;
}

function RectangleNodeComponent({ id, data, selected }: NodeProps) {
  const elementId = (data as RectNodeData).elementId;
  const element = useBoardStore(s => s.board?.elements.find(el => el.id === elementId));

  if (!element || element.type !== 'rectangle') return null;

  const { style, metadata } = element;
  const shape = metadata?.shape as string | undefined;

  const clipPath = shape === 'diamond'
    ? 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)'
    : shape === 'triangle'
    ? 'polygon(50% 0%, 100% 100%, 0% 100%)'
    : undefined;

  return (
    <>
      <NodeResizer
        isVisible={selected && !element.locked}
        minWidth={20}
        minHeight={20}
        lineStyle={{ borderColor: '#3b82f6', borderWidth: 1 }}
        handleStyle={{ width: 8, height: 8, backgroundColor: 'white', borderColor: '#3b82f6', borderWidth: 2, borderRadius: 1 }}
      />
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
      {/* Stroke overlay for clipped shapes */}
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
  );
}

export const RectangleNode = memo(RectangleNodeComponent);
