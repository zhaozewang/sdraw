import { useEffect, useCallback, useRef } from 'react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import { pasteImageFromBlob } from '@/utils/pasteImage';

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

    // Serialize selected elements to system clipboard. Returns the expanded
    // id set (groups pull in their children) so Cut can delete the same scope.
    const writeSelectionToClipboard = (): string[] | null => {
      const b = store.board;
      if (!b || selectedIds.length === 0) return null;

      // Expand selection: if a group is selected, also include its children
      const idSet = new Set(selectedIds);
      for (const id of selectedIds) {
        const el = b.elements.find(x => x.id === id);
        if (el?.type === 'group' && el.children) {
          for (const cid of el.children) idSet.add(cid);
        }
      }
      const elements = b.elements.filter(el => idSet.has(el.id));
      if (elements.length === 0) return null;

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
      return Array.from(idSet);
    };

    // Copy
    if (mod && !e.shiftKey && e.key === 'c') {
      writeSelectionToClipboard();
      return;
    }

    // Cut — copy to clipboard then delete the same elements
    if (mod && !e.shiftKey && e.key === 'x') {
      e.preventDefault();
      const ids = writeSelectionToClipboard();
      if (ids && ids.length > 0) {
        useUIStore.getState().clearSelection();
        store.removeElements(ids);
      }
      return;
    }

    // Paste — read whatever's actually on the OS clipboard right now. The
    // window.__sdraw_clipboard cache is only a last-resort fallback for
    // when clipboard permissions block reads entirely; otherwise letting
    // it win produces a stale-paste bug where copying an image externally
    // still pastes a sdraw selection from earlier in the session because
    // the in-memory cache was never invalidated.
    //
    // Priority once the OS clipboard is readable:
    //   1. sdraw JSON (text/plain that parses as our payload format)
    //   2. image/* bytes (copied screenshot, dragged image, etc.) →
    //      embedded as a fresh image element on the active board
    if (mod && e.key === 'v') {
      e.preventDefault();
      (async () => {
        let payload: any = null;
        let imageBlob: { blob: Blob; mime: string } | null = null;
        let osReadAttempted = false;

        try {
          const items = await navigator.clipboard.read();
          osReadAttempted = true;
          for (const item of items) {
            if (!payload && item.types.includes('text/plain')) {
              try {
                const text = await (await item.getType('text/plain')).text();
                const parsed = JSON.parse(text);
                if (parsed?.__sdraw === 'clipboard' && Array.isArray(parsed.elements)) {
                  payload = parsed;
                }
              } catch {}
            }
            if (!imageBlob) {
              const imgType = item.types.find(t => t.startsWith('image/'));
              if (imgType) {
                try {
                  imageBlob = { blob: await item.getType(imgType), mime: imgType };
                } catch {}
              }
            }
          }
        } catch {
          // clipboard.read() unsupported or denied — try readText().
          try {
            const text = await navigator.clipboard.readText();
            osReadAttempted = true;
            if (text) {
              try {
                const parsed = JSON.parse(text);
                if (parsed?.__sdraw === 'clipboard' && Array.isArray(parsed.elements)) {
                  payload = parsed;
                }
              } catch {}
            }
          } catch {}
        }

        // Only consult the in-memory cache when we couldn't read the OS
        // clipboard at all. If the OS read succeeded but had nothing
        // useful, the user copied something else externally and we
        // honour that instead of resurrecting an old sdraw payload.
        if (!payload && !imageBlob && !osReadAttempted) {
          const cached = (window as any).__sdraw_clipboard;
          if (cached?.elements?.length) payload = cached;
        }

        const cur = useBoardStore.getState();
        if (!cur.board) return;

        if (payload?.elements?.length) {
          const sameBoard = cur.board.id === payload.sourceBoardId;
          const offset = sameBoard ? { x: 20, y: 20 } : { x: 0, y: 0 };
          const pasted = cur.pasteElements(
            payload.elements,
            offset,
            payload.plotCodes ?? undefined,
          );
          useUIStore.getState().setSelectedIds(pasted.map(el => el.id));
          return;
        }

        if (imageBlob) {
          const pastedImage = await pasteImageFromBlob(imageBlob.blob, imageBlob.mime);
          if (pastedImage) {
            useUIStore.getState().setSelectedIds([pastedImage.id]);
          }
        }
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
      const selectedArrows = new Set(selected.filter(el => el.type === 'arrow').map(el => el.id));
      for (const el of selected) {
        if (el.type !== 'arrow') store.updateConnectedArrows(el.id, selectedArrows);
      }
      window.clearTimeout(nudgeTimerRef.current);
      nudgeTimerRef.current = window.setTimeout(() => useBoardStore.getState().pushHistory('Nudge'), 500);
    }

    window.addEventListener('keydown', nudge, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', nudge, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);
}
