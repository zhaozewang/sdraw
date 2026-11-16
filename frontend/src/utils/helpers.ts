import { v4 as uuidv4 } from 'uuid';
import type { BoardElement, ElementStyle, ElementType } from '@/types/board';

export const DEFAULT_PLOT_CODE = '';
import {
  DEFAULT_IMAGE_STYLE,
  DEFAULT_TEXT_STYLE,
  DEFAULT_RECT_STYLE,
  DEFAULT_ARROW_STYLE,
  DEFAULT_PLOT_STYLE,
  DEFAULT_PEN_STYLE,
} from '@/types/board';

export function generateId(): string {
  return uuidv4();
}

export function createElement(
  type: ElementType,
  overrides: Partial<BoardElement> = {}
): BoardElement {
  const defaults: BoardElement = {
    id: generateId(),
    type,
    x: 100,
    y: 100,
    width: type === 'arrow' || type === 'pen' ? 200 : type === 'text' ? 120 : type === 'plot' ? 400 : 300,
    height: type === 'arrow' ? 0 : type === 'pen' ? 1 : type === 'text' ? 40 : type === 'plot' ? 350 : 200,
    z_index: 0,
    locked: false,
    visible: true,
    rotation: 0,
    style: getDefaultStyle(type),
    metadata: {},
  };

  if (type === 'text') {
    defaults.text = 'Text';
  }

  if (type === 'arrow') {
    defaults.points = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ];
  }

  if (type === 'image') {
    defaults.source = {
      mode: 'exact',
      path: '',
      followLatest: false,
      autoRefresh: true,
    };
  }

  if (type === 'plot') {
    // Code is no longer stored per-element — it lives in `board.plotCodes`
    // and the element points at an entry via `metadata.plotCodeId`. The
    // plotCodeId is assigned by `addElement` at insert time so a fresh
    // registry entry is created for every new plot.
    defaults.metadata = {
      figureIndex: 0,
      lastOutput: null,
      lastError: null,
      lockAspectRatio: true,
    };
  }

  if (type === 'pen') {
    defaults.points = [];
  }

  if (type === 'group') {
    defaults.children = [];
  }

  return { ...defaults, ...overrides };
}

export function getDefaultStyle(type: ElementType): ElementStyle {
  switch (type) {
    case 'image': return { ...DEFAULT_IMAGE_STYLE };
    case 'text': return { ...DEFAULT_TEXT_STYLE };
    case 'rectangle': return { ...DEFAULT_RECT_STYLE };
    case 'arrow': return { ...DEFAULT_ARROW_STYLE };
    case 'pen': return { ...DEFAULT_PEN_STYLE };
    case 'plot': return { ...DEFAULT_PLOT_STYLE };
    case 'group': return { opacity: 1 };
    default: return {};
  }
}

export function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function getFileName(path: string): string {
  return path.split('/').pop() || path;
}

export function getFileExtension(path: string): string {
  const parts = path.split('.');
  return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

// ---------------------------------------------------------------------------
// Last browsed directory (shared across all file browsers)
// ---------------------------------------------------------------------------
const LAST_DIR_KEY = 'sdraw_last_directory';

export function getLastDirectory(): string {
  return localStorage.getItem(LAST_DIR_KEY) || '';
}

// Fetch and cache the user's home directory from the backend
let _cachedHome: string | null = null;
export async function fetchUserHome(): Promise<string> {
  if (_cachedHome) return _cachedHome;
  try {
    const res = await fetch(new URL('api/path/home', document.baseURI).pathname);
    if (res.ok) {
      const data = await res.json();
      _cachedHome = data.path;
      return data.path;
    }
  } catch {}
  return '/';
}

export function getLastDirectoryOrHome(): string {
  const last = localStorage.getItem(LAST_DIR_KEY);
  if (last) return last;
  return _cachedHome || '/';
}

export function saveLastDirectory(path: string) {
  localStorage.setItem(LAST_DIR_KEY, path);
}
