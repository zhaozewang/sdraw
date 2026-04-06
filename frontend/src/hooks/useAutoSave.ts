import { useEffect, useRef } from 'react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';

export function useAutoSave(intervalMs: number = 5000) {
  const isDirty = useBoardStore(s => s.isDirty);
  const board = useBoardStore(s => s.board);
  const autoSaveEnabled = useUIStore(s => s.autoSaveEnabled);
  const saveTimerRef = useRef<number>();
  const exportTimerRef = useRef<number>();

  // Auto-save board file
  useEffect(() => {
    if (!autoSaveEnabled || !isDirty || !board) return;

    saveTimerRef.current = window.setTimeout(() => {
      useBoardStore.getState().saveBoard();
    }, intervalMs);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [isDirty, autoSaveEnabled, board, intervalMs]);

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
