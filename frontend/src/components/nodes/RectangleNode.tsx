import { memo, useCallback } from 'react';
import { NodeProps } from '@xyflow/react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import { Resizer } from './Resizer';
import { roundedJunctionPath } from '@/utils/arrowGeometry';

/** Compute polygon points (in 0-100 viewBox) for a shape with adjustable params.
 *  sw = shaft width (0-1), hl = head length (0-1) */
function getShapePoints(shape: string, sw: number, hl: number): string {
  // For arrow shapes: sw controls body thickness, hl controls head size
  const s = Math.max(0.05, Math.min(0.95, sw)); // shaft width fraction
  const h = Math.max(0.05, Math.min(0.95, hl)); // head length fraction
  const top = 50 - s * 50;   // shaft top edge
  const bot = 50 + s * 50;   // shaft bottom edge
  const neck = 100 - h * 100; // where head meets shaft (main axis)

  switch (shape) {
    case 'encoder': return '0,0 100,18 100,82 0,100';
    case 'decoder': return '0,18 100,0 100,100 0,82';
    case 'arrow-right':
      return `0,${top} ${neck},${top} ${neck},0 100,50 ${neck},100 ${neck},${bot} 0,${bot}`;
    case 'arrow-left':
      return `0,50 ${h * 100},0 ${h * 100},${top} 100,${top} 100,${bot} ${h * 100},${bot} ${h * 100},100`;
    case 'arrow-up':
      return `50,0 100,${h * 100} ${bot},${h * 100} ${bot},100 ${top},100 ${top},${h * 100} 0,${h * 100}`;
    case 'arrow-down':
      return `${top},0 ${bot},0 ${bot},${neck} 100,${neck} 50,100 0,${neck} ${top},${neck}`;
    case 'arrow-double':
      return `0,50 ${h * 50},0 ${h * 50},${top} ${100 - h * 50},${top} ${100 - h * 50},0 100,50 ${100 - h * 50},100 ${100 - h * 50},${bot} ${h * 50},${bot} ${h * 50},100`;
    case 'chevron': {
      const indent = h * 100;
      return `0,0 ${100 - indent},0 100,50 ${100 - indent},100 0,100 ${indent},50`;
    }
    case 'diamond':
      return '50,0 100,50 50,100 0,50';
    case 'triangle':
      return '50,0 100,100 0,100';
    default:
      return '50,0 100,100 0,100';
  }
}

/** Check if a shape supports adjustable shaft/head handles */
const ADJUSTABLE_SHAPES = new Set(['arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'arrow-double', 'chevron']);

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
    // For groups, `updateElement` propagates the scale to every child.
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
  const rotation = element.rotation || 0;

  return (
    <div style={rotation ? { transform: `rotate(${rotation}deg)`, width: '100%', height: '100%' } : { width: '100%', height: '100%' }}>
      <Resizer
        isVisible={selected && !element.locked}
        nodeId={id}
        minWidth={20}
        minHeight={20}
        onResizeAbsolute={onResizeAbsolute}
        onResizeEnd={onResizeEnd}
        getRect={getRect}
        lockAspect={!!element.metadata?.lockAspectRatio}
        rotation={rotation}
        onRotate={r => updateElement(elementId, { rotation: r })}
        onRotateEnd={() => pushHistory('Rotate')}
      />
      {isGroup ? (
        /* Group: invisible unless selected */
        <div
          className="w-full h-full"
          style={{
            border: selected ? `${Math.max(1, 1.5 * invZoom)}px dashed #3b82f6` : 'none',
            borderRadius: 2,
            backgroundColor: selected ? 'rgba(59,130,246,0.04)' : 'transparent',
            opacity: style.opacity ?? 1,
          }}
        />
      ) : (
        <>
          {shape && shape !== 'rectangle' ? (() => {
            const isJunction = shape === 'rounded-junction';
            const isFilled = !isJunction && !!style.fill && style.fill !== 'transparent';
            // Adjustable parameters (0-1): shaftWidth = fraction of cross-axis,
            // headLength = fraction of main axis for the arrowhead
            const sw = (metadata?.shaftWidth as number) ?? 0.5;
            const hl = (metadata?.headLength as number) ?? 0.4;
            // Compute points in actual pixel coordinates (not 0-100 viewBox)
            // to avoid non-uniform stroke scaling from preserveAspectRatio="none"
            const rawPoints = getShapePoints(shape, sw, hl);
            const w = element.width || 100;
            const h = element.height || 100;
            const ShapeTag = isJunction ? 'path' : 'polygon';
            const junctionPath = isJunction ? roundedJunctionPath(w, h, style.borderRadius ?? 0,
              (metadata?.junctionDirection as string) || 'down') : undefined;
            const polyPoints = rawPoints.split(' ').map(pair => {
              const [px, py] = pair.split(',').map(Number);
              return `${(px / 100) * w},${(py / 100) * h}`;
            }).join(' ');
            const handleSelect = (e: React.PointerEvent) => {
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
              // Plain click on an already-selected multi-member → remove only
              // this element if the click ends without a drag (pointerup
              // branch below). Modifier held or single-selection → no-op.
              const deferredRemove = !additive && wasSelected && sel.length >= 2;
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
                else if (deferredRemove) useUIStore.getState().removeFromSelection(elementId);
              };
              document.addEventListener('pointermove', onMove);
              document.addEventListener('pointerup', onUp);
            };
            return (<>
              <svg className="absolute inset-0 w-full h-full overflow-visible" viewBox={`0 0 ${w} ${h}`}
                style={{ pointerEvents: 'none' }}>
                {/* Invisible thick stroke for easier clicking on unfilled shapes */}
                {!isFilled && (
                  <ShapeTag
                    {...(isJunction ? { d: junctionPath } : { points: polyPoints })}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={Math.max(14, (style.strokeWidth ?? 2) * 4)}
                    style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                    onPointerDown={handleSelect}
                  />
                )}
                <ShapeTag
                  {...(isJunction ? { d: junctionPath } : { points: polyPoints })}
                  fill={isJunction ? 'none' : style.fill || 'transparent'}
                  stroke={style.strokeColor || '#333333'}
                  strokeWidth={style.strokeWidth ?? 2}
                  strokeDasharray={style.strokeStyle === 'dashed' ? '8,4' : style.strokeStyle === 'dotted' ? '2,4' : undefined}
                  style={{
                    opacity: style.opacity ?? 1,
                    pointerEvents: isFilled ? 'visiblePainted' : 'none',
                    cursor: isFilled ? 'pointer' : undefined,
                  }}
                  onPointerDown={isFilled ? handleSelect : undefined}
                />
              </svg>
              {/* Adjustable handles for arrow shapes */}
              {selected && ADJUSTABLE_SHAPES.has(shape!) && (() => {
                const isHoriz = shape === 'arrow-right' || shape === 'arrow-left' || shape === 'arrow-double' || shape === 'chevron';
                const curSw = (metadata?.shaftWidth as number) ?? 0.5;
                const curHl = (metadata?.headLength as number) ?? 0.4;
                const handleSize = 14 / Math.max(zoom, 0.1);

                // Shaft width handle: on the shaft edge, drag cross-axis
                const swHandleStyle: React.CSSProperties = isHoriz
                  ? { left: '10%', top: `${(50 - curSw * 50)}%`, cursor: 'ns-resize' }
                  : { top: '10%', left: `${(50 - curSw * 50)}%`, cursor: 'ew-resize' };

                // Head length handle: at head/shaft junction, drag main-axis
                const hlHandleStyle: React.CSSProperties = isHoriz
                  ? { left: `${shape === 'arrow-left' ? curHl * 100 : 100 - curHl * 100}%`, top: '50%', cursor: 'ew-resize' }
                  : { top: `${shape === 'arrow-up' ? curHl * 100 : 100 - curHl * 100}%`, left: '50%', cursor: 'ns-resize' };

                const makeHandleDrag = (param: 'shaftWidth' | 'headLength') => (e: React.PointerEvent) => {
                  e.stopPropagation();
                  e.preventDefault();
                  const startX = e.clientX, startY = e.clientY;
                  const startVal = param === 'shaftWidth' ? curSw : curHl;
                  const viewport = document.querySelector('.react-flow__viewport') as HTMLElement;
                  const scale = viewport ? parseFloat(viewport.style.transform.match(/scale\((.+?)\)/)?.[1] || '1') : 1;

                  const onMove = (ev: PointerEvent) => {
                    const dx = (ev.clientX - startX) / scale;
                    const dy = (ev.clientY - startY) / scale;
                    let delta: number;
                    if (param === 'shaftWidth') {
                      delta = isHoriz ? -dy / element.height : -dx / element.width;
                    } else {
                      if (shape === 'arrow-left' || shape === 'arrow-up') {
                        delta = isHoriz ? dx / element.width : dy / element.height;
                      } else {
                        delta = isHoriz ? -dx / element.width : -dy / element.height;
                      }
                    }
                    const newVal = Math.max(0.05, Math.min(0.95, startVal + delta));
                    updateElement(elementId, { metadata: { ...element.metadata, [param]: newVal } });
                  };
                  const onUp = () => {
                    document.removeEventListener('pointermove', onMove);
                    document.removeEventListener('pointerup', onUp);
                    pushHistory('Adjust shape');
                  };
                  document.addEventListener('pointermove', onMove);
                  document.addEventListener('pointerup', onUp);
                };

                return (
                  <>
                    <div
                      onPointerDown={makeHandleDrag('shaftWidth')}
                      style={{
                        position: 'absolute', ...swHandleStyle,
                        width: handleSize, height: handleSize,
                        background: '#f59e0b', border: '1.5px solid white',
                        borderRadius: '50%', transform: 'translate(-50%, -50%)',
                        zIndex: 20, pointerEvents: 'auto',
                      }}
                      title="Drag to adjust shaft width"
                    />
                    <div
                      onPointerDown={makeHandleDrag('headLength')}
                      style={{
                        position: 'absolute', ...hlHandleStyle,
                        width: handleSize, height: handleSize,
                        background: '#f59e0b', border: '1.5px solid white',
                        borderRadius: '50%', transform: 'translate(-50%, -50%)',
                        zIndex: 20, pointerEvents: 'auto',
                      }}
                      title="Drag to adjust head size"
                    />
                  </>
                );
              })()}
            </>);
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
    </div>
  );
}

export const RectangleNode = memo(RectangleNodeComponent);
