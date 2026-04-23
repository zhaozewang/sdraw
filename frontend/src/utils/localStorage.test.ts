import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getRecentBoards,
  setRecentBoards,
  addRecentBoard,
  removeRecentBoard,
  getTheme,
  setTheme,
  getPythonEnv,
  setPythonEnv,
  getRecentColors,
  setRecentColors,
  addRecentColor,
  type RecentBoard,
} from './localStorage';

// On-disk key strings are private to the module, but the tests need to write
// malformed values directly. Duplicated intentionally — if these drift, the
// module's public contract has changed and the tests must follow.
const RECENT_BOARDS_KEY = 'sdraw_recent_boards';
const THEME_KEY = 'sdraw_theme';
const PYTHON_ENV_KEY = 'sdraw_python_env';
const RECENT_COLORS_KEY = 'sdraw_recent_colors';

beforeEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Recent boards
// ---------------------------------------------------------------------------
describe('getRecentBoards', () => {
  it('returns [] when key is unset', () => {
    expect(getRecentBoards()).toEqual([]);
  });

  it('round-trips a valid array', () => {
    const boards: RecentBoard[] = [
      { name: 'A', path: '/a.sdraw', openedAt: '2026-01-01T00:00:00Z' },
      { name: 'B', path: '/b.sdraw', openedAt: '2026-01-02T00:00:00Z' },
    ];
    setRecentBoards(boards);
    expect(getRecentBoards()).toEqual(boards);
  });

  it('returns [] on malformed JSON (parse failure fallback)', () => {
    localStorage.setItem(RECENT_BOARDS_KEY, '{not json');
    expect(getRecentBoards()).toEqual([]);
  });

  it('returns [] when stored value is not an array (shape-mismatch fallback)', () => {
    localStorage.setItem(RECENT_BOARDS_KEY, '{"not":"array"}');
    expect(getRecentBoards()).toEqual([]);
  });

  it('returns [] when array elements miss required fields', () => {
    localStorage.setItem(RECENT_BOARDS_KEY, JSON.stringify([{ name: 'A' }]));
    expect(getRecentBoards()).toEqual([]);
  });

  it('does NOT rewrite storage when shape mismatches (preserves debuggability)', () => {
    localStorage.setItem(RECENT_BOARDS_KEY, '{"not":"array"}');
    getRecentBoards();
    expect(localStorage.getItem(RECENT_BOARDS_KEY)).toBe('{"not":"array"}');
  });
});

describe('addRecentBoard', () => {
  it('prepends a new entry', () => {
    addRecentBoard('A', '/a.sdraw');
    const boards = getRecentBoards();
    expect(boards).toHaveLength(1);
    expect(boards[0].name).toBe('A');
    expect(boards[0].path).toBe('/a.sdraw');
    expect(boards[0].openedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('dedupes by path (existing entry replaced and moved to front)', () => {
    addRecentBoard('A', '/a.sdraw');
    addRecentBoard('B', '/b.sdraw');
    addRecentBoard('A-renamed', '/a.sdraw'); // same path, new name

    const boards = getRecentBoards();
    expect(boards).toHaveLength(2);
    expect(boards[0].path).toBe('/a.sdraw');
    expect(boards[0].name).toBe('A-renamed');
    expect(boards[1].path).toBe('/b.sdraw');
  });

  it('MRU: most recently added is first', () => {
    addRecentBoard('A', '/a.sdraw');
    addRecentBoard('B', '/b.sdraw');
    addRecentBoard('C', '/c.sdraw');
    expect(getRecentBoards().map((b) => b.path)).toEqual(['/c.sdraw', '/b.sdraw', '/a.sdraw']);
  });

  it('caps at 10 entries', () => {
    for (let i = 0; i < 15; i++) {
      addRecentBoard(`B${i}`, `/b${i}.sdraw`);
    }
    const boards = getRecentBoards();
    expect(boards).toHaveLength(10);
    // Most recent (B14) at front, B5 at back (B0-B4 dropped)
    expect(boards[0].path).toBe('/b14.sdraw');
    expect(boards[9].path).toBe('/b5.sdraw');
  });
});

describe('removeRecentBoard', () => {
  it('removes entry by path', () => {
    addRecentBoard('A', '/a.sdraw');
    addRecentBoard('B', '/b.sdraw');
    removeRecentBoard('/a.sdraw');
    expect(getRecentBoards().map((b) => b.path)).toEqual(['/b.sdraw']);
  });

  it('is a no-op when path is not present', () => {
    addRecentBoard('A', '/a.sdraw');
    removeRecentBoard('/nonexistent.sdraw');
    expect(getRecentBoards()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
describe('getTheme / setTheme', () => {
  it('defaults to "light" when unset', () => {
    expect(getTheme()).toBe('light');
  });

  it.each(['light', 'dark', 'system'] as const)('round-trips %s', (mode) => {
    setTheme(mode);
    expect(getTheme()).toBe(mode);
  });

  it('falls back to "light" on invalid stored value', () => {
    localStorage.setItem(THEME_KEY, 'chartreuse');
    expect(getTheme()).toBe('light');
  });
});

// ---------------------------------------------------------------------------
// Python env
// ---------------------------------------------------------------------------
describe('getPythonEnv / setPythonEnv', () => {
  it('returns null when unset', () => {
    expect(getPythonEnv()).toBeNull();
  });

  it('round-trips a path string', () => {
    setPythonEnv('/opt/venv/bin/python');
    expect(getPythonEnv()).toBe('/opt/venv/bin/python');
  });

  it('setPythonEnv(null) clears the key', () => {
    setPythonEnv('/opt/venv/bin/python');
    expect(localStorage.getItem(PYTHON_ENV_KEY)).toBe('/opt/venv/bin/python');
    setPythonEnv(null);
    expect(localStorage.getItem(PYTHON_ENV_KEY)).toBeNull();
    expect(getPythonEnv()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Recent colors
// ---------------------------------------------------------------------------
describe('getRecentColors / setRecentColors', () => {
  it('returns [] when unset', () => {
    expect(getRecentColors()).toEqual([]);
  });

  it('round-trips a string array', () => {
    setRecentColors(['#ff0000', '#00ff00']);
    expect(getRecentColors()).toEqual(['#ff0000', '#00ff00']);
  });

  it('returns [] on malformed JSON', () => {
    localStorage.setItem(RECENT_COLORS_KEY, 'garbage');
    expect(getRecentColors()).toEqual([]);
  });

  it('returns [] on shape mismatch (not an array)', () => {
    localStorage.setItem(RECENT_COLORS_KEY, '{"not":"array"}');
    expect(getRecentColors()).toEqual([]);
  });

  it('returns [] when array contains non-strings', () => {
    localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(['#ff0000', 42]));
    expect(getRecentColors()).toEqual([]);
  });

  it('setRecentColors caps at 8 entries', () => {
    const many = Array.from({ length: 20 }, (_, i) => `#${i.toString(16).padStart(6, '0')}`);
    setRecentColors(many);
    expect(getRecentColors()).toHaveLength(8);
    expect(getRecentColors()[0]).toBe(many[0]);
  });
});

describe('addRecentColor', () => {
  it('prepends a new color', () => {
    addRecentColor('#ff0000');
    addRecentColor('#00ff00');
    expect(getRecentColors()).toEqual(['#00ff00', '#ff0000']);
  });

  it('dedupes case-insensitively, moving existing to front', () => {
    addRecentColor('#FF0000');
    addRecentColor('#00ff00');
    addRecentColor('#ff0000'); // same as first, different case
    expect(getRecentColors()).toEqual(['#ff0000', '#00ff00']);
  });

  it('ignores empty and transparent', () => {
    addRecentColor('');
    addRecentColor('transparent');
    expect(getRecentColors()).toEqual([]);
  });

  it('caps at 8 entries', () => {
    for (let i = 0; i < 12; i++) {
      addRecentColor(`#${i.toString(16).padStart(6, '0')}`);
    }
    expect(getRecentColors()).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------
// Quota-exceeded behavior
// ---------------------------------------------------------------------------
describe('setter quota-exceeded resilience', () => {
  const originalSetItem = Storage.prototype.setItem;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    Storage.prototype.setItem = originalSetItem;
    warnSpy.mockRestore();
  });

  it('setTheme swallows quota errors and warns', () => {
    Storage.prototype.setItem = vi.fn(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => setTheme('dark')).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
  });
});
