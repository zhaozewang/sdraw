import { describe, it, expect } from 'vitest';
import {
  plotRenderHash,
  codeDigest,
  computeSaveHashes,
  migrateToPlotCodeRegistry,
} from '@/store/boardStore';
import type { Board, BoardElement } from '@/types/board';
import {
  DEFAULT_CANVAS,
  DEFAULT_BOARD_SETUP,
  CURRENT_SCHEMA_VERSION,
} from '@/types/board';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makePlotElement(
  id: string,
  plotCodeId: string,
  overrides: Partial<BoardElement> = {},
): BoardElement {
  return {
    id,
    type: 'plot',
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    z_index: 0,
    locked: false,
    visible: true,
    rotation: 0,
    style: {},
    metadata: { plotCodeId, figureIndex: 0 },
    ...overrides,
  };
}

function makeBoard(overrides: Partial<Board> = {}): Board {
  return {
    schema_version: CURRENT_SCHEMA_VERSION,
    id: 'board-1',
    name: 'Test Board',
    canvas: { ...DEFAULT_CANVAS },
    elements: [],
    setup: { ...DEFAULT_BOARD_SETUP },
    plotCodes: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    app_version: 'test',
    ...overrides,
  };
}

// Legacy-shape plot element for migration tests. Uses `any` because the
// whole point of the migrator is that it accepts pre-v3 boards whose plot
// elements carry fields (`metadata.code`, `metadata.sourceElementId`) that
// are not part of the v3 BoardElement type.
function makeLegacyPlotElement(id: string, metadata: Record<string, any>): any {
  return {
    id,
    type: 'plot',
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    z_index: 0,
    locked: false,
    visible: true,
    rotation: 0,
    style: {},
    metadata,
  };
}

function makeLegacyBoard(
  schemaVersion: number,
  elements: any[],
): any {
  return {
    schema_version: schemaVersion,
    id: 'b',
    name: 'legacy board',
    canvas: { ...DEFAULT_CANVAS },
    elements,
    setup: { ...DEFAULT_BOARD_SETUP },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    app_version: 'test',
  };
}

// ---------------------------------------------------------------------------
// plotRenderHash
// ---------------------------------------------------------------------------

describe('plotRenderHash', () => {
  it('is deterministic for identical inputs', () => {
    const a = plotRenderHash('import numpy as np', 'plt.plot([1,2,3])');
    const b = plotRenderHash('import numpy as np', 'plt.plot([1,2,3])');
    expect(a).toBe(b);
  });

  it('is order-sensitive: swapping setup and plot code changes the hash', () => {
    const setupFirst = plotRenderHash('A', 'B');
    const swapped = plotRenderHash('B', 'A');
    expect(setupFirst).not.toBe(swapped);
  });

  it('does not throw on empty strings', () => {
    expect(() => plotRenderHash('', '')).not.toThrow();
    // Output must be a non-empty hex string so downstream consumers
    // (the stored-crop staleness check) always have something to compare.
    expect(plotRenderHash('', '')).toMatch(/^[0-9a-f]{8}$/);
  });
});

// ---------------------------------------------------------------------------
// codeDigest
// ---------------------------------------------------------------------------

describe('codeDigest', () => {
  it('is stable across insertion-order variations when code content is identical', () => {
    const boardA = makeBoard({
      plotCodes: {
        'id-a': { code: 'plt.plot(x)' },
        'id-b': { code: 'plt.scatter(x, y)' },
      },
    });
    const boardB = makeBoard({
      plotCodes: {
        'id-b': { code: 'plt.scatter(x, y)' },
        'id-a': { code: 'plt.plot(x)' },
      },
    });
    expect(codeDigest(boardA)).toBe(codeDigest(boardB));
  });

  it('changes when setup.code changes', () => {
    const base = makeBoard({
      setup: { code: 'import pandas as pd', timeout: 120 },
      plotCodes: { 'id-a': { code: 'plt.plot(x)' } },
    });
    const bumped = makeBoard({
      setup: { code: 'import pandas as pd\nimport numpy as np', timeout: 120 },
      plotCodes: { 'id-a': { code: 'plt.plot(x)' } },
    });
    expect(codeDigest(base)).not.toBe(codeDigest(bumped));
  });

  it('changes when a plot code body changes', () => {
    const before = makeBoard({
      plotCodes: { 'id-a': { code: 'plt.plot(x)' } },
    });
    const after = makeBoard({
      plotCodes: { 'id-a': { code: 'plt.plot(y)' } },
    });
    expect(codeDigest(before)).not.toBe(codeDigest(after));
  });

  it('is stable when a plotCodeId key is renamed but the code body is unchanged (migration stability)', () => {
    const original = makeBoard({
      plotCodes: { 'legacy-id': { code: 'plt.plot(x)' } },
    });
    const renamed = makeBoard({
      plotCodes: { 'brand-new-uuid': { code: 'plt.plot(x)' } },
    });
    expect(codeDigest(original)).toBe(codeDigest(renamed));
  });
});

// ---------------------------------------------------------------------------
// computeSaveHashes
// ---------------------------------------------------------------------------

describe('computeSaveHashes', () => {
  it('returns one elementHashes entry per element id', () => {
    const board = makeBoard({
      elements: [
        makePlotElement('el-1', 'pc-1'),
        makePlotElement('el-2', 'pc-2'),
        makePlotElement('el-3', 'pc-3'),
      ],
    });
    const { elementHashes } = computeSaveHashes(board);
    expect(elementHashes.size).toBe(3);
    expect(elementHashes.has('el-1')).toBe(true);
    expect(elementHashes.has('el-2')).toBe(true);
    expect(elementHashes.has('el-3')).toBe(true);
  });

  it('boardFieldsHash changes when board.setup.code changes', () => {
    const before = makeBoard({
      setup: { code: 'a = 1', timeout: 120 },
    });
    const after = makeBoard({
      setup: { code: 'a = 2', timeout: 120 },
    });
    expect(computeSaveHashes(before).boardFieldsHash).not.toBe(
      computeSaveHashes(after).boardFieldsHash,
    );
  });

  it('boardFieldsHash is stable across calls when the board is unchanged', () => {
    const board = makeBoard({
      setup: { code: 'a = 1', timeout: 120 },
      plotCodes: { 'pc-1': { code: 'plt.plot(x)' } },
    });
    const first = computeSaveHashes(board).boardFieldsHash;
    const second = computeSaveHashes(board).boardFieldsHash;
    expect(first).toBe(second);
  });

  it('elementIds set matches board element ids exactly', () => {
    const board = makeBoard({
      elements: [
        makePlotElement('alpha', 'pc-1'),
        makePlotElement('beta', 'pc-2'),
      ],
    });
    const { elementIds } = computeSaveHashes(board);
    expect(elementIds.size).toBe(2);
    expect(elementIds.has('alpha')).toBe(true);
    expect(elementIds.has('beta')).toBe(true);
    expect(elementIds.has('gamma')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// migrateToPlotCodeRegistry
// ---------------------------------------------------------------------------

describe('migrateToPlotCodeRegistry', () => {
  it('v1 plot with metadata.code gets a plotCodeId and registry entry, and metadata.code is deleted', () => {
    const v1Board = makeLegacyBoard(1, [
      makeLegacyPlotElement('el-1', { code: 'plt.plot([1,2])', figureIndex: 0 }),
    ]);

    const migrated = migrateToPlotCodeRegistry(v1Board);

    const el = migrated.elements[0];
    const plotCodeId = el.metadata.plotCodeId;
    expect(typeof plotCodeId).toBe('string');
    expect(plotCodeId.length).toBeGreaterThan(0);
    expect(migrated.plotCodes[plotCodeId]).toBeDefined();
    expect(migrated.plotCodes[plotCodeId].code).toBe('plt.plot([1,2])');
    expect('code' in el.metadata).toBe(false);
  });

  it('v2 sibling with metadata.sourceElementId inherits its source plotCodeId and sourceElementId is deleted', () => {
    const v2Board = makeLegacyBoard(2, [
      makeLegacyPlotElement('source-el', { code: 'plt.plot([1,2])', figureIndex: 0 }),
      makeLegacyPlotElement('sibling-el', { sourceElementId: 'source-el', figureIndex: 1 }),
    ]);

    const migrated = migrateToPlotCodeRegistry(v2Board);

    const source = migrated.elements[0];
    const sibling = migrated.elements[1];
    expect(source.metadata.plotCodeId).toBe(sibling.metadata.plotCodeId);
    expect(typeof sibling.metadata.plotCodeId).toBe('string');
    expect('sourceElementId' in sibling.metadata).toBe(false);
  });

  it('orphan plot (no code and no source) gets a fresh empty plotCodes entry', () => {
    const orphanBoard = makeLegacyBoard(1, [
      makeLegacyPlotElement('orphan-el', { figureIndex: 0 }),
    ]);

    const migrated = migrateToPlotCodeRegistry(orphanBoard);

    const el = migrated.elements[0];
    const plotCodeId = el.metadata.plotCodeId;
    expect(typeof plotCodeId).toBe('string');
    expect(migrated.plotCodes[plotCodeId]).toBeDefined();
    expect(migrated.plotCodes[plotCodeId].code).toBe('');
  });

  it('is idempotent: running twice is a no-op', () => {
    const v1Board = makeLegacyBoard(1, [
      makeLegacyPlotElement('el-1', { code: 'plt.plot([1,2])', figureIndex: 0 }),
    ]);

    const firstPass = migrateToPlotCodeRegistry(v1Board);
    const snapshotAfterFirst = JSON.parse(JSON.stringify(firstPass));
    const secondPass = migrateToPlotCodeRegistry(firstPass);
    expect(JSON.parse(JSON.stringify(secondPass))).toEqual(snapshotAfterFirst);
  });

  it('sets board.schema_version to CURRENT_SCHEMA_VERSION', () => {
    const v1Board = makeLegacyBoard(1, []);
    const migrated = migrateToPlotCodeRegistry(v1Board);
    expect(migrated.schema_version).toBe(CURRENT_SCHEMA_VERSION);
  });
});
