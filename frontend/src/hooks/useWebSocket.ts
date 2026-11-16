import { useEffect, useRef, useCallback } from 'react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import type { FileEvent } from '@/types/board';

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number>();
  const exportTimeoutRef = useRef<number>();
  const bumpImageVersion = useBoardStore(s => s.bumpImageVersion);
  const board = useBoardStore(s => s.board);
  const setConnectionStatus = useUIStore(s => s.setConnectionStatus);
  const addRecentEvent = useUIStore(s => s.addRecentEvent);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setConnectionStatus('connecting');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const endpoint = new URL('ws/events', document.baseURI);
    const wsUrl = `${protocol}//${endpoint.host}${endpoint.pathname}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setConnectionStatus('connected');
      // Register watches for current board's image paths
      if (board) {
        const roots = new Set<string>();
        for (const el of board.elements) {
          if (el.source?.path) {
            const dir = el.source.path.substring(0, el.source.path.lastIndexOf('/'));
            if (dir) roots.add(dir);
          }
        }
        roots.forEach(root => {
          ws.send(JSON.stringify({ action: 'watch', path: root }));
        });
      }
    };

    ws.onmessage = (event) => {
      try {
        const data: FileEvent = JSON.parse(event.data);
        if (data.event_type && data.path) {
          const boardState = useBoardStore.getState();

          // Ignore file change events for the auto-export output file itself
          // to prevent infinite export loops
          const exportPath = boardState.board?.autoExport?.outputPath;
          if (exportPath && data.path === exportPath) return;

          bumpImageVersion(data.path);
          addRecentEvent({
            path: data.path,
            type: data.event_type,
            time: new Date().toISOString(),
          });
          // Trigger auto-export after a short delay (let image re-render first)
          // Only if the changed file is relevant to the current board's images
          if (boardState.board?.autoExport?.enabled) {
            const isRelevant = boardState.board.elements.some(
              e => e.source?.path === data.path
            );
            if (isRelevant) {
              if (exportTimeoutRef.current) clearTimeout(exportTimeoutRef.current);
              const currentBoardId = boardState.board.id;
              exportTimeoutRef.current = window.setTimeout(() => {
                const state = useBoardStore.getState();
                if (state.board?.id === currentBoardId) {
                  // Pass board snapshot to avoid TOCTOU race
                  state.triggerAutoExport(state.board!);
                }
              }, 500);
            }
          }
        }
      } catch {
        // ignore non-JSON messages
      }
    };

    ws.onclose = () => {
      setConnectionStatus('disconnected');
      wsRef.current = null;
      // Reconnect after 3 seconds
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connect();
      }, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, [board, bumpImageVersion, setConnectionStatus, addRecentEvent]);

  const sendMessage = useCallback((message: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const watchPath = useCallback((path: string) => {
    sendMessage({ action: 'watch', path });
  }, [sendMessage]);

  const unwatchPath = useCallback((path: string) => {
    sendMessage({ action: 'unwatch', path });
  }, [sendMessage]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (exportTimeoutRef.current) clearTimeout(exportTimeoutRef.current);
      wsRef.current?.close();
    };
  }, []); // connect once on mount

  return { watchPath, unwatchPath, sendMessage };
}
