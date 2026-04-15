import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { Board, BoardElement, CanvasSettings, ElementType, AutoExportSettings, PlotCodeEntry } from '@/types/board';
import { DEFAULT_CANVAS, DEFAULT_BOARD_SETUP, CURRENT_SCHEMA_VERSION } from '@/types/board';
import { createElement, DEFAULT_PLOT_CODE } from '@/utils/helpers';
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
  plotCodes: Record<string, PlotCodeEntry>;
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
/**
 * Per-plot render hash: setup code + this plot's code. A cropped plot's
 * frozen image is only trusted for a Run All when this hash matches the
 * value stamped onto the plot at the moment its crop was saved. When the
 * code (setup or plot) changes, the stored crop is considered stale and
 * Run All falls through to the normal refresh path.
 */
export function plotRenderHash(setupCode: string, plotCode: string): string {
  return fnv1a(`setup\n${setupCode ?? ''}\n---\nplot\n${plotCode ?? ''}`);
}

function codeDigest(board: Board): string {
  const parts: string[] = [];
  parts.push(`setup\n${board.setup?.code ?? ''}`);
  const entries = Object.entries(board.plotCodes ?? {})
    .map(([id, entry]) => ({ id, code: String(entry?.code ?? '') }))
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const e of entries) parts.push(`plot:${e.id}\n${e.code}`);
  return fnv1a(parts.join('\n---\n'));
}

/**
 * Migrate an on-disk board to the plot-code-registry schema (v3). For every
 * plot element with `metadata.code`, create a `plotCodes` registry entry and
 * set `metadata.plotCodeId` on the element. For every plot element with
 * `metadata.sourceElementId`, point at the same registry entry the former
 * source now references. Idempotent: running twice is a no-op. Also ensures
 * `board.plotCodes` is always a defined object and bumps `schema_version`.
 *
 * This runs on load and newBoard. The next normal save persists it.
 */
function migrateToPlotCodeRegistry(board: any): Board {
  if (!board || typeof board !== 'object') return board;
  if (!board.plotCodes || typeof board.plotCodes !== 'object') {
    board.plotCodes = {};
  }
  const elements: any[] = Array.isArray(board.elements) ? board.elements : [];

  // Pass 1: every plot element that still carries metadata.code becomes a
  // new registry entry and drops the inline code. This also captures the
  // legacy "source" elements; siblings have no code of their own.
  const elIdToPlotCodeId = new Map<string, string>();
  for (const el of elements) {
    if (el?.type !== 'plot' || !el.metadata) continue;
    if (typeof el.metadata.plotCodeId === 'string') {
      // Already migrated.
      elIdToPlotCodeId.set(el.id, el.metadata.plotCodeId);
      continue;
    }
    if (typeof el.metadata.code === 'string') {
      const newId = uuidv4();
      board.plotCodes[newId] = { code: el.metadata.code };
      el.metadata.plotCodeId = newId;
      elIdToPlotCodeId.set(el.id, newId);
      delete el.metadata.code;
    }
  }

  // Pass 2: legacy siblings (had `sourceElementId` pointing at the source)
  // inherit the same plotCodeId the source now references.
  for (const el of elements) {
    if (el?.type !== 'plot' || !el.metadata) continue;
    if (typeof el.metadata.plotCodeId === 'string') continue;
    const srcId: string | undefined = el.metadata.sourceElementId;
    if (srcId) {
      const pcid = elIdToPlotCodeId.get(srcId);
      if (pcid) {
        el.metadata.plotCodeId = pcid;
        delete el.metadata.sourceElementId;
        continue;
      }
    }
    // Orphan: a plot element with neither code nor source. Give it its own
    // fresh empty registry entry so it can be edited and run.
    const newId = uuidv4();
    board.plotCodes[newId] = { code: '' };
    el.metadata.plotCodeId = newId;
  }

  // Clean up any leftover sourceElementId hints now that they're redundant.
  for (const el of elements) {
    if (el?.type === 'plot' && el.metadata && 'sourceElementId' in el.metadata) {
      delete el.metadata.sourceElementId;
    }
  }

  board.schema_version = CURRENT_SCHEMA_VERSION;
  return board as Board;
}

/**
 * Return a new plotCodes registry with entries that no element references
 * removed. Called after deletions so the registry stays tight. Pure — does
 * not mutate.
 */
function gcPlotCodes(
  plotCodes: Record<string, PlotCodeEntry>,
  elements: BoardElement[],
): Record<string, PlotCodeEntry> {
  const referenced = new Set<string>();
  for (const el of elements) {
    if (el.type === 'plot') {
      const pcid = el.metadata?.plotCodeId;
      if (typeof pcid === 'string') referenced.add(pcid);
    }
  }
  let changed = false;
  const next: Record<string, PlotCodeEntry> = {};
  for (const [id, entry] of Object.entries(plotCodes)) {
    if (referenced.has(id)) next[id] = entry;
    else changed = true;
  }
  return changed ? next : plotCodes;
}

/**
 * Merge strategy: take the agent's setup+plotCodes registry (from disk) and
 * preserve the user's canvas layout (elements). Elements that exist only on
 * one side are kept as-is — agent-added plots land on the canvas, user-added
 * elements survive the merge.
 *
 * The invariant is now: `board.plotCodes` is agent territory; elements and
 * their non-code metadata are user territory.
 */
function mergeAgentCodeIntoLayout(
  local: Board,
  disk: Board,
): { plotCodes: Record<string, PlotCodeEntry>; elements: BoardElement[] } {
  // Registry merge: disk wins for codes that exist on both sides. Entries
  // present only on one side are kept. (Elements still reference ids; the
  // migrator on the disk side ensured ids are stable.)
  const plotCodes: Record<string, PlotCodeEntry> = { ...(local.plotCodes ?? {}) };
  for (const [id, entry] of Object.entries(disk.plotCodes ?? {})) {
    plotCodes[id] = entry;
  }
  // Elements: keep local layout, add disk-only elements so agent-added
  // plots survive the merge.
  const diskById = new Map(disk.elements.map(el => [el.id, el]));
  const localIds = new Set(local.elements.map(el => el.id));
  const merged: BoardElement[] = [...local.elements];
  for (const [id, el] of diskById) {
    if (!localIds.has(id)) merged.push(el);
  }
  return { plotCodes, elements: merged };
}

/**
 * Read width/height from a base64-encoded PNG by parsing the IHDR chunk.
 * Synchronous and DOM-free so it can run inside a store update. Tolerant
 * of a `data:image/png;base64,` prefix and of stray whitespace in the
 * base64 string (some encoders wrap at 76 chars).
 */
function readPngDimensions(b64: string | null | undefined): { width: number; height: number } | null {
  if (!b64) return null;
  try {
    // Strip data-URL prefix if present, then remove whitespace so atob
    // sees a clean base64 stream.
    const clean = b64.replace(/^data:image\/[^;]+;base64,/, '').replace(/\s+/g, '');
    // 48 base64 chars = 36 bytes, which covers through the IHDR width+height.
    const header = atob(clean.slice(0, 48));
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

/**
 * Synchronously compute the element height that matches a fresh figure's
 * natural aspect ratio. Used only for UNCROPPED plots — cropped plots are
 * frozen during Run All and never routed through this function. Reads the
 * PNG header bytes directly (no image decode) so it can't fail on large
 * figures.
 */
function syncHeightForFigure(
  elWidth: number,
  fallbackHeight: number,
  imageB64: string | null | undefined,
  plotCrop: { w?: number; h?: number } | null | undefined,
): number {
  if (!imageB64 || elWidth <= 0) return fallbackHeight;
  const dims = readPngDimensions(imageB64);
  if (!dims) return fallbackHeight;
  const cropW =
    plotCrop && typeof plotCrop.w === 'number' && plotCrop.w > 0.02
      ? plotCrop.w
      : 1;
  const cropH =
    plotCrop && typeof plotCrop.h === 'number' && plotCrop.h > 0.02
      ? plotCrop.h
      : 1;
  const effW = dims.width * cropW;
  const effH = dims.height * cropH;
  if (effW <= 0 || effH <= 0) return fallbackHeight;
  return Math.max(1, Math.round(elWidth * (effH / effW)));
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
  /** Distribute N figures across every element that references the given
   * plotCodeId, by `metadata.figureIndex`. Auto-spawns new sibling elements
   * only for figure indices greater than the highest existing index (so a
   * deleted figure does not resurrect on re-run). Returns the updated
   * ordered list of reference element IDs. */
  distributePlotFigures: (
    anchorElementId: string,
    figures: PlotFigure[],
    stdout: string | null,
    error: string | null,
  ) => Promise<string[]>;

  // Plot code registry
  /** Write `code` to the given plot code registry entry. Creates the entry
   * if it doesn't exist (shouldn't happen in practice — elements always
   * create their entry at insert time). Pushes history. */
  setPlotCode: (plotCodeId: string, code: string) => void;

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
  pasteElements: (
    sourceElements: BoardElement[],
    offset?: { x: number; y: number },
    sourcePlotCodes?: Record<string, PlotCodeEntry>,
  ) => BoardElement[];

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
  toggleHidden: (ids: string[]) => void;

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

  distributePlotFigures: async (anchorElementId, figures, stdout, error) => {
    const { board } = get();
    if (!board) return [];
    const anchor = board.elements.find(el => el.id === anchorElementId);
    if (!anchor) return [];
    const plotCodeId: string | undefined = anchor.metadata?.plotCodeId;
    if (!plotCodeId) return [];

    // Every element referencing this plotCodeId is a figure view. Sort by
    // figureIndex so new siblings (if any) append after the highest.
    type Ref = { id: string; figureIndex: number };
    const existingRefs: Ref[] = board.elements
      .filter(el => el.type === 'plot' && el.metadata?.plotCodeId === plotCodeId)
      .map(el => ({ id: el.id, figureIndex: el.metadata?.figureIndex ?? 0 }))
      .sort((a, b) => a.figureIndex - b.figureIndex);
    const existingIndexSet = new Set(existingRefs.map(r => r.figureIndex));
    const maxExistingIndex = existingRefs.length > 0
      ? Math.max(...existingRefs.map(r => r.figureIndex))
      : -1;

    // Spawn new elements only for figure indices strictly greater than the
    // highest existing index. This keeps deleted figures deleted — if the
    // user trashed figure 1, re-running the code that still produces three
    // figures will update figures 0 and 2 in place and not resurrect fig 1.
    const newSiblings: BoardElement[] = [];
    const layoutAnchor = existingRefs.length > 0
      ? board.elements.find(el => el.id === existingRefs[existingRefs.length - 1].id) ?? anchor
      : anchor;
    let spawnOffset = 1;
    for (let i = 0; i < figures.length; i++) {
      if (existingIndexSet.has(i)) continue;
      if (i <= maxExistingIndex) continue; // deleted hole — don't refill
      const newEl: BoardElement = {
        ...structuredClone(anchor),
        id: uuidv4(),
        x: layoutAnchor.x + spawnOffset * (layoutAnchor.width + 20),
        y: layoutAnchor.y,
        metadata: {
          ...(anchor.metadata ?? {}),
          plotCodeId,
          figureIndex: i,
          lastOutput: null,
          lastStdout: null,
          lastError: null,
          plotlyJson: null,
          plotCrop: null,
          renderedCodeHash: undefined,
          figureMissing: false,
        },
      };
      newSiblings.push(newEl);
      existingRefs.push({ id: newEl.id, figureIndex: i });
      spawnOffset++;
    }

    const refIdToFigureIndex = new Map(existingRefs.map(r => [r.id, r.figureIndex]));

    // The freeze is only valid when the code that produced the cropped
    // image matches the code being run now. Compare per-plot hash stamped
    // at the last editor Save against the current setup + registry code.
    const plotCode = String(board.plotCodes?.[plotCodeId]?.code ?? '');
    const currentRenderHash = plotRenderHash(board.setup?.code ?? '', plotCode);

    // Update every referencing element with its figure's output, or flag
    // it as missing when the code now produces fewer figures than refs.
    //
    // Policy for cropped plots: Run All FREEZES them only when their
    // stamped renderedCodeHash matches the current code. The freeze exists
    // because plotly camera drifts by a fraction on re-render and kaleido
    // vs the interactive canvas aren't byte-identical — issues that only
    // matter when the code is unchanged. If the code was edited (or the
    // plot was never stamped), the stored image is stale and we fall
    // through to the normal refresh path so the user's code change wins.
    const updatedElements = board.elements.map(el => {
      const figIdx = refIdToFigureIndex.get(el.id);
      if (figIdx === undefined) return el;
      const fig = figures[figIdx];
      const plotCrop = el.metadata?.plotCrop;
      const hasStoredCrop = plotCrop && plotCrop.w > 0.02 && plotCrop.h > 0.02;
      const storedHash = el.metadata?.renderedCodeHash;
      const freeze = hasStoredCrop && storedHash === currentRenderHash;

      // Frozen cropped plot → update only stdout/error/figureIndex, leave
      // the image/dims/plotly_json strictly alone.
      if (freeze) {
        const nextMeta: Record<string, any> = {
          ...el.metadata,
          lastStdout: stdout,
          lastError: error,
        };
        // If the code no longer produces this figure index, flag it
        // as missing so the user sees a clear error, but still don't
        // touch dimensions.
        if (!fig) {
          nextMeta.figureMissing = true;
          if (!error) {
            nextMeta.lastError =
              `Figure ${figIdx} missing: code now produces only ${figures.length} figure${figures.length === 1 ? '' : 's'}.`;
          }
        }
        return { ...el, metadata: nextMeta };
      }

      // Uncropped (or stale-crop) plot → full refresh path. When the code
      // changed, we drop the old crop so the fresh figure isn't cropped to
      // regions that no longer make sense, and we clear the render hash.
      const nextMeta: Record<string, any> = {
        ...el.metadata,
        lastStdout: stdout,
        lastError: error,
      };
      if (hasStoredCrop) {
        nextMeta.plotCrop = null;
        nextMeta.renderedCodeHash = undefined;
      }
      const nextHeight = fig?.image
        ? syncHeightForFigure(el.width, el.height, fig.image, null)
        : el.height;
      if (fig) {
        nextMeta.lastOutput = fig.image ?? null;
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

      return { ...el, height: nextHeight, metadata: nextMeta };
    });

    // Bake the new siblings' per-figure output into their metadata so the
    // canvas immediately renders the correct figure for each. New siblings
    // start uncropped, so height comes directly from the full image's
    // natural aspect ratio (via the same sync PNG-header path).
    const newSiblingsWithFigure = newSiblings.map(sib => {
      const figIdx = sib.metadata.figureIndex;
      const fig = figures[figIdx];
      const nextHeight = fig?.image
        ? syncHeightForFigure(sib.width, sib.height, fig.image, null)
        : sib.height;
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

    // One run per distinct plot code entry. Pick one anchor element per
    // plotCodeId (the lowest figureIndex, z-order as tiebreaker) — the
    // distribute call will fan the figures out across every other element
    // that shares the same plotCodeId. Skip entries whose code is empty.
    type RunTarget = { plotCodeId: string; anchor: BoardElement; code: string };
    const byCode = new Map<string, RunTarget>();
    for (const el of board.elements) {
      if (el.type !== 'plot') continue;
      if (el.hidden) continue;
      const pcid = el.metadata?.plotCodeId;
      if (typeof pcid !== 'string') continue;
      const code = String(board.plotCodes?.[pcid]?.code ?? '');
      if (code.trim().length === 0) continue;
      const existing = byCode.get(pcid);
      const figIdx = el.metadata?.figureIndex ?? 0;
      if (!existing) {
        byCode.set(pcid, { plotCodeId: pcid, anchor: el, code });
      } else {
        const existIdx = existing.anchor.metadata?.figureIndex ?? 0;
        if (figIdx < existIdx || (figIdx === existIdx && el.z_index < existing.anchor.z_index)) {
          byCode.set(pcid, { plotCodeId: pcid, anchor: el, code });
        }
      }
    }
    const targets: RunTarget[] = [...byCode.values()]
      .sort((a, b) => a.anchor.z_index - b.anchor.z_index);

    if (targets.length === 0) {
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
          total: targets.length + 1,
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
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const label = target.anchor.metadata?.name || `Plot ${i + 1}`;
      set({
        runAllStatus: {
          state: 'running',
          current: i + 1 + (setupCode.trim().length > 0 ? 1 : 0),
          total: targets.length + (setupCode.trim().length > 0 ? 1 : 0),
          label,
        },
      });
      try {
        const r = await api.executePlot(
          target.code,
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
        await get().distributePlotFigures(target.anchor.id, figures, r.stdout, r.success ? null : r.error);
        if (r.success) successes++;
        else failures++;
      } catch (err: any) {
        failures++;
        await get().distributePlotFigures(
          target.anchor.id,
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
      plotCodes: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      app_version: '0.1.0',
    };
    const result = await api.saveBoardToFile(board, filePath);
    const loaded = migrateToPlotCodeRegistry(result.board);
    set({
      board: loaded,
      boardFilePath: result.path,
      isDirty: false,
      loadedCodeDigest: codeDigest(loaded),
      history: [{ elements: [], plotCodes: {}, description: 'New board' }],
      historyIndex: 0,
    });
  },

  openBoard: async (filePath: string) => {
    if (autoExportAbort) autoExportAbort.abort();
    autoExportAbort = new AbortController();
    const result = await api.openBoardFromFile(filePath);
    const board = migrateToPlotCodeRegistry(result.board);

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

    const loadedBoard = { ...board, elements: checkedElements };
    set({
      board: loadedBoard,
      boardFilePath: result.path,
      // If any linked image was re-embedded on open, the store now holds
      // fresher bytes than the .sdraw file — mark dirty so autosave writes
      // them back.
      isDirty: needsResave,
      loadedCodeDigest: codeDigest(loadedBoard),
      externalConflict: null,
      history: [{
        elements: structuredClone(checkedElements),
        plotCodes: structuredClone(loadedBoard.plotCodes ?? {}),
        description: 'Load',
      }],
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
        // Migrate the disk snapshot into registry form before comparing so
        // the digest function can run against a clean v3 shape.
        const dbMigrated = migrateToPlotCodeRegistry(diskBoard);
        const diskDigest = codeDigest(dbMigrated);
        if (diskDigest !== initial.loadedCodeDigest) {
          const db = dbMigrated;
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
              history: [{
                elements: structuredClone(db.elements),
                plotCodes: structuredClone(db.plotCodes ?? {}),
                description: 'Accept external',
              }],
              historyIndex: 0,
            });
            return;
          }

          if (choice === 'merge') {
            // Take disk's plotCodes registry + setup, keep the user's
            // canvas layout, then fall through to the normal save path so
            // the merged state gets written.
            const cur = get().board!;
            const merged = mergeAgentCodeIntoLayout(cur, db);
            const mergedBoard: Board = {
              ...cur,
              setup: {
                ...(cur.setup ?? DEFAULT_BOARD_SETUP),
                code: db.setup?.code ?? cur.setup?.code ?? '',
              },
              elements: merged.elements,
              plotCodes: merged.plotCodes,
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
    let nextPlotCodes = board.plotCodes ?? {};
    if (type === 'plot' && !element.metadata?.plotCodeId) {
      // Every new plot element gets its own fresh registry entry seeded
      // with the default starter code. The element references it by id.
      const newId = uuidv4();
      nextPlotCodes = { ...nextPlotCodes, [newId]: { code: DEFAULT_PLOT_CODE } };
      element.metadata = {
        ...(element.metadata ?? {}),
        plotCodeId: newId,
        figureIndex: element.metadata?.figureIndex ?? 0,
      };
    }
    const newElements = [...board.elements, element];
    set({ board: { ...board, elements: newElements, plotCodes: nextPlotCodes }, isDirty: true });
    get().pushHistory(`Add ${type}`);
    return element;
  },

  setPlotCode: (plotCodeId: string, code: string) => {
    const { board } = get();
    if (!board) return;
    const current = board.plotCodes?.[plotCodeId]?.code ?? '';
    if (current === code) return;
    const nextPlotCodes = {
      ...(board.plotCodes ?? {}),
      [plotCodeId]: { code },
    };
    set({ board: { ...board, plotCodes: nextPlotCodes }, isDirty: true });
  },

  updateElement: (id: string, updates: Partial<BoardElement>) => {
    const { board } = get();
    if (!board) return;

    const target = board.elements.find(el => el.id === id);

    // When a group's geometry changes, propagate to its children:
    //   - Moving (x/y): translate every child by the same delta.
    //   - Resizing (width/height): scale every child's position and size
    //     proportionally. Text children only reposition (font/box stays
    //     put); arrow/pen `points` scale with the same factors since they
    //     are stored in element-local space.
    // This runs for all `updateElement` callers, so Inspector numeric
    // edits and the Resizer drag handle behave identically.
    let childUpdates: Map<string, Partial<BoardElement>> | null = null;
    if (target?.type === 'group' && target.children && target.children.length > 0) {
      const newX = updates.x ?? target.x;
      const newY = updates.y ?? target.y;
      const newW = updates.width ?? target.width;
      const newH = updates.height ?? target.height;
      const scaleX = (updates.width !== undefined && target.width > 0) ? newW / target.width : 1;
      const scaleY = (updates.height !== undefined && target.height > 0) ? newH / target.height : 1;
      const scaling = scaleX !== 1 || scaleY !== 1;
      const moving = newX !== target.x || newY !== target.y;

      if (scaling || moving) {
        childUpdates = new Map();
        for (const childId of target.children) {
          const child = board.elements.find(el => el.id === childId);
          if (!child) continue;
          const ch: Partial<BoardElement> = {
            x: newX + (child.x - target.x) * scaleX,
            y: newY + (child.y - target.y) * scaleY,
          };
          if (scaling && child.type !== 'text') {
            ch.width = child.width * scaleX;
            ch.height = child.height * scaleY;
            if (child.points && child.points.length > 0) {
              ch.points = child.points.map(p => ({ x: p.x * scaleX, y: p.y * scaleY }));
            }
          }
          childUpdates.set(childId, ch);
        }
      }
    }

    const newElements = board.elements.map(el => {
      if (el.id === id) return { ...el, ...updates };
      const chChanges = childUpdates?.get(el.id);
      if (chChanges) return { ...el, ...chChanges };
      return el;
    });
    set({ board: { ...board, elements: newElements }, isDirty: true });
  },

  updateElements: (updates: Array<{ id: string; changes: Partial<BoardElement> }>) => {
    const { board } = get();
    if (!board) return;

    // Merge caller-supplied updates first. These always win — if the user
    // selected a group *and* one of its children, the direct update on the
    // child takes precedence over any group-propagated delta.
    const updateMap = new Map<string, Partial<BoardElement>>();
    for (const u of updates) {
      updateMap.set(u.id, { ...(updateMap.get(u.id) || {}), ...u.changes });
    }

    // Expand every group in the batch with scaled/translated child changes,
    // matching the behavior of `updateElement` for single writes. This makes
    // arrow-key nudge, multi-select Position/Size broadcasts, and any other
    // bulk caller move grouped children along with their container.
    for (const u of updates) {
      const target = board.elements.find(el => el.id === u.id);
      if (!target || target.type !== 'group' || !target.children || target.children.length === 0) continue;

      const newX = u.changes.x ?? target.x;
      const newY = u.changes.y ?? target.y;
      const newW = u.changes.width ?? target.width;
      const newH = u.changes.height ?? target.height;
      const scaleX = (u.changes.width !== undefined && target.width > 0) ? newW / target.width : 1;
      const scaleY = (u.changes.height !== undefined && target.height > 0) ? newH / target.height : 1;
      const scaling = scaleX !== 1 || scaleY !== 1;
      const moving = newX !== target.x || newY !== target.y;
      if (!scaling && !moving) continue;

      for (const childId of target.children) {
        if (updateMap.has(childId)) continue; // direct update wins
        const child = board.elements.find(el => el.id === childId);
        if (!child) continue;
        const ch: Partial<BoardElement> = {
          x: newX + (child.x - target.x) * scaleX,
          y: newY + (child.y - target.y) * scaleY,
        };
        if (scaling && child.type !== 'text') {
          ch.width = child.width * scaleX;
          ch.height = child.height * scaleY;
          if (child.points && child.points.length > 0) {
            ch.points = child.points.map(p => ({ x: p.x * scaleX, y: p.y * scaleY }));
          }
        }
        updateMap.set(childId, ch);
      }
    }

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
    const nextPlotCodes = gcPlotCodes(board.plotCodes ?? {}, newElements);
    set({
      board: { ...board, elements: newElements, plotCodes: nextPlotCodes },
      isDirty: true,
    });
    get().pushHistory('Delete elements');
  },

  duplicateElements: (ids: string[]) => {
    const { board } = get();
    if (!board) return [];
    const idSet = new Set(ids);
    const toDuplicate = board.elements.filter(el => idSet.has(el.id));
    const maxZ = board.elements.reduce((max, el) => Math.max(max, el.z_index), 0);

    // A duplicated figure should reference a FRESH plot code entry so the
    // copy is an independent cell — editing it doesn't touch the original.
    // Multiple duped figures that shared the same plotCodeId in the source
    // selection all land on the same new plotCodeId so the duplicate stays
    // internally linked.
    const plotCodeIdMap = new Map<string, string>();
    const newPlotCodes: Record<string, PlotCodeEntry> = { ...(board.plotCodes ?? {}) };
    for (const el of toDuplicate) {
      if (el.type !== 'plot') continue;
      const pcid = el.metadata?.plotCodeId;
      if (typeof pcid !== 'string' || plotCodeIdMap.has(pcid)) continue;
      const newId = uuidv4();
      newPlotCodes[newId] = { code: board.plotCodes?.[pcid]?.code ?? '' };
      plotCodeIdMap.set(pcid, newId);
    }

    const duplicated = toDuplicate.map((el, i) => {
      const cloned: BoardElement = {
        ...structuredClone(el),
        id: uuidv4(),
        x: el.x + 20,
        y: el.y + 20,
        z_index: maxZ + 1 + i,
      };
      if (cloned.type === 'plot' && cloned.metadata?.plotCodeId) {
        const newPcid = plotCodeIdMap.get(cloned.metadata.plotCodeId);
        if (newPcid) {
          cloned.metadata = { ...cloned.metadata, plotCodeId: newPcid };
        }
      }
      return cloned;
    });
    set({
      board: {
        ...board,
        elements: [...board.elements, ...duplicated],
        plotCodes: newPlotCodes,
      },
      isDirty: true,
    });
    get().pushHistory('Duplicate');
    return duplicated;
  },

  pasteElements: (sourceElements: BoardElement[], offset = { x: 0, y: 0 }, sourcePlotCodes) => {
    const { board } = get();
    if (!board || sourceElements.length === 0) return [];

    const idMap = new Map<string, string>();
    for (const el of sourceElements) idMap.set(el.id, uuidv4());

    // Build a plot-code-id remap: every distinct old plotCodeId in the
    // payload becomes a new registry entry in this board. Multiple pasted
    // figures that shared a plotCodeId land on the same new entry so the
    // pasted set stays internally linked.
    const plotCodeIdMap = new Map<string, string>();
    const newPlotCodes: Record<string, PlotCodeEntry> = { ...(board.plotCodes ?? {}) };
    const pcLookup = sourcePlotCodes ?? {};
    for (const el of sourceElements) {
      if (el.type !== 'plot') continue;
      const pcid = el.metadata?.plotCodeId;
      if (typeof pcid !== 'string' || plotCodeIdMap.has(pcid)) continue;
      const newId = uuidv4();
      newPlotCodes[newId] = { code: pcLookup[pcid]?.code ?? '' };
      plotCodeIdMap.set(pcid, newId);
    }

    const maxZ = board.elements.reduce((max, el) => Math.max(max, el.z_index), 0);

    const pasted = sourceElements.map((src, i) => {
      const cloned: BoardElement = structuredClone(src);
      cloned.id = idMap.get(src.id)!;
      cloned.x = src.x + offset.x;
      cloned.y = src.y + offset.y;
      cloned.z_index = maxZ + 1 + i;

      if (cloned.children) {
        cloned.children = cloned.children
          .map(cid => idMap.get(cid))
          .filter((cid): cid is string => !!cid);
      }

      const meta = cloned.metadata || {};
      if (meta.groupId) {
        const newGid = idMap.get(meta.groupId);
        if (newGid) {
          cloned.metadata = { ...meta, groupId: newGid };
        } else {
          const { groupId: _g, relX: _rx, relY: _ry, ...rest } = meta;
          cloned.metadata = rest;
        }
      }
      if (cloned.type === 'plot' && cloned.metadata?.plotCodeId) {
        const newPcid = plotCodeIdMap.get(cloned.metadata.plotCodeId);
        if (newPcid) {
          cloned.metadata = { ...cloned.metadata, plotCodeId: newPcid };
        }
      }
      if (cloned.type === 'arrow') {
        const m = { ...(cloned.metadata || {}) };
        for (const key of ['startConnection', 'endConnection'] as const) {
          if (m[key]) {
            const remapped = idMap.get(m[key]);
            if (remapped) m[key] = remapped;
            else delete m[key];
          }
        }
        cloned.metadata = m;
      }

      return cloned;
    });

    set({
      board: {
        ...board,
        elements: [...board.elements, ...pasted],
        plotCodes: newPlotCodes,
      },
      isDirty: true,
    });
    get().pushHistory('Paste');
    return pasted;
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

  toggleHidden: (ids: string[]) => {
    const { board } = get();
    if (!board) return;
    // Expand groups so children follow their parent's hidden state.
    const expandedIds = new Set(ids);
    for (const id of ids) {
      const el = board.elements.find(e => e.id === id);
      if (el?.type === 'group' && el.children) {
        el.children.forEach(cid => expandedIds.add(cid));
      }
    }
    const allHidden = board.elements
      .filter(el => expandedIds.has(el.id))
      .every(el => el.hidden === true);
    const newElements = board.elements.map(el =>
      expandedIds.has(el.id) ? { ...el, hidden: !allHidden } : el
    );
    set({ board: { ...board, elements: newElements }, isDirty: true });
    get().pushHistory('Toggle hidden');
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
    newHistory.push({
      elements: stripBlobsForHistory(structuredClone(board.elements)),
      plotCodes: structuredClone(board.plotCodes ?? {}),
      description,
    });
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
      board: {
        ...board,
        elements: restored,
        plotCodes: structuredClone(entry.plotCodes ?? {}),
      },
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
      board: {
        ...board,
        elements: restored,
        plotCodes: structuredClone(entry.plotCodes ?? {}),
      },
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
