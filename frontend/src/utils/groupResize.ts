import type { BoardElement } from '@/types/board';

export type ElementRect = Pick<BoardElement, 'x' | 'y' | 'width' | 'height'>;

// Work from the saved layout at pointer-down, so shrinking and enlarging
// within one gesture never compounds rounding errors.
export function groupResizeUpdates(group: BoardElement, elements: BoardElement[], rect: ElementRect) {
  const byId = new Map(elements.map(element => [element.id, element]));
  const scale = rect.width / group.width;
  const updates: Array<{ id: string; changes: Partial<BoardElement> & ElementRect }> = [
    { id: group.id, changes: rect },
  ];
  const visited = new Set([group.id]);
  for (let i = 0; i < updates.length; i++) {
    const parent = byId.get(updates[i].id)!;
    for (const id of parent.children ?? []) {
      const child = byId.get(id);
      if (!child || visited.has(id)) continue;
      visited.add(id);
      const changes: Partial<BoardElement> & ElementRect = {
        x: rect.x + (child.x - group.x) * scale,
        y: rect.y + (child.y - group.y) * scale,
        width: child.width * scale,
        height: child.height * scale,
        metadata: { ...child.metadata, relX: (child.x - parent.x) * scale, relY: (child.y - parent.y) * scale },
      };
      if (child.type === 'arrow') {
        const scalePoint = (p: { x: number; y: number }) => ({ x: p.x * scale, y: p.y * scale });
        if (child.points) changes.points = child.points.map(scalePoint);
        if (child.metadata.controlPoints) changes.metadata!.controlPoints = child.metadata.controlPoints.map(scalePoint);
      }
      updates.push({ id, changes });
    }
  }
  return updates;
}
