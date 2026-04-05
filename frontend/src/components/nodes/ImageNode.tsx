import { memo, useState, useCallback, useMemo } from 'react';
import { NodeProps, NodeResizer } from '@xyflow/react';
import { useBoardStore } from '@/store/boardStore';
import { api } from '@/api/client';
import { RefreshCw, AlertTriangle, Lock } from 'lucide-react';

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

  const handleRefresh = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (sourcePath) {
      useBoardStore.getState().bumpImageVersion(sourcePath);
      setImgError(false);
      setLoading(true);
    }
  }, [sourcePath]);

  if (!element || element.type !== 'image') return null;

  const { source, style } = element;

  const fitMode = style.fitMode || 'contain';
  const objectFit =
    fitMode === 'contain' ? 'contain' :
    fitMode === 'cover' ? 'cover' :
    fitMode === 'stretch' ? 'fill' :
    fitMode === 'center' ? 'none' : 'contain';

  return (
    <>
      <NodeResizer
        isVisible={selected && !element.locked}
        minWidth={50}
        minHeight={50}
        lineStyle={{ borderColor: '#3b82f6', borderWidth: 1 }}
        handleStyle={{ width: 8, height: 8, backgroundColor: 'white', borderColor: '#3b82f6', borderWidth: 2, borderRadius: 1 }}
      />
      <div
        className="w-full h-full relative overflow-hidden"
        style={{
          borderColor: style.borderColor || '#d0d0d0',
          borderWidth: style.borderWidth ?? 1,
          borderStyle: 'solid',
          borderRadius: style.borderRadius ?? 4,
          backgroundColor: style.background || '#ffffff',
          boxShadow: style.shadow ? '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.06)' : 'none',
          opacity: style.opacity ?? 1,
        }}
      >
        {imgUrl && !imgError ? (
          <img
            src={imgUrl}
            alt=""
            className="w-full h-full"
            style={{ objectFit }}
            onLoad={() => setLoading(false)}
            onError={() => { setImgError(true); setLoading(false); }}
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

        {loading && imgUrl && !imgError && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/50">
            <RefreshCw size={16} className="animate-spin text-gray-400" />
          </div>
        )}

        {/* Status indicators */}
        <div className="absolute top-1 right-1 flex gap-1">
          {element.locked && (
            <div className="bg-white/80 rounded p-0.5" title="Locked">
              <Lock size={10} className="text-gray-500" />
            </div>
          )}
          <button
            onClick={handleRefresh}
            className="bg-white/80 rounded p-0.5 hover:bg-white transition-colors"
            title="Refresh image"
          >
            <RefreshCw size={10} className="text-gray-500" />
          </button>
        </div>

        {/* File path indicator on hover */}
        {selected && source?.path && (
          <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-2xs px-1.5 py-0.5 truncate">
            {source.path.split('/').pop()}
          </div>
        )}
      </div>
    </>
  );
}

export const ImageNode = memo(ImageNodeComponent);
