import { useEffect, useRef } from 'react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';

export function useAutoSave(intervalMs: number = 5000) {
  const isDirty = useBoardStore(s => s.isDirty);
  const board = useBoardStore(s => s.board);
  const autoSaveEnabled = useUIStore(s => s.autoSaveEnabled);
  const timerRef = useRef<number>();

  useEffect(() => {
    if (!autoSaveEnabled || !isDirty || !board) return;

    timerRef.current = window.setTimeout(() => {
      useBoardStore.getState().saveBoard();
    }, intervalMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isDirty, autoSaveEnabled, board, intervalMs]);
}
