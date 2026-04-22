import { useEffect, useRef } from 'react';
import { useBoardStore } from '@/store/boardStore';

const CHECKPOINT_INTERVAL = 3000;
const FULL_SAVE_INTERVAL = 8000;

export function useAutoSave() {
  const isDirty = useBoardStore(s => s.isDirty);
  const board = useBoardStore(s => s.board);
  const checkpointTimerRef = useRef<number>();
  const fullSaveTimerRef = useRef<number>();

  // Checkpoint save (crash recovery). When delta save is active (we have
  // a saved snapshot), the .sdraw file is already updated within 8 seconds
  // by the full-save timer, so the checkpoint is redundant — skip it to
  // avoid sending 12 MB over the wire every 3 seconds. Only use the
  // network checkpoint for the first save (before the snapshot exists).
  useEffect(() => {
    if (!isDirty || !board) return;
    // Delta save keeps the file fresh — no need for a separate checkpoint.
    if (useBoardStore.getState()._savedElementHashes.size > 0) return;

    checkpointTimerRef.current = window.setTimeout(() => {
      useBoardStore.getState().saveCheckpoint();
    }, CHECKPOINT_INTERVAL);

    return () => {
      if (checkpointTimerRef.current) clearTimeout(checkpointTimerRef.current);
    };
  }, [isDirty, board]);

  // Full autosave — flushes store (plot PNGs, embedded images, thumbnail)
  // to the .sdraw file so the render guarantee holds without explicit Save.
  // Any new edit before the debounce fires resets the timer, so a continuous
  // typing burst produces one write rather than many.
  useEffect(() => {
    if (!isDirty || !board) return;

    fullSaveTimerRef.current = window.setTimeout(() => {
      const state = useBoardStore.getState();
      if (!state.isDirty || !state.board || !state.boardFilePath) return;
      state.saveBoard().catch(() => {
        // Best-effort — checkpoint still covers crash recovery.
      });
    }, FULL_SAVE_INTERVAL);

    return () => {
      if (fullSaveTimerRef.current) clearTimeout(fullSaveTimerRef.current);
    };
  }, [isDirty, board]);

  // Auto-export: event-driven, fires once after each successful save.
  // The old timer-based approach polled every 5 seconds and fired a heavy
  // canvas render + upload on every fingerprint change (even a single plot
  // run). This made the network unusable. Now auto-export piggybacks on
  // the save cycle: save completes → isDirty flips false → export once.
  const autoExportEnabled = board?.autoExport?.enabled && !!board?.autoExport?.outputPath;
  const wasDirtyRef = useRef(false);

  useEffect(() => {
    // Detect the transition isDirty: true → false (a save just completed).
    if (wasDirtyRef.current && !isDirty && board && autoExportEnabled) {
      // Small delay so the save fully settles before we render + export.
      const timer = window.setTimeout(() => {
        const state = useBoardStore.getState();
        const b = state.board;
        if (b?.autoExport?.enabled && b.autoExport.outputPath) {
          state.triggerAutoExport(b);
        }
      }, 500);
      wasDirtyRef.current = false;
      return () => clearTimeout(timer);
    }
    wasDirtyRef.current = isDirty;
  }, [isDirty, board, autoExportEnabled]);
}
