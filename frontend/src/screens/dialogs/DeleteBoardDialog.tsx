import { AlertTriangle } from 'lucide-react';

/**
 * Two-option delete:
 *  - "Remove from list" just unhooks the board from the welcome screen
 *    (clears the recent-boards entry; adds to a "hidden paths" list for
 *    workspace boards so they stop appearing). The file stays on disk.
 *  - "Delete file permanently" removes the file from disk (current
 *    default — the destructive action).
 */
export function DeleteBoardDialog({ boardName, onRemoveFromList, onDeleteFile, onCancel }: {
  boardName: string;
  onRemoveFromList: () => void;
  onDeleteFile: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-white dark:bg-surface-primary rounded-lg shadow-xl w-[440px]" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-200 dark:border-border">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-on-surface-primary">Remove board</h2>
        </div>
        <div className="px-4 py-4 space-y-3">
          <p className="text-sm text-gray-600 dark:text-on-surface-secondary">
            What do you want to do with <strong>{boardName}</strong>?
          </p>
          <div className="space-y-2">
            <button
              onClick={onRemoveFromList}
              className="w-full text-left px-3 py-2 rounded border border-gray-200 dark:border-border hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-surface-tertiary transition-colors"
            >
              <div className="text-xs font-medium text-gray-800 dark:text-on-surface-primary">Remove from list</div>
              <div className="text-2xs text-gray-500 dark:text-on-surface-muted mt-0.5">
                Hide it from the welcome screen. The .sdraw file stays on disk.
              </div>
            </button>
            <button
              onClick={onDeleteFile}
              className="w-full text-left px-3 py-2 rounded border border-gray-200 dark:border-border hover:border-red-400 hover:bg-red-50/50 dark:hover:bg-surface-tertiary transition-colors"
            >
              <div className="text-xs font-medium text-red-600 dark:text-red-400 flex items-center gap-1.5">
                <AlertTriangle size={12} className="shrink-0" />
                Delete file permanently
              </div>
              <div className="text-2xs text-gray-500 dark:text-on-surface-muted mt-0.5">
                Removes the .sdraw file from disk. This cannot be undone.
              </div>
            </button>
          </div>
        </div>
        <div className="px-4 py-3 border-t border-gray-100 dark:border-border flex justify-end">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm text-gray-600 dark:text-on-surface-secondary hover:bg-gray-100 dark:hover:bg-surface-tertiary rounded">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
