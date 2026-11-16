import { memo } from 'react';
import { NodeProps } from '@xyflow/react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import { useBoardElement, useIsExporting } from '@/store/exportContext';

interface PenNodeData {
  elementId: string;
  [key: string]: unknown;
}

function PenNodeComponent({ id, data, selected: rfSelected }: NodeProps) {
  const elementId = (data as PenNodeData).elementId;
  const element = useBoardElement(elementId);
  const isExporting = useIsExporting();
  const updateElement = useBoardStore(s => s.updateElement);
  const pushHistory = useBoardStore(s => s.pushHistory);
  const isSelectedInStoreLive = useUIStore(s => s.selectedIds.includes(elementId));
  const isSelectedInStore = isExporting ? false : isSelectedInStoreLive;
  const selected = rfSelected || isSelectedInStore;
  const zoom = useUIStore(s => s.zoom);

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
      <div className="absolute inset-0 pointer-events-none" style={{ minHeight: 16, minWidth: 16 }} />
      <svg
        className="overflow-visible absolute inset-0"
        style={{ opacity: style.opacity ?? 1, width: '100%', height: '100%', pointerEvents: 'none' }}
      >
        {/* Invisible thick path for easier selection + drag */}
        {pathD && (
          <path
            d={pathD}
            fill="none"
            stroke="transparent"
            strokeWidth={Math.max(14, strokeWidth * 4) / Math.max(zoom, 0.1)}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
            onPointerDown={(e) => {
              e.stopPropagation();
              const sel = useUIStore.getState().selectedIds;
              const additive = e.shiftKey || e.metaKey || e.ctrlKey;
              const wasSelected = sel.includes(elementId);
              if (additive) {
                if (wasSelected) useUIStore.getState().removeFromSelection(elementId);
                else useUIStore.getState().addToSelection(elementId);
              } else if (!wasSelected) {
                useUIStore.getState().setSelectedIds([elementId]);
              }
              // If the element was already part of a multi-selection and no
              // modifier is held, defer the decision to pointerup: if the
              // user didn't drag, treat it as a plain click and remove only
              // this element from the multi-selection.
              const deferredRemove = !additive && wasSelected && sel.length >= 2;
              // Drag support
              if (element.locked) return;
              const startX = e.clientX, startY = e.clientY;
              const origPos = { x: element.x, y: element.y };
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
                if (moved) pushHistory('Move');
                else if (deferredRemove) useUIStore.getState().removeFromSelection(elementId);
              };
              document.addEventListener('pointermove', onMove);
              document.addEventListener('pointerup', onUp);
            }}
          />
        )}
        {/* Selection highlight — scale-invariant glow behind the main path */}
        {selected && pathD && (
          <path
            d={pathD}
            fill="none"
            stroke="#3b82f6"
            strokeWidth={(strokeWidth + 4) / Math.max(zoom, 0.1)}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity={0.4}
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
