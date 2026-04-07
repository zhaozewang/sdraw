import { useEffect, useCallback, useRef } from 'react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';

export function useKeyboardShortcuts() {
  const board = useBoardStore(s => s.board);
  const nudgeTimerRef = useRef<number>();

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    // Don't handle shortcuts when typing in inputs
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    const mod = e.metaKey || e.ctrlKey;
    const { selectedIds } = useUIStore.getState();
    const store = useBoardStore.getState();

    // Save
    if (mod && e.key === 's') {
      e.preventDefault();
      store.saveBoard();
      return;
    }

    // Undo
    if (mod && !e.shiftKey && e.key === 'z') {
      e.preventDefault();
      useUIStore.getState().clearSelection();
      store.undo();
      return;
    }

    // Redo
    if (mod && e.shiftKey && e.key === 'z') {
      e.preventDefault();
      useUIStore.getState().clearSelection();
      store.redo();
      return;
    }

    // Copy (store IDs for now, actual clipboard integration is complex)
    if (mod && e.key === 'c') {
      if (selectedIds.length > 0) {
        (window as any).__sdraw_clipboard = selectedIds;
      }
      return;
    }

    // Paste
    if (mod && e.key === 'v') {
      const clipboard = (window as any).__sdraw_clipboard as string[] | undefined;
      if (clipboard && clipboard.length > 0) {
        e.preventDefault();
        const duplicated = store.duplicateElements(clipboard);
        useUIStore.getState().setSelectedIds(duplicated.map(el => el.id));
      }
      return;
    }

    // Duplicate
    if (mod && e.key === 'd') {
      e.preventDefault();
      if (selectedIds.length > 0) {
        const duplicated = store.duplicateElements(selectedIds);
        useUIStore.getState().setSelectedIds(duplicated.map(el => el.id));
      }
      return;
    }

    // Delete
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedIds.length > 0) {
        e.preventDefault();
        const idsToDelete = [...selectedIds];
        useUIStore.getState().clearSelection();
        store.removeElements(idsToDelete);
      }
      return;
    }

    // Group
    if (mod && e.key === 'g' && !e.shiftKey) {
      e.preventDefault();
      if (selectedIds.length >= 2) {
        const groupId = store.groupElements(selectedIds);
        useUIStore.getState().setSelectedIds([groupId]);
      }
      return;
    }

    // Ungroup
    if (mod && e.shiftKey && e.key === 'G') {
      e.preventDefault();
      if (selectedIds.length === 1) {
        const el = store.board?.elements.find(e => e.id === selectedIds[0]);
        if (el?.type === 'group') {
          const childIds = el.children || [];
          store.ungroupElements(selectedIds[0]);
          useUIStore.getState().setSelectedIds(childIds);
        }
      }
      return;
    }

    // Lock
    if (mod && e.key === 'l') {
      e.preventDefault();
      if (selectedIds.length > 0) {
        store.toggleLock(selectedIds);
      }
      return;
    }

    // Arrow key nudge
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      if (selectedIds.length > 0) {
        e.preventDefault();
        const amount = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -amount : e.key === 'ArrowRight' ? amount : 0;
        const dy = e.key === 'ArrowUp' ? -amount : e.key === 'ArrowDown' ? amount : 0;
        store.updateElements(
          selectedIds.map(id => ({
            id,
            changes: {
              x: (store.board?.elements.find(el => el.id === id)?.x || 0) + dx,
              y: (store.board?.elements.find(el => el.id === id)?.y || 0) + dy,
            },
          }))
        );
        // Debounce history push — group rapid arrow presses into one undo entry
        if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
        nudgeTimerRef.current = window.setTimeout(() => {
          useBoardStore.getState().pushHistory('Nudge');
        }, 500);
      }
      return;
    }

    // Select all
    if (mod && e.key === 'a') {
      e.preventDefault();
      if (store.board) {
        useUIStore.getState().setSelectedIds(store.board.elements.map(el => el.id));
      }
      return;
    }

    // Escape - clear selection / cancel insert mode
    if (e.key === 'Escape') {
      useUIStore.getState().clearSelection();
      useUIStore.getState().setInsertPayload(null);
      return;
    }
  }, [board]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
