import { memo, useState, useCallback, useMemo } from 'react';
import { NodeProps } from '@xyflow/react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import { api } from '@/api/client';
import { RefreshCw, AlertTriangle, Lock } from 'lucide-react';
import { Resizer } from './Resizer';

interface ImageNodeData {
  elementId: string;
  [key: string]: unknown;
}

function ImageNodeComponent({ id, data, selected }: NodeProps) {
  const elementId = (data as ImageNodeData).elementId;
  const element = useBoardStore(s => s.board?.elements.find(el => el.id === elementId));
  const sourcePath = element?.source?.path || '';

  // Separate selector that only depends on the path string, not the element reference
  const imageVersion = useBoardStore(
    useCallback((s) => sourcePath ? (s.imageVersions[sourcePath] ?? 0) : 0, [sourcePath])
  );

  const [imgError, setImgError] = useState(false);
  const [loading, setLoading] = useState(true);

  // Stable image URL — only changes when path or version changes
  const imgUrl = useMemo(
    () => sourcePath ? api.getImageUrl(sourcePath, imageVersion) : '',
    [sourcePath, imageVersion]
  );

  const updateElement = useBoardStore(s => s.updateElement);
  const pushHistory = useBoardStore(s => s.pushHistory);
  const zoom = useUIStore(s => s.zoom);

  const handleRefresh = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (sourcePath) {
      useBoardStore.getState().bumpImageVersion(sourcePath);
      setImgError(false);
      setLoading(true);
    }
  }, [sourcePath]);

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

  if (!element || element.type !== 'image') return null;

  const { source, style } = element;
  const invZoom = 1 / Math.max(zoom, 0.1);

  const rotation = element.rotation || 0;

  // When we're serving from the board's embedded base64 copy there's
  // nothing to wait for — the bytes are already in memory. Suppressing
  // the loading state here is what prevents the `bg-white/50` spinner
  // overlay from ghosting every image on the canvas after open.
  const usingEmbedded = !!source?.embeddedData && imageVersion === 0;

  return (
    <div style={rotation ? { transform: `rotate(${rotation}deg)`, width: '100%', height: '100%' } : { width: '100%', height: '100%' }}>
      <Resizer
        isVisible={selected && !element.locked}
        nodeId={id}
        minWidth={50}
        minHeight={50}
        onResizeAbsolute={onResizeAbsolute}
        onResizeEnd={onResizeEnd}
        getRect={getRect}
        lockAspect={true}
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
      >
        {/* Prefer the embedded base64 copy when we already have it AND
            no explicit refresh has been requested (imageVersion == 0).
            Fetching /api/image for a linked file we've already embedded
            is pure waste — over an SSH tunnel it can blow the link's
            budget on every page load. Once the user clicks Refresh or
            a file-change event bumps the version, we fall through to
            the live URL fetch below. */}
        {usingEmbedded ? (
          <img
            src={`data:${source!.embeddedMime || 'image/png'};base64,${source!.embeddedData}`}
            alt=""
            className="w-full h-full"
            style={{ objectFit: 'fill' as const }}
            draggable={false}
          />
        ) : imgUrl && !imgError ? (
          <img
            src={imgUrl}
            alt=""
            className="w-full h-full"
            style={{ objectFit: 'fill' as const }}
            onLoad={() => setLoading(false)}
            onError={() => { setImgError(true); setLoading(false); }}
            draggable={false}
          />
        ) : source?.embeddedData ? (
          /* Fallback to embedded copy when source file is missing */
          <img
            src={`data:${source.embeddedMime || 'image/png'};base64,${source.embeddedData}`}
            alt=""
            className="w-full h-full"
            style={{ objectFit: 'fill' as const }}
            draggable={false}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-50 text-gray-400">
            {imgError ? (
              <div className="flex flex-col items-center gap-1 text-xs">
                <AlertTriangle size={20} className="text-amber-500" />
                <span>Image not found</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1 text-xs">
                <span>No image linked</span>
              </div>
            )}
          </div>
        )}

        {loading && !usingEmbedded && imgUrl && !imgError && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/50">
            <RefreshCw size={16} className="animate-spin text-gray-400" />
          </div>
        )}

        {/* Status indicators — scale-invariant */}
        <div className="absolute flex items-center" style={{ top: 4 * invZoom, right: 4 * invZoom, gap: 3 * invZoom }}>
          {/* Link status dot */}
          {source?.linkStatus === 'unlinked' && (
            <div style={{ width: 10 * invZoom, height: 10 * invZoom, borderRadius: '50%', backgroundColor: '#fb923c', border: `${invZoom}px solid white`, boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }} title="Source file unlinked — using embedded copy" />
          )}
          {source?.linkStatus === 'updated' && (
            <div className="animate-pulse" style={{ width: 10 * invZoom, height: 10 * invZoom, borderRadius: '50%', backgroundColor: '#60a5fa', border: `${invZoom}px solid white`, boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }} title="Source file updated" />
          )}
          {source?.linkStatus === 'error' && (
            <div style={{ width: 10 * invZoom, height: 10 * invZoom, borderRadius: '50%', backgroundColor: '#f87171', border: `${invZoom}px solid white`, boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }} title="Error accessing source file" />
          )}
          {source?.linkStatus === 'linked' && (
            <div style={{ width: 8 * invZoom, height: 8 * invZoom, borderRadius: '50%', backgroundColor: '#4ade80', border: `${invZoom}px solid white`, boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }} title="Linked — in sync" />
          )}
          {element.locked && (
            <div style={{ backgroundColor: 'rgba(255,255,255,0.8)', borderRadius: 2 * invZoom, padding: 2 * invZoom }} title="Locked">
              <Lock size={10 * invZoom} className="text-gray-500" />
            </div>
          )}
          <button
            onClick={handleRefresh}
            style={{ backgroundColor: 'rgba(255,255,255,0.8)', borderRadius: 2 * invZoom, padding: 2 * invZoom }}
            title="Refresh image"
          >
            <RefreshCw size={10 * invZoom} className="text-gray-500" />
          </button>
        </div>

        {/* File path indicator on hover — zoom invariant */}
        {selected && source?.path && (
          <div className="absolute left-0 right-0 bg-black/60 text-white truncate"
            style={{ bottom: 0, fontSize: 10 * invZoom, padding: `${2 * invZoom}px ${4 * invZoom}px`, transformOrigin: 'bottom left' }}>
            {source.path.split('/').pop()}
          </div>
        )}
      </div>
    </div>
  );
}

export const ImageNode = memo(ImageNodeComponent);
