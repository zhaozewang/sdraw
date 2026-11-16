import { useEffect } from 'react';
import { useBoardStore } from '@/store/boardStore';

/** Save before the research document closes its embedded canvas editor. */
export function useConsoleBridge(): void {
  useEffect(() => {
    if (window.parent === window) return;
    const receive = async (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== location.origin) return;
      if (event.data?.type !== 'rsi-save' || typeof event.data.requestId !== 'string') return;
      const requestId = event.data.requestId;
      try {
        const before = useBoardStore.getState();
        if (!before.board || !before.boardFilePath) throw new Error('Wait for the board to open.');
        await before.saveBoard();
        const after = useBoardStore.getState();
        if (after.isDirty || after.externalConflict) throw new Error('Resolve unsaved changes before returning.');
        window.parent.postMessage({type: 'rsi-saved', requestId, success: true}, location.origin);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Save failed';
        window.parent.postMessage({type: 'rsi-saved', requestId, success: false, error: message}, location.origin);
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);
}
