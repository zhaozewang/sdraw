import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import { Wifi, WifiOff, Loader2 } from 'lucide-react';

export function StatusBar() {
  const board = useBoardStore(s => s.board);
  const isDirty = useBoardStore(s => s.isDirty);
  const selectedIds = useUIStore(s => s.selectedIds);
  const zoom = useUIStore(s => s.zoom);
  const connectionStatus = useUIStore(s => s.connectionStatus);
  const recentEvents = useUIStore(s => s.recentEvents);
  const progressLabel = useUIStore(s => s.progressLabel);

  if (!board) return null;

  const lastEvent = recentEvents[0];

  return (
    <div className="h-6 bg-toolbar-bg border-t border-toolbar-border flex items-center px-3 text-2xs text-gray-500 dark:text-on-surface-muted gap-4 select-none shrink-0">
      {/* Connection status */}
      <div className="flex items-center gap-1" title={`WebSocket: ${connectionStatus}`}>
        {connectionStatus === 'connected' ? (
          <Wifi size={10} className="text-green-500" />
        ) : connectionStatus === 'connecting' ? (
          <Loader2 size={10} className="text-amber-500 animate-spin" />
        ) : (
          <WifiOff size={10} className="text-red-400" />
        )}
        <span>{connectionStatus}</span>
      </div>

      {/* Board info */}
      <span>{board.name}</span>
      <span>{board.elements.length} elements</span>

      {/* Selection */}
      {selectedIds.length > 0 && (
        <span>{selectedIds.length} selected</span>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Last event */}
      {lastEvent && (
        <span className="text-gray-400 dark:text-on-surface-muted truncate max-w-xs" title={lastEvent.path}>
          {lastEvent.type}: {lastEvent.path.split('/').pop()}
        </span>
      )}

      {/* Save status — active save/upload supersedes the "Unsaved" chip so
          the user sees "Saving… → (gone)" instead of a loud top bar. */}
      {progressLabel ? (
        <span className="flex items-center gap-1 text-accent">
          <Loader2 size={10} className="animate-spin" />
          {progressLabel}
        </span>
      ) : isDirty ? (
        <span className="text-amber-500">Unsaved</span>
      ) : null}

      {/* Zoom */}
      <span className="tabular-nums">{Math.round(zoom * 100)}%</span>
    </div>
  );
}
