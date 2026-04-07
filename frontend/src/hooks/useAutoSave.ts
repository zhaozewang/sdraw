import { useEffect, useRef } from 'react';
import { useBoardStore } from '@/store/boardStore';

const CHECKPOINT_INTERVAL = 3000;
const EXPORT_INTERVAL = 5000;

export function useAutoSave() {
  const isDirty = useBoardStore(s => s.isDirty);
  const board = useBoardStore(s => s.board);
  const boardId = board?.id;
  const checkpointTimerRef = useRef<number>();
  const exportIntervalRef = useRef<number>();
  const lastExportFingerprintRef = useRef('');
  const lastExportBoardIdRef = useRef<string | undefined>();

  // Reset fingerprint when board changes
  useEffect(() => {
    if (boardId !== lastExportBoardIdRef.current) {
      lastExportFingerprintRef.current = '';
      lastExportBoardIdRef.current = boardId;
    }
  }, [boardId]);

  // Checkpoint save (crash recovery)
  useEffect(() => {
    if (!isDirty || !board) return;

    checkpointTimerRef.current = window.setTimeout(() => {
      useBoardStore.getState().saveCheckpoint();
    }, CHECKPOINT_INTERVAL);

    return () => {
      if (checkpointTimerRef.current) clearTimeout(checkpointTimerRef.current);
    };
  }, [isDirty, board]);

  // Auto-export: interval-based, scoped to current board
  const autoExportEnabled = board?.autoExport?.enabled && !!board?.autoExport?.outputPath;

  useEffect(() => {
    if (!autoExportEnabled || !boardId) {
      if (exportIntervalRef.current) {
        clearInterval(exportIntervalRef.current);
        exportIntervalRef.current = undefined;
      }
      return;
    }

    const scopedBoardId = boardId;

    const check = () => {
      const state = useBoardStore.getState();
      const b = state.board;
      if (!b || b.id !== scopedBoardId) return;
      if (!b.autoExport?.enabled || !b.autoExport.outputPath) return;

      // Content-only fingerprint: elements + image versions for THIS board's images only
      // Does NOT include zoom, pan, selection, or viewport state
      const boardImagePaths = new Set(
        b.elements.filter(e => e.source?.path).map(e => e.source!.path)
      );
      const relevantVersions: Record<string, number> = {};
      for (const [path, ver] of Object.entries(state.imageVersions)) {
        if (boardImagePaths.has(path)) relevantVersions[path] = ver;
      }

      const fp = JSON.stringify({
        els: b.elements.map(e => ({
          id: e.id, x: e.x, y: e.y, w: e.width, h: e.height,
          z: e.z_index, v: e.visible, r: e.rotation,
          t: e.text, s: e.style, src: e.source?.path,
          crop: e.crop, meta: e.metadata, pts: e.points,
        })),
        bg: b.canvas.background,
        iv: relevantVersions,
      });

      if (fp !== lastExportFingerprintRef.current) {
        lastExportFingerprintRef.current = fp;
        // Pass the board snapshot directly to avoid TOCTOU race:
        // the store state could change between this check and
        // triggerAutoExport reading it.
        state.triggerAutoExport(b);
      }
    };

    exportIntervalRef.current = window.setInterval(check, EXPORT_INTERVAL);

    return () => {
      if (exportIntervalRef.current) clearInterval(exportIntervalRef.current);
    };
  }, [autoExportEnabled, boardId]);
}
