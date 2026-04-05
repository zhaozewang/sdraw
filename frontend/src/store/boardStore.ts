import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { Board, BoardElement, CanvasSettings, ElementType } from '@/types/board';
import { DEFAULT_CANVAS } from '@/types/board';
import { createElement } from '@/utils/helpers';
import { api } from '@/api/client';

interface HistoryEntry {
  elements: BoardElement[];
  description: string;
}

interface BoardState {
  // Current board
  board: Board | null;
  boardFilePath: string | null;  // where the current board is saved on disk
  isDirty: boolean;

  // Undo/redo
  history: HistoryEntry[];
  historyIndex: number;

  // Image version tracking (for cache busting)
  imageVersions: Record<string, number>;

  // Actions - Board management
  newBoard: (name: string, filePath: string, canvasOverrides?: Partial<CanvasSettings>) => Promise<void>;
  openBoard: (filePath: string) => Promise<void>;
  saveBoard: () => Promise<void>;
  closeBoard: () => void;
  setBoardName: (name: string) => void;

  // Actions - Canvas
  updateCanvas: (settings: Partial<CanvasSettings>) => void;

  // Actions - Elements
  addElement: (type: ElementType, overrides?: Partial<BoardElement>) => BoardElement;
  updateElement: (id: string, updates: Partial<BoardElement>) => void;
  updateElements: (updates: Array<{ id: string; changes: Partial<BoardElement> }>) => void;
  removeElements: (ids: string[]) => void;
  duplicateElements: (ids: string[]) => BoardElement[];

  // Actions - Z-order
  bringToFront: (ids: string[]) => void;
  sendToBack: (ids: string[]) => void;
  bringForward: (ids: string[]) => void;
  sendBackward: (ids: string[]) => void;

  // Actions - Grouping
  groupElements: (ids: string[]) => string;
  ungroupElements: (groupId: string) => void;

  // Actions - Lock
  toggleLock: (ids: string[]) => void;

  // Actions - Alignment
  alignElements: (ids: string[], alignment: 'left' | 'right' | 'top' | 'bottom' | 'centerH' | 'centerV') => void;
  distributeElements: (ids: string[], direction: 'horizontal' | 'vertical') => void;

  // Actions - History
  pushHistory: (description: string) => void;
  undo: () => void;
  redo: () => void;

  // Actions - Image refresh
  bumpImageVersion: (path: string) => void;
  getImageVersion: (path: string) => number;
}

const MAX_HISTORY = 50;

export const useBoardStore = create<BoardState>((set, get) => ({
  board: null,
  boardFilePath: null,
  isDirty: false,
  history: [],
  historyIndex: -1,
  imageVersions: {},

  newBoard: async (name: string, filePath: string, canvasOverrides?: Partial<CanvasSettings>) => {
    const board: Board = {
      schema_version: 1,
      id: uuidv4(),
      name,
      canvas: { ...DEFAULT_CANVAS, ...canvasOverrides },
      elements: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      app_version: '0.1.0',
    };
    const result = await api.saveBoardToFile(board, filePath);
    set({
      board: result.board,
      boardFilePath: result.path,
      isDirty: false,
      history: [{ elements: [], description: 'New board' }],
      historyIndex: 0,
    });
  },

  openBoard: async (filePath: string) => {
    const result = await api.openBoardFromFile(filePath);
    set({
      board: result.board,
      boardFilePath: result.path,
      isDirty: false,
      history: [{ elements: structuredClone(result.board.elements), description: 'Load' }],
      historyIndex: 0,
    });
  },

  saveBoard: async () => {
    const { board, boardFilePath } = get();
    if (!board || !boardFilePath) return;
    const updated = { ...board, updated_at: new Date().toISOString() };
    await api.saveBoardToFile(updated, boardFilePath);
    set({ board: updated, isDirty: false });
  },

  closeBoard: () => {
    set({ board: null, boardFilePath: null, isDirty: false, history: [], historyIndex: -1 });
  },

  setBoardName: (name: string) => {
    const { board } = get();
    if (!board) return;
    set({ board: { ...board, name }, isDirty: true });
  },

  updateCanvas: (settings: Partial<CanvasSettings>) => {
    const { board } = get();
    if (!board) return;
    set({ board: { ...board, canvas: { ...board.canvas, ...settings } }, isDirty: true });
  },

  addElement: (type: ElementType, overrides: Partial<BoardElement> = {}) => {
    const { board } = get();
    if (!board) throw new Error('No board loaded');
    const maxZ = board.elements.reduce((max, el) => Math.max(max, el.z_index), 0);
    const element = createElement(type, { ...overrides, z_index: maxZ + 1 });
    const newElements = [...board.elements, element];
    get().pushHistory(`Add ${type}`);
    set({ board: { ...board, elements: newElements }, isDirty: true });
    return element;
  },

  updateElement: (id: string, updates: Partial<BoardElement>) => {
    const { board } = get();
    if (!board) return;
    const newElements = board.elements.map(el =>
      el.id === id ? { ...el, ...updates } : el
    );
    set({ board: { ...board, elements: newElements }, isDirty: true });
  },

  updateElements: (updates: Array<{ id: string; changes: Partial<BoardElement> }>) => {
    const { board } = get();
    if (!board) return;
    const updateMap = new Map(updates.map(u => [u.id, u.changes]));
    const newElements = board.elements.map(el => {
      const changes = updateMap.get(el.id);
      return changes ? { ...el, ...changes } : el;
    });
    set({ board: { ...board, elements: newElements }, isDirty: true });
  },

  removeElements: (ids: string[]) => {
    const { board } = get();
    if (!board) return;
    const idSet = new Set(ids);
    get().pushHistory('Delete elements');
    const newElements = board.elements.filter(el => !idSet.has(el.id));
    set({ board: { ...board, elements: newElements }, isDirty: true });
  },

  duplicateElements: (ids: string[]) => {
    const { board } = get();
    if (!board) return [];
    const idSet = new Set(ids);
    const toDuplicate = board.elements.filter(el => idSet.has(el.id));
    const maxZ = board.elements.reduce((max, el) => Math.max(max, el.z_index), 0);
    const duplicated = toDuplicate.map((el, i) => ({
      ...structuredClone(el),
      id: uuidv4(),
      x: el.x + 20,
      y: el.y + 20,
      z_index: maxZ + 1 + i,
    }));
    get().pushHistory('Duplicate');
    set({ board: { ...board, elements: [...board.elements, ...duplicated] }, isDirty: true });
    return duplicated;
  },

  bringToFront: (ids: string[]) => {
    const { board } = get();
    if (!board) return;
    const maxZ = board.elements.reduce((max, el) => Math.max(max, el.z_index), 0);
    const idSet = new Set(ids);
    get().pushHistory('Bring to front');
    const newElements = board.elements.map((el, i) =>
      idSet.has(el.id) ? { ...el, z_index: maxZ + 1 + i } : el
    );
    set({ board: { ...board, elements: newElements }, isDirty: true });
  },

  sendToBack: (ids: string[]) => {
    const { board } = get();
    if (!board) return;
    const minZ = board.elements.reduce((min, el) => Math.min(min, el.z_index), 0);
    const idSet = new Set(ids);
    get().pushHistory('Send to back');
    const newElements = board.elements.map((el, i) =>
      idSet.has(el.id) ? { ...el, z_index: minZ - ids.length + i } : el
    );
    set({ board: { ...board, elements: newElements }, isDirty: true });
  },

  bringForward: (ids: string[]) => {
    const { board } = get();
    if (!board) return;
    const idSet = new Set(ids);
    get().pushHistory('Bring forward');
    const newElements = board.elements.map(el =>
      idSet.has(el.id) ? { ...el, z_index: el.z_index + 1 } : el
    );
    set({ board: { ...board, elements: newElements }, isDirty: true });
  },

  sendBackward: (ids: string[]) => {
    const { board } = get();
    if (!board) return;
    const idSet = new Set(ids);
    get().pushHistory('Send backward');
    const newElements = board.elements.map(el =>
      idSet.has(el.id) ? { ...el, z_index: el.z_index - 1 } : el
    );
    set({ board: { ...board, elements: newElements }, isDirty: true });
  },

  groupElements: (ids: string[]) => {
    const { board } = get();
    if (!board || ids.length < 2) return '';
    const idSet = new Set(ids);
    const groupMembers = board.elements.filter(el => idSet.has(el.id));
    const minX = Math.min(...groupMembers.map(el => el.x));
    const minY = Math.min(...groupMembers.map(el => el.y));
    const maxX = Math.max(...groupMembers.map(el => el.x + el.width));
    const maxY = Math.max(...groupMembers.map(el => el.y + el.height));
    const maxZ = board.elements.reduce((max, el) => Math.max(max, el.z_index), 0);

    const group = createElement('group', {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      z_index: maxZ + 1,
      children: ids,
    });

    get().pushHistory('Group');
    set({
      board: { ...board, elements: [...board.elements, group] },
      isDirty: true,
    });
    return group.id;
  },

  ungroupElements: (groupId: string) => {
    const { board } = get();
    if (!board) return;
    get().pushHistory('Ungroup');
    const newElements = board.elements.filter(el => el.id !== groupId);
    set({ board: { ...board, elements: newElements }, isDirty: true });
  },

  toggleLock: (ids: string[]) => {
    const { board } = get();
    if (!board) return;
    const idSet = new Set(ids);
    const allLocked = board.elements.filter(el => idSet.has(el.id)).every(el => el.locked);
    const newElements = board.elements.map(el =>
      idSet.has(el.id) ? { ...el, locked: !allLocked } : el
    );
    set({ board: { ...board, elements: newElements }, isDirty: true });
  },

  alignElements: (ids: string[], alignment) => {
    const { board } = get();
    if (!board || ids.length < 2) return;
    const idSet = new Set(ids);
    const targets = board.elements.filter(el => idSet.has(el.id));

    get().pushHistory(`Align ${alignment}`);

    let newElements = [...board.elements];
    switch (alignment) {
      case 'left': {
        const minX = Math.min(...targets.map(el => el.x));
        newElements = newElements.map(el => idSet.has(el.id) ? { ...el, x: minX } : el);
        break;
      }
      case 'right': {
        const maxRight = Math.max(...targets.map(el => el.x + el.width));
        newElements = newElements.map(el => idSet.has(el.id) ? { ...el, x: maxRight - el.width } : el);
        break;
      }
      case 'top': {
        const minY = Math.min(...targets.map(el => el.y));
        newElements = newElements.map(el => idSet.has(el.id) ? { ...el, y: minY } : el);
        break;
      }
      case 'bottom': {
        const maxBottom = Math.max(...targets.map(el => el.y + el.height));
        newElements = newElements.map(el => idSet.has(el.id) ? { ...el, y: maxBottom - el.height } : el);
        break;
      }
      case 'centerH': {
        const avgCx = targets.reduce((sum, el) => sum + el.x + el.width / 2, 0) / targets.length;
        newElements = newElements.map(el => idSet.has(el.id) ? { ...el, x: avgCx - el.width / 2 } : el);
        break;
      }
      case 'centerV': {
        const avgCy = targets.reduce((sum, el) => sum + el.y + el.height / 2, 0) / targets.length;
        newElements = newElements.map(el => idSet.has(el.id) ? { ...el, y: avgCy - el.height / 2 } : el);
        break;
      }
    }
    set({ board: { ...board, elements: newElements }, isDirty: true });
  },

  distributeElements: (ids: string[], direction) => {
    const { board } = get();
    if (!board || ids.length < 3) return;
    const idSet = new Set(ids);
    const targets = board.elements.filter(el => idSet.has(el.id));

    get().pushHistory(`Distribute ${direction}`);

    if (direction === 'horizontal') {
      const sorted = [...targets].sort((a, b) => a.x - b.x);
      const minX = sorted[0].x;
      const maxRight = sorted[sorted.length - 1].x + sorted[sorted.length - 1].width;
      const totalWidth = sorted.reduce((sum, el) => sum + el.width, 0);
      const gap = (maxRight - minX - totalWidth) / (sorted.length - 1);
      let cx = minX;
      const posMap = new Map<string, number>();
      for (const el of sorted) {
        posMap.set(el.id, cx);
        cx += el.width + gap;
      }
      const newElements = board.elements.map(el => {
        const newX = posMap.get(el.id);
        return newX !== undefined ? { ...el, x: newX } : el;
      });
      set({ board: { ...board, elements: newElements }, isDirty: true });
    } else {
      const sorted = [...targets].sort((a, b) => a.y - b.y);
      const minY = sorted[0].y;
      const maxBottom = sorted[sorted.length - 1].y + sorted[sorted.length - 1].height;
      const totalHeight = sorted.reduce((sum, el) => sum + el.height, 0);
      const gap = (maxBottom - minY - totalHeight) / (sorted.length - 1);
      let cy = minY;
      const posMap = new Map<string, number>();
      for (const el of sorted) {
        posMap.set(el.id, cy);
        cy += el.height + gap;
      }
      const newElements = board.elements.map(el => {
        const newY = posMap.get(el.id);
        return newY !== undefined ? { ...el, y: newY } : el;
      });
      set({ board: { ...board, elements: newElements }, isDirty: true });
    }
  },

  pushHistory: (description: string) => {
    const { board, history, historyIndex } = get();
    if (!board) return;
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({ elements: structuredClone(board.elements), description });
    if (newHistory.length > MAX_HISTORY) newHistory.shift();
    set({ history: newHistory, historyIndex: newHistory.length - 1 });
  },

  undo: () => {
    const { board, history, historyIndex } = get();
    if (!board || historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    const entry = history[newIndex];
    set({
      board: { ...board, elements: structuredClone(entry.elements) },
      historyIndex: newIndex,
      isDirty: true,
    });
  },

  redo: () => {
    const { board, history, historyIndex } = get();
    if (!board || historyIndex >= history.length - 1) return;
    const newIndex = historyIndex + 1;
    const entry = history[newIndex];
    set({
      board: { ...board, elements: structuredClone(entry.elements) },
      historyIndex: newIndex,
      isDirty: true,
    });
  },

  bumpImageVersion: (path: string) => {
    const { imageVersions } = get();
    const current = imageVersions[path] || 0;
    set({ imageVersions: { ...imageVersions, [path]: current + 1 } });
  },

  getImageVersion: (path: string) => {
    return get().imageVersions[path] || 0;
  },
}));
