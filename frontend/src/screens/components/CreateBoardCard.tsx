import { Plus } from 'lucide-react';

export function CreateBoardCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col bg-white dark:bg-surface-primary rounded-xl border-2 border-dashed border-gray-200 dark:border-border hover:border-blue-400 hover:bg-blue-50/30 dark:hover:bg-blue-900/10 transition-all duration-150 overflow-hidden text-left"
    >
      {/* Preview area — same aspect ratio as BoardCard */}
      <div className="w-full aspect-[3/2] flex items-center justify-center">
        <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-surface-tertiary group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30 flex items-center justify-center transition-colors">
          <Plus size={24} className="text-gray-400 dark:text-on-surface-muted group-hover:text-blue-500 transition-colors" />
        </div>
      </div>
      {/* Info — matches BoardCard's bottom section */}
      <div className="px-3 py-2.5 border-t border-gray-100 dark:border-border flex-1 flex flex-col justify-center">
        <div className="text-sm font-medium text-gray-500 dark:text-on-surface-muted group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">New Board</div>
        <div className="text-[11px] text-gray-300 dark:text-on-surface-disabled">Create a new figure board</div>
      </div>
    </button>
  );
}
