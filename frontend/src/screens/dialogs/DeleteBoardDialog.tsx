export function DeleteBoardDialog({ boardName, onConfirm, onCancel }: {
  boardName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-white dark:bg-surface-primary rounded-lg shadow-xl w-[380px]" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-on-surface-primary">Delete Board</h2>
        </div>
        <div className="px-4 py-4 space-y-2">
          <p className="text-sm text-gray-600 dark:text-on-surface-secondary">
            Are you sure you want to delete <strong>{boardName}</strong>?
          </p>
          <p className="text-xs text-gray-400 dark:text-on-surface-muted">
            The board file and any associated auto-exports will be permanently removed. This cannot be undone.
          </p>
        </div>
        <div className="px-4 py-3 border-t border-gray-100 dark:border-border flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm text-gray-600 dark:text-on-surface-secondary hover:bg-gray-100 dark:hover:bg-surface-tertiary rounded">
            Cancel
          </button>
          <button onClick={onConfirm} className="px-3 py-1.5 text-sm bg-red-500 text-white rounded hover:bg-red-600">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
