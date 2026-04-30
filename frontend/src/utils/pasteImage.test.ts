import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pasteImageFromBlob } from './pasteImage';
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

describe('pasteImageFromBlob', () => {
  beforeEach(() => {
    useBoardStore.setState({ board: null, isDirty: false } as any);
  });

  it('returns null when no board is open', async () => {
    const blob = new Blob(['fake'], { type: 'image/png' });
    const result = await pasteImageFromBlob(blob, 'image/png');
    expect(result).toBeNull();
  });

  it('embeds an image element when decoding succeeds', async () => {
    useBoardStore.setState({ board: emptyBoard(), isDirty: false } as any);
    const blob = new Blob(['stub'], { type: 'image/png' });

    // Stub Image so that .onload fires immediately with deterministic dims.
    const RealImage = globalThis.Image;
    class StubImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 1200;
      naturalHeight = 900;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
      get src() { return ''; }
    }
    (globalThis as any).Image = StubImage;

    try {
      const el = await pasteImageFromBlob(blob, 'image/png');
      expect(el).not.toBeNull();
      expect(el!.type).toBe('image');
      expect(el!.source?.embeddedMime).toBe('image/png');
      expect(typeof el!.source?.embeddedData).toBe('string');
      // Dimensions clamped to MAX_W=600 / MAX_H=500 while preserving 4:3 ratio.
      // 1200x900 → scale = min(1, 600/1200=0.5, 500/900≈0.555) = 0.5 → 600x450.
      expect(el!.width).toBe(600);
      expect(el!.height).toBe(450);
      expect(el!.source?.path).toBe('');
      expect(el!.source?.linkStatus).toBe('unlinked');
    } finally {
      (globalThis as any).Image = RealImage;
    }
  });
});
