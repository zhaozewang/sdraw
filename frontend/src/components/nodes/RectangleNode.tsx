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

  const { style } = element;

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
          borderColor: style.strokeColor || '#333333',
          borderWidth: style.strokeWidth ?? 2,
          borderStyle: style.strokeStyle || 'solid',
          borderRadius: style.borderRadius ?? 0,
          opacity: style.opacity ?? 1,
        }}
      />
    </>
  );
}

export const RectangleNode = memo(RectangleNodeComponent);
