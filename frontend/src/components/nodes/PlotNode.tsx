import { memo, useCallback } from 'react';
import { NodeProps } from '@xyflow/react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import { Code2, Lock } from 'lucide-react';
import { Resizer } from './Resizer';

interface PlotNodeData {
  elementId: string;
  [key: string]: unknown;
}

function PlotNodeComponent({ id, data, selected }: NodeProps) {
  const elementId = (data as PlotNodeData).elementId;
  const element = useBoardStore(s => s.board?.elements.find(el => el.id === elementId));
  const updateElement = useBoardStore(s => s.updateElement);
  const pushHistory = useBoardStore(s => s.pushHistory);
  const zoom = useUIStore(s => s.zoom);
  const invZoom = 1 / Math.max(zoom, 0.1);

  const handleDoubleClick = useCallback(() => {
    if (element && !element.locked) {
      useUIStore.getState().setPlotEditorElementId(elementId);
    }
  }, [elementId, element?.locked]);

  const onResizeAbsolute = useCallback((x: number, y: number, w: number, h: number) => {
    updateElement(elementId, { x, y, width: w, height: h });
  }, [elementId, updateElement]);

  const onResizeEnd = useCallback(() => {
    pushHistory('Resize');
  }, [pushHistory]);

  const getRect = useCallback(() => {
    const el = useBoardStore.getState().board?.elements.find(e => e.id === elementId);
    return el ? { x: el.x, y: el.y, width: el.width, height: el.height } : { x: 0, y: 0, width: 480, height: 520 };
  }, [elementId]);

  if (!element || element.type !== 'plot') return null;

  const { style, metadata } = element;
  const lastOutput = metadata?.lastOutput as string | null;
  const lastStdout = metadata?.lastStdout as string | null;
  const lastError = metadata?.lastError as string | null;
  const rotation = element.rotation || 0;

  return (
    <div style={rotation ? { transform: `rotate(${rotation}deg)`, width: '100%', height: '100%' } : { width: '100%', height: '100%' }}>
      <Resizer
        isVisible={selected && !element.locked}
        nodeId={id}
        minWidth={100}
        minHeight={80}
        onResizeAbsolute={onResizeAbsolute}
        onResizeEnd={onResizeEnd}
        getRect={getRect}
        lockAspect={element.metadata?.lockAspectRatio !== false}
        rotation={rotation}
        onRotate={r => updateElement(elementId, { rotation: r })}
        onRotateEnd={() => pushHistory('Rotate')}
      />
      <div
        className="w-full h-full relative overflow-hidden"
        style={{
          borderColor: style.borderColor || '#d0d0d0',
          borderWidth: style.borderWidth ?? 0,
          borderStyle: (style.borderWidth ?? 0) > 0 ? 'solid' : 'none',
          borderRadius: style.borderRadius ?? 0,
          backgroundColor: style.background || 'transparent',
          boxShadow: style.shadow ? '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.06)' : 'none',
          opacity: style.opacity ?? 1,
        }}
        onDoubleClick={handleDoubleClick}
      >
        {lastOutput ? (
          <img
            src={`data:image/png;base64,${lastOutput}`}
            alt="Plot output"
            className="w-full h-full"
            style={{ objectFit: 'fill' as const }}
            draggable={false}
          />
        ) : lastStdout ? (
          <div className="w-full h-full overflow-hidden p-2">
            <pre className="text-xs text-on-surface-primary whitespace-pre-wrap break-words"
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' }}
            >{lastStdout}</pre>
          </div>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-gray-400 dark:text-on-surface-muted select-none">
            <Code2 size={24} />
            <span className="text-xs">
              {lastError ? 'Error — double-click to fix' : 'Double-click to edit'}
            </span>
          </div>
        )}

        {/* Status indicators */}
        <div className="absolute top-1 right-1 flex gap-1">
          {element.locked && (
            <div className="bg-white/80 dark:bg-black/40 rounded p-0.5" title="Locked">
              <Lock size={10} className="text-gray-500 dark:text-gray-400" />
            </div>
          )}
        </div>

        {/* Label on hover — zoom invariant */}
        {selected && (
          <div className="absolute left-0 right-0 bg-black/60 text-white truncate"
            style={{ bottom: 0, fontSize: 10 * invZoom, padding: `${2 * invZoom}px ${4 * invZoom}px` }}>
            Python Plot
          </div>
        )}
      </div>
    </div>
  );
}

export const PlotNode = memo(PlotNodeComponent);
