import { useEffect, useCallback, useRef } from 'react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';

export function useKeyboardShortcuts() {
  const board = useBoardStore(s => s.board);
  const nudgeTimerRef = useRef<number>();

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const mod = e.metaKey || e.ctrlKey;
    const store = useBoardStore.getState();

    // Save — always works, even when typing in inputs
    if (mod && e.key === 's') {
      e.preventDefault();
      store.saveBoard();
      return;
    }

    // Open board setup editor (Cmd+;) — always works
    if (mod && e.key === ';') {
      e.preventDefault();
      if (useBoardStore.getState().board) {
        useUIStore.getState().openSetupEditor();
      }
      return;
    }

    // Don't handle other shortcuts when typing in inputs
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    const { selectedIds } = useUIStore.getState();

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

    // Copy — serialize selected elements to system clipboard so paste works across boards
    if (mod && e.key === 'c') {
      const b = store.board;
      if (!b || selectedIds.length === 0) return;

      // Expand selection: if a group is selected, also include its children
      const idSet = new Set(selectedIds);
      for (const id of selectedIds) {
        const el = b.elements.find(x => x.id === id);
        if (el?.type === 'group' && el.children) {
          for (const cid of el.children) idSet.add(cid);
        }
      }
      const elements = b.elements.filter(el => idSet.has(el.id));
      if (elements.length === 0) return;

      // Include the plot code entries referenced by the pasted plots so a
      // cross-board paste carries its Python source along — without this,
      // the pasted figure elements land in the target board with dangling
      // plotCodeId references and the code is empty.
      const plotCodes: Record<string, { code: string }> = {};
      for (const el of elements) {
        if (el.type !== 'plot') continue;
        const pcid = el.metadata?.plotCodeId;
        if (typeof pcid !== 'string') continue;
        const entry = b.plotCodes?.[pcid];
        if (entry) plotCodes[pcid] = { code: entry.code };
      }

      const payload = {
        __sdraw: 'clipboard',
        version: 2,
        sourceBoardId: b.id,
        elements: structuredClone(elements),
        plotCodes,
      };
      (window as any).__sdraw_clipboard = payload;
      try { navigator.clipboard.writeText(JSON.stringify(payload)); } catch {}
      return;
    }

    // Paste — read from system clipboard, fall back to in-memory; remap IDs
    if (mod && e.key === 'v') {
      e.preventDefault();
      (async () => {
        let payload: any = (window as any).__sdraw_clipboard;
        try {
          const text = await navigator.clipboard.readText();
          if (text) {
            try {
              const parsed = JSON.parse(text);
              if (parsed?.__sdraw === 'clipboard' && Array.isArray(parsed.elements)) {
                payload = parsed;
              }
            } catch {}
          }
        } catch {}

        if (!payload?.elements?.length) return;
        const cur = useBoardStore.getState();
        if (!cur.board) return;
        const sameBoard = cur.board.id === payload.sourceBoardId;
        const offset = sameBoard ? { x: 20, y: 20 } : { x: 0, y: 0 };
        const pasted = cur.pasteElements(
          payload.elements,
          offset,
          payload.plotCodes ?? undefined,
        );
        useUIStore.getState().setSelectedIds(pasted.map(el => el.id));
      })();
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

    // Toggle hidden (soft hide — ghosted, excluded from export/Run All/fit view)
    if (mod && e.key === 'h') {
      e.preventDefault();
      if (selectedIds.length > 0) {
        store.toggleHidden(selectedIds);
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

    // Select all — skip hidden (ghosted) elements so they stay as reference-only.
    if (mod && e.key === 'a') {
      e.preventDefault();
      if (store.board) {
        useUIStore.getState().setSelectedIds(
          store.board.elements.filter(el => !el.hidden).map(el => el.id)
        );
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
