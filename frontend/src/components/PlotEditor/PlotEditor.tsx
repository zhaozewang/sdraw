import { useState, useCallback, useRef, useEffect } from 'react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import { api } from '@/api/client';
import { Play, Square, Loader2, X, Code2, Crop, Check } from 'lucide-react';
import Plotly from 'plotly.js-dist-min';

import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { python } from '@codemirror/lang-python';
import { indentWithTab } from '@codemirror/commands';
import { defaultKeymap, history, historyKeymap, indentMore, indentLess } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

interface CropRect {
  x: number; y: number; w: number; h: number;
}

// ─── Crop Overlay ──────────────────────────────────────────────
// Sits on top of the plotly container. Two modes:
// - cropMode=true: full overlay captures all events (plotly frozen), user draws/adjusts crop
// - cropMode=false: overlay is visual-only (pointer-events:none), plotly interactive underneath
//   EXCEPT handles + move area which remain interactive

const HANDLE = 10;
type Corner = 'nw' | 'ne' | 'sw' | 'se';
const CURSORS: Record<Corner, string> = { nw: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', se: 'nwse-resize' };

function CropOverlay({ cropRect, onChange, cropMode, containerRef }: {
  cropRect: CropRect | null;
  onChange: (r: CropRect | null) => void;
  cropMode: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const cropRef = useRef(cropRect);
  cropRef.current = cropRect;

  const toFrac = useCallback((e: MouseEvent | React.MouseEvent) => {
    const el = containerRef.current;
    if (!el) return { fx: 0, fy: 0 };
    const r = el.getBoundingClientRect();
    return {
      fx: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      fy: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  }, [containerRef]);

  const drag = useCallback((
    onMove: (ev: MouseEvent) => void,
    onDone?: () => void,
  ) => {
    const move = (ev: MouseEvent) => { ev.preventDefault(); onMove(ev); };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      onDone?.();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }, []);

  // Draw new crop
  const onBgDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).dataset.crop) return;
    e.preventDefault();
    const { fx, fy } = toFrac(e);
    const sx = fx, sy = fy;
    onChange({ x: fx, y: fy, w: 0, h: 0 });
    drag((ev) => {
      const { fx: mx, fy: my } = toFrac(ev);
      onChange({
        x: Math.min(sx, mx), y: Math.min(sy, my),
        w: Math.abs(mx - sx), h: Math.abs(my - sy),
      });
    }, () => {
      const cr = cropRef.current;
      if (cr && (cr.w < 0.01 || cr.h < 0.01)) onChange(null);
    });
  }, [toFrac, onChange, drag]);

  // Resize from corner
  const onHandleDown = useCallback((corner: Corner, e: React.MouseEvent) => {
    e.stopPropagation(); e.preventDefault();
    if (!cropRef.current) return;
    const start = { ...cropRef.current };
    const { fx: sx, fy: sy } = toFrac(e);
    drag((ev) => {
      const { fx, fy } = toFrac(ev);
      const dx = fx - sx, dy = fy - sy;
      const c = start;
      let x = c.x, y = c.y, w = c.w, h = c.h;
      if (corner === 'nw') { x = Math.max(0, Math.min(c.x + c.w - 0.02, c.x + dx)); y = Math.max(0, Math.min(c.y + c.h - 0.02, c.y + dy)); w = c.x + c.w - x; h = c.y + c.h - y; }
      else if (corner === 'ne') { w = Math.max(0.02, Math.min(1 - c.x, c.w + dx)); y = Math.max(0, Math.min(c.y + c.h - 0.02, c.y + dy)); h = c.y + c.h - y; }
      else if (corner === 'sw') { x = Math.max(0, Math.min(c.x + c.w - 0.02, c.x + dx)); w = c.x + c.w - x; h = Math.max(0.02, Math.min(1 - c.y, c.h + dy)); }
      else { w = Math.max(0.02, Math.min(1 - c.x, c.w + dx)); h = Math.max(0.02, Math.min(1 - c.y, c.h + dy)); }
      onChange({ x, y, w, h });
    });
  }, [toFrac, onChange, drag]);

  // Move entire box
  const onMoveDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); e.preventDefault();
    if (!cropRef.current) return;
    const start = { ...cropRef.current };
    const { fx: sx, fy: sy } = toFrac(e);
    drag((ev) => {
      const { fx, fy } = toFrac(ev);
      let nx = start.x + (fx - sx), ny = start.y + (fy - sy);
      nx = Math.max(0, Math.min(1 - start.w, nx));
      ny = Math.max(0, Math.min(1 - start.h, ny));
      onChange({ x: nx, y: ny, w: start.w, h: start.h });
    });
  }, [toFrac, onChange, drag]);

  const corners: { c: Corner; cx: number; cy: number }[] = cropRect ? [
    { c: 'nw', cx: cropRect.x, cy: cropRect.y },
    { c: 'ne', cx: cropRect.x + cropRect.w, cy: cropRect.y },
    { c: 'sw', cx: cropRect.x, cy: cropRect.y + cropRect.h },
    { c: 'se', cx: cropRect.x + cropRect.w, cy: cropRect.y + cropRect.h },
  ] : [];

  return (
    <div
      className="absolute inset-0"
      style={{
        zIndex: 5,
        // In crop mode: capture all events (plotly frozen). Otherwise: visual only, except handles.
        pointerEvents: cropMode ? 'auto' : 'none',
        cursor: cropMode ? 'crosshair' : 'default',
      }}
      onMouseDown={cropMode ? onBgDown : undefined}
    >
      {/* Dim mask */}
      {cropRect && cropRect.w > 0.01 && (
        <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }} preserveAspectRatio="none" viewBox="0 0 1 1">
          <defs><mask id="sdraw-crop-mask">
            <rect x="0" y="0" width="1" height="1" fill="white" />
            <rect x={cropRect.x} y={cropRect.y} width={cropRect.w} height={cropRect.h} fill="black" />
          </mask></defs>
          <rect x="0" y="0" width="1" height="1" fill={cropMode ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.35)'} mask="url(#sdraw-crop-mask)" />
          <rect x={cropRect.x} y={cropRect.y} width={cropRect.w} height={cropRect.h}
            fill="none" stroke="#3b82f6" strokeWidth="0.003"
            strokeDasharray={cropMode ? undefined : '0.01 0.005'} />
        </svg>
      )}

      {/* Move area — always interactive when crop exists */}
      {cropRect && cropRect.w > 0.01 && (
        <div data-crop="move" onMouseDown={onMoveDown} style={{
          position: 'absolute', left: `${cropRect.x * 100}%`, top: `${cropRect.y * 100}%`,
          width: `${cropRect.w * 100}%`, height: `${cropRect.h * 100}%`,
          cursor: 'move', pointerEvents: 'auto', zIndex: 6,
        }} />
      )}

      {/* Corner handles — always interactive when crop exists */}
      {corners.map(({ c, cx, cy }) => (
        <div key={c} data-crop="handle" onMouseDown={(e) => onHandleDown(c, e)} style={{
          position: 'absolute',
          left: `calc(${cx * 100}% - ${HANDLE / 2}px)`, top: `calc(${cy * 100}% - ${HANDLE / 2}px)`,
          width: HANDLE, height: HANDLE,
          backgroundColor: '#3b82f6', border: '1.5px solid white', borderRadius: 2,
          cursor: CURSORS[c], pointerEvents: 'auto', zIndex: 10,
        }} />
      ))}

      {/* Hint in crop mode with no crop yet */}
      {cropMode && !cropRect && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-black/60 text-white text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5">
            <Crop size={12} /> Drag to select crop region
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PlotEditor ────────────────────────────────────────────────

export function PlotEditor() {
  const elementId = useUIStore(s => s.plotEditorElementId);
  const element = useBoardStore(s =>
    elementId ? s.board?.elements.find(el => el.id === elementId) : undefined
  );
  const updateElement = useBoardStore(s => s.updateElement);
  const pushHistory = useBoardStore(s => s.pushHistory);
  const theme = useUIStore(s => s.theme);
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const boardPythonEnv = useBoardStore(s => s.board?.pythonEnvPath);
  const globalPythonEnv = useUIStore(s => s.pythonEnvPath);
  const activePythonEnv = boardPythonEnv ?? globalPythonEnv;

  const [localCode, setLocalCode] = useState('');
  const [localOutput, setLocalOutput] = useState<string | null>(null);
  const [localStdout, setLocalStdout] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [plotlyJson, setPlotlyJson] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [captureDpi, setCaptureDpi] = useState(2);

  // Crop
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [cropMode, setCropMode] = useState(false); // true = editing crop, plotly frozen

  const plotlyContainerRef = useRef<HTMLDivElement>(null);
  const plotlyDivRef = useRef<HTMLDivElement>(null);
  const initRef = useRef<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const codeRef = useRef('');
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist to store (debounced)
  const persistToStore = useCallback(() => {
    if (!elementId) return;
    const el = useBoardStore.getState().board?.elements.find(e => e.id === elementId);
    if (!el) return;
    const code = codeRef.current;
    if (code !== el.metadata?.code || localOutput !== el.metadata?.lastOutput ||
        localStdout !== el.metadata?.lastStdout || localError !== el.metadata?.lastError) {
      updateElement(elementId, {
        metadata: { ...el.metadata, code, lastOutput: localOutput, lastStdout: localStdout, lastError: localError },
      });
    }
  }, [elementId, localOutput, localStdout, localError, updateElement]);

  const schedulePersist = useCallback(() => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => persistToStore(), 2000);
  }, [persistToStore]);

  // Sync on open
  useEffect(() => {
    if (elementId && element && initRef.current !== elementId) {
      initRef.current = elementId;
      const code = element.metadata?.code || '';
      setLocalCode(code); codeRef.current = code;
      setLocalOutput(element.metadata?.lastOutput || null);
      setLocalStdout(element.metadata?.lastStdout || null);
      setLocalError(element.metadata?.lastError || null);
      setCropRect(element.metadata?.plotCrop || null);
      setPlotlyJson(element.metadata?.plotlyJson || null);
      setCropMode(false);
      setIsRunning(false); setHasRun(false); setExecutionId(null);
    }
  }, [elementId, element]);

  // CodeMirror setup
  useEffect(() => {
    if (!editorRef.current || !elementId) return;
    if (viewRef.current) { viewRef.current.destroy(); viewRef.current = null; }
    const runKm = keymap.of([
      { key: 'Mod-Enter', run: () => { handleRunRef.current(); return true; } },
      { key: 'Escape', run: () => { handleCloseRef.current(); return true; } },
      { key: 'Shift-Tab', run: (v) => { indentLess(v); return true; } },
    ]);
    const exts = [
      lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(),
      history(), indentOnInput(), bracketMatching(), python(),
      syntaxHighlighting(defaultHighlightStyle),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]), runKm,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) { const c = u.state.doc.toString(); codeRef.current = c; setLocalCode(c); schedulePersist(); }
      }),
      EditorView.theme({
        '&': { height: '100%', fontSize: '12px' },
        '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' },
        '.cm-content': { padding: '8px 0' }, '.cm-gutters': { borderRight: 'none' },
      }),
    ];
    if (isDark) exts.push(oneDark);
    else exts.push(EditorView.theme({ '.cm-gutters': { backgroundColor: '#f8f9fa', color: '#999' } }));
    const state = EditorState.create({ doc: codeRef.current, extensions: exts });
    const view = new EditorView({ state, parent: editorRef.current });
    viewRef.current = view;
    requestAnimationFrame(() => view.focus());
    return () => { view.destroy(); viewRef.current = null; };
  }, [elementId, isDark]);

  const handleRunRef = useRef<() => void>(() => {});
  const handleCloseRef = useRef<() => void>(() => {});

  const handleRun = useCallback(async () => {
    if (isRunning || !elementId) return;
    const execId = generateId();
    setIsRunning(true); setExecutionId(execId);
    setLocalError(null); setLocalStdout(null);
    try {
      const pythonEnv = useBoardStore.getState().board?.pythonEnvPath ?? useUIStore.getState().pythonEnvPath;
      const boardPath = useBoardStore.getState().boardFilePath;
      const cwd = boardPath ? boardPath.replace(/\/[^/]+$/, '') : null;
      const result = await api.executePlot(codeRef.current, 30, 150, pythonEnv, execId, cwd);
      setLocalOutput(result.image_base64);
      setLocalStdout(result.stdout);
      setLocalError(result.success ? null : result.error);
      setPlotlyJson(result.plotly_json);
    } catch (err: any) {
      if (!String(err).includes('abort')) setLocalError(String(err));
    } finally { setIsRunning(false); setHasRun(true); setExecutionId(null); }
  }, [elementId, isRunning]);

  const handleAbort = useCallback(async () => {
    if (executionId) { try { await api.abortPlot(executionId); } catch {} }
  }, [executionId]);

  // Apply crop to base64 image
  const applyCrop = useCallback((base64: string, crop: CropRect): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const sx = Math.round(crop.x * img.width), sy = Math.round(crop.y * img.height);
        const sw = Math.round(crop.w * img.width), sh = Math.round(crop.h * img.height);
        const c = document.createElement('canvas'); c.width = sw; c.height = sh;
        c.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        resolve(c.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''));
      };
      img.src = `data:image/png;base64,${base64}`;
    });
  }, []);

  const handleClose = useCallback(async () => {
    if (persistTimerRef.current) { clearTimeout(persistTimerRef.current); persistTimerRef.current = null; }

    // Capture plotly view
    let finalImage = localOutput;
    if (plotlyJson && plotlyDivRef.current) {
      try {
        const url = await Plotly.toImage(plotlyDivRef.current, { format: 'png', width: 800, height: 700, scale: captureDpi });
        finalImage = url.replace(/^data:image\/png;base64,/, '');
      } catch {}
    }

    // Apply crop
    let cropped = finalImage;
    if (finalImage && cropRect && cropRect.w > 0.02 && cropRect.h > 0.02) {
      try { cropped = await applyCrop(finalImage, cropRect); } catch {}
    }

    if (elementId) {
      const el = useBoardStore.getState().board?.elements.find(e => e.id === elementId);
      if (el) {
        const updates: Record<string, any> = {
          metadata: {
            ...el.metadata, code: codeRef.current,
            lastOutput: cropped, lastStdout: localStdout, lastError: localError,
            plotCrop: cropRect, plotlyJson,
          },
        };
        if (cropped && cropped !== el.metadata?.lastOutput) {
          try {
            const img = new Image();
            img.src = `data:image/png;base64,${cropped}`;
            await new Promise<void>(r => { img.onload = () => r(); img.onerror = () => r(); });
            if (img.naturalWidth > 0) updates.height = Math.round(el.width * (img.naturalHeight / img.naturalWidth));
          } catch {}
        }
        updateElement(elementId, updates);
        pushHistory('Edit plot');
      }
    }
    initRef.current = null;
    useUIStore.getState().setPlotEditorElementId(null);
  }, [elementId, localOutput, localStdout, localError, plotlyJson, cropRect, captureDpi, updateElement, pushHistory, applyCrop]);

  // Render plotly
  useEffect(() => {
    if (!plotlyJson || !plotlyDivRef.current) return;
    try {
      const spec = JSON.parse(plotlyJson);
      const { width: _w, height: _h, ...rest } = (spec.layout || {});
      Plotly.react(plotlyDivRef.current, spec.data || [], {
        ...rest, autosize: true, margin: rest.margin || { l: 0, r: 0, t: 30, b: 0 },
      }, { responsive: true, displayModeBar: true, modeBarButtonsToRemove: ['sendDataToCloud', 'toImage'] });
    } catch (e) { console.warn('[PlotEditor] plotly render error:', e); }
    return () => { if (plotlyDivRef.current) Plotly.purge(plotlyDivRef.current); };
  }, [plotlyJson]);

  handleRunRef.current = handleRun;
  handleCloseRef.current = handleClose;
  useEffect(() => { return () => { if (persistTimerRef.current) clearTimeout(persistTimerRef.current); }; }, []);

  if (!elementId || !element) return null;

  const hasPlotly = !!plotlyJson;
  const hasOutput = !!localOutput || hasPlotly;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/30" onClick={handleClose}>
      <div className="m-6 flex-1 flex flex-col bg-surface-primary rounded-lg shadow-2xl overflow-hidden border border-border"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="h-10 bg-toolbar-bg border-b border-toolbar-border flex items-center px-3 gap-2 shrink-0 select-none">
          <Code2 size={15} className="text-on-surface-secondary shrink-0" />
          <span className="text-xs font-semibold text-on-surface-primary">Plot Editor</span>
          <span className="text-2xs text-on-surface-muted truncate max-w-[200px]" title={activePythonEnv || 'default (built-in)'}>
            [{(activePythonEnv || 'default').split('/').pop()}]
          </span>

          <div className="w-px h-5 bg-toolbar-border mx-1" />

          {isRunning ? (
            <button onClick={handleAbort}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md text-red-100"
              style={{ backgroundColor: isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.75)', border: isDark ? '1px solid rgba(239,68,68,0.35)' : '1px solid rgba(239,68,68,0.45)' }}>
              <Square size={10} fill="currentColor" /> Stop
            </button>
          ) : (
            <button onClick={handleRun}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md text-green-100"
              style={{ backgroundColor: isDark ? 'rgba(34,197,94,0.2)' : 'rgba(74,186,120,0.75)', border: isDark ? '1px solid rgba(34,197,94,0.35)' : '1px solid rgba(74,186,120,0.45)', boxShadow: isDark ? '0 0 8px rgba(34,197,94,0.1)' : '0 0 6px rgba(22,163,74,0.15)' }}>
              <Play size={12} /> Run
            </button>
          )}
          <span className="text-2xs text-on-surface-muted select-none">{isRunning ? 'Running...' : 'Cmd+Enter'}</span>

          <div className="flex-1" />

          <span className="text-2xs text-on-surface-muted select-none">Esc to close</span>
          <button onClick={handleClose} className="p-1 text-on-surface-muted hover:text-on-surface-primary hover:bg-toolbar-hover rounded transition-colors" title="Close (Esc)">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 flex min-h-0">
          {/* Code */}
          <div className="w-1/2 flex flex-col border-r border-border">
            <div className="px-3 py-1.5 border-b border-border bg-inspector-section shrink-0">
              <span className="text-2xs font-semibold text-on-surface-muted uppercase tracking-wider">Code</span>
            </div>
            <div ref={editorRef} className="flex-1 overflow-hidden" style={{ minHeight: 0 }} />
          </div>

          {/* Output */}
          <div className="w-1/2 flex flex-col">
            {/* Output toolbar */}
            <div className="px-3 py-1.5 border-b border-border bg-inspector-section shrink-0 flex items-center gap-2">
              <span className="text-2xs font-semibold text-on-surface-muted uppercase tracking-wider">Output</span>
              <div className="flex-1" />

              {/* Resolution */}
              {hasPlotly && (
                <div className="flex items-center gap-1">
                  <span className="text-2xs text-on-surface-muted">Resolution:</span>
                  {([1, 2, 3] as const).map(d => (
                    <button key={d} onClick={() => setCaptureDpi(d)} title={`${800 * d}×${700 * d}px`}
                      className={`px-1 py-0.5 text-2xs rounded ${captureDpi === d ? 'bg-blue-500 text-white' : 'text-on-surface-muted hover:bg-toolbar-hover'}`}>
                      {d === 1 ? 'Low' : d === 2 ? 'Med' : 'High'}
                    </button>
                  ))}
                </div>
              )}

              {/* Crop toggle */}
              {hasOutput && (
                cropMode ? (
                  <button onClick={() => setCropMode(false)}
                    className="flex items-center gap-1 px-2 py-0.5 text-2xs font-medium text-white rounded" style={{ backgroundColor: '#3b82f6' }}>
                    <Check size={10} /> Done Cropping
                  </button>
                ) : (
                  <button onClick={() => setCropMode(true)}
                    className={`flex items-center gap-1 px-1.5 py-0.5 text-2xs rounded transition-colors ${
                      cropRect ? 'text-blue-500 hover:text-blue-600' : 'text-on-surface-secondary hover:text-on-surface-primary'
                    } hover:bg-toolbar-hover`}>
                    <Crop size={10} /> {cropRect ? 'Edit Crop' : 'Crop'}
                  </button>
                )
              )}
              {cropRect && !cropMode && (
                <button onClick={() => setCropRect(null)}
                  className="flex items-center gap-1 px-1.5 py-0.5 text-2xs text-red-500 hover:text-red-600 hover:bg-toolbar-hover rounded">
                  <X size={10} /> Clear
                </button>
              )}
            </div>

            <div className="flex-1 overflow-hidden bg-surface-primary flex flex-col min-h-0">
              {isRunning ? (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="flex items-center gap-2 text-sm text-on-surface-muted"><Loader2 size={18} className="animate-spin" /> Executing...</div>
                </div>
              ) : (
                <>
                  {/* Interactive plotly with crop overlay */}
                  {hasPlotly && (
                    <div className="flex-1 min-h-0 relative overflow-hidden bg-white dark:bg-neutral-900" ref={plotlyContainerRef}>
                      <div ref={plotlyDivRef} className="absolute inset-0 overflow-hidden" />
                      {/* Crop overlay — always present, mode controls interactivity */}
                      {(cropRect || cropMode) && (
                        <CropOverlay
                          cropRect={cropRect}
                          onChange={setCropRect}
                          cropMode={cropMode}
                          containerRef={plotlyContainerRef}
                        />
                      )}
                    </div>
                  )}

                  {/* Static matplotlib image */}
                  {!hasPlotly && localOutput && (
                    <div className="flex-1 flex items-center justify-center p-4 min-h-0">
                      <img src={`data:image/png;base64,${localOutput}`} alt="Plot" className="max-w-full max-h-full object-contain" draggable={false} />
                    </div>
                  )}

                  {/* Stdout */}
                  {localStdout && !cropMode && (
                    <div className={`border-t border-border ${!hasOutput ? 'flex-1' : ''}`}>
                      <div className="px-3 py-1 bg-inspector-section border-b border-border">
                        <span className="text-2xs font-semibold text-on-surface-muted uppercase tracking-wider">Console</span>
                      </div>
                      <pre className="p-3 text-xs text-on-surface-primary whitespace-pre-wrap break-words overflow-auto max-h-[200px]"
                        style={{ fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' }}>
                        {localStdout}
                      </pre>
                    </div>
                  )}

                  {/* Error */}
                  {localError && !cropMode && (
                    <div className={`border-t border-border ${!hasOutput && !localStdout ? 'flex-1 flex items-start' : ''}`}>
                      <pre className="p-4 text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap break-words w-full"
                        style={{ fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' }}>
                        {localError}
                      </pre>
                    </div>
                  )}

                  {/* Empty */}
                  {!hasOutput && !localStdout && !localError && (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-on-surface-muted select-none">
                      {hasRun ? (
                        <div className="flex flex-col items-center gap-3 px-8 max-w-md">
                          <span className="text-sm font-medium">Code executed — no output captured</span>
                          <div className="text-xs opacity-70 text-left space-y-2 w-full">
                            <p>sdraw captures output in two ways:</p>
                            <p className="font-semibold">Matplotlib:</p>
                            <pre className="bg-surface-secondary rounded px-2 py-1 text-2xs">{'import matplotlib.pyplot as plt\nplt.plot([1, 2, 3], [1, 4, 9])\n# Any plt figure is auto-captured'}</pre>
                            <p className="font-semibold">Plotly:</p>
                            <pre className="bg-surface-secondary rounded px-2 py-1 text-2xs">{'import plotly.graph_objects as go\nfig = go.Figure(...)\n# Variable named "fig" is auto-captured'}</pre>
                            <p className="opacity-80">Use <code className="bg-surface-secondary rounded px-1">print()</code> for debugging.</p>
                          </div>
                        </div>
                      ) : (
                        <>
                          <Play size={20} />
                          <span className="text-sm">Click Run to execute your code</span>
                          <span className="text-xs opacity-60">Cmd+Enter</span>
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
