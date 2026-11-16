/**
 * Export-mode context.
 *
 * The live node components (TextNode, ImageNode, PlotNode, RectangleNode,
 * etc.) read their element from the global boardStore. That makes them
 * unsuitable for off-screen export rendering, where we want to render an
 * arbitrary board snapshot — not whatever board happens to be currently
 * loaded — and we want chrome (resize handles, status dots, the "<python>"
 * tag, the 1px transparent selection-padding border) to be suppressed.
 *
 * `BoardSnapshotProvider` injects a snapshot board into context. Any
 * descendant component that calls `useBoardElement(id)` reads the element
 * from the snapshot instead of the live store. `useIsExporting()` lets
 * components hide editor-only chrome.
 *
 * This is the keystone that lets the export pipeline reuse the live
 * components instead of maintaining a parallel renderer.
 */

import { createContext, useContext, type ReactNode } from 'react';
import type { Board, BoardElement } from '@/types/board';
import { useBoardStore } from './boardStore';

interface ExportContextValue {
  board: Board;
}

const ExportContext = createContext<ExportContextValue | null>(null);

export function BoardSnapshotProvider({
  board,
  children,
}: {
  board: Board;
  children: ReactNode;
}) {
  return (
    <ExportContext.Provider value={{ board }}>
      {children}
    </ExportContext.Provider>
  );
}

/**
 * Read an element by id. Inside a `BoardSnapshotProvider` we look it up in
 * the snapshot (no store subscription); outside, we subscribe to the live
 * store the same way the original code did.
 */
export function useBoardElement(elementId: string): BoardElement | undefined {
  const ctx = useContext(ExportContext);
  // Hooks must run unconditionally — always subscribe to the store and pick
  // whichever source applies. The store path is what's used in the live app.
  const liveElement = useBoardStore(s =>
    s.board?.elements.find(el => el.id === elementId),
  );
  if (ctx) {
    return ctx.board.elements.find(el => el.id === elementId);
  }
  return liveElement;
}

/** True when rendering inside the export pipeline; false in normal app use. */
export function useIsExporting(): boolean {
  return useContext(ExportContext) !== null;
}

/**
 * Read board-level fields (setup code, plotCodes, canvas) from snapshot or
 * live store. Used by PlotNode for staleness display — irrelevant in export
 * (chrome is hidden), but the hook still has to return *something* on every
 * render path.
 */
export function useBoardField<T>(selector: (board: Board | null) => T): T {
  const ctx = useContext(ExportContext);
  const liveValue = useBoardStore(s => selector(s.board ?? null));
  if (ctx) return selector(ctx.board);
  return liveValue;
}
