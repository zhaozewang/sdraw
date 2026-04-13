/**
 * Bridge between the sDraw React app and a VS Code webview host.
 *
 * When the app runs inside a VS Code webview iframe, this hook:
 * - Listens for "save" / "revert" commands from the extension
 * - Sends "dirty" / "save-done" / "ready" events back to the extension
 *
 * When running standalone (browser / Electron), this hook is a no-op.
 */

import { useEffect } from 'react';
import { useBoardStore } from '@/store/boardStore';
import { api } from '@/api/client';

/** True when the app is running inside an iframe (VS Code webview). */
export function isVSCodeWebview(): boolean {
  try {
    return window.parent !== window && new URLSearchParams(window.location.search).has('vscode');
  } catch {
    return false;
  }
}

const _inVSCode = isVSCodeWebview();

/** Post a message to the VS Code webview host (the outer frame). */
function postToHost(msg: Record<string, unknown>): void {
  try {
    window.parent.postMessage({ source: 'sdraw-app', ...msg }, '*');
  } catch {
    // Not in an iframe or cross-origin — ignore
  }
}

export function useVSCodeBridge(): void {
  useEffect(() => {
    if (!_inVSCode) { return; }

    const handler = async (event: MessageEvent) => {
      const msg = event.data;
      if (!msg || msg.source !== 'vscode-sdraw') { return; }

      switch (msg.type) {
        case 'save': {
          try {
            await useBoardStore.getState().saveBoard();
            postToHost({ type: 'save-done', requestId: msg.requestId, success: true });
          } catch (err: any) {
            postToHost({
              type: 'save-done',
              requestId: msg.requestId,
              success: false,
              error: err?.message || 'Save failed',
            });
          }
          break;
        }

        case 'save-as': {
          try {
            const board = useBoardStore.getState().board;
            if (!board) { throw new Error('No board open'); }
            await api.saveBoardToFile(board, msg.path);
            postToHost({ type: 'save-done', requestId: msg.requestId, success: true });
          } catch (err: any) {
            postToHost({
              type: 'save-done',
              requestId: msg.requestId,
              success: false,
              error: err?.message || 'Save-as failed',
            });
          }
          break;
        }

        case 'revert': {
          const filePath = useBoardStore.getState().boardFilePath;
          if (filePath) {
            await useBoardStore.getState().openBoard(filePath);
          }
          break;
        }
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  useEffect(() => {
    if (!_inVSCode) { return; }

    let prevDirty = useBoardStore.getState().isDirty;
    let prevBoard = useBoardStore.getState().board;

    const unsub = useBoardStore.subscribe((state) => {
      if (state.isDirty && !prevDirty) {
        postToHost({ type: 'dirty' });
      }
      prevDirty = state.isDirty;

      if (state.board && state.board !== prevBoard) {
        postToHost({ type: 'ready', boardId: state.board.id });
      }
      prevBoard = state.board;
    });
    return unsub;
  }, []);
}
