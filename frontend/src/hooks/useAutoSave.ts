import { useEffect, useRef } from 'react';
import { useBoardStore } from '@/store/boardStore';

const CHECKPOINT_INTERVAL = 3000; // Save checkpoint every 3s when dirty

export function useAutoSave() {
  const isDirty = useBoardStore(s => s.isDirty);
  const board = useBoardStore(s => s.board);
  const checkpointTimerRef = useRef<number>();
  const exportTimerRef = useRef<number>();

  // Checkpoint save (crash recovery) — always active, no user toggle
  useEffect(() => {
    if (!isDirty || !board) return;

    checkpointTimerRef.current = window.setTimeout(() => {
      useBoardStore.getState().saveCheckpoint();
    }, CHECKPOINT_INTERVAL);

    return () => {
      if (checkpointTimerRef.current) clearTimeout(checkpointTimerRef.current);
    };
  }, [isDirty, board]);

  // Auto-export on board changes (debounced 2s after last change)
  const boardFingerprint = board?.elements
    ? `${board.elements.length}:${board.elements.map(e => `${e.id}:${e.x}:${e.y}:${e.width}:${e.height}:${e.z_index}:${e.text || ''}:${e.style?.fill || ''}:${e.style?.strokeColor || ''}`).join('|')}`
    : '';

  const prevFingerprintRef = useRef(boardFingerprint);

  useEffect(() => {
    if (!board?.autoExport?.enabled || !board.autoExport.outputPath) return;
    if (boardFingerprint === prevFingerprintRef.current) return;
    prevFingerprintRef.current = boardFingerprint;

    // Clear previous timer
    if (exportTimerRef.current) clearTimeout(exportTimerRef.current);

    // Debounce: wait 2s after last change before exporting
    exportTimerRef.current = window.setTimeout(() => {
      useBoardStore.getState().triggerAutoExport();
    }, 2000);

    return () => {
      if (exportTimerRef.current) clearTimeout(exportTimerRef.current);
    };
  }, [boardFingerprint, board?.autoExport?.enabled, board?.autoExport?.outputPath]);
}
