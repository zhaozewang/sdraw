import { memo, useCallback } from 'react';
import { NodeProps } from '@xyflow/react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import { Resizer } from './Resizer';

interface RectNodeData {
  elementId: string;
  [key: string]: unknown;
}

function RectangleNodeComponent({ id, data, selected: rfSelected }: NodeProps) {
  const elementId = (data as RectNodeData).elementId;
  const element = useBoardStore(s => s.board?.elements.find(el => el.id === elementId));
  const updateElement = useBoardStore(s => s.updateElement);
  const pushHistory = useBoardStore(s => s.pushHistory);
  const zoom = useUIStore(s => s.zoom);
  // Unfilled shapes may have selectable:false, check UI store directly
  const isSelectedInStore = useUIStore(s => s.selectedIds.includes(elementId));
  const selected = rfSelected || isSelectedInStore;

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
        aspectRatio={element.metadata?.lockAspectRatio ? element.width / element.height : undefined}
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
          {shape === 'triangle' || shape === 'diamond' ? (() => {
            const isFilled = !!style.fill && style.fill !== 'transparent';
            const polyPoints = shape === 'diamond' ? '50,0 100,50 50,100 0,50' : '50,0 100,100 0,100';
            const handleSelect = (e: React.PointerEvent) => {
              e.stopPropagation();
              const sel = useUIStore.getState().selectedIds;
              if (e.shiftKey) {
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
                useBoardStore.getState().updateConnectedArrows(elementId);
              };
              const onUp = () => {
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                if (moved) pushHistory('Move');
              };
              document.addEventListener('pointermove', onMove);
              document.addEventListener('pointerup', onUp);
            };
            return (
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none"
                style={{ pointerEvents: 'none' }}>
                {/* Invisible thick stroke for easier clicking on unfilled shapes */}
                {!isFilled && (
                  <polygon
                    points={polyPoints}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={Math.max(14, (style.strokeWidth ?? 2) * 4)}
                    vectorEffect="non-scaling-stroke"
                    style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                    onPointerDown={handleSelect}
                  />
                )}
                <polygon
                  points={polyPoints}
                  fill={style.fill || 'transparent'}
                  stroke={style.strokeColor || '#333333'}
                  strokeWidth={(style.strokeWidth ?? 2) * 2}
                  strokeDasharray={style.strokeStyle === 'dashed' ? '8,4' : style.strokeStyle === 'dotted' ? '2,4' : undefined}
                  vectorEffect="non-scaling-stroke"
                  style={{
                    opacity: style.opacity ?? 1,
                    pointerEvents: isFilled ? 'visiblePainted' : 'none',
                    cursor: isFilled ? 'pointer' : undefined,
                  }}
                  onPointerDown={isFilled ? handleSelect : undefined}
                />
              </svg>
            );
          })() : (
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
          )}
        </>
      )}
    </>
  );
}

export const RectangleNode = memo(RectangleNodeComponent);
