import { memo, useCallback } from 'react';
import { NodeProps } from '@xyflow/react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import { Resizer } from './Resizer';

interface PenNodeData {
  elementId: string;
  [key: string]: unknown;
}

function PenNodeComponent({ id, data, selected: rfSelected }: NodeProps) {
  const elementId = (data as PenNodeData).elementId;
  const element = useBoardStore(s => s.board?.elements.find(el => el.id === elementId));
  const updateElement = useBoardStore(s => s.updateElement);
  const pushHistory = useBoardStore(s => s.pushHistory);
  const isSelectedInStore = useUIStore(s => s.selectedIds.includes(elementId));
  const selected = rfSelected || isSelectedInStore;

  const onResizeAbsolute = useCallback((x: number, y: number, w: number, h: number) => {
    if (!element) return;
    const oldW = element.width || 1;
    const oldH = element.height || 1;
    const scaleX = w / oldW;
    const scaleY = h / oldH;
    const scaledPoints = (element.points || []).map(p => ({
      x: p.x * scaleX,
      y: p.y * scaleY,
    }));
    updateElement(elementId, { x, y, width: w, height: h, points: scaledPoints });
  }, [elementId, element, updateElement]);

  const onResizeEnd = useCallback(() => {
    pushHistory('Resize');
  }, [pushHistory]);

  const getRect = useCallback(() => {
    const el = useBoardStore.getState().board?.elements.find(e => e.id === elementId);
    return el ? { x: el.x, y: el.y, width: el.width, height: el.height } : { x: 0, y: 0, width: 100, height: 100 };
  }, [elementId]);

  if (!element || element.type !== 'pen') return null;

  const { style } = element;
  const points = element.points || [];
  const rotation = element.rotation || 0;

  // Build SVG path from points
  let pathD = '';
  if (points.length > 0) {
    pathD = `M ${points[0].x},${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      pathD += ` L ${points[i].x},${points[i].y}`;
    }
  }

  const strokeColor = style.strokeColor || '#333333';
  const strokeWidth = style.strokeWidth ?? 2;
  const dashArray = style.strokeStyle === 'dashed' ? '8,4' : style.strokeStyle === 'dotted' ? '2,4' : undefined;

  return (
    <div style={rotation ? { transform: `rotate(${rotation}deg)`, width: '100%', height: '100%' } : { width: '100%', height: '100%' }}>
      <Resizer
        isVisible={selected && !element.locked}
        nodeId={id}
        minWidth={10}
        minHeight={10}
        onResizeAbsolute={onResizeAbsolute}
        onResizeEnd={onResizeEnd}
        getRect={getRect}
      />
      <svg
        className="overflow-visible absolute inset-0"
        style={{ opacity: style.opacity ?? 1, width: '100%', height: '100%', pointerEvents: 'none' }}
      >
        {/* Invisible thick path for easier selection */}
        {pathD && (
          <path
            d={pathD}
            fill="none"
            stroke="transparent"
            strokeWidth={Math.max(14, strokeWidth * 4)}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
            onPointerDown={(e) => {
              e.stopPropagation();
              const sel = useUIStore.getState().selectedIds;
              if (e.shiftKey) {
                if (sel.includes(elementId)) useUIStore.getState().removeFromSelection(elementId);
                else useUIStore.getState().addToSelection(elementId);
              } else if (!sel.includes(elementId)) {
                useUIStore.getState().setSelectedIds([elementId]);
              }
            }}
          />
        )}
        {pathD && (
          <path
            d={pathD}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={dashArray}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
    </div>
  );
}

export const PenNode = memo(PenNodeComponent);
