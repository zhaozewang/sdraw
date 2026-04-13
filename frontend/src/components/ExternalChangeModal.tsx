import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useBoardStore } from '@/store/boardStore';

/**
 * Shown when the user tries to save but the .sdraw file on disk has been
 * modified since we loaded it — typically because an external agent rewrote
 * the Python code. Offers two resolutions: Merge (take external code + keep
 * my canvas layout) or Overwrite (save my state, wiping external changes).
 * Cancel dismisses the modal and leaves the save pending. The rare "accept
 * disk wholesale, throw away my edits" case is handled by closing and
 * reopening the board.
 */
export function ExternalChangeModal() {
  const conflict = useBoardStore(s => s.externalConflict);
  const board = useBoardStore(s => s.board);
  const resolve = useBoardStore(s => s.resolveExternalConflict);

  const diffItems = useMemo(() => {
    if (!conflict || !board) return [] as string[];
    const localPlots = new Map(
      board.elements
        .filter(el => el.type === 'plot')
        .map(el => [el.id, String(el.metadata?.code ?? '')]),
    );
    const diskPlots = new Map(
      conflict.diskBoard.elements
        .filter(el => el.type === 'plot')
        .map(el => [el.id, String(el.metadata?.code ?? '')]),
    );
    let changed = 0;
    let added = 0;
    let removed = 0;
    for (const [id, diskCode] of diskPlots) {
      const localCode = localPlots.get(id);
      if (localCode === undefined) added++;
      else if (localCode !== diskCode) changed++;
    }
    for (const id of localPlots.keys()) {
      if (!diskPlots.has(id)) removed++;
    }
    const setupChanged =
      (board.setup?.code ?? '') !== (conflict.diskBoard.setup?.code ?? '');
    const out: string[] = [];
    if (changed) out.push(`${changed} plot${changed === 1 ? '' : 's'} with modified code`);
    if (added) out.push(`${added} new plot${added === 1 ? '' : 's'} on disk`);
    if (removed) out.push(`${removed} plot${removed === 1 ? '' : 's'} removed on disk`);
    if (setupChanged) out.push('Python Setup code changed');
    return out;
  }, [conflict, board]);

  if (!conflict) return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={() => resolve('cancel')}
    >
      <div
        className="bg-white dark:bg-surface-primary rounded-lg shadow-xl w-[420px]"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-gray-200 dark:border-border flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-500 shrink-0" />
          <h2 className="text-sm font-semibold text-gray-800 dark:text-on-surface-primary">
            External changes detected
          </h2>
        </div>
        <div className="px-4 py-4 space-y-3">
          <p className="text-sm text-gray-600 dark:text-on-surface-secondary">
            The .sdraw file on disk was modified by another process since you opened it.
          </p>
          {diffItems.length > 0 && (
            <ul className="text-xs text-gray-500 dark:text-on-surface-muted space-y-0.5 pl-4 list-disc">
              {diffItems.map((line, i) => <li key={i}>{line}</li>)}
            </ul>
          )}
          <div className="text-xs text-gray-500 dark:text-on-surface-muted space-y-1 pt-1">
            <div>
              <span className="font-medium text-gray-700 dark:text-on-surface-secondary">Merge</span>
              {' '}takes the new code from disk and keeps your canvas layout.
            </div>
            <div>
              <span className="font-medium text-gray-700 dark:text-on-surface-secondary">Overwrite</span>
              {' '}saves your in-memory version, discarding the external changes.
            </div>
          </div>
        </div>
        <div className="px-4 py-3 border-t border-gray-100 dark:border-border flex justify-end gap-1.5">
          <button
            onClick={() => resolve('cancel')}
            className="px-3 py-1.5 text-sm whitespace-nowrap text-gray-600 dark:text-on-surface-secondary hover:bg-gray-100 dark:hover:bg-surface-tertiary rounded"
          >
            Cancel
          </button>
          <button
            onClick={() => resolve('mine')}
            className="px-3 py-1.5 text-sm whitespace-nowrap text-gray-700 dark:text-on-surface-primary hover:bg-gray-100 dark:hover:bg-surface-tertiary rounded"
          >
            Overwrite
          </button>
          <button
            onClick={() => resolve('merge')}
            className="px-3 py-1.5 text-sm whitespace-nowrap bg-blue-500 text-white rounded hover:bg-blue-600 font-medium"
          >
            Merge
          </button>
        </div>
      </div>
    </div>
  );
}
