import { useMemo } from 'react';
import { LayoutGrid, Layers, Trash2 } from 'lucide-react';
import type { WorkspaceBoardSummary } from '@/api/client';

export function BoardCard({ board, onClick, onDelete }: { board: WorkspaceBoardSummary; onClick: () => void; onDelete: () => void }) {
  const timeAgo = useMemo(() => {
    try {
      const d = new Date(board.updated_at);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return 'Just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHr = Math.floor(diffMin / 60);
      if (diffHr < 24) return `${diffHr}h ago`;
      const diffDay = Math.floor(diffHr / 24);
      if (diffDay < 30) return `${diffDay}d ago`;
      return d.toLocaleDateString();
    } catch { return ''; }
  }, [board.updated_at]);

  return (
    <div
      onClick={onClick}
      className="group relative flex flex-col bg-white dark:bg-surface-primary rounded-xl border border-gray-200 dark:border-border hover:border-blue-300 dark:hover:border-blue-500/50 hover:shadow-md transition-all duration-150 overflow-hidden text-left cursor-pointer"
    >
      {/* Delete button */}
      <button
        onClick={e => { e.stopPropagation(); onDelete(); }}
        className="absolute top-2 right-2 z-10 p-1 rounded-md bg-white/80 dark:bg-surface-tertiary/80 text-gray-400 dark:text-on-surface-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 opacity-0 group-hover:opacity-100 transition-all shadow-sm"
        title="Delete board"
      >
        <Trash2 size={14} />
      </button>
      {/* Preview area */}
      <div className="relative w-full aspect-[3/2] bg-gradient-to-br from-gray-50 to-gray-100 dark:from-surface-secondary dark:to-surface-tertiary flex items-center justify-center overflow-hidden">
        {board.thumbnail ? (
          <img src={board.thumbnail} alt={board.name} className="w-full h-full object-cover" />
        ) : board.image_count > 0 ? (
          <div className="flex items-center gap-3 text-gray-300">
            <LayoutGrid size={32} strokeWidth={1.5} />
            <div className="text-left">
              <div className="text-2xl font-semibold text-gray-400">{board.image_count}</div>
              <div className="text-[10px] uppercase tracking-wider text-gray-400">panels</div>
            </div>
          </div>
        ) : (
          <div className="text-gray-300">
            <Layers size={28} strokeWidth={1.5} />
          </div>
        )}
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      {/* Info */}
      <div className="px-3 py-2.5 border-t border-gray-100 dark:border-border flex-1 flex flex-col gap-0.5">
        <div className="text-sm font-medium text-gray-800 dark:text-on-surface-primary truncate">{board.name}</div>
        <div className="flex items-center gap-2 text-[11px] text-gray-400 dark:text-on-surface-muted">
          <span>{board.element_count} element{board.element_count !== 1 ? 's' : ''}</span>
          <span className="text-gray-200 dark:text-on-surface-disabled">|</span>
          <span>{timeAgo}</span>
        </div>
      </div>
    </div>
  );
}
