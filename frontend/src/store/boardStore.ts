import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { Board, BoardElement, CanvasSettings, ElementType, AutoExportSettings } from '@/types/board';
import { DEFAULT_CANVAS, DEFAULT_BOARD_SETUP, CURRENT_SCHEMA_VERSION } from '@/types/board';
import { createElement } from '@/utils/helpers';
import { api } from '@/api/client';
import { toRelativeAnchor, fromRelativeAnchor } from '@/utils/snapToShape';
/**
 * Capture the visible React Flow canvas using html2canvas.
 * html-to-image has a known bug where images with different query params
 * get deduplicated during DOM cloning, causing identical renders.
 * html2canvas rasterizes directly from the live DOM, avoiding this.
 */
async function captureThumbnail(board: Board): Promise<string | undefined> {
  const { captureOffscreen } = await import('@/utils/captureOffscreen');
  try {
    const canvas = await captureOffscreen(board, {
      scale: 0.5, // low res for thumbnail
      transparent: false,
      mode: 'fit', // shows all elements regardless of current viewport
    });
    return canvas.toDataURL('image/png');
  } catch {
    return undefined;
  }
}

interface HistoryEntry {
  elements: BoardElement[];
  description: string;
}

/**
 * Short, stable 32-bit FNV-1a hash. Good enough for divergence detection —
 * collisions are vanishingly unlikely for the set of plot code snippets we
 * compare here, and this avoids pulling in a crypto dependency.
 */
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Digest of the "agent-editable" portion of a board: the setup code plus
 * every plot element's code (identified by element id). Canvas layout
 * (position, size, crop, style) is deliberately excluded so that user-side
 * manual edits don't count as divergence — only code changes do.
 */
function codeDigest(board: Board): string {
  const parts: string[] = [];
  parts.push(`setup\n${board.setup?.code ?? ''}`);
  const plots = board.elements
    .filter(el => el.type === 'plot')
    .map(el => ({ id: el.id, code: String(el.metadata?.code ?? '') }))
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const p of plots) parts.push(`plot:${p.id}\n${p.code}`);
  return fnv1a(parts.join('\n---\n'));
}

/**
 * Merge strategy: take the agent's code (from disk) for every plot that
 * exists on both sides, and preserve the user's canvas layout (position,
 * size, crop, style, cached output). Elements that exist only on one side
 * are kept as-is — agent-added plots land on the canvas, user-added
 * elements survive the merge.
 *
 * The key invariant: `metadata.code` is agent territory; everything else on
 * the element is user territory. We don't try to merge the code text
 * itself — last writer wins for the code field, with the user's
 * "accept / merge / keep mine" decision making the final call.
 */
function mergeAgentCodeIntoLayout(
  localElements: BoardElement[],
  diskElements: BoardElement[],
): BoardElement[] {
  const diskById = new Map(diskElements.map(el => [el.id, el]));
  const localIds = new Set(localElements.map(el => el.id));
  const merged: BoardElement[] = localElements.map(local => {
    const disk = diskById.get(local.id);
    if (!disk) return local;
    if (local.type === 'plot' && disk.type === 'plot') {
      const localCode = String(local.metadata?.code ?? '');
      const diskCode = String(disk.metadata?.code ?? '');
      if (localCode === diskCode) return local;
      return {
        ...local,
        metadata: { ...local.metadata, code: disk.metadata?.code },
      };
    }
    return local;
  });
  for (const disk of diskElements) {
    if (!localIds.has(disk.id)) merged.push(disk);
  }
  return merged;
}

/**
 * Read width/height from a base64-encoded PNG by parsing the IHDR chunk.
 * Synchronous and DOM-free so it can run inside a store update.
 */
function readPngDimensions(b64: string | null | undefined): { width: number; height: number } | null {
  if (!b64) return null;
  try {
    const header = atob(b64.slice(0, 48));
    if (header.charCodeAt(0) !== 0x89 || header.charCodeAt(1) !== 0x50) return null;
    const w =
      (header.charCodeAt(16) << 24) | (header.charCodeAt(17) << 16) |
      (header.charCodeAt(18) << 8) | header.charCodeAt(19);
    const h =
      (header.charCodeAt(20) << 24) | (header.charCodeAt(21) << 16) |
      (header.charCodeAt(22) << 8) | header.charCodeAt(23);
    if (w <= 0 || h <= 0) return null;
    return { width: w, height: h };
  } catch {
    return null;
  }
}

/** Load a base64 PNG into an HTMLImageElement. */
function loadImageB64(b64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:image/png;base64,${b64}`;
  });
}

/**
 * Canvas-crop a base64 PNG to a fractional rectangle. Returns the cropped
 * image as a base64 string (no data URL prefix). On any failure, returns the
 * original image unchanged so the caller still has a valid lastOutput.
 */
async function cropImageB64(
  fullB64: string,
  crop: { x: number; y: number; w: number; h: number },
): Promise<string> {
  try {
    const img = await loadImageB64(fullB64);
    const sx = Math.max(0, Math.round(crop.x * img.naturalWidth));
    const sy = Math.max(0, Math.round(crop.y * img.naturalHeight));
    const sw = Math.max(1, Math.min(img.naturalWidth - sx, Math.round(crop.w * img.naturalWidth)));
    const sh = Math.max(1, Math.min(img.naturalHeight - sy, Math.round(crop.h * img.naturalHeight)));
    const cvs = document.createElement('canvas');
    cvs.width = sw; cvs.height = sh;
    cvs.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    return cvs.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
  } catch {
    return fullB64;
  }
}

/**
 * Given an element and a newly-rendered figure image, return the height that
 * preserves the element's current width while matching the effective display
 * aspect ratio. The effective aspect accounts for any stored plotCrop (crop
 * fractions are relative to the full figure). Returns the original height if
 * the PNG can't be decoded.
 */
function heightForFigure(
  el: BoardElement,
  imageB64: string | null | undefined,
  plotCrop: { w?: number; h?: number } | null | undefined,
): number {
  const dims = readPngDimensions(imageB64);
  if (!dims) return el.height;
  const cropW = plotCrop && plotCrop.w && plotCrop.w > 0.02 ? plotCrop.w : 1;
  const cropH = plotCrop && plotCrop.h && plotCrop.h > 0.02 ? plotCrop.h : 1;
  const effW = dims.width * cropW;
  const effH = dims.height * cropH;
  if (effW <= 0) return el.height;
  return Math.max(1, Math.round(el.width * (effH / effW)));
}

/** Kernel lifecycle / health status for the currently-open board. */
export type KernelStatus = 'idle' | 'running' | 'ok' | 'error' | 'unknown';

/** Unified shape used by runSetup / kernel responses. */
export interface KernelRunResult {
  ok: boolean;
  stdout: string | null;
  error: string | null;
}

/** One figure captured from a plot cell. */
export interface PlotFigure {
  image: string | null;
  plotly_json: string | null;
}

/** Run-all status broadcast to the UI. */
export type RunAllStatus =
  | { state: 'idle' }
  | { state: 'running'; current: number; total: number; label: string }
  | { state: 'done'; successes: number; failures: number }
  | { state: 'error'; message: string };

/** External-change conflict surfaced to the user when the disk version of the
 * open board has diverged from what we loaded. The user picks one of three
 * resolutions via `resolveExternalConflict`. */
export interface ExternalConflict {
  diskBoard: Board;
  diskDigest: string;
  /** Resolved when the user picks an option. Lets saveBoard() await the
   * user's decision and either complete or abort cleanly. */
  resolve: (choice: 'mine' | 'theirs' | 'merge' | 'cancel') => void;
}

interface BoardState {
  // Current board
  board: Board | null;
  boardFilePath: string | null;  // where the current board is saved on disk
  isDirty: boolean;

  /** Digest of the agent-editable portion of the board as we last read it
   * from disk (on load or after a successful save). Used to detect whether
   * an external process rewrote the file behind our back. */
  loadedCodeDigest: string | null;

  /** Non-null while a save detected divergence and is waiting on the user
   * to pick a resolution. Rendered by ExternalChangeModal. */
  externalConflict: ExternalConflict | null;
  resolveExternalConflict: (choice: 'mine' | 'theirs' | 'merge' | 'cancel') => void;

  // Per-board kernel status (lives in-memory, never persisted)
  kernelStatus: KernelStatus;
  runSetup: (code?: string) => Promise<KernelRunResult>;
  restartKernel: () => Promise<void>;

  // Multi-figure plot support
  /** Distribute N figures across N referencing elements (source + siblings),
   * auto-spawning new sibling elements when N exceeds the current reference
   * count. Returns the updated ordered list of reference element IDs. */
  distributePlotFigures: (
    sourceElementId: string,
    figures: PlotFigure[],
    stdout: string | null,
    error: string | null,
  ) => Promise<string[]>;

  // Run-all-plots support
  runAllStatus: RunAllStatus;
  /** Run setup (if non-empty) then every plot cell source element in
   * z-order. Each element's executePlot call reuses the auto-distribute
   * logic, so multi-figure cells keep working. Safe to call from the UI. */
  runAllPlots: () => Promise<void>;

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
  setSetupCode: (code: string) => void;
  setSetupTimeout: (timeout: number) => void;
  updateAutoExport: (settings: Partial<AutoExportSettings>) => void;
  triggerAutoExport: (boardSnapshot?: Board) => Promise<void>;
  setBoardPythonEnv: (path: string | null) => void;

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

/**
 * Strip heavy blob data (plot base64 output, embedded image data) from elements
 * before storing in undo history. This prevents memory bloat when boards contain
 * many plots or large embedded images. The live board state still has the full data.
 */
function stripBlobsForHistory(elements: BoardElement[]): BoardElement[] {
  return elements.map(el => {
    // Strip plot output blobs from history (they're re-rendered on demand)
    if (el.type === 'plot' && (el.metadata?.lastOutput || el.metadata?.plotlyJson)) {
      return {
        ...el,
        metadata: { ...el.metadata, lastOutput: null, lastStdout: null, plotlyJson: null },
      };
    }
    // Strip embedded image data from history (it's re-embedded on save)
    if (el.type === 'image' && el.source?.embeddedData) {
      return {
        ...el,
        source: { ...el.source, embeddedData: undefined },
      };
    }
    return el;
  });
}

/**
 * Restore a history snapshot without losing the live blobs that `stripBlobsForHistory`
 * removed. Plot outputs and embedded image bytes are the result of kernel runs or
 * embed passes, not of layout operations — undoing "move element" should not wipe
 * them from the canvas. For each element in the restored snapshot whose blobs are
 * missing, we copy the current live blobs in by element id. Elements that no longer
 * exist live (e.g. undoing a delete brings back an element that was never re-run)
 * keep their null blobs and the user can re-run the plot.
 */
function reattachBlobsAfterHistory(
  restored: BoardElement[],
  live: BoardElement[],
): BoardElement[] {
  const liveById = new Map(live.map(el => [el.id, el]));
  return restored.map(el => {
    const liveEl = liveById.get(el.id);
    if (!liveEl) return el;
    if (el.type === 'plot' && liveEl.type === 'plot') {
      const liveMeta = liveEl.metadata ?? {};
      if (liveMeta.lastOutput || liveMeta.plotlyJson || liveMeta.lastStdout) {
        return {
          ...el,
          metadata: {
            ...el.metadata,
            lastOutput: el.metadata?.lastOutput ?? liveMeta.lastOutput ?? null,
            plotlyJson: el.metadata?.plotlyJson ?? liveMeta.plotlyJson ?? null,
            lastStdout: el.metadata?.lastStdout ?? liveMeta.lastStdout ?? null,
          },
        };
      }
    }
    if (el.type === 'image' && liveEl.type === 'image') {
      if (!el.source?.embeddedData && liveEl.source?.embeddedData) {
        return {
          ...el,
          source: {
            ...el.source!,
            embeddedData: liveEl.source.embeddedData,
            embeddedMime: el.source?.embeddedMime ?? liveEl.source.embeddedMime,
          },
        };
      }
    }
    return el;
  });
}

// Abort controller for cancelling in-flight exports on board switch
let autoExportAbort: AbortController | null = null;

export const useBoardStore = create<BoardState>((set, get) => ({
  board: null,
  boardFilePath: null,
  isDirty: false,
  loadedCodeDigest: null,
  externalConflict: null,
  resolveExternalConflict: (choice) => {
    const conflict = get().externalConflict;
    if (!conflict) return;
    conflict.resolve(choice);
  },
  kernelStatus: 'idle' as KernelStatus,
  history: [],
  historyIndex: -1,
  imageVersions: {},

  runSetup: async (code?: string) => {
    const { board, boardFilePath } = get();
    if (!board) return { ok: false, stdout: null, error: 'no board open' };
    const setupCode = code ?? board.setup?.code ?? '';
    const timeout = board.setup?.timeout ?? 120;
    // Match plot execution: pass the board file's directory as cwd so the
    // backend can resolve the user's project root from it.
    const cwd = boardFilePath ? boardFilePath.replace(/\/[^/]+$/, '') : null;
    set({ kernelStatus: 'running' });
    try {
      const r = await api.runSetup(board.id, setupCode, board.pythonEnvPath ?? null, timeout, cwd);
      set({ kernelStatus: r.success ? 'ok' : 'error' });
      return {
        ok: r.success,
        stdout: r.stdout,
        error: r.error,
      };
    } catch (err: any) {
      set({ kernelStatus: 'error' });
      return { ok: false, stdout: null, error: String(err?.message ?? err) };
    }
  },

  restartKernel: async () => {
    const { board } = get();
    if (!board) return;
    try {
      await api.restartKernel(board.id);
      set({ kernelStatus: 'idle' });
    } catch {
      set({ kernelStatus: 'error' });
    }
  },

  runAllStatus: { state: 'idle' } as RunAllStatus,

  distributePlotFigures: async (sourceElementId, figures, stdout, error) => {
    const { board } = get();
    if (!board) return [];
    const source = board.elements.find(el => el.id === sourceElementId);
    if (!source) return [];

    // Collect current references: the source itself plus any siblings
    // whose metadata.sourceElementId points at this source. Sort by
    // figureIndex so the order matches the figures list.
    const rawSiblings = board.elements.filter(
      el => el.metadata?.sourceElementId === sourceElementId,
    );
    type Ref = { id: string; figureIndex: number };
    const existingRefs: Ref[] = [
      { id: source.id, figureIndex: source.metadata?.figureIndex ?? 0 },
      ...rawSiblings.map(s => ({
        id: s.id,
        figureIndex: s.metadata?.figureIndex ?? 0,
      })),
    ].sort((a, b) => a.figureIndex - b.figureIndex);

    // Spawn new siblings if the code now produces more figures than
    // we have references for. Lay them out to the right in a row.
    const newSiblings: BoardElement[] = [];
    for (let i = existingRefs.length; i < figures.length; i++) {
      const offset = i - existingRefs.length + 1;
      const newEl: BoardElement = {
        ...structuredClone(source),
        id: uuidv4(),
        x: source.x + offset * (source.width + 20),
        y: source.y,
        metadata: {
          ...(source.metadata ?? {}),
          sourceElementId: sourceElementId,
          figureIndex: i,
          // Inherit nothing transient from the source:
          code: undefined,
          lastOutput: null,
          lastStdout: null,
          lastError: null,
          plotlyJson: null,
          plotCrop: null,
          figureMissing: false,
        },
      };
      newSiblings.push(newEl);
      existingRefs.push({ id: newEl.id, figureIndex: i });
    }

    const refIdToFigureIndex = new Map(existingRefs.map(r => [r.id, r.figureIndex]));

    // Update every referencing element with its figure's output, or flag
    // it as missing when the code now produces fewer figures than refs.
    // Async so we can canvas-crop the image for panels that have a
    // stored plotCrop — matches what the PlotEditor save path does.
    const updatedElements = await Promise.all(board.elements.map(async el => {
      const figIdx = refIdToFigureIndex.get(el.id);
      if (figIdx === undefined) return el;
      const fig = figures[figIdx];
      const isSource = el.id === sourceElementId;
      const nextMeta: Record<string, any> = {
        ...el.metadata,
        lastStdout: stdout,
        lastError: error,
      };
      // Ensure source has a concrete figureIndex so all refs are
      // queryable uniformly.
      if (isSource && nextMeta.figureIndex === undefined) {
        nextMeta.figureIndex = 0;
      }
      let effectiveImage: string | null = null;
      if (fig) {
        const plotCrop = nextMeta.plotCrop;
        const hasCrop = plotCrop && plotCrop.w > 0.02 && plotCrop.h > 0.02;
        effectiveImage = fig.image && hasCrop
          ? await cropImageB64(fig.image, plotCrop)
          : fig.image;
        nextMeta.lastOutput = effectiveImage;
        nextMeta.plotlyJson = fig.plotly_json;
        nextMeta.figureMissing = false;
      } else {
        nextMeta.lastOutput = null;
        nextMeta.plotlyJson = null;
        nextMeta.figureMissing = true;
        if (!error) {
          nextMeta.lastError =
            `Figure ${figIdx} missing: code now produces only ${figures.length} figure${figures.length === 1 ? '' : 's'}.`;
        }
      }
      // Sync element height to the cropped image's aspect ratio. Using
      // the already-cropped image means we pass a null crop rect to
      // heightForFigure — the PNG dimensions are the final display dims.
      const nextHeight = effectiveImage
        ? heightForFigure(el, effectiveImage, null)
        : el.height;
      return { ...el, height: nextHeight, metadata: nextMeta };
    }));

    // Bake the new siblings' per-figure output into their metadata so the
    // canvas immediately renders the correct figure for each. New siblings
    // start uncropped, so height is derived directly from the image.
    const newSiblingsWithFigure = newSiblings.map(sib => {
      const figIdx = sib.metadata.figureIndex;
      const fig = figures[figIdx];
      const nextHeight = fig?.image ? heightForFigure(sib, fig.image, null) : sib.height;
      return {
        ...sib,
        height: nextHeight,
        metadata: {
          ...sib.metadata,
          lastOutput: fig?.image ?? null,
          plotlyJson: fig?.plotly_json ?? null,
          lastStdout: stdout,
          lastError: error,
          figureMissing: !fig,
        },
      };
    });

    set({
      board: {
        ...board,
        elements: [...updatedElements, ...newSiblingsWithFigure],
      },
      isDirty: true,
    });

    return existingRefs.map(r => r.id);
  },

  runAllPlots: async () => {
    const { board, boardFilePath } = get();
    if (!board) return;

    // Collect only SOURCE plot elements (skip siblings that share code).
    const sources = board.elements
      .filter(
        el =>
          el.type === 'plot' &&
          (el.metadata?.sourceElementId === undefined ||
            el.metadata?.sourceElementId === null) &&
          (el.metadata?.code ?? '').trim().length > 0,
      )
      .sort((a, b) => a.z_index - b.z_index);

    if (sources.length === 0) {
      set({ runAllStatus: { state: 'done', successes: 0, failures: 0 } });
      return;
    }

    const env = board.pythonEnvPath ?? null;
    const cwd = boardFilePath ? boardFilePath.replace(/\/[^/]+$/, '') : null;
    const setupCode = board.setup?.code ?? '';
    const setupTimeout = board.setup?.timeout ?? 120;

    // Force setup to re-run once at the start of a Run All by explicitly
    // running it here — this gives the user a known-good baseline and
    // clear feedback if setup itself fails.
    if (setupCode.trim().length > 0) {
      set({
        runAllStatus: {
          state: 'running',
          current: 0,
          total: sources.length + 1,
          label: 'Python Setup',
        },
        kernelStatus: 'running',
      });
      try {
        const r = await api.runSetup(board.id, setupCode, env, setupTimeout, cwd);
        if (!r.success) {
          set({
            runAllStatus: {
              state: 'error',
              message: `Python Setup failed:\n${r.error ?? 'unknown error'}`,
            },
            kernelStatus: 'error',
          });
          return;
        }
        set({ kernelStatus: 'ok' });
      } catch (err: any) {
        set({
          runAllStatus: {
            state: 'error',
            message: `Python Setup failed:\n${err?.message ?? String(err)}`,
          },
          kernelStatus: 'error',
        });
        return;
      }
    }

    let successes = 0;
    let failures = 0;
    for (let i = 0; i < sources.length; i++) {
      const el = sources[i];
      const label = el.metadata?.name || `Plot ${i + 1}`;
      set({
        runAllStatus: {
          state: 'running',
          current: i + 1 + (setupCode.trim().length > 0 ? 1 : 0),
          total: sources.length + (setupCode.trim().length > 0 ? 1 : 0),
          label,
        },
      });
      try {
        const r = await api.executePlot(
          el.metadata?.code ?? '',
          30,
          150,
          env,
          undefined,
          cwd,
          { boardId: board.id, setupCode, setupTimeout },
        );
        const figures =
          r.figures && r.figures.length > 0
            ? r.figures
            : r.image_base64 || r.plotly_json
            ? [{ image: r.image_base64, plotly_json: r.plotly_json }]
            : [];
        await get().distributePlotFigures(el.id, figures, r.stdout, r.success ? null : r.error);
        if (r.success) successes++;
        else failures++;
      } catch (err: any) {
        failures++;
        await get().distributePlotFigures(
          el.id,
          [],
          null,
          `Run All failed for ${label}: ${err?.message ?? String(err)}`,
        );
      }
    }

    set({ runAllStatus: { state: 'done', successes, failures } });
  },

  newBoard: async (name: string, filePath: string, canvasOverrides?: Partial<CanvasSettings>) => {
    if (autoExportAbort) autoExportAbort.abort();
    autoExportAbort = new AbortController();
    const board: Board = {
      schema_version: CURRENT_SCHEMA_VERSION,
      id: uuidv4(),
      name,
      canvas: { ...DEFAULT_CANVAS, ...canvasOverrides },
      elements: [],
      setup: { ...DEFAULT_BOARD_SETUP },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      app_version: '0.1.0',
    };
    const result = await api.saveBoardToFile(board, filePath);
    set({
      board: result.board,
      boardFilePath: result.path,
      isDirty: false,
      loadedCodeDigest: codeDigest(result.board),
      history: [{ elements: [], description: 'New board' }],
      historyIndex: 0,
    });
  },

  openBoard: async (filePath: string) => {
    if (autoExportAbort) autoExportAbort.abort();
    autoExportAbort = new AbortController();
    const result = await api.openBoardFromFile(filePath);
    const board = result.board;

    // Safety net: backend should already have migrated, but guarantee the
    // field exists so downstream consumers don't need null-checks everywhere.
    if (!board.setup) {
      board.setup = { ...DEFAULT_BOARD_SETUP };
      board.schema_version = CURRENT_SCHEMA_VERSION;
    }

    // Check link status for image elements. If the source file is newer
    // than the embedded copy, re-embed immediately so the canvas shows the
    // live bytes (and mark the board dirty so autosave writes them back).
    let needsResave = false;
    const checkedElements = await Promise.all(
      board.elements.map(async (el: any) => {
        if (el.type !== 'image' || !el.source?.path) return el;
        try {
          const check = await api.checkImage(el.source.path);
          if (!check.exists) {
            return { ...el, source: { ...el.source, linkStatus: 'unlinked' } };
          }
          const isUpdated =
            el.source.lastModified && check.mtime && check.mtime > el.source.lastModified;
          if (isUpdated) {
            try {
              const embed = await api.embedImage(el.source.path);
              if (embed.exists && embed.data) {
                needsResave = true;
                return {
                  ...el,
                  source: {
                    ...el.source,
                    embeddedData: embed.data,
                    embeddedMime: embed.mime || el.source.embeddedMime || 'image/png',
                    lastModified: embed.mtime || check.mtime,
                    linkStatus: 'linked' as const,
                  },
                };
              }
            } catch {
              // Fall through to marking as 'updated' without refreshing bytes.
            }
            return { ...el, source: { ...el.source, linkStatus: 'updated' } };
          }
          return { ...el, source: { ...el.source, linkStatus: 'linked' } };
        } catch {
          return el;
        }
      })
    );

    set({
      board: { ...board, elements: checkedElements },
      boardFilePath: result.path,
      // If any linked image was re-embedded on open, the store now holds
      // fresher bytes than the .sdraw file — mark dirty so autosave writes
      // them back.
      isDirty: needsResave,
      loadedCodeDigest: codeDigest({ ...board, elements: checkedElements }),
      externalConflict: null,
      history: [{ elements: structuredClone(checkedElements), description: 'Load' }],
      historyIndex: 0,
    });
  },

  saveBoard: async () => {
    const initial = get();
    if (!initial.board || !initial.boardFilePath) return;
    // A conflict resolution is already waiting on the user — don't queue
    // another write until they pick.
    if (initial.externalConflict) return;
    const boardFilePath = initial.boardFilePath;

    // --- External-change detection ---
    // Re-read the file as it currently sits on disk and compare the code
    // digest to the baseline we captured on load/last-save. If an external
    // process (e.g. an AI agent) rewrote the Python code, open a conflict
    // modal and wait for the user to pick a resolution.
    if (initial.loadedCodeDigest !== null) {
      let diskBoard: Board | null = null;
      try {
        const r = await api.openBoardFromFile(boardFilePath);
        diskBoard = r.board as Board;
      } catch {
        // File missing / unreadable — fall through to normal save, which
        // will either recreate the file or surface a clear error.
      }
      if (diskBoard) {
        const diskDigest = codeDigest(diskBoard);
        if (diskDigest !== initial.loadedCodeDigest) {
          const db = diskBoard;
          const choice = await new Promise<'mine' | 'theirs' | 'merge' | 'cancel'>(resolve => {
            set({ externalConflict: { diskBoard: db, diskDigest, resolve } });
          });
          set({ externalConflict: null });

          if (choice === 'cancel') return;

          if (choice === 'theirs') {
            // Discard in-memory state and adopt the disk version wholesale.
            // No write needed — we're now in sync with disk.
            set({
              board: db,
              isDirty: false,
              loadedCodeDigest: diskDigest,
              history: [{ elements: structuredClone(db.elements), description: 'Accept external' }],
              historyIndex: 0,
            });
            return;
          }

          if (choice === 'merge') {
            // Take disk's code for each matching plot, keep the user's
            // canvas layout, then fall through to the normal save path so
            // the merged state gets written.
            const cur = get().board!;
            const mergedElements = mergeAgentCodeIntoLayout(cur.elements, db.elements);
            const mergedBoard: Board = {
              ...cur,
              setup: {
                ...(cur.setup ?? DEFAULT_BOARD_SETUP),
                code: db.setup?.code ?? cur.setup?.code ?? '',
              },
              elements: mergedElements,
            };
            set({ board: mergedBoard });
          }
          // 'mine' → fall through, overwriting disk with the in-memory board.
        }
      }
    }

    const board = get().board;
    if (!board) return;

    // Capture thumbnail from the canvas
    let thumbnail: string | undefined;
    try {
      thumbnail = await captureThumbnail(board);
    } catch {
      // Thumbnail capture is best-effort
    }

    // Embed images: for each image element with a source path, fetch the
    // file data and store as base64 so the board is self-contained.
    // Files that exceed the backend per-image cap come back with
    // `oversized: true` and no data — we keep the linked path and accept a
    // reduced render guarantee for that one element rather than bloat the
    // .sdraw file. Collect oversized paths so we can warn the user.
    const oversizedImages: { path: string; size?: number }[] = [];
    const embeddedElements = await Promise.all(
      board.elements.map(async (el) => {
        if (el.type !== 'image' || !el.source?.path) return el;
        try {
          const result = await api.embedImage(el.source.path);
          if (result.exists && result.oversized) {
            oversizedImages.push({ path: el.source.path, size: result.size });
            return {
              ...el,
              source: {
                ...el.source,
                lastModified: result.mtime || el.source.lastModified,
                linkStatus: 'linked' as const,
              },
            };
          }
          if (result.exists && result.data) {
            return {
              ...el,
              source: {
                ...el.source,
                embeddedData: result.data,
                embeddedMime: result.mime || 'image/png',
                lastModified: result.mtime || undefined,
                linkStatus: 'linked' as const,
              },
            };
          }
          // File doesn't exist — mark as unlinked but keep existing embedded data
          return {
            ...el,
            source: { ...el.source, linkStatus: 'unlinked' as const },
          };
        } catch {
          return el; // embedding failed, keep element as-is
        }
      })
    );

    const updated = {
      ...board,
      elements: embeddedElements,
      updated_at: new Date().toISOString(),
      thumbnail,
    };
    const saveResult = await api.saveBoardToFile(updated, boardFilePath);
    set({ board: updated, isDirty: false, loadedCodeDigest: codeDigest(updated) });
    // Clean up checkpoint after a successful save
    try { await api.deleteCheckpoint(boardFilePath); } catch {}

    // Surface size warnings. The hard cap is already enforced backend-side;
    // these are informational so users know why an image isn't embedded or
    // why the file is getting heavy.
    if (oversizedImages.length > 0) {
      const names = oversizedImages
        .map(i => i.path.split('/').pop() || i.path)
        .slice(0, 3)
        .join(', ');
      const more = oversizedImages.length > 3 ? ` (+${oversizedImages.length - 3} more)` : '';
      console.warn(
        `[sdraw] ${oversizedImages.length} image(s) too large to embed: ${names}${more}. ` +
          `Linked path preserved but will not render on devices without the source file.`,
      );
    }
    if (saveResult.oversized && saveResult.size) {
      const mb = (saveResult.size / (1024 * 1024)).toFixed(0);
      console.warn(
        `[sdraw] .sdraw file is large (${mb} MB). Consider splitting the board or removing unused images.`,
      );
    }
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

    // Final save goes through the full saveBoard path so the file picks up
    // freshly-run plot outputs, re-embedded linked images, and the thumbnail
    // before we tear down.
    const { board, boardFilePath, isDirty } = get();
    if (board && boardFilePath && isDirty) {
      try {
        await get().saveBoard();
      } catch {
        // Best-effort
      }
    }
    // Fire-and-forget kernel shutdown — don't block close on backend latency.
    if (board) {
      api.shutdownKernel(board.id).catch(() => {});
    }
    set({ board: null, boardFilePath: null, isDirty: false, kernelStatus: 'idle', history: [], historyIndex: -1 });
  },

  setBoardName: (name: string) => {
    const { board } = get();
    if (!board) return;
    set({ board: { ...board, name }, isDirty: true });
  },

  setSetupCode: (code: string) => {
    const { board } = get();
    if (!board) return;
    if (board.setup.code === code) return;
    set({
      board: { ...board, setup: { ...board.setup, code } },
      isDirty: true,
    });
  },

  setSetupTimeout: (timeout: number) => {
    const { board } = get();
    if (!board) return;
    if (board.setup.timeout === timeout) return;
    set({
      board: { ...board, setup: { ...board.setup, timeout } },
      isDirty: true,
    });
  },

  setBoardPythonEnv: (path: string | null) => {
    const { board } = get();
    if (!board) return;
    set({ board: { ...board, pythonEnvPath: path }, isDirty: true });
  },

  updateAutoExport: (settings: Partial<AutoExportSettings>) => {
    const { board } = get();
    if (!board) return;
    const current = board.autoExport || { enabled: false, outputPath: '', format: 'png' as const, dpi: 2, transparent: false, sizeMode: 'fit' as const };
    set({ board: { ...board, autoExport: { ...current, ...settings } }, isDirty: true });
  },

  triggerAutoExport: async (boardSnapshot?: Board) => {
    // Use the provided snapshot if available, otherwise read from store.
    const board = boardSnapshot ?? get().board;
    if (!board?.autoExport?.enabled || !board.autoExport.outputPath) return;
    if (!board.elements.length) return;

    const exportBoardId = board.id;
    const signal = autoExportAbort?.signal;
    if (signal?.aborted) return;

    const { useUIStore } = await import('@/store/uiStore');

    // Re-check after await: board may have switched during dynamic import
    if (signal?.aborted || (get().board && get().board!.id !== exportBoardId)) {
      return;
    }

    useUIStore.getState().setExportStatus('exporting');

    try {
      // Off-screen DOM rendering: build a hidden container with DOM elements
      // that mirror the React component visual output, then capture with
      // html2canvas.  The board snapshot is rendered in isolation, so there
      // is no cross-board contamination regardless of which board is visible.
      // NOTE: SVG foreignObject would give pixel-perfect text but the canvas
      // becomes "tainted" (security restriction), so we use html2canvas.
      const { captureOffscreen } = await import('@/utils/captureOffscreen');

      if (signal?.aborted || get().board?.id !== exportBoardId) {
        useUIStore.getState().setExportStatus('idle');
        return;
      }

      const ae = board.autoExport;
      const canvas = await captureOffscreen(board, {
        scale: ae.dpi || 2,
        transparent: ae.transparent && ae.format === 'png',
        mode: ae.sizeMode || 'fit',
        fixedW: ae.fixedWidth,
        fixedH: ae.fixedHeight,
      });

      if (signal?.aborted || get().board?.id !== exportBoardId) {
        useUIStore.getState().setExportStatus('idle');
        return;
      }

      const mimeType = ae.format === 'jpg' ? 'image/jpeg' : 'image/png';
      const dataUrl = canvas.toDataURL(mimeType, 0.95);
      const res = await fetch('/api/export/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: signal,
        body: JSON.stringify({
          path: ae.outputPath,
          data_url: dataUrl,
        }),
      });

      if (signal?.aborted || get().board?.id !== exportBoardId) {
        useUIStore.getState().setExportStatus('idle');
        return;
      }

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
      if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
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
    get().pushHistory('Toggle lock');
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
    newHistory.push({ elements: stripBlobsForHistory(structuredClone(board.elements)), description });
    if (newHistory.length > MAX_HISTORY) newHistory.shift();
    set({ history: newHistory, historyIndex: newHistory.length - 1 });
  },

  undo: () => {
    const { board, history, historyIndex } = get();
    if (!board || historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    const entry = history[newIndex];
    const restored = reattachBlobsAfterHistory(
      structuredClone(entry.elements),
      board.elements,
    );
    set({
      board: { ...board, elements: restored },
      historyIndex: newIndex,
      isDirty: true,
    });
  },

  redo: () => {
    const { board, history, historyIndex } = get();
    if (!board || historyIndex >= history.length - 1) return;
    const newIndex = historyIndex + 1;
    const entry = history[newIndex];
    const restored = reattachBlobsAfterHistory(
      structuredClone(entry.elements),
      board.elements,
    );
    set({
      board: { ...board, elements: restored },
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
