import { groupResizeUpdates } from '@/utils/groupResize';
import { layoutChanges } from '@/utils/contentPolicy';
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

/**
 * Content-based code digest: setup code + sorted plot code strings. Does NOT
 * include plotCodeId keys, because the v2→v3 migration assigns random UUIDs
 * and two independent migrations of the same file produce different keys but
 * the same set of code strings. Sorting by content keeps the digest stable
 * regardless of migration order or insertion order.
 */
export function codeDigest(board: Board): string {
  const parts: string[] = [];
  parts.push(`setup\n${board.setup?.code ?? ''}`);
  const codes = Object.values(board.plotCodes ?? {})
    .map(entry => String(entry?.code ?? ''))
    .sort();
  for (const code of codes) parts.push(`plot\n${code}`);
  return fnv1a(parts.join('\n---\n'));
}

/** Compute per-element hash map and board-level fields hash for delta
 *  detection. Only elements whose hash changed since the last save are
 *  included in the save-delta payload. */
export function computeSaveHashes(board: Board) {
  const elementHashes = new Map<string, string>();
  for (const el of board.elements) {
    elementHashes.set(el.id, JSON.stringify(el));
  }
  const boardFieldsHash = JSON.stringify({
    setup: board.setup,
    plotCodes: board.plotCodes,
    canvas: board.canvas,
    autoExport: board.autoExport,
  });
  const elementIds = new Set(board.elements.map(e => e.id));
  return { elementHashes, boardFieldsHash, elementIds };
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
export function migrateToPlotCodeRegistry(board: any): Board {
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

  /** Mtime of the board file the last time WE wrote or read it. Primary
   * external-change signal — if the disk mtime is greater than this, some
   * other process touched the file. Immune to migration-randomness bugs
   * that can break content digests. Null until the first successful
   * open/save. */
  loadedFileMtime: number | null;

  /** Per-element hash from the last successful save. Used to compute
   *  deltas: only elements whose hash changed are included in the
   *  save-delta payload. Keyed by element id → JSON.stringify(element). */
  _savedElementHashes: Map<string, string>;
  /** Board-level fields hash from the last save (setup, plotCodes,
   *  canvas, autoExport — without elements). */
  _savedBoardFieldsHash: string;
  /** Element IDs that existed at last save — used to detect adds/removes. */
  _savedElementIds: Set<string>;

  /** Non-null while a save detected divergence and is waiting on the user
   * to pick a resolution. Rendered by ExternalChangeModal. */
  externalConflict: ExternalConflict | null;
  resolveExternalConflict: (choice: 'mine' | 'theirs' | 'merge' | 'cancel') => void;

  // Per-board kernel status (lives in-memory, never persisted)
  kernelStatus: KernelStatus;
  runSetup: (code?: string) => Promise<KernelRunResult>;
  restartKernel: () => Promise<void>;
  /** Force-reload project-local Python modules inside the running
   *  kernel so edits to helper .py files take effect without killing
   *  the kernel (setup globals — loaded datasets, fitted models — are
   *  preserved). Also rebinds `from X import Y` style references in
   *  setup_ns so they point at the fresh objects. Automatic reload
   *  also runs before every plot exec; this is the manual override.
   *  No-op if no kernel is running for this board. */
  reloadKernelModules: () => Promise<{
    reloaded: string[];
    errors: Array<{ module: string; error: string }>;
    rebound: number;
    kernelRunning: boolean;
  }>;

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
  /** Run a single plot code entry and fan its figures out to every element
   * referencing the same plotCodeId via distributePlotFigures. Does NOT
   * touch runAllStatus so it can be called from per-cell UI (PlotNode Run
   * button, stale-badge click) without interfering with Run All's progress
   * bar. Setup code is passed through to the kernel which short-circuits
   * re-runs when the setup hash is unchanged, so cell-wise Run costs
   * nothing extra on a warm kernel. */
  runOnePlot: (plotCodeId: string) => Promise<{ success: boolean; error: string | null }>;

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
  renameBoardFile: (newBaseName: string) => Promise<{ newPath: string }>;
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
  // skipArrowIds: arrows to leave alone (e.g. ones being translated as part
  // of a multi-selection drag). Without this, dragging a shape that's also
  // selected alongside an arrow would yank the arrow's endpoint back to the
  // shape, defeating the user's intent of moving the whole group together.
  updateConnectedArrows: (movedElementId: string, skipArrowIds?: Set<string>) => void;

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

/**
 * Deep-clone a set of elements with full ID remapping. The single source of
 * truth for "fork these elements as independent copies" — used by both
 * `pasteElements` (Cmd+V across boards/sessions) and `duplicateElements`
 * (Cmd+D in-place).
 *
 * Internal references that must follow the new IDs:
 *   - `el.id`                         → new uuid
 *   - `group.children[]`              → new ids (drop entries not in payload)
 *   - `child.metadata.groupId`        → new id, or strip {groupId,relX,relY}
 *                                      if the group wasn't included
 *   - `arrow.metadata.startConnection`→ new id, or drop both connection +
 *                                      its anchor if target wasn't included
 *   - `arrow.metadata.endConnection`  → ditto
 *   - `arrow.metadata.startAbsPos /
 *      endAbsPos`                     → always dropped (cached against old
 *                                      coords; regenerated on next
 *                                      updateConnectedArrows)
 *   - `plot.metadata.plotCodeId`      → caller-supplied map (the registry
 *                                      lives outside the element)
 *
 * Skipping any of the above produces a "linked clone" — symptoms ranging
 * from "moving the duplicate also moves the source" to "ungrouping the
 * copy ungroups the original". Callers must use this helper, not their
 * own ad-hoc clone loop.
 */
function cloneElementsWithRemap(
  sourceElements: BoardElement[],
  plotCodeIdMap?: Map<string, string>,
): { cloned: BoardElement[]; idMap: Map<string, string> } {
  const idMap = new Map<string, string>();
  for (const el of sourceElements) idMap.set(el.id, uuidv4());

  const cloned = sourceElements.map((src) => {
    const c: BoardElement = structuredClone(src);
    c.id = idMap.get(src.id)!;

    if (c.children) {
      c.children = c.children
        .map((cid) => idMap.get(cid))
        .filter((cid): cid is string => !!cid);
    }

    const meta = c.metadata || {};
    if (meta.groupId) {
      const newGid = idMap.get(meta.groupId);
      if (newGid) {
        c.metadata = { ...meta, groupId: newGid };
      } else {
        const { groupId: _g, relX: _rx, relY: _ry, ...rest } = meta;
        c.metadata = rest;
      }
    }

    if (c.type === 'plot' && c.metadata?.plotCodeId && plotCodeIdMap) {
      const newPcid = plotCodeIdMap.get(c.metadata.plotCodeId as string);
      if (newPcid) c.metadata = { ...c.metadata, plotCodeId: newPcid };
    }

    if (c.type === 'arrow') {
      const m = { ...(c.metadata || {}) };
      for (const key of ['startConnection', 'endConnection'] as const) {
        if (m[key]) {
          const remapped = idMap.get(m[key] as string);
          if (remapped) {
            m[key] = remapped;
          } else {
            // Connection target not part of this clone batch — drop the
            // connection and its anchor so the endpoint becomes free.
            delete m[key];
            const anchorKey = key === 'startConnection' ? 'startAnchor' : 'endAnchor';
            delete m[anchorKey];
          }
        }
      }
      // Cached absolute positions reference the OLD bbox; let
      // updateConnectedArrows regenerate them.
      delete m.startAbsPos;
      delete m.endAbsPos;
      c.metadata = m;
    }

    return c;
  });

  return { cloned, idMap };
}

// Abort controller for cancelling in-flight exports on board switch
let autoExportAbort: AbortController | null = null;

export const useBoardStore = create<BoardState>((set, get) => ({
  board: null,
  boardFilePath: null,
  isDirty: false,
  loadedCodeDigest: null,
  loadedFileMtime: null,
  _savedElementHashes: new Map(),
  _savedBoardFieldsHash: '',
  _savedElementIds: new Set(),
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

  reloadKernelModules: async () => {
    const { board } = get();
    if (!board) return { reloaded: [], errors: [], rebound: 0, kernelRunning: false };
    try {
      const r = await api.reloadKernelModules(board.id);
      return {
        reloaded: r.reloaded,
        errors: r.errors,
        rebound: r.rebound,
        kernelRunning: r.kernel_running,
      };
    } catch (err: any) {
      return {
        reloaded: [],
        errors: [{ module: '*', error: String(err?.message ?? err) }],
        rebound: 0,
        kernelRunning: false,
      };
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

    // Spawn a new canvas element for any figure index the code produces
    // that doesn't already have an element. Previously we skipped any
    // index <= maxExistingIndex to avoid "resurrecting" a figure the user
    // had deleted, but that heuristic also broke the common case where
    // the user starts with a lone cbar at fidx=1 and later the code begins
    // returning iso at fidx=0 — iso would be silently dropped. The UX
    // priority is "Run always puts what the code produces on the canvas";
    // if the user wants a figure gone, they edit the code to stop
    // producing it (or delete the element and the code together).
    const newSiblings: BoardElement[] = [];
    const layoutAnchor = existingRefs.length > 0
      ? board.elements.find(el => el.id === existingRefs[existingRefs.length - 1].id) ?? anchor
      : anchor;
    let spawnOffset = 1;
    for (let i = 0; i < figures.length; i++) {
      if (existingIndexSet.has(i)) continue;
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
      // the image/dims/plotly_json strictly alone. Stamp renderedCodeHash
      // unconditionally so staleness detection elsewhere works even when a
      // frozen cell is re-run against matching code.
      if (freeze) {
        const nextMeta: Record<string, any> = {
          ...el.metadata,
          lastStdout: stdout,
          lastError: error,
          renderedCodeHash: currentRenderHash,
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

      // Uncropped or stale-crop plot → full refresh path. The image is
      // replaced with the fresh figure, but any existing user crop is
      // preserved so manual framing work isn't lost on re-run. The crop is
      // stored as fractions [0,1] so it applies to the new figure too.
      // Stamp the new renderedCodeHash unconditionally — it is the general
      // "this output was produced by this code" tag that PlotNode reads to
      // detect staleness.
      const nextMeta: Record<string, any> = {
        ...el.metadata,
        lastStdout: stdout,
        lastError: error,
        renderedCodeHash: currentRenderHash,
      };
      const nextHeight = fig?.image
        ? syncHeightForFigure(el.width, el.height, fig.image, hasStoredCrop ? plotCrop : null)
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
          renderedCodeHash: currentRenderHash,
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

  runOnePlot: async (plotCodeId: string) => {
    const { board, boardFilePath } = get();
    if (!board) return { success: false, error: 'No board open' };
    const code = String(board.plotCodes?.[plotCodeId]?.code ?? '');
    if (code.trim().length === 0) {
      return { success: false, error: 'Empty plot code' };
    }

    // Pick the anchor the same way Run All does: lowest figureIndex,
    // z-order as tiebreaker. distribute fans out to all other refs.
    let anchor: BoardElement | null = null;
    for (const el of board.elements) {
      if (el.type !== 'plot') continue;
      if (el.metadata?.plotCodeId !== plotCodeId) continue;
      if (!anchor) { anchor = el; continue; }
      const figIdx = el.metadata?.figureIndex ?? 0;
      const anchorIdx = anchor.metadata?.figureIndex ?? 0;
      if (figIdx < anchorIdx || (figIdx === anchorIdx && el.z_index < anchor.z_index)) {
        anchor = el;
      }
    }
    if (!anchor) return { success: false, error: 'No element references this plotCodeId' };

    const env = board.pythonEnvPath ?? null;
    const cwd = boardFilePath ? boardFilePath.replace(/\/[^/]+$/, '') : null;
    const setupCode = board.setup?.code ?? '';
    const setupTimeout = board.setup?.timeout ?? 120;

    try {
      const r = await api.executePlot(
        code,
        600,
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
      await get().distributePlotFigures(anchor.id, figures, r.stdout, r.success ? null : r.error);
      return { success: r.success, error: r.success ? null : r.error };
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await get().distributePlotFigures(anchor.id, [], null, `Run failed: ${msg}`);
      return { success: false, error: msg };
    }
  },

  runAllPlots: async () => {
    const { board } = get();
    if (!board) return;

    // One run per distinct plot code entry. Pick one anchor element per
    // plotCodeId (the lowest figureIndex, z-order as tiebreaker) for the
    // progress label; runOnePlot picks the same anchor internally. Skip
    // entries whose code is empty.
    type RunTarget = { plotCodeId: string; anchor: BoardElement };
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
        byCode.set(pcid, { plotCodeId: pcid, anchor: el });
      } else {
        const existIdx = existing.anchor.metadata?.figureIndex ?? 0;
        if (figIdx < existIdx || (figIdx === existIdx && el.z_index < existing.anchor.z_index)) {
          byCode.set(pcid, { plotCodeId: pcid, anchor: el });
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
    const { boardFilePath } = get();
    const cwd = boardFilePath ? boardFilePath.replace(/\/[^/]+$/, '') : null;
    const setupCode = board.setup?.code ?? '';
    const setupTimeout = board.setup?.timeout ?? 120;

    // Force setup to re-run once at the start of a Run All by explicitly
    // running it here — this gives the user a known-good baseline and
    // clear feedback if setup itself fails. Per-cell Run does NOT do this;
    // it trusts the kernel's cached setup state.
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
      const r = await get().runOnePlot(target.plotCodeId);
      if (r.success) successes++;
      else failures++;
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
    const newHashes = computeSaveHashes(board);
    set({
      board: board,
      boardFilePath: result.path,
      isDirty: false,
      loadedCodeDigest: codeDigest(board),
      _savedElementHashes: newHashes.elementHashes,
      _savedBoardFieldsHash: newHashes.boardFieldsHash,
      _savedElementIds: newHashes.elementIds,
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
    // Snapshot the loaded state so the first autosave can use delta
    const initHashes = computeSaveHashes(loadedBoard);
    set({
      board: loadedBoard,
      boardFilePath: result.path,
      isDirty: needsResave,
      loadedCodeDigest: codeDigest(loadedBoard),
      loadedFileMtime: typeof result.mtime === 'number' ? result.mtime : null,
      externalConflict: null,
      _savedElementHashes: initHashes.elementHashes,
      _savedBoardFieldsHash: initHashes.boardFieldsHash,
      _savedElementIds: initHashes.elementIds,
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
    // Primary signal: file mtime. If the disk mtime is at most the mtime
    // of our last known write, nothing external could have happened — skip
    // the entire check (no modal risk, no extra round-trip cost).
    //
    // Secondary signal: content digest. Only consulted when mtime actually
    // moved forward, to distinguish an external edit from the same file
    // being re-saved by another sdraw client producing identical bytes.
    // Using digest alone (the old behavior) was brittle: any migration
    // randomness or subtle cross-language hash quirk triggered a false
    // conflict, popping the merge modal on every autosave.
    if (initial.loadedCodeDigest !== null && initial.loadedFileMtime !== null) {
      let conflict = false;
      try {
        const { digest: diskDigest, mtime: diskMtime } = await api.boardCodeDigest(boardFilePath);
        // A 0.5s grace absorbs sub-second filesystem rounding (some FSes
        // only expose second-precision mtimes).
        const mtimeAdvanced =
          typeof diskMtime === 'number' &&
          diskMtime > (initial.loadedFileMtime ?? 0) + 0.5;
        conflict = mtimeAdvanced && diskDigest !== initial.loadedCodeDigest;
      } catch {
        // File missing / unreadable — fall through to normal save.
      }
      if (conflict) {
        let diskBoard: Board | null = null;
        let diskMtime: number | null = null;
        try {
          const r = await api.openBoardFromFile(boardFilePath);
          diskBoard = r.board as Board;
          diskMtime = typeof r.mtime === 'number' ? r.mtime : null;
        } catch {
          // Can't read disk copy — fall through to save.
        }
        if (diskBoard) {
          const db = migrateToPlotCodeRegistry(diskBoard);
          const diskDigest = codeDigest(db);
          const choice = await new Promise<'mine' | 'theirs' | 'merge' | 'cancel'>(resolve => {
            set({ externalConflict: { diskBoard: db, diskDigest, resolve } });
          });
          set({ externalConflict: null });

          if (choice === 'cancel') return;

          if (choice === 'theirs') {
            set({
              board: db,
              isDirty: false,
              loadedCodeDigest: diskDigest,
              loadedFileMtime: diskMtime,
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
        }
      }
    }

    const board = get().board;
    if (!board) return;

    const { useUIStore } = await import('@/store/uiStore');
    const setProgress = useUIStore.getState().setProgressLabel;
    setProgress('Saving...');
    try {

    // Capture thumbnail from the canvas
    let thumbnail: string | undefined;
    try {
      thumbnail = await captureThumbnail(board);
    } catch {
      // Thumbnail capture is best-effort
    }

    const savedHashes = get()._savedElementHashes;
    const savedIds = get()._savedElementIds;
    const hasPriorSave = savedHashes.size > 0;

    // ---- Delta save path ----
    // If we have a prior save snapshot, compute what changed and send
    // only the diff. This reduces save traffic from ~12 MB to ~100 KB
    // for the common case (one plot output changed).
    if (hasPriorSave) {
      const current = computeSaveHashes(board);
      const dirtyElements: BoardElement[] = [];
      const removedIds: string[] = [];

      // Find changed / added elements
      for (const el of board.elements) {
        const oldHash = savedHashes.get(el.id);
        const newHash = current.elementHashes.get(el.id)!;
        if (oldHash !== newHash) {
          dirtyElements.push(el);
        }
      }

      // Find removed elements
      for (const oldId of savedIds) {
        if (!current.elementIds.has(oldId)) {
          removedIds.push(oldId);
        }
      }

      const boardFieldsChanged = current.boardFieldsHash !== get()._savedBoardFieldsHash;

      // If nothing changed at all, skip the save
      if (dirtyElements.length === 0 && removedIds.length === 0 && !boardFieldsChanged && !thumbnail) {
        set({ isDirty: false });
        return;
      }

      try {
        setProgress('Uploading...');
        const deltaResult = await api.saveBoardDelta({
          path: boardFilePath,
          board_id: board.id,
          updated_at: new Date().toISOString(),
          thumbnail: thumbnail || null,
          dirty_elements: dirtyElements,
          removed_ids: removedIds,
          ...(boardFieldsChanged ? {
            setup: board.setup,
            plot_codes: board.plotCodes,
            canvas: board.canvas,
            auto_export: board.autoExport,
          } : {}),
        });
        set({
          isDirty: false,
          loadedCodeDigest: codeDigest(board),
          loadedFileMtime:
            typeof deltaResult.mtime === 'number' ? deltaResult.mtime : Date.now() / 1000,
          _savedElementHashes: current.elementHashes,
          _savedBoardFieldsHash: current.boardFieldsHash,
          _savedElementIds: current.elementIds,
        });
        try { await api.deleteCheckpoint(boardFilePath); } catch {}
        return; // delta save succeeded
      } catch {
        // Delta save failed (409 = file missing, or backend too old).
        // Fall through to full save.
        console.warn('[sdraw] Delta save failed, falling back to full save');
      }
    }

    // ---- Full save path ----
    // Used for first save (no prior snapshot) or when delta save fails.
    // Re-embeds images that have changed on disk.
    const oversizedImages: { path: string; size?: number }[] = [];
    const embeddedElements = await Promise.all(
      board.elements.map(async (el) => {
        if (el.type !== 'image' || !el.source?.path) return el;
        try {
          if (el.source.embeddedData && el.source.lastModified) {
            const check = await api.checkImage(el.source.path);
            if (!check.exists) {
              return { ...el, source: { ...el.source, linkStatus: 'unlinked' as const } };
            }
            if (check.mtime && check.mtime <= el.source.lastModified) {
              return { ...el, source: { ...el.source, linkStatus: 'linked' as const } };
            }
          }
          const result = await api.embedImage(el.source.path);
          if (result.exists && result.oversized) {
            oversizedImages.push({ path: el.source.path, size: result.size });
            return { ...el, source: { ...el.source, lastModified: result.mtime || el.source.lastModified, linkStatus: 'linked' as const } };
          }
          if (result.exists && result.data) {
            return { ...el, source: { ...el.source, embeddedData: result.data, embeddedMime: result.mime || 'image/png', lastModified: result.mtime || undefined, linkStatus: 'linked' as const } };
          }
          return { ...el, source: { ...el.source, linkStatus: 'unlinked' as const } };
        } catch {
          return el;
        }
      })
    );

    const updated = { ...board, elements: embeddedElements, updated_at: new Date().toISOString(), thumbnail };
    setProgress('Uploading...');
    const saveResult = await api.saveBoardToFile(updated, boardFilePath);
    // Build snapshot for future delta saves
    const hashes = computeSaveHashes(updated);
    set({
      board: updated,
      isDirty: false,
      loadedCodeDigest: codeDigest(updated),
      loadedFileMtime:
        typeof saveResult.mtime === 'number' ? saveResult.mtime : Date.now() / 1000,
      _savedElementHashes: hashes.elementHashes,
      _savedBoardFieldsHash: hashes.boardFieldsHash,
      _savedElementIds: hashes.elementIds,
    });
    try { await api.deleteCheckpoint(boardFilePath); } catch {}

    if (oversizedImages.length > 0) {
      const names = oversizedImages.map(i => i.path.split('/').pop() || i.path).slice(0, 3).join(', ');
      const more = oversizedImages.length > 3 ? ` (+${oversizedImages.length - 3} more)` : '';
      console.warn(`[sdraw] ${oversizedImages.length} image(s) too large to embed: ${names}${more}. Linked path preserved but will not render on devices without the source file.`);
    }
    if (saveResult.oversized && saveResult.size) {
      console.warn(`[sdraw] .sdraw file is large (${(saveResult.size / (1024 * 1024)).toFixed(0)} MB). Consider splitting the board or removing unused images.`);
    }

    } finally {
      setProgress(null);
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

  renameBoardFile: async (newBaseName: string) => {
    const { boardFilePath } = get();
    if (!boardFilePath) throw new Error('No board file loaded');
    const sanitized = newBaseName.replace(/[^a-zA-Z0-9_\- ]/g, '_').trim();
    if (!sanitized) throw new Error('Filename cannot be empty');
    const lastSlash = boardFilePath.lastIndexOf('/');
    const dir = lastSlash >= 0 ? boardFilePath.slice(0, lastSlash) : '';
    const extension = boardFilePath.match(/\.(sdraw|json|html|htm)$/i)?.[0] ?? ".html";
    const newPath = dir ? `${dir}/${sanitized}${extension}` : `${sanitized}${extension}`;
    if (newPath === boardFilePath) return { newPath };
    const result = await api.renameBoardFile(boardFilePath, newPath);
    // Point the MRU entry at the new filename so the welcome screen picks it up.
    try {
      const { getRecentBoards, setRecentBoards } = await import('@/utils/localStorage');
      const list = getRecentBoards().map(b =>
        b.path === boardFilePath ? { ...b, path: result.path, name: sanitized } : b,
      );
      setRecentBoards(list);
    } catch { /* non-fatal */ }
    set({ boardFilePath: result.path, loadedFileMtime: result.mtime });
    // Rewrite the URL so a page reload stays pointed at the renamed file.
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('board', result.path);
      window.history.replaceState(null, '', u.toString());
    } catch { /* non-fatal */ }
    return { newPath: result.path };
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
    // No progress bar for auto-export — it's a background task that fires
    // every few seconds. Showing "Rendering export..." / "Uploading..."
    // on every cycle is noisy and alarming. The tiny toolbar dot indicator
    // is enough; the progress bar is reserved for manual user actions.

    try {
      const ae = board.autoExport;
      let res: Response;
      if (ae.format === 'svg') {
        // Preserve vector elements and editable-source metadata. A raster
        // capture written with an .svg suffix cannot be reopened as a figure.
        res = await fetch(new URL('api/export/render', document.baseURI).pathname, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({ board }),
        });
      } else {
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
        res = await fetch(new URL('api/export/save', document.baseURI).pathname, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: signal,
          body: JSON.stringify({
            path: ae.outputPath,
            data_url: dataUrl,
          }),
        });

      }

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
    get().updateElements([{ id, changes: updates }]);
  },

  updateElements: updates => {
    const { board } = get();
    if (!board) return;

    const direct = new Map<string, Partial<BoardElement>>();
    for (const { id, changes } of updates) {
      direct.set(id, { ...direct.get(id), ...changes });
    }
    const updateMap = new Map(direct);
    const inherited = new Set<string>();
    for (const group of board.elements) {
      const changes = direct.get(group.id);
      if (group.type !== 'group' || !changes || inherited.has(group.id)) continue;
      const rect = {
        x: changes.x ?? group.x, y: changes.y ?? group.y,
        width: changes.width ?? group.width, height: changes.height ?? group.height,
      };
      if (rect.x === group.x && rect.y === group.y && rect.width === group.width && rect.height === group.height) continue;
      for (const child of groupResizeUpdates(group, board.elements, rect, direct).slice(1)) {
        inherited.add(child.id);
        updateMap.set(child.id, child.changes);
      }
    }
    const newElements = board.elements.map(el => {
      const changes = updateMap.get(el.id);
      return changes ? { ...el, ...layoutChanges(el, changes) } : el;
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

    // Expand selection: duplicating a group must drag its children along,
    // otherwise the duplicate group ends up with `children` pointing at
    // nothing-in-this-batch and (after id remap) zero children, which
    // visually presents as an empty group floating next to the source.
    // Same shape as the writeSelectionToClipboard expansion in the keyboard
    // handler — keep the two in sync.
    const idSet = new Set(ids);
    for (const id of ids) {
      const el = board.elements.find(e => e.id === id);
      if (el?.type === 'group' && el.children) {
        for (const cid of el.children) idSet.add(cid);
      }
    }
    const toDuplicate = board.elements.filter(el => idSet.has(el.id));
    if (toDuplicate.length === 0) return [];
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

    const { cloned } = cloneElementsWithRemap(toDuplicate, plotCodeIdMap);
    const duplicated = cloned.map((c, i) => {
      c.x = c.x + 20;
      c.y = c.y + 20;
      c.z_index = maxZ + 1 + i;
      return c;
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

    const { cloned } = cloneElementsWithRemap(sourceElements, plotCodeIdMap);
    const pasted = cloned.map((c, i) => {
      c.x = c.x + offset.x;
      c.y = c.y + offset.y;
      c.z_index = maxZ + 1 + i;
      return c;
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

  updateConnectedArrows: (movedElementId: string, skipArrowIds?: Set<string>) => {
    const { board } = get();
    if (!board) return;
    const movedEl = board.elements.find(e => e.id === movedElementId);
    if (!movedEl) return;

    for (const arrow of board.elements) {
      if (arrow.type !== 'arrow') continue;
      // Caller is translating these arrows wholesale — don't snap their
      // endpoints to the moved shape, that would override the translation.
      if (skipArrowIds?.has(arrow.id)) continue;
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

      // Snapshot the OLD line endpoints (in absolute canvas coords) before
      // we resolve the new ones — needed to reparameterize control points
      // in line-relative coordinates so the curve "sticks" to the line as
      // its endpoints move with the connected shape.
      const oldStart = { x: arrow.x + pts[0].x, y: arrow.y + pts[0].y };
      const oldEnd = { x: arrow.x + pts[1].x, y: arrow.y + pts[1].y };

      const sAbs = resolveEndpoint(startConn, 'startAnchor', 'startAbsPos', 0);
      const eAbs = resolveEndpoint(endConn, 'endAnchor', 'endAbsPos', 1);

      if (!startConn) newMeta.startAbsPos = sAbs;
      if (!endConn) newMeta.endAbsPos = eAbs;

      // Re-anchor any curve control points to the new line. Control points
      // live in arrow-local coords (offsets from arrow.x/y), so the old
      // bbox origin is implicit in their values. Convert to absolute, then
      // express in line-relative (along, perp) against the OLD line, then
      // re-emit against the NEW line. This preserves curve shape as the
      // line stretches/rotates with the connected shape, instead of
      // leaving control points pinned to a stale origin (which made the
      // curve look like it had vanished).
      const oldCtrl = (arrow.metadata?.controlPoints as Array<{ x: number; y: number }> | undefined) || [];
      if (oldCtrl.length > 0) {
        const oldDx = oldEnd.x - oldStart.x;
        const oldDy = oldEnd.y - oldStart.y;
        const oldLen = Math.hypot(oldDx, oldDy);
        const newDx = eAbs.x - sAbs.x;
        const newDy = eAbs.y - sAbs.y;
        const newLen = Math.hypot(newDx, newDy);

        if (oldLen > 1e-6 && newLen > 1e-6) {
          const oldUx = oldDx / oldLen, oldUy = oldDy / oldLen;
          const newUx = newDx / newLen, newUy = newDy / newLen;
          newMeta.controlPoints = oldCtrl.map(c => {
            const cAbs = { x: arrow.x + c.x, y: arrow.y + c.y };
            const relX = cAbs.x - oldStart.x;
            const relY = cAbs.y - oldStart.y;
            // Decompose along old line basis: parallel (along) and perpendicular.
            const along = relX * oldUx + relY * oldUy;
            const perp = relX * (-oldUy) + relY * oldUx;
            // Scale the parallel component by len ratio so the curve stretches
            // proportionally; keep perpendicular at the same fraction of length
            // for the same reason (curve depth scales with line length).
            const t = along / oldLen;
            const newAlong = t * newLen;
            const newPerp = perp * (newLen / oldLen);
            const newAbsX = sAbs.x + newAlong * newUx + newPerp * (-newUy);
            const newAbsY = sAbs.y + newAlong * newUy + newPerp * newUx;
            return { x: newAbsX, y: newAbsY }; // converted to local coords below
          });
        } else {
          // Degenerate old or new line (zero length): translate control
          // points by the start-endpoint delta as a safe fallback.
          const dx = sAbs.x - oldStart.x;
          const dy = sAbs.y - oldStart.y;
          newMeta.controlPoints = oldCtrl.map(c => ({
            x: arrow.x + c.x + dx,
            y: arrow.y + c.y + dy,
          }));
        }
      }

      // Bounding box must include control points so they aren't lost when
      // the SVG overflow gets clipped at high zoom levels or during export.
      const allAbs = [sAbs, eAbs, ...((newMeta.controlPoints as Array<{ x: number; y: number }> | undefined) || [])];
      const minX = Math.min(...allAbs.map(p => p.x));
      const minY = Math.min(...allAbs.map(p => p.y));
      const maxX = Math.max(...allAbs.map(p => p.x));
      const maxY = Math.max(...allAbs.map(p => p.y));
      const w = Math.max(maxX - minX, 1);
      const h = Math.max(maxY - minY, 1);

      // Convert control points from absolute back to local (offsets from new minX/minY)
      if (newMeta.controlPoints) {
        newMeta.controlPoints = (newMeta.controlPoints as Array<{ x: number; y: number }>).map(c => ({
          x: c.x - minX,
          y: c.y - minY,
        }));
      }

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
