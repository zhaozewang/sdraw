import { memo } from 'react';
import { NodeProps, NodeResizer } from '@xyflow/react';
import { useBoardStore } from '@/store/boardStore';

interface ArrowNodeData {
  elementId: string;
  [key: string]: unknown;
}

function ArrowNodeComponent({ id, data, selected }: NodeProps) {
  const elementId = (data as ArrowNodeData).elementId;
  const element = useBoardStore(s => s.board?.elements.find(el => el.id === elementId));

  if (!element || element.type !== 'arrow') return null;

  const { style } = element;
  const strokeColor = style.strokeColor || '#333333';
  const strokeWidth = style.strokeWidth ?? 2;
  const dashArray = style.strokeStyle === 'dashed' ? '8,4' : style.strokeStyle === 'dotted' ? '2,4' : undefined;

  return (
    <>
      <NodeResizer
        isVisible={selected && !element.locked}
        minWidth={20}
        minHeight={4}
        lineStyle={{ borderColor: '#3b82f6', borderWidth: 1 }}
        handleStyle={{ width: 8, height: 8, backgroundColor: 'white', borderColor: '#3b82f6', borderWidth: 2, borderRadius: 1 }}
      />
      <svg
        className="w-full h-full overflow-visible"
        style={{ opacity: style.opacity ?? 1, minHeight: 4 }}
      >
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
        <line
          x1="0"
          y1="50%"
          x2="100%"
          y2="50%"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={dashArray}
          markerEnd={`url(#arrowhead-${elementId})`}
        />
      </svg>
    </>
  );
}

export const ArrowNode = memo(ArrowNodeComponent);
