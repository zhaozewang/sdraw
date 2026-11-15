import { useEffect, useCallback } from 'react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';

export function useKeyboardShortcuts() {
  const board = useBoardStore(s => s.board);

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
    // Handle nudges before React Flow can move the same selection a second time.
    function nudge(event: KeyboardEvent) {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable=true]')) return;
      const { selectedIds } = useUIStore.getState();
      const store = useBoardStore.getState();
      const selected = store.board?.elements.filter(el => selectedIds.includes(el.id) && !el.locked);
      if (!selected?.length) return;
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? 10 : 1;
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      store.updateElements(selected.map(el => ({ id: el.id, changes: { x: el.x + dx, y: el.y + dy } })));
      store.pushHistory('Move');
    }

    window.addEventListener('keydown', nudge, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', nudge, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);
}
