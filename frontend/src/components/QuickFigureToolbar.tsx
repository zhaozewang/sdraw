import { MousePointer2, Type, ArrowRight, Square, Undo2, Redo2, Maximize, Grid3x3, PanelRight, Copy, X, ExternalLink, Magnet, Save, Check } from 'lucide-react';
import { ToolButton } from './Toolbar/ToolButton';
import { FigureExportSettings } from './FigureExportSettings';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';

/** Minimal report overlay; uses the same canvas, history and save path as the full editor. */
export function QuickFigureToolbar({grid, setGrid}: {grid:boolean; setGrid:(value:boolean)=>void}) {
  const selected = useUIStore(s => s.selectedIds);
  const inspector = useUIStore(s => s.showInspector);
  const canvas = useBoardStore(s => s.board?.canvas);
  useEffect(() => { useUIStore.setState({showInspector: false}); }, []);
  useEffect(() => { if (selected.length) useUIStore.setState({showInspector:true}); }, [selected]);
  const dirty = useBoardStore(s => s.isDirty);
  const index = useBoardStore(s => s.historyIndex);
  const historyLength = useBoardStore(s => s.history.length);
  const insert = useUIStore(s => s.insertMode);
  const exportStatus = useUIStore(s => s.exportStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const saving = useRef(false);
  const finish = useCallback(async (action: 'save' | 'close' | 'full' = 'close') => {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(''); setSaved(false);
    // Open synchronously to retain the browser's user-gesture permission.
    const tab = action === 'full' ? window.open('about:blank', '_blank') : null;
    try {
      (document.activeElement as HTMLElement | null)?.blur();
      await new Promise(resolve => setTimeout(resolve, 0));
      if (useBoardStore.getState().isDirty) await useBoardStore.getState().saveBoard();
      if (useBoardStore.getState().isDirty) throw new Error('Save did not complete. Please try again.');
      await useBoardStore.getState().triggerAutoExport();
      if (useUIStore.getState().exportStatus === 'error') throw new Error('Figure export failed. Please try again.');
      setSaved(true);
      window.parent.postMessage({ type: 'sdraw:figure-saved' }, window.location.origin);
      if (action === 'full') {
        if (!tab) throw new Error('Allow pop-ups to open the full editor.');
        const url = new URL(window.location.href); url.searchParams.delete('mode');
        tab.opener = null; tab.location.href = url.href;
      }
      if (action !== 'save') window.parent.postMessage({ type: 'sdraw:figure-closed' }, window.location.origin);
    } catch (e) { tab?.close(); setError(e instanceof Error ? e.message : 'Unable to save figure.'); }
    finally { saving.current = false; setBusy(false); }
  }, []);
  useEffect(() => {
    const listener = (e: MessageEvent) => {
      if (e.origin === location.origin && e.source === window.parent && e.data?.type === 'sdraw:figure-close') void finish();
    };
    window.addEventListener('message', listener);
    window.parent.postMessage({ type: 'sdraw:figure-ready' }, location.origin);
    return () => window.removeEventListener('message', listener);
  }, [finish]);
  useEffect(() => {
    const save = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault(); event.stopImmediatePropagation(); void finish('save');
      }
    };
    window.addEventListener('keydown', save, true);
    return () => window.removeEventListener('keydown', save, true);
  }, [finish]);
  return <div className="flex flex-wrap items-center gap-1 border-b border-toolbar-border bg-toolbar-bg text-gray-700 px-3 py-2 shrink-0" aria-label="Figure tools">
    <ToolButton icon={MousePointer2} title="Select" active={!insert} onClick={() => useUIStore.getState().setInsertPayload(null)} />
    <ToolButton icon={Type} title="Text" active={insert==='text'} onClick={() => useUIStore.getState().setInsertPayload({type:'text'})} />
    <ToolButton icon={ArrowRight} title="Arrow" active={insert==='arrow'} onClick={() => useUIStore.getState().setInsertPayload({type:'arrow'})} />
    <ToolButton icon={Square} title="Rectangle" active={insert==='rectangle'} onClick={() => useUIStore.getState().setInsertPayload({type:'rectangle'})} />
    <span className="w-px h-5 bg-toolbar-border mx-1" />
    <ToolButton icon={Undo2} title="Undo" disabled={index<=0 || busy} onClick={() => useBoardStore.getState().undo()} />
    <ToolButton icon={Redo2} title="Redo" disabled={index>=historyLength-1 || busy} onClick={() => useBoardStore.getState().redo()} />
    <ToolButton icon={Copy} title="Duplicate selection" disabled={!selected.length} onClick={() => useBoardStore.getState().duplicateElements(selected)} />
    <ToolButton icon={Maximize} title="Fit to canvas" onClick={() => useUIStore.getState().fitView?.()} />
    <ToolButton icon={Grid3x3} title="Grid" active={grid} onClick={() => setGrid(!grid)} />
    <ToolButton icon={Magnet} title="Snap to grid" active={canvas?.snap_enabled} onClick={() => useBoardStore.getState().updateCanvas({snap_enabled:!canvas?.snap_enabled})} />
    <ToolButton icon={PanelRight} title="Properties" active={inspector} onClick={() => useUIStore.getState().toggleInspector()} />
    <span className="w-px h-5 bg-toolbar-border mx-1" />
    <FigureExportSettings disabled={busy} />
    <span className="text-xs text-gray-500 ml-auto" role="status">{error || (busy ? 'Saving…' : exportStatus === 'error' ? 'Export failed' : dirty ? 'Unsaved changes' : saved ? 'Saved' : '')}</span>
    <ToolButton icon={saved && !dirty ? Check : Save} title="Save figure" disabled={busy} onClick={() => void finish('save')} />
    <ToolButton icon={ExternalLink} title="Open full editor" disabled={busy} onClick={() => void finish('full')} />
    <ToolButton icon={X} title="Close" disabled={busy} onClick={() => void finish()} />
  </div>;
}
