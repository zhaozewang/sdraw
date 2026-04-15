import { memo, useCallback, useState } from 'react';
import { NodeProps } from '@xyflow/react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import { Code2, Lock, AlertTriangle, X } from 'lucide-react';
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
  const [errorExpanded, setErrorExpanded] = useState(false);

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
    <div
      className="relative"
      style={rotation ? { transform: `rotate(${rotation}deg)`, width: '100%', height: '100%' } : { width: '100%', height: '100%' }}
    >
      {/* <python> tag — anchored above the panel, always visible, zoom invariant */}
      <div
        className="absolute left-0 pointer-events-none font-mono text-white bg-black/70 rounded-t whitespace-nowrap z-10"
        style={{
          bottom: '100%',
          transformOrigin: 'bottom left',
          transform: `scale(${invZoom})`,
          fontSize: 10,
          padding: '1px 6px',
          lineHeight: 1.4,
        }}
      >
        &lt;python&gt;
      </div>
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
          // Red ring if the last run failed, regardless of whether a cached
          // image is still visible — so you can spot failed cells from a
          // zoomed-out view without having to open each one.
          borderColor: lastError ? '#ef4444' : (style.borderColor || '#d0d0d0'),
          borderWidth: lastError ? 2 : (style.borderWidth ?? 0),
          borderStyle: lastError || (style.borderWidth ?? 0) > 0 ? 'solid' : 'none',
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
        ) : lastStdout && !lastError ? (
          <div className="w-full h-full overflow-hidden p-2">
            <pre className="text-xs text-on-surface-primary whitespace-pre-wrap break-words"
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' }}
            >{lastStdout}</pre>
          </div>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-gray-400 dark:text-on-surface-muted select-none">
            <Code2 size={24} />
            <span className="text-xs">
              {lastError ? 'Error — see log below' : 'Double-click to edit'}
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

        {/* Error log overlay — shows under the image whenever lastError is
            set, so a failed Run All is never silent when a cached image is
            still visible. Collapsed shows the last error line; clicking
            expands to the full scrollable traceback. */}
        {lastError && (
          <div
            className="absolute left-0 right-0 bottom-0 bg-red-600/90 text-white font-mono shadow-[0_-1px_4px_rgba(0,0,0,0.25)]"
            style={{
              fontSize: 11,
              maxHeight: errorExpanded ? '70%' : 'auto',
              display: 'flex',
              flexDirection: 'column',
            }}
            onDoubleClick={e => e.stopPropagation()}
          >
            <button
              type="button"
              className="flex items-center gap-1.5 px-2 py-1 text-left hover:bg-red-700/50"
              onClick={e => { e.stopPropagation(); setErrorExpanded(v => !v); }}
              title={errorExpanded ? 'Collapse error' : 'Expand error'}
            >
              <AlertTriangle size={12} className="shrink-0" />
              <span className="truncate flex-1">
                {lastError.trim().split('\n').slice(-1)[0] || 'Error'}
              </span>
              {errorExpanded && <X size={12} className="shrink-0" />}
            </button>
            {errorExpanded && (
              <pre
                className="flex-1 overflow-auto px-2 pb-2 whitespace-pre-wrap break-words"
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' }}
              >
                {lastError}
              </pre>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

export const PlotNode = memo(PlotNodeComponent);
