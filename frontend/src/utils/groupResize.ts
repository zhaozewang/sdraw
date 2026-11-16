import type { BoardElement } from '@/types/board';

export type ElementRect = Pick<BoardElement, 'x' | 'y' | 'width' | 'height'>;

// Calculate from the saved layout so repeated pointer moves never compound scaling.
export function groupResizeUpdates(
  group: BoardElement, elements: BoardElement[], rect: ElementRect,
  direct?: ReadonlyMap<string, Partial<BoardElement>>,
) {
  const byId = new Map(elements.map(element => [element.id, element]));
  const updates: Array<{ id: string; changes: Partial<BoardElement> & ElementRect }> = [
    { id: group.id, changes: rect },
  ];
  const visited = new Set([group.id]);
  for (let i = 0; i < updates.length; i++) {
    const parent = byId.get(updates[i].id)!;
    const target = updates[i].changes;
    const sx = parent.width > 0 ? target.width / parent.width : 1;
    const sy = parent.height > 0 ? target.height / parent.height : 1;
    for (const id of parent.children ?? []) {
      const child = byId.get(id);
      if (!child || visited.has(id)) continue;
      visited.add(id);
      const explicit = direct?.get(id);
      const x = explicit?.x ?? target.x + (child.x - parent.x) * sx;
      const y = explicit?.y ?? target.y + (child.y - parent.y) * sy;
      const changes = {
        x, y, width: child.width * sx, height: child.height * sy,
        ...explicit,
        metadata: { ...child.metadata, relX: x - target.x, relY: y - target.y, ...explicit?.metadata },
      } as Partial<BoardElement> & ElementRect;
      if ((sx !== 1 || sy !== 1) && (child.type === 'arrow' || child.type === 'pen')) {
        const scalePoint = (p: { x: number; y: number }) => ({ x: p.x * sx, y: p.y * sy });
        if (child.points && !explicit?.points) changes.points = child.points.map(scalePoint);
        if (child.metadata?.controlPoints && !explicit?.metadata?.controlPoints) {
          changes.metadata!.controlPoints = child.metadata.controlPoints.map(
            (p: { x: number; y: number } | null) => p && scalePoint(p),
          );
        }
      }
      updates.push({ id, changes });
    }
  }
  return updates;
}
