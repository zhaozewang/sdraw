import { describe, it, expect, beforeEach } from 'vitest';
import { useBoardStore } from '@/store/boardStore';
import {
  DEFAULT_CANVAS,
  DEFAULT_BOARD_SETUP,
  CURRENT_SCHEMA_VERSION,
  type Board,
} from '@/types/board';

function emptyBoard(): Board {
  return {
    schema_version: CURRENT_SCHEMA_VERSION,
    id: 'b1',
    name: 'Test',
    canvas: { ...DEFAULT_CANVAS },
    elements: [],
    setup: { ...DEFAULT_BOARD_SETUP },
    plotCodes: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    app_version: 'test',
  };
}

function reset() {
  useBoardStore.setState({ board: emptyBoard(), isDirty: false } as any);
}

describe('group + paste data integrity', () => {
  beforeEach(reset);

  it('pasted group does NOT share children with source', () => {
    const s = useBoardStore.getState();
    const r1 = s.addElement('rectangle', { x: 0, y: 0, width: 100, height: 100 });
    const r2 = s.addElement('rectangle', { x: 200, y: 0, width: 100, height: 100 });
    const gId = s.groupElements([r1.id, r2.id]);

    const board = useBoardStore.getState().board!;
    const src = board.elements;
    const sourceGroup = src.find(e => e.id === gId)!;

    // Simulate Cmd+C: serialize the group + children. structuredClone matches
    // what the keyboard handler does before stashing in the clipboard.
    const clipboardElements = structuredClone(
      src.filter(e => e.id === gId || sourceGroup.children!.includes(e.id)),
    );

    // Cmd+V
    useBoardStore.getState().pasteElements(clipboardElements, { x: 20, y: 20 });

    const after = useBoardStore.getState().board!.elements;
    const groups = after.filter(e => e.type === 'group');
    expect(groups.length).toBe(2);
    const [src1, copy] = groups[0].id === gId ? [groups[0], groups[1]] : [groups[1], groups[0]];

    // Source children must be untouched
    expect(src1.children).toEqual([r1.id, r2.id]);
    // Pasted group children must be NEW ids (not source ids)
    for (const cid of copy.children!) {
      expect(cid).not.toBe(r1.id);
      expect(cid).not.toBe(r2.id);
      expect(after.find(e => e.id === cid)).toBeTruthy();
    }
    // Pasted children must reference the pasted group, not the source group
    for (const cid of copy.children!) {
      const child = after.find(e => e.id === cid)!;
      expect(child.metadata?.groupId).toBe(copy.id);
      expect(child.metadata?.groupId).not.toBe(src1.id);
    }
    // Source children must still reference the source group
    for (const cid of src1.children!) {
      const child = after.find(e => e.id === cid)!;
      expect(child.metadata?.groupId).toBe(src1.id);
    }
  });

  it('ungrouping the pasted group does NOT affect source group', () => {
    const s = useBoardStore.getState();
    const r1 = s.addElement('rectangle', { x: 0, y: 0, width: 100, height: 100 });
    const r2 = s.addElement('rectangle', { x: 200, y: 0, width: 100, height: 100 });
    const gId = s.groupElements([r1.id, r2.id]);

    const board = useBoardStore.getState().board!;
    const sourceGroup = board.elements.find(e => e.id === gId)!;
    const clipboard = structuredClone(
      board.elements.filter(e => e.id === gId || sourceGroup.children!.includes(e.id)),
    );

    useBoardStore.getState().pasteElements(clipboard, { x: 20, y: 20 });

    const groups = useBoardStore.getState().board!.elements.filter(e => e.type === 'group');
    const pasted = groups.find(g => g.id !== gId)!;

    useBoardStore.getState().ungroupElements(pasted.id);

    const after = useBoardStore.getState().board!.elements;
    // Source group must still exist with intact children
    const src = after.find(e => e.id === gId);
    expect(src).toBeTruthy();
    expect(src!.children).toEqual([r1.id, r2.id]);
    // Source children must still reference source group
    expect(after.find(e => e.id === r1.id)!.metadata?.groupId).toBe(gId);
    expect(after.find(e => e.id === r2.id)!.metadata?.groupId).toBe(gId);
  });

  it('duplicating a group must fully clone children, not alias source IDs', () => {
    const s = useBoardStore.getState();
    const r1 = s.addElement('rectangle', { x: 0, y: 0, width: 100, height: 100 });
    const r2 = s.addElement('rectangle', { x: 200, y: 0, width: 100, height: 100 });
    const gId = s.groupElements([r1.id, r2.id]);

    const dup = useBoardStore.getState().duplicateElements([gId]);
    expect(dup.length).toBeGreaterThanOrEqual(1);
    const dupGroup = dup.find(e => e.type === 'group')!;
    // The duplicated group's children must NOT reference source elements.
    expect(dupGroup.children).not.toContain(r1.id);
    expect(dupGroup.children).not.toContain(r2.id);
    // Each child in the duplicated group must exist in the board.
    const after = useBoardStore.getState().board!.elements;
    for (const cid of dupGroup.children!) {
      expect(after.find(e => e.id === cid)).toBeTruthy();
    }
  });

  it('duplicating an arrow connected to shapes must remap connections when shapes are duplicated together', () => {
    const s = useBoardStore.getState();
    const r1 = s.addElement('rectangle', { x: 0, y: 0, width: 100, height: 100 });
    const r2 = s.addElement('rectangle', { x: 300, y: 0, width: 100, height: 100 });
    const arrow = s.addElement('arrow', {
      x: 100, y: 50,
      width: 200, height: 1,
      points: [{ x: 0, y: 0 }, { x: 200, y: 0 }],
      metadata: { startConnection: r1.id, endConnection: r2.id },
    });

    const dup = useBoardStore.getState().duplicateElements([r1.id, r2.id, arrow.id]);
    const dupArrow = dup.find(e => e.type === 'arrow')!;
    const dupShapes = dup.filter(e => e.type === 'rectangle');
    const dupShapeIds = new Set(dupShapes.map(s => s.id));

    // The duplicated arrow's connections must point to the duplicated shapes,
    // not to the source shapes.
    expect(dupShapeIds.has(dupArrow.metadata?.startConnection as string)).toBe(true);
    expect(dupShapeIds.has(dupArrow.metadata?.endConnection as string)).toBe(true);
    expect(dupArrow.metadata?.startConnection).not.toBe(r1.id);
    expect(dupArrow.metadata?.endConnection).not.toBe(r2.id);
  });

  it('moving a duplicated group does NOT move the source group children (no shared children)', () => {
    const s = useBoardStore.getState();
    const r1 = s.addElement('rectangle', { x: 0, y: 0, width: 100, height: 100 });
    const r2 = s.addElement('rectangle', { x: 200, y: 0, width: 100, height: 100 });
    const gId = s.groupElements([r1.id, r2.id]);

    const dup = useBoardStore.getState().duplicateElements([gId]);
    const dupGroup = dup.find(e => e.type === 'group')!;

    // Move the duplicate group by +500
    useBoardStore.getState().updateElement(dupGroup.id, {
      x: dupGroup.x + 500,
      y: dupGroup.y + 500,
    });

    const after = useBoardStore.getState().board!.elements;
    // Source children must NOT have moved.
    expect(after.find(e => e.id === r1.id)!.x).toBe(0);
    expect(after.find(e => e.id === r1.id)!.y).toBe(0);
    expect(after.find(e => e.id === r2.id)!.x).toBe(200);
    expect(after.find(e => e.id === r2.id)!.y).toBe(0);
  });

  it('ungrouping a duplicated group does NOT ungroup the source group', () => {
    const s = useBoardStore.getState();
    const r1 = s.addElement('rectangle', { x: 0, y: 0, width: 100, height: 100 });
    const r2 = s.addElement('rectangle', { x: 200, y: 0, width: 100, height: 100 });
    const gId = s.groupElements([r1.id, r2.id]);

    const dup = useBoardStore.getState().duplicateElements([gId]);
    const dupGroup = dup.find(e => e.type === 'group')!;

    useBoardStore.getState().ungroupElements(dupGroup.id);

    const after = useBoardStore.getState().board!.elements;
    // Source group must still exist with intact children
    const srcGroup = after.find(e => e.id === gId);
    expect(srcGroup, 'source group should still exist').toBeTruthy();
    expect(srcGroup!.children).toEqual([r1.id, r2.id]);
    expect(after.find(e => e.id === r1.id)!.metadata?.groupId).toBe(gId);
    expect(after.find(e => e.id === r2.id)!.metadata?.groupId).toBe(gId);
  });
});

describe('updateConnectedArrows skip set', () => {
  beforeEach(reset);

  // Pre-anchored arrow setup: r1 ↔ r2 with the start anchor pinned to r1's
  // right-middle edge and the end anchor to r2's left-middle edge. Matches
  // what the UI snap-to-shape does at creation time.
  function setupConnected() {
    const s = useBoardStore.getState();
    const r1 = s.addElement('rectangle', { x: 0, y: 0, width: 100, height: 100 });
    const r2 = s.addElement('rectangle', { x: 300, y: 0, width: 100, height: 100 });
    const arrow = s.addElement('arrow', {
      x: 100, y: 50, width: 200, height: 1,
      points: [{ x: 0, y: 0 }, { x: 200, y: 0 }],
      metadata: {
        startConnection: r1.id,
        endConnection: r2.id,
        startAnchor: { rx: 1, ry: 0.5 },
        endAnchor: { rx: 0, ry: 0.5 },
      },
    });
    return { r1, r2, arrow };
  }

  it('default behavior: dragging a shape pulls a connected arrow with it', () => {
    const s = useBoardStore.getState();
    const { r1, arrow } = setupConnected();

    s.updateElement(r1.id, { x: r1.x + 50, y: r1.y });
    s.updateConnectedArrows(r1.id);

    const a2 = useBoardStore.getState().board!.elements.find(e => e.id === arrow.id)!;
    // Arrow's start endpoint now sits on r1's new right-edge midpoint at
    // (50+100, 50) = (150, 50). Bbox expands rightward, so x advances.
    expect(a2.x).toBe(150);
  });

  it('with skipArrowIds containing the arrow, the arrow is NOT touched when its connected shape moves', () => {
    const s = useBoardStore.getState();
    const { r1, arrow } = setupConnected();
    const before = { ...useBoardStore.getState().board!.elements.find(e => e.id === arrow.id)! };

    s.updateElement(r1.id, { x: r1.x + 50, y: r1.y });
    s.updateConnectedArrows(r1.id, new Set([arrow.id]));

    const a2 = useBoardStore.getState().board!.elements.find(e => e.id === arrow.id)!;
    expect(a2.x).toBe(before.x);
    expect(a2.y).toBe(before.y);
    expect(a2.width).toBe(before.width);
    expect(a2.height).toBe(before.height);
    expect(a2.points).toEqual(before.points);
  });
});

describe('move-after-paste does NOT drag source arrow', () => {
  beforeEach(reset);

  // Reproduces the user-reported flow: select [shape, arrow], copy, paste,
  // then drag the pasted shape. Source arrow must stay put.
  it('source arrow stays put when pasted shape is dragged', () => {
    const s = useBoardStore.getState();
    const r1 = s.addElement('rectangle', { x: 0, y: 0, width: 100, height: 100 });
    const r2 = s.addElement('rectangle', { x: 300, y: 0, width: 100, height: 100 });
    const arrow = s.addElement('arrow', {
      x: 100, y: 50, width: 200, height: 1,
      points: [{ x: 0, y: 0 }, { x: 200, y: 0 }],
      metadata: {
        startConnection: r1.id,
        endConnection: r2.id,
        startAnchor: { rx: 1, ry: 0.5 },
        endAnchor: { rx: 0, ry: 0.5 },
      },
    });

    // Cmd+C
    const board = useBoardStore.getState().board!;
    const ids = new Set([r1.id, r2.id, arrow.id]);
    const clipboard = structuredClone(board.elements.filter(e => ids.has(e.id)));

    // Cmd+V
    const pasted = useBoardStore.getState().pasteElements(clipboard, { x: 50, y: 50 });

    // Caller would now do: setSelectedIds(pasted.map(p => p.id))
    const pastedShape1 = pasted.find(p => p.type === 'rectangle' && p.x === 50)!;
    const pastedArrow = pasted.find(p => p.type === 'arrow')!;
    const pastedArrowIds = new Set(pasted.filter(p => p.type === 'arrow').map(p => p.id));

    // Snapshot source arrow geometry
    const sourceArrowBefore = {
      ...useBoardStore.getState().board!.elements.find(e => e.id === arrow.id)!,
    };

    // Simulate user dragging pastedShape1 by +30,+30 (exactly what onNodesChange does)
    const shapeDelta = { x: 30, y: 30 };
    useBoardStore.getState().updateElement(pastedShape1.id, {
      x: pastedShape1.x + shapeDelta.x,
      y: pastedShape1.y + shapeDelta.y,
    });
    useBoardStore.getState().updateConnectedArrows(pastedShape1.id, pastedArrowIds);
    // Translate pasted arrow uniformly (mimicking the post-loop step)
    useBoardStore.getState().updateElement(pastedArrow.id, {
      x: pastedArrow.x + shapeDelta.x,
      y: pastedArrow.y + shapeDelta.y,
    });

    // Source arrow MUST be untouched.
    const sourceArrowAfter = useBoardStore.getState().board!.elements.find(e => e.id === arrow.id)!;
    expect(sourceArrowAfter.x).toBe(sourceArrowBefore.x);
    expect(sourceArrowAfter.y).toBe(sourceArrowBefore.y);
    expect(sourceArrowAfter.width).toBe(sourceArrowBefore.width);
    expect(sourceArrowAfter.height).toBe(sourceArrowBefore.height);
    expect(sourceArrowAfter.points).toEqual(sourceArrowBefore.points);
    expect(sourceArrowAfter.metadata?.startConnection).toBe(r1.id);
    expect(sourceArrowAfter.metadata?.endConnection).toBe(r2.id);

    // Source rectangles must also be untouched.
    expect(useBoardStore.getState().board!.elements.find(e => e.id === r1.id)!.x).toBe(0);
    expect(useBoardStore.getState().board!.elements.find(e => e.id === r2.id)!.x).toBe(300);
  });
});

describe('post-paste selection contains only pasted ids', () => {
  beforeEach(reset);

  it('paste returns ONLY the new ids — caller can use them to setSelectedIds without source bleed-through', () => {
    const s = useBoardStore.getState();
    const r1 = s.addElement('rectangle', { x: 0, y: 0, width: 100, height: 100 });
    const arrow = s.addElement('arrow', {
      x: 100, y: 50, width: 200, height: 1,
      points: [{ x: 0, y: 0 }, { x: 200, y: 0 }],
    });
    const sourceIds = new Set([r1.id, arrow.id]);

    const board = useBoardStore.getState().board!;
    const clipboard = structuredClone(board.elements.filter(e => sourceIds.has(e.id)));

    const pasted = useBoardStore.getState().pasteElements(clipboard, { x: 30, y: 30 });

    // None of the returned pasted ids should overlap the source ids.
    for (const p of pasted) {
      expect(sourceIds.has(p.id)).toBe(false);
    }
    // Pasted set must contain BOTH a rectangle AND an arrow — sanity check
    // that arrows aren't being silently dropped from the paste payload.
    expect(pasted.find(p => p.type === 'rectangle')).toBeTruthy();
    expect(pasted.find(p => p.type === 'arrow')).toBeTruthy();
  });
});

describe('arrow + multi-select copy/paste integrity', () => {
  beforeEach(reset);

  it('copying shapes + arrow leaves source elements intact', () => {
    const s = useBoardStore.getState();
    const r1 = s.addElement('rectangle', { x: 0, y: 0, width: 100, height: 100 });
    const r2 = s.addElement('rectangle', { x: 300, y: 0, width: 100, height: 100 });
    const arrow = s.addElement('arrow', {
      x: 100, y: 50,
      width: 200, height: 1,
      points: [{ x: 0, y: 0 }, { x: 200, y: 0 }],
      metadata: { startConnection: r1.id, endConnection: r2.id },
    });

    const before = useBoardStore.getState().board!.elements.map(e => e.id).sort();

    // Simulate Cmd+C: snapshot the multi-selection
    const sel = [r1.id, r2.id, arrow.id];
    const board = useBoardStore.getState().board!;
    const clipboard = structuredClone(board.elements.filter(e => sel.includes(e.id)));

    // Cmd+V
    const pasted = useBoardStore.getState().pasteElements(clipboard, { x: 50, y: 50 });
    expect(pasted.length).toBe(3);

    const afterBoard = useBoardStore.getState().board!.elements;
    // Source IDs must all still be present
    for (const id of before) {
      expect(afterBoard.find(e => e.id === id), `source ${id} disappeared`).toBeTruthy();
    }
    // Pasted ids should also be present
    for (const p of pasted) {
      expect(afterBoard.find(e => e.id === p.id), `pasted ${p.id} missing`).toBeTruthy();
    }
    // Source arrow must still have its original startConnection / endConnection
    const srcArrow = afterBoard.find(e => e.id === arrow.id)!;
    expect(srcArrow.metadata?.startConnection).toBe(r1.id);
    expect(srcArrow.metadata?.endConnection).toBe(r2.id);
    // Pasted arrow must point at pasted shapes, not source
    const pastedArrow = pasted.find(e => e.type === 'arrow')!;
    const pastedR1 = pasted.find(e => e.x === 50 && e.y === 50)!; // r1 shifted
    const pastedR2 = pasted.find(e => e.x === 350 && e.y === 50)!; // r2 shifted
    expect(pastedArrow.metadata?.startConnection).toBe(pastedR1.id);
    expect(pastedArrow.metadata?.endConnection).toBe(pastedR2.id);
  });
});

describe('nested group transforms', () => {
  beforeEach(reset);

  it('scales nested images and arrow points while keeping the label font size', () => {
    const store = useBoardStore.getState();
    const image = store.addElement('image', { x: 10, y: 20, width: 20, height: 10 });
    const label = store.addElement('text', { x: 40, y: 20, style: { fontSize: 12 } });
    const inner = store.groupElements([image.id, label.id]);
    const arrow = store.addElement('arrow', { x: 60, y: 30, points: [{ x: 0, y: 0 }, { x: 10, y: 8 }] });
    const outer = store.groupElements([inner, arrow.id]);
    const get = (id: string) => useBoardStore.getState().board!.elements.find(el => el.id === id)!;
    const group = get(outer);
    store.updateElement(outer, { x: 100, y: 200, width: group.width * 2, height: group.height * 2 });
    expect(get(image.id)).toMatchObject({ x: 100, y: 200, width: 40, height: 20 });
    expect(get(label.id)).toMatchObject({ x: 160, y: 200, style: { fontSize: 12 } });
    expect(get(arrow.id).points).toEqual([{ x: 0, y: 0 }, { x: 20, y: 16 }]);

    store.updateElements([{ id: outer, changes: { x: 105 } }, { id: inner, changes: { x: 112 } }]);
    expect(get(image.id).x).toBe(112);
    expect(get(label.id).x).toBe(172);
  });
});
