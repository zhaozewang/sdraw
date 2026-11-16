/**
 * The board's display name IS the filename stem — no separate `name` field.
 * Every display site derives the name from `boardFilePath` (or the path of
 * a listed board summary). The legacy `board.name` field is deprecated; on
 * save the backend overwrites it with the filename stem so diverged values
 * normalize the next time a board is written.
 */

export function deriveBoardName(path: string | null | undefined): string {
  if (!path) return 'Untitled';
  const base = path.split('/').pop() || '';
  const stem = base.replace(/\.(sdraw|json|html|htm)$/i, '');
  return stem || 'Untitled';
}
