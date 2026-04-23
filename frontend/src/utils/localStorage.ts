/**
 * Centralized typed accessors for the four sdraw localStorage keys.
 *
 * If a key's shape ever changes, bump the module-private key string and write a
 * one-shot migrator — do not silently reinterpret old values.
 *
 * DOM side effects (e.g. applying theme to <html>) are NOT this module's job;
 * see `uiStore.ts` for the `applyThemeToDOM` listener logic.
 */

import type { ThemeMode } from '@/store/uiStore';

// ---------------------------------------------------------------------------
// Module-private key constants
// ---------------------------------------------------------------------------

const RECENT_BOARDS_KEY = 'sdraw_recent_boards';
const THEME_KEY = 'sdraw_theme';
const PYTHON_ENV_KEY = 'sdraw_python_env';
const RECENT_COLORS_KEY = 'sdraw_recent_colors';

const MAX_RECENT_BOARDS = 10;
const MAX_RECENT_COLORS = 8;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecentBoard {
  name: string;
  path: string;
  openedAt: string; // ISO timestamp
}

// Re-export ThemeMode so callers don't need to import from two places.
export type { ThemeMode };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isBrowser(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

function isThemeMode(v: unknown): v is ThemeMode {
  return v === 'light' || v === 'dark' || v === 'system';
}

function isRecentBoard(v: unknown): v is RecentBoard {
  if (!v || typeof v !== 'object') return false;
  const b = v as Record<string, unknown>;
  return typeof b.name === 'string' && typeof b.path === 'string' && typeof b.openedAt === 'string';
}

function isRecentBoardArray(v: unknown): v is RecentBoard[] {
  return Array.isArray(v) && v.every(isRecentBoard);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

function safeGetRaw(key: string): string | null {
  if (!isBrowser()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetRaw(key: string, value: string): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(key, value);
  } catch (err) {
    // Quota exceeded or storage disabled. Match prior inline behavior (swallow).
    // Emit a warn so it's visible in devtools for debugging.
    console.warn(`[localStorage] setItem(${key}) failed:`, err);
  }
}

function safeRemoveRaw(key: string): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // swallow
  }
}

// ---------------------------------------------------------------------------
// Recent boards
// ---------------------------------------------------------------------------

export function getRecentBoards(): RecentBoard[] {
  const raw = safeGetRaw(RECENT_BOARDS_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecentBoardArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function setRecentBoards(boards: RecentBoard[]): void {
  safeSetRaw(RECENT_BOARDS_KEY, JSON.stringify(boards));
}

/** MRU insert: dedupe by path, prepend, cap at MAX_RECENT_BOARDS. */
export function addRecentBoard(name: string, path: string): void {
  const boards = getRecentBoards().filter((b) => b.path !== path);
  boards.unshift({ name, path, openedAt: new Date().toISOString() });
  safeSetRaw(RECENT_BOARDS_KEY, JSON.stringify(boards.slice(0, MAX_RECENT_BOARDS)));
}

export function removeRecentBoard(path: string): void {
  const boards = getRecentBoards().filter((b) => b.path !== path);
  safeSetRaw(RECENT_BOARDS_KEY, JSON.stringify(boards));
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

export function getTheme(): ThemeMode {
  const raw = safeGetRaw(THEME_KEY);
  return isThemeMode(raw) ? raw : 'light';
}

export function setTheme(theme: ThemeMode): void {
  safeSetRaw(THEME_KEY, theme);
}

// ---------------------------------------------------------------------------
// Python env path
// ---------------------------------------------------------------------------

export function getPythonEnv(): string | null {
  const raw = safeGetRaw(PYTHON_ENV_KEY);
  return raw || null;
}

/** Pass `null` to clear the key. */
export function setPythonEnv(path: string | null): void {
  if (path) {
    safeSetRaw(PYTHON_ENV_KEY, path);
  } else {
    safeRemoveRaw(PYTHON_ENV_KEY);
  }
}

// ---------------------------------------------------------------------------
// Recent colors
// ---------------------------------------------------------------------------

export function getRecentColors(): string[] {
  const raw = safeGetRaw(RECENT_COLORS_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return isStringArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function setRecentColors(colors: string[]): void {
  safeSetRaw(RECENT_COLORS_KEY, JSON.stringify(colors.slice(0, MAX_RECENT_COLORS)));
}

/** MRU insert: case-insensitive dedupe, prepend, cap at MAX_RECENT_COLORS. */
export function addRecentColor(color: string): void {
  if (!color || color === 'transparent') return;
  const normalized = color.toLowerCase();
  const colors = getRecentColors().filter((c) => c.toLowerCase() !== normalized);
  colors.unshift(color);
  setRecentColors(colors);
}
