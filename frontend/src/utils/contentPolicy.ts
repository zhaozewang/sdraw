import type { BoardElement } from '@/types/board';

/** Scientific figures are opaque assets, not editable collections of data marks. */
export function layoutChanges(element: BoardElement, changes: Partial<BoardElement>): Partial<BoardElement> {
  if (element.metadata?.contentPolicy !== 'layout-only') return changes;
  const result: Partial<BoardElement> = {};
  for (const key of ['x', 'y', 'z_index', 'visible', 'hidden', 'locked'] as const) {
    if (changes[key] !== undefined) Object.assign(result, { [key]: changes[key] });
  }
  if (changes.width !== undefined && changes.width > 0) {
    result.width = changes.width; result.height = element.height * changes.width / element.width;
  } else if (changes.height !== undefined && changes.height > 0) {
    result.height = changes.height; result.width = element.width * changes.height / element.height;
  }
  return result;
}
