import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { Board, BoardElement, CanvasSettings, ElementType, AutoExportSettings } from '@/types/board';
import { DEFAULT_CANVAS } from '@/types/board';
import { createElement } from '@/utils/helpers';
import { api } from '@/api/client';
import { toRelativeAnchor, fromRelativeAnchor } from '@/utils/snapToShape';
/**
 * Capture the visible React Flow canvas using html2canvas.
 * html-to-image has a known bug where images with different query params
 * get deduplicated during DOM cloning, causing identical renders.
 * html2canvas rasterizes directly from the live DOM, avoiding this.
 */
async function captureCanvas(bg: string, scale = 0.3): Promise<string | undefined> {
  const { default: html2canvas } = await import('html2canvas');
  const el = document.querySelector('.react-flow') as HTMLElement;
  if (!el) return undefined;

  // Hide overlays
  const selectors = ['.react-flow__minimap', '.react-flow__panel', '.react-flow__controls', '.react-flow__attribution'];
  const hidden: HTMLElement[] = [];
  for (const sel of selectors) {
    el.querySelectorAll(sel).forEach(node => {
      const htmlNode = node as HTMLElement;
      if (htmlNode.style.display !== 'none') {
        hidden.push(htmlNode);
        htmlNode.style.display = 'none';
      }
    });
  }

  try {
    const canvas = await html2canvas(el, {
      scale,
      backgroundColor: bg,
      useCORS: true,
      allowTaint: true,
      logging: false,
    });
    return canvas.toDataURL('image/png');
  } finally {
    for (const node of hidden) node.style.display = '';
  }
}

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
  saveCheckpoint: () => Promise<void>;
  deleteCheckpoint: () => Promise<void>;
  closeBoard: () => void;
  setBoardName: (name: string) => void;
  updateAutoExport: (settings: Partial<AutoExportSettings>) => void;
  triggerAutoExport: () => Promise<void>;

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

  // Actions - Connected arrows
  updateConnectedArrows: (movedElementId: string) => void;

  // Actions - Image refresh
  bumpImageVersion: (path: string) => void;
  getImageVersion: (path: string) => number;
}

const MAX_HISTORY = 50;

// Abort controller for cancelling in-flight exports on board switch
let autoExportAbort: AbortController | null = null;

export const useBoardStore = create<BoardState>((set, get) => ({
  board: null,
  boardFilePath: null,
  isDirty: false,
  history: [],
  historyIndex: -1,
  imageVersions: {},

  newBoard: async (name: string, filePath: string, canvasOverrides?: Partial<CanvasSettings>) => {
    if (autoExportAbort) autoExportAbort.abort();
    autoExportAbort = new AbortController();
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
    if (autoExportAbort) autoExportAbort.abort();
    autoExportAbort = new AbortController();
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

    // Capture thumbnail from the canvas
    let thumbnail: string | undefined;
    try {
      thumbnail = await captureCanvas(board.canvas.background || '#ffffff', 0.3);
    } catch {
      // Thumbnail capture is best-effort
    }

    const updated = {
      ...board,
      updated_at: new Date().toISOString(),
      thumbnail,
    };
    await api.saveBoardToFile(updated, boardFilePath);
    set({ board: updated, isDirty: false });
    // Clean up checkpoint after a successful save
    try { await api.deleteCheckpoint(boardFilePath); } catch {}
  },

  saveCheckpoint: async () => {
    const { board, boardFilePath, isDirty } = get();
    if (!board || !boardFilePath || !isDirty) return;
    try {
      // Lightweight save — no thumbnail, no updated_at change
      await api.saveCheckpoint(board, boardFilePath);
    } catch {
      // Best-effort
    }
  },

  deleteCheckpoint: async () => {
    const { boardFilePath } = get();
    if (!boardFilePath) return;
    try { await api.deleteCheckpoint(boardFilePath); } catch {}
  },

  closeBoard: async () => {
    // Cancel any pending auto-exports
    if (autoExportAbort) {
      autoExportAbort.abort();
      autoExportAbort = null;
    }

    // Capture thumbnail before closing so the welcome page shows a preview
    const { board, boardFilePath, isDirty } = get();
    if (board && boardFilePath && isDirty) {
      try {
        const thumbnail = await captureCanvas(board.canvas.background || '#ffffff', 0.3);
        if (thumbnail) {
          const updated = { ...board, updated_at: new Date().toISOString(), thumbnail };
          await api.saveBoardToFile(updated, boardFilePath);
        }
      } catch {
        // Best-effort
      }
    }
    set({ board: null, boardFilePath: null, isDirty: false, history: [], historyIndex: -1 });
  },

  setBoardName: (name: string) => {
    const { board } = get();
    if (!board) return;
    set({ board: { ...board, name }, isDirty: true });
  },

  updateAutoExport: (settings: Partial<AutoExportSettings>) => {
    const { board } = get();
    if (!board) return;
    const current = board.autoExport || { enabled: false, outputPath: '', format: 'png' as const, dpi: 2, transparent: false, sizeMode: 'fit' as const };
    set({ board: { ...board, autoExport: { ...current, ...settings } }, isDirty: true });
  },

  triggerAutoExport: async () => {
    const { board } = get();
    if (!board?.autoExport?.enabled || !board.autoExport.outputPath) return;
    if (!board.elements.length) return;

    const exportBoardId = board.id;
    const signal = autoExportAbort?.signal;
    if (signal?.aborted) return;

    const { useUIStore } = await import('@/store/uiStore');
    useUIStore.getState().setExportStatus('exporting');

    try {
      const { default: html2canvas } = await import('html2canvas');
      const rfEl = document.querySelector('.react-flow') as HTMLElement;
      const viewport = document.querySelector('.react-flow__viewport') as HTMLElement;
      if (!rfEl || !viewport) { useUIStore.getState().setExportStatus('error'); return; }

      const fmt = board.autoExport.format || 'png';
      const isTransparent = board.autoExport.transparent && fmt === 'png';
      const scale = board.autoExport.dpi || 2;
      const sizeMode = board.autoExport.sizeMode || 'fit';

      // Compute content bounds from data model (viewport-independent)
      const pad = 20;
      const visibleEls = board.elements.filter(e => e.visible);
      const minX = Math.min(...visibleEls.map(e => e.x)) - pad;
      const minY = Math.min(...visibleEls.map(e => e.y)) - pad;
      const maxX = Math.max(...visibleEls.map(e => e.x + e.width)) + pad;
      const maxY = Math.max(...visibleEls.map(e => e.y + e.height)) + pad;
      const contentW = maxX - minX;
      const contentH = maxY - minY;

      // Determine target size
      let targetW = contentW;
      let targetH = contentH;
      if (sizeMode === 'fixed' && board.autoExport.fixedWidth && board.autoExport.fixedHeight) {
        targetW = board.autoExport.fixedWidth;
        targetH = board.autoExport.fixedHeight;
      } else if (sizeMode === 'canvas') {
        targetW = board.canvas.width;
        targetH = board.canvas.height;
      }

      // Save current viewport transform to restore later
      const origTransform = viewport.style.transform;
      const rfRect = rfEl.getBoundingClientRect();

      // Compute zoom to fit content into the RF container
      const fitZoom = Math.min(rfRect.width / contentW, rfRect.height / contentH, 1);
      // Set viewport: translate so content starts at (0,0) in screen space, scaled to fit
      const tx = -minX * fitZoom;
      const ty = -minY * fitZoom;
      viewport.style.transform = `translate(${tx}px, ${ty}px) scale(${fitZoom})`;
      // Force a synchronous layout reflow so html2canvas sees the new viewport
      void viewport.offsetHeight;

      // Clear selection
      const prevSelection = useUIStore.getState().selectedIds;
      useUIStore.getState().setSelectedIds([]);

      // Hide UI overlays
      const hideSelectors = [
        '.react-flow__minimap', '.react-flow__panel', '.react-flow__controls',
        '.react-flow__attribution', '.react-flow__background',
        '.react-flow__selection', '.react-flow__nodesselection',
      ];
      const hidden: HTMLElement[] = [];
      for (const sel of hideSelectors) {
        rfEl.querySelectorAll(sel).forEach(node => {
          const htmlNode = node as HTMLElement;
          if (htmlNode.style.display !== 'none') {
            hidden.push(htmlNode);
            htmlNode.style.display = 'none';
          }
        });
      }

      // Handle transparent background
      const origBg = rfEl.style.backgroundColor;
      if (isTransparent) {
        rfEl.style.backgroundColor = 'transparent';
        rfEl.classList.remove('bg-canvas-bg');
      }

      // Collect arrow SVG data BEFORE hiding them for html2canvas.
      // We render arrows separately via SVG→Image→Canvas to avoid html2canvas clipping.
      const arrowSvgData: Array<{
        svgMarkup: string; bboxX: number; bboxY: number; bboxW: number; bboxH: number;
        elX: number; elY: number;
      }> = [];
      rfEl.querySelectorAll('.react-flow__node-arrow').forEach(node => {
        const wrapper = node as HTMLElement;
        const svg = wrapper.querySelector('svg.overflow-visible') as SVGSVGElement | null;
        if (!svg) return;
        try {
          const bbox = svg.getBBox();
          if (!bbox || (bbox.width === 0 && bbox.height === 0)) return;
          const m = wrapper.style.transform.match(/translate\((.+?)px,\s*(.+?)px\)/);
          const elX = m ? parseFloat(m[1]) : 0;
          const elY = m ? parseFloat(m[2]) : 0;

          const pad = 5;
          const vbX = bbox.x - pad, vbY = bbox.y - pad;
          const vbW = bbox.width + pad * 2, vbH = bbox.height + pad * 2;

          // Clone SVG and clean it for standalone rendering
          const clonedSvg = svg.cloneNode(true) as SVGSVGElement;
          // Remove transparent hit-test paths and any elements with pointer-events handlers
          clonedSvg.querySelectorAll('[stroke="transparent"]').forEach(el => el.remove());
          // Remove React event handler attributes
          const removeAttrs = (el: Element) => {
            for (const attr of Array.from(el.attributes)) {
              if (attr.name.startsWith('on') || attr.name === 'class' || attr.name === 'style') {
                el.removeAttribute(attr.name);
              }
            }
            for (const child of Array.from(el.children)) removeAttrs(child);
          };
          removeAttrs(clonedSvg);
          // Set proper SVG attributes
          clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
          clonedSvg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
          clonedSvg.setAttribute('width', String(Math.ceil(vbW)));
          clonedSvg.setAttribute('height', String(Math.ceil(vbH)));
          // Copy the opacity from the original SVG
          const opacity = svg.style.opacity;
          if (opacity && opacity !== '1') clonedSvg.setAttribute('opacity', opacity);

          const svgMarkup = new XMLSerializer().serializeToString(clonedSvg);
          arrowSvgData.push({ svgMarkup, bboxX: vbX, bboxY: vbY, bboxW: vbW, bboxH: vbH, elX, elY });
        } catch (e) { console.warn('Arrow SVG collect failed:', e); }
      });

      // Hide arrow nodes during html2canvas capture
      const arrowNodes: HTMLElement[] = [];
      rfEl.querySelectorAll('.react-flow__node-arrow').forEach(node => {
        const wrapper = node as HTMLElement;
        if (wrapper.style.display !== 'none') {
          arrowNodes.push(wrapper);
          wrapper.style.display = 'none';
        }
      });

      let dataUrl: string;
      try {
        // Step 1: Capture everything except arrows with html2canvas
        const capturedCanvas = await html2canvas(rfEl, {
          scale,
          backgroundColor: isTransparent ? null : (board.canvas.background || '#ffffff'),
          useCORS: true,
          allowTaint: true,
          logging: false,
          width: rfRect.width,
          height: rfRect.height,
        });

        // Step 2: Crop to content area
        const cropW = Math.round(contentW * fitZoom * scale);
        const cropH = Math.round(contentH * fitZoom * scale);
        let resultCanvas: HTMLCanvasElement;

        if (sizeMode === 'fit') {
          resultCanvas = document.createElement('canvas');
          resultCanvas.width = cropW;
          resultCanvas.height = cropH;
          resultCanvas.getContext('2d')!.drawImage(capturedCanvas, 0, 0, cropW, cropH, 0, 0, cropW, cropH);
        } else if (sizeMode === 'fixed') {
          const fw = targetW * scale;
          const fh = targetH * scale;
          resultCanvas = document.createElement('canvas');
          resultCanvas.width = fw;
          resultCanvas.height = fh;
          const ctx = resultCanvas.getContext('2d')!;
          if (!isTransparent) {
            ctx.fillStyle = board.canvas.background || '#ffffff';
            ctx.fillRect(0, 0, fw, fh);
          }
          const s = Math.min(fw / cropW, fh / cropH);
          const dx = (fw - cropW * s) / 2;
          const dy = (fh - cropH * s) / 2;
          ctx.drawImage(capturedCanvas, 0, 0, cropW, cropH, dx, dy, cropW * s, cropH * s);
        } else {
          resultCanvas = capturedCanvas;
        }

        // Step 3: Composite arrows on top via SVG→Image→Canvas
        // Arrow wrapper positions (elX, elY) are in canvas coords.
        // Our viewport was set to: translate(-minX*fitZoom, -minY*fitZoom) scale(fitZoom)
        // So canvas coord C maps to screen pixel: (C - minX) * fitZoom
        // In the captured image at DPI scale: (C - minX) * fitZoom * scale
        // For 'fit' mode, we cropped from (0,0) so this is the final position.
        const rctx = resultCanvas.getContext('2d')!;
        for (const arrow of arrowSvgData) {
          try {
            const blob = new Blob([arrow.svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const img = await new Promise<HTMLImageElement>((resolve, reject) => {
              const i = new window.Image();
              i.onload = () => resolve(i);
              i.onerror = (e) => { console.warn('Arrow SVG image load failed', e); reject(e); };
              i.src = url;
            });

            // Arrow bbox origin in canvas coords
            const canvasX = arrow.elX + arrow.bboxX;
            const canvasY = arrow.elY + arrow.bboxY;

            if (sizeMode === 'fit') {
              const drawX = (canvasX - minX) * fitZoom * scale;
              const drawY = (canvasY - minY) * fitZoom * scale;
              const drawW = arrow.bboxW * fitZoom * scale;
              const drawH = arrow.bboxH * fitZoom * scale;
              rctx.drawImage(img, drawX, drawY, drawW, drawH);
            } else if (sizeMode === 'canvas') {
              const drawX = canvasX * fitZoom * scale;
              const drawY = canvasY * fitZoom * scale;
              const drawW = arrow.bboxW * fitZoom * scale;
              const drawH = arrow.bboxH * fitZoom * scale;
              rctx.drawImage(img, drawX, drawY, drawW, drawH);
            } else {
              // fixed mode — same as fit but with centering offset
              const fw = targetW * scale;
              const fh = targetH * scale;
              const s = Math.min(fw / cropW, fh / cropH);
              const offX = (fw - cropW * s) / 2;
              const offY = (fh - cropH * s) / 2;
              const drawX = offX + (canvasX - minX) * fitZoom * scale * s;
              const drawY = offY + (canvasY - minY) * fitZoom * scale * s;
              const drawW = arrow.bboxW * fitZoom * scale * s;
              const drawH = arrow.bboxH * fitZoom * scale * s;
              rctx.drawImage(img, drawX, drawY, drawW, drawH);
            }
            URL.revokeObjectURL(url);
          } catch (e) {
            console.warn('Failed to render arrow for export:', e);
          }
        }

        const mimeType = fmt === 'jpg' ? 'image/jpeg' : 'image/png';
        dataUrl = resultCanvas.toDataURL(mimeType, 0.95);
      } finally {
        // Restore everything
        viewport.style.transform = origTransform;
        void viewport.offsetHeight;
        for (const node of arrowNodes) node.style.display = '';
        for (const node of hidden) node.style.display = '';
        if (isTransparent) {
          rfEl.style.backgroundColor = origBg;
          rfEl.classList.add('bg-canvas-bg');
        }
        useUIStore.getState().setSelectedIds(prevSelection);
      }

      // Board switched during capture — discard
      if (signal?.aborted || get().board?.id !== exportBoardId) {
        useUIStore.getState().setExportStatus('idle');
        return;
      }

      const res = await fetch('/api/export/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: board.autoExport.outputPath,
          data_url: dataUrl,
        }),
      });

      if (signal?.aborted || get().board?.id !== exportBoardId) return;

      if (!res.ok) {
        console.error('Auto-export save failed:', await res.text());
        useUIStore.getState().setExportStatus('error');
      } else {
        useUIStore.getState().setExportStatus('success');
        setTimeout(() => {
          if (get().board?.id === exportBoardId && useUIStore.getState().exportStatus === 'success') {
            useUIStore.getState().setExportStatus('idle');
          }
        }, 3000);
      }
    } catch (err) {
      if (signal?.aborted) return;
      console.error('Auto-export failed:', err);
      const { useUIStore: ui } = await import('@/store/uiStore');
      ui.getState().setExportStatus('error');
    }
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
    set({ board: { ...board, elements: newElements }, isDirty: true });
    get().pushHistory(`Add ${type}`);
    return element;
  },

  updateElement: (id: string, updates: Partial<BoardElement>) => {
    const { board } = get();
    if (!board) return;

    const target = board.elements.find(el => el.id === id);

    // If moving a group, move all children by the same delta
    let childUpdates: Map<string, { x: number; y: number }> | null = null;
    if (target?.type === 'group' && target.children && (updates.x !== undefined || updates.y !== undefined)) {
      const dx = (updates.x ?? target.x) - target.x;
      const dy = (updates.y ?? target.y) - target.y;
      if (dx !== 0 || dy !== 0) {
        childUpdates = new Map();
        for (const childId of target.children) {
          const child = board.elements.find(el => el.id === childId);
          if (child) {
            childUpdates.set(childId, { x: child.x + dx, y: child.y + dy });
          }
        }
      }
    }

    const newElements = board.elements.map(el => {
      if (el.id === id) return { ...el, ...updates };
      if (childUpdates?.has(el.id)) {
        const pos = childUpdates.get(el.id)!;
        return { ...el, x: pos.x, y: pos.y };
      }
      return el;
    });
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
    const newElements = board.elements.filter(el => !idSet.has(el.id));
    set({ board: { ...board, elements: newElements }, isDirty: true });
    get().pushHistory('Delete elements');
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
    set({ board: { ...board, elements: [...board.elements, ...duplicated] }, isDirty: true });
    get().pushHistory('Duplicate');
    return duplicated;
  },

  bringToFront: (ids: string[]) => {
    const { board } = get();
    if (!board) return;
    const maxZ = board.elements.reduce((max, el) => Math.max(max, el.z_index), 0);
    const idSet = new Set(ids);
    const newElements = board.elements.map((el, i) =>
      idSet.has(el.id) ? { ...el, z_index: maxZ + 1 + i } : el
    );
    set({ board: { ...board, elements: newElements }, isDirty: true });
    get().pushHistory('Bring to front');
  },

  sendToBack: (ids: string[]) => {
    const { board } = get();
    if (!board) return;
    const minZ = board.elements.reduce((min, el) => Math.min(min, el.z_index), 0);
    const idSet = new Set(ids);
    const newElements = board.elements.map((el, i) =>
      idSet.has(el.id) ? { ...el, z_index: minZ - ids.length + i } : el
    );
    set({ board: { ...board, elements: newElements }, isDirty: true });
    get().pushHistory('Send to back');
  },

  bringForward: (ids: string[]) => {
    const { board } = get();
    if (!board) return;
    const idSet = new Set(ids);
    const newElements = board.elements.map(el =>
      idSet.has(el.id) ? { ...el, z_index: el.z_index + 1 } : el
    );
    set({ board: { ...board, elements: newElements }, isDirty: true });
    get().pushHistory('Bring forward');
  },

  sendBackward: (ids: string[]) => {
    const { board } = get();
    if (!board) return;
    const idSet = new Set(ids);
    const newElements = board.elements.map(el =>
      idSet.has(el.id) ? { ...el, z_index: el.z_index - 1 } : el
    );
    set({ board: { ...board, elements: newElements }, isDirty: true });
    get().pushHistory('Send backward');
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

    // Mark children with their groupId and store relative offsets
    const newElements = board.elements.map(el => {
      if (idSet.has(el.id)) {
        return {
          ...el,
          metadata: {
            ...el.metadata,
            groupId: group.id,
            relX: el.x - minX,
            relY: el.y - minY,
          },
        };
      }
      return el;
    });

    set({
      board: { ...board, elements: [...newElements, group] },
      isDirty: true,
    });
    get().pushHistory('Group');
    return group.id;
  },

  ungroupElements: (groupId: string) => {
    const { board } = get();
    if (!board) return;
    // Remove groupId from children metadata, remove the group element
    const newElements = board.elements
      .filter(el => el.id !== groupId)
      .map(el => {
        if (el.metadata?.groupId === groupId) {
          const { groupId: _, relX, relY, ...restMeta } = el.metadata;
          return { ...el, metadata: restMeta };
        }
        return el;
      });
    set({ board: { ...board, elements: newElements }, isDirty: true });
    get().pushHistory('Ungroup');
  },

  toggleLock: (ids: string[]) => {
    const { board } = get();
    if (!board) return;
    const idSet = new Set(ids);
    // Expand groups: if a group is selected, include its children
    const expandedIds = new Set(ids);
    for (const id of ids) {
      const el = board.elements.find(e => e.id === id);
      if (el?.type === 'group' && el.children) {
        el.children.forEach(cid => expandedIds.add(cid));
      }
    }
    const allLocked = board.elements.filter(el => expandedIds.has(el.id)).every(el => el.locked);
    const newElements = board.elements.map(el =>
      expandedIds.has(el.id) ? { ...el, locked: !allLocked } : el
    );
    set({ board: { ...board, elements: newElements }, isDirty: true });
  },

  alignElements: (ids: string[], alignment) => {
    const { board } = get();
    if (!board || ids.length < 2) return;
    const idSet = new Set(ids);
    const targets = board.elements.filter(el => idSet.has(el.id));

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
    get().pushHistory(`Align ${alignment}`);
  },

  distributeElements: (ids: string[], direction) => {
    const { board } = get();
    if (!board || ids.length < 3) return;
    const idSet = new Set(ids);
    const targets = board.elements.filter(el => idSet.has(el.id));

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
    get().pushHistory(`Distribute ${direction}`);
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

  updateConnectedArrows: (movedElementId: string) => {
    const { board } = get();
    if (!board) return;
    const movedEl = board.elements.find(e => e.id === movedElementId);
    if (!movedEl) return;

    for (const arrow of board.elements) {
      if (arrow.type !== 'arrow') continue;
      const startConn = arrow.metadata?.startConnection as string | undefined;
      const endConn = arrow.metadata?.endConnection as string | undefined;
      if (startConn !== movedElementId && endConn !== movedElementId) continue;

      const pts = arrow.points && arrow.points.length >= 2
        ? arrow.points
        : [{ x: 0, y: arrow.height / 2 }, { x: arrow.width, y: arrow.height / 2 }];
      const newMeta = { ...arrow.metadata };

      const resolveEndpoint = (
        connId: string | undefined,
        anchorKey: string,
        absKey: string,
        ptIdx: number,
      ) => {
        if (connId) {
          let anchor = arrow.metadata?.[anchorKey] as { rx: number; ry: number } | undefined;
          const el = connId === movedElementId ? movedEl : board.elements.find(e => e.id === connId);
          if (el) {
            if (!anchor) {
              const absPoint = { x: arrow.x + pts[ptIdx].x, y: arrow.y + pts[ptIdx].y };
              anchor = toRelativeAnchor(absPoint, el);
              newMeta[anchorKey] = anchor;
            }
            return fromRelativeAnchor(anchor, el);
          }
        }
        const stored = arrow.metadata?.[absKey] as { x: number; y: number } | undefined;
        if (stored) return { ...stored };
        return { x: arrow.x + pts[ptIdx].x, y: arrow.y + pts[ptIdx].y };
      };

      const sAbs = resolveEndpoint(startConn, 'startAnchor', 'startAbsPos', 0);
      const eAbs = resolveEndpoint(endConn, 'endAnchor', 'endAbsPos', 1);

      if (!startConn) newMeta.startAbsPos = sAbs;
      if (!endConn) newMeta.endAbsPos = eAbs;

      const minX = Math.min(sAbs.x, eAbs.x);
      const minY = Math.min(sAbs.y, eAbs.y);
      const w = Math.max(Math.abs(eAbs.x - sAbs.x), 1);
      const h = Math.max(Math.abs(eAbs.y - sAbs.y), 1);

      get().updateElement(arrow.id, {
        x: minX, y: minY, width: w, height: h,
        points: [
          { x: sAbs.x - minX, y: sAbs.y - minY },
          { x: eAbs.x - minX, y: eAbs.y - minY },
        ],
        metadata: newMeta,
      });
    }
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
