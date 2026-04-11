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

// ─── Phase A: Crop Editor ──────────────────────────────────────
// Full interactive crop overlay with 8 handles + move + draw.
// Captures ALL pointer events (plotly frozen underneath).

const H = 8; // handle size
type Dir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const DIR_CURSOR: Record<Dir, string> = {
  nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize',
  se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize',
};

function CropEditor({ cropRect, onChange, containerRef }: {
  cropRect: CropRect | null;
  onChange: (r: CropRect | null) => void;
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

  const useDrag = useCallback((onMove: (ev: MouseEvent) => void, onDone?: () => void) => {
    const move = (ev: MouseEvent) => { ev.preventDefault(); onMove(ev); };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); onDone?.(); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }, []);

  // Draw new
  const onBgDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).dataset.crop) return;
    e.preventDefault();
    const { fx, fy } = toFrac(e);
    const sx = fx, sy = fy;
    onChange({ x: fx, y: fy, w: 0, h: 0 });
    useDrag((ev) => {
      const { fx: mx, fy: my } = toFrac(ev);
      onChange({ x: Math.min(sx, mx), y: Math.min(sy, my), w: Math.abs(mx - sx), h: Math.abs(my - sy) });
    }, () => { const cr = cropRef.current; if (cr && (cr.w < 0.01 || cr.h < 0.01)) onChange(null); });
  }, [toFrac, onChange, useDrag]);

  // Resize
  const onHandleDown = useCallback((dir: Dir, e: React.MouseEvent) => {
    e.stopPropagation(); e.preventDefault();
    if (!cropRef.current) return;
    const s = { ...cropRef.current };
    const { fx: sx, fy: sy } = toFrac(e);
    useDrag((ev) => {
      const { fx, fy } = toFrac(ev);
      const dx = fx - sx, dy = fy - sy;
      let { x, y, w, h } = s;
      const r = s.x + s.w, b = s.y + s.h;
      // Edges
      if (dir.includes('w')) { x = Math.max(0, Math.min(r - 0.02, s.x + dx)); w = r - x; }
      if (dir.includes('e')) { w = Math.max(0.02, Math.min(1 - s.x, s.w + dx)); }
      if (dir.includes('n')) { y = Math.max(0, Math.min(b - 0.02, s.y + dy)); h = b - y; }
      if (dir.includes('s')) { h = Math.max(0.02, Math.min(1 - s.y, s.h + dy)); }
      // Single-axis dirs: keep other axis unchanged
      if (dir === 'n' || dir === 's') { x = s.x; w = s.w; }
      if (dir === 'e' || dir === 'w') { y = s.y; h = s.h; }
      onChange({ x, y, w, h });
    });
  }, [toFrac, onChange, useDrag]);

  // Move
  const onMoveDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); e.preventDefault();
    if (!cropRef.current) return;
    const s = { ...cropRef.current };
    const { fx: sx, fy: sy } = toFrac(e);
    useDrag((ev) => {
      const { fx, fy } = toFrac(ev);
      let nx = s.x + (fx - sx), ny = s.y + (fy - sy);
      nx = Math.max(0, Math.min(1 - s.w, nx));
      ny = Math.max(0, Math.min(1 - s.h, ny));
      onChange({ x: nx, y: ny, w: s.w, h: s.h });
    });
  }, [toFrac, onChange, useDrag]);

  // Handle positions
  const handles: { dir: Dir; x: number; y: number }[] = cropRect ? [
    { dir: 'nw', x: cropRect.x, y: cropRect.y },
    { dir: 'n',  x: cropRect.x + cropRect.w / 2, y: cropRect.y },
    { dir: 'ne', x: cropRect.x + cropRect.w, y: cropRect.y },
    { dir: 'e',  x: cropRect.x + cropRect.w, y: cropRect.y + cropRect.h / 2 },
    { dir: 'se', x: cropRect.x + cropRect.w, y: cropRect.y + cropRect.h },
    { dir: 's',  x: cropRect.x + cropRect.w / 2, y: cropRect.y + cropRect.h },
    { dir: 'sw', x: cropRect.x, y: cropRect.y + cropRect.h },
    { dir: 'w',  x: cropRect.x, y: cropRect.y + cropRect.h / 2 },
  ] : [];

  return (
    <div className="absolute inset-0" style={{ zIndex: 20, cursor: 'crosshair', pointerEvents: 'auto' }}
      onMouseDown={onBgDown}>
      {/* Dim mask */}
      {cropRect && cropRect.w > 0.01 && (
        <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }} preserveAspectRatio="none" viewBox="0 0 1 1">
          <defs><mask id="sdraw-crop-edit">
            <rect x="0" y="0" width="1" height="1" fill="white" />
            <rect x={cropRect.x} y={cropRect.y} width={cropRect.w} height={cropRect.h} fill="black" />
          </mask></defs>
          <rect x="0" y="0" width="1" height="1" fill="rgba(0,0,0,0.5)" mask="url(#sdraw-crop-edit)" />
          <rect x={cropRect.x} y={cropRect.y} width={cropRect.w} height={cropRect.h}
            fill="none" stroke="#3b82f6" strokeWidth="0.003" />
        </svg>
      )}
      {/* Move area */}
      {cropRect && cropRect.w > 0.01 && (
        <div data-crop="move" onMouseDown={onMoveDown} style={{
          position: 'absolute', left: `${cropRect.x * 100}%`, top: `${cropRect.y * 100}%`,
          width: `${cropRect.w * 100}%`, height: `${cropRect.h * 100}%`,
          cursor: 'move', zIndex: 21,
        }} />
      )}
      {/* 8 handles */}
      {handles.map(({ dir, x, y }) => (
        <div key={dir} data-crop="handle" onMouseDown={(e) => onHandleDown(dir, e)} style={{
          position: 'absolute',
          left: `calc(${x * 100}% - ${H / 2}px)`, top: `calc(${y * 100}% - ${H / 2}px)`,
          width: H, height: H,
          backgroundColor: '#3b82f6', border: '1.5px solid white', borderRadius: 2,
          cursor: DIR_CURSOR[dir], zIndex: 22,
        }} />
      ))}
      {/* Hint */}
      {!cropRect && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-black/60 text-white text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5">
            <Crop size={12} /> Drag to select crop region
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Phase B: Crop Indicator ───────────────────────────────────
// Visual-only overlay. No pointer events. Shows the crop region with
// a dashed border and lightly dimmed outside.

function CropIndicator({ cropRect }: { cropRect: CropRect }) {
  return (
    <div className="absolute inset-0" style={{ zIndex: 10, pointerEvents: 'none' }}>
      <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 1 1">
        <defs><mask id="sdraw-crop-view">
          <rect x="0" y="0" width="1" height="1" fill="white" />
          <rect x={cropRect.x} y={cropRect.y} width={cropRect.w} height={cropRect.h} fill="black" />
        </mask></defs>
        <rect x="0" y="0" width="1" height="1" fill="rgba(0,0,0,0.3)" mask="url(#sdraw-crop-view)" />
        <rect x={cropRect.x} y={cropRect.y} width={cropRect.w} height={cropRect.h}
          fill="none" stroke="#3b82f6" strokeWidth="0.002" strokeDasharray="0.01 0.005" />
      </svg>
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
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [cropMode, setCropMode] = useState(false);

  const plotlyContainerRef = useRef<HTMLDivElement>(null);
  const plotlyDivRef = useRef<HTMLDivElement>(null);
  const initRef = useRef<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const codeRef = useRef('');
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      setCropMode(false); setIsRunning(false); setHasRun(false); setExecutionId(null);
    }
  }, [elementId, element]);

  // CodeMirror
  useEffect(() => {
    if (!editorRef.current || !elementId) return;
    if (viewRef.current) { viewRef.current.destroy(); viewRef.current = null; }
    const km = keymap.of([
      { key: 'Mod-Enter', run: () => { handleRunRef.current(); return true; } },
      { key: 'Escape', run: () => { handleCloseRef.current(); return true; } },
      { key: 'Shift-Tab', run: (v) => { indentLess(v); return true; } },
    ]);
    const exts = [
      lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(),
      history(), indentOnInput(), bracketMatching(), python(),
      syntaxHighlighting(defaultHighlightStyle),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]), km,
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
    const st = EditorState.create({ doc: codeRef.current, extensions: exts });
    const v = new EditorView({ state: st, parent: editorRef.current });
    viewRef.current = v;
    requestAnimationFrame(() => v.focus());
    return () => { v.destroy(); viewRef.current = null; };
  }, [elementId, isDark]);

  const handleRunRef = useRef<() => void>(() => {});
  const handleCloseRef = useRef<() => void>(() => {});

  const handleRun = useCallback(async () => {
    if (isRunning || !elementId) return;
    const execId = generateId();
    setIsRunning(true); setExecutionId(execId);
    setLocalError(null); setLocalStdout(null);
    try {
      const env = useBoardStore.getState().board?.pythonEnvPath ?? useUIStore.getState().pythonEnvPath;
      const bp = useBoardStore.getState().boardFilePath;
      const cwd = bp ? bp.replace(/\/[^/]+$/, '') : null;
      const r = await api.executePlot(codeRef.current, 30, 150, env, execId, cwd);
      setLocalOutput(r.image_base64); setLocalStdout(r.stdout);
      setLocalError(r.success ? null : r.error); setPlotlyJson(r.plotly_json);
    } catch (err: any) {
      if (!String(err).includes('abort')) setLocalError(String(err));
    } finally { setIsRunning(false); setHasRun(true); setExecutionId(null); }
  }, [elementId, isRunning]);

  const handleAbort = useCallback(async () => {
    if (executionId) { try { await api.abortPlot(executionId); } catch {} }
  }, [executionId]);

  const applyCrop = useCallback((b64: string, crop: CropRect): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const sx = Math.round(crop.x * img.width), sy = Math.round(crop.y * img.height);
        const sw = Math.round(crop.w * img.width), sh = Math.round(crop.h * img.height);
        const c = document.createElement('canvas'); c.width = sw; c.height = sh;
        c.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        resolve(c.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''));
      };
      img.src = `data:image/png;base64,${b64}`;
    });
  }, []);

  const handleClose = useCallback(async () => {
    if (persistTimerRef.current) { clearTimeout(persistTimerRef.current); persistTimerRef.current = null; }
    let finalImage = localOutput;
    if (plotlyJson && plotlyDivRef.current) {
      try {
        const url = await Plotly.toImage(plotlyDivRef.current, { format: 'png', width: 800, height: 700, scale: captureDpi });
        finalImage = url.replace(/^data:image\/png;base64,/, '');
      } catch {}
    }
    let cropped = finalImage;
    if (finalImage && cropRect && cropRect.w > 0.02 && cropRect.h > 0.02) {
      try { cropped = await applyCrop(finalImage, cropRect); } catch {}
    }
    if (elementId) {
      const el = useBoardStore.getState().board?.elements.find(e => e.id === elementId);
      if (el) {
        const updates: Record<string, any> = {
          metadata: { ...el.metadata, code: codeRef.current, lastOutput: cropped, lastStdout: localStdout, lastError: localError, plotCrop: cropRect, plotlyJson },
        };
        if (cropped && cropped !== el.metadata?.lastOutput) {
          try {
            const img = new Image(); img.src = `data:image/png;base64,${cropped}`;
            await new Promise<void>(r => { img.onload = () => r(); img.onerror = () => r(); });
            if (img.naturalWidth > 0) updates.height = Math.round(el.width * (img.naturalHeight / img.naturalWidth));
          } catch {}
        }
        updateElement(elementId, updates); pushHistory('Edit plot');
      }
    }
    initRef.current = null;
    useUIStore.getState().setPlotEditorElementId(null);
  }, [elementId, localOutput, localStdout, localError, plotlyJson, cropRect, captureDpi, updateElement, pushHistory, applyCrop]);

  // Plotly render
  useEffect(() => {
    if (!plotlyJson || !plotlyDivRef.current) return;
    try {
      const spec = JSON.parse(plotlyJson);
      const { width: _w, height: _h, ...rest } = (spec.layout || {});
      Plotly.react(plotlyDivRef.current, spec.data || [], {
        ...rest, autosize: true, margin: rest.margin || { l: 0, r: 0, t: 30, b: 0 },
      }, { responsive: true, displayModeBar: true, modeBarButtonsToRemove: ['sendDataToCloud', 'toImage'] });
    } catch (e) { console.warn('[PlotEditor] plotly error:', e); }
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
            <button onClick={handleAbort} className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md text-red-100"
              style={{ backgroundColor: isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.75)', border: isDark ? '1px solid rgba(239,68,68,0.35)' : '1px solid rgba(239,68,68,0.45)' }}>
              <Square size={10} fill="currentColor" /> Stop
            </button>
          ) : (
            <button onClick={handleRun} className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md text-green-100"
              style={{ backgroundColor: isDark ? 'rgba(34,197,94,0.2)' : 'rgba(74,186,120,0.75)', border: isDark ? '1px solid rgba(34,197,94,0.35)' : '1px solid rgba(74,186,120,0.45)', boxShadow: isDark ? '0 0 8px rgba(34,197,94,0.1)' : '0 0 6px rgba(22,163,74,0.15)' }}>
              <Play size={12} /> Run
            </button>
          )}
          <span className="text-2xs text-on-surface-muted select-none">{isRunning ? 'Running...' : 'Cmd+Enter'}</span>
          <div className="flex-1" />
          <span className="text-2xs text-on-surface-muted select-none">Esc to close</span>
          <button onClick={handleClose} className="p-1 text-on-surface-muted hover:text-on-surface-primary hover:bg-toolbar-hover rounded transition-colors"><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 flex min-h-0">
          {/* Code + Console/Error */}
          <div className="w-1/2 flex flex-col border-r border-border">
            <div className="px-3 py-1.5 border-b border-border bg-inspector-section shrink-0">
              <span className="text-2xs font-semibold text-on-surface-muted uppercase tracking-wider">Code</span>
            </div>
            <div ref={editorRef} className="flex-1 overflow-hidden" style={{ minHeight: 0 }} />

            {/* Stdout */}
            {localStdout && (
              <div className="border-t border-border shrink-0">
                <div className="px-3 py-1 bg-inspector-section border-b border-border">
                  <span className="text-2xs font-semibold text-on-surface-muted uppercase tracking-wider">Console</span>
                </div>
                <pre className="p-3 text-xs text-on-surface-primary whitespace-pre-wrap break-words overflow-auto max-h-[150px]"
                  style={{ fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' }}>{localStdout}</pre>
              </div>
            )}

            {/* Error */}
            {localError && (
              <div className="border-t border-border shrink-0">
                <pre className="p-3 text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap break-words overflow-auto max-h-[150px]"
                  style={{ fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' }}>{localError}</pre>
              </div>
            )}
          </div>

          {/* Output */}
          <div className="w-1/2 flex flex-col">
            <div className="px-3 py-1.5 border-b border-border bg-inspector-section shrink-0 flex items-center gap-2">
              <span className="text-2xs font-semibold text-on-surface-muted uppercase tracking-wider">Output</span>
              <div className="flex-1" />

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

              {hasOutput && !cropMode && (
                <button onClick={() => setCropMode(true)}
                  className={`flex items-center gap-1 px-1.5 py-0.5 text-2xs rounded hover:bg-toolbar-hover ${cropRect ? 'text-blue-500' : 'text-on-surface-secondary hover:text-on-surface-primary'}`}>
                  <Crop size={10} /> {cropRect ? 'Edit Crop' : 'Crop'}
                </button>
              )}
              {cropMode && (
                <button onClick={() => setCropMode(false)}
                  className="flex items-center gap-1 px-2 py-0.5 text-2xs font-medium text-white rounded" style={{ backgroundColor: '#3b82f6' }}>
                  <Check size={10} /> Done
                </button>
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
                  {/* Plotly */}
                  {hasPlotly && (
                    <div className="flex-1 min-h-0 relative overflow-hidden bg-white dark:bg-neutral-900" ref={plotlyContainerRef}>
                      <div ref={plotlyDivRef} className="absolute inset-0 overflow-hidden" />

                      {/* Phase A: crop editor (plotly frozen) */}
                      {cropMode && (
                        <CropEditor cropRect={cropRect} onChange={setCropRect} containerRef={plotlyContainerRef} />
                      )}

                      {/* Phase B: crop indicator (visual only, plotly interactive) */}
                      {!cropMode && cropRect && cropRect.w > 0.01 && (
                        <CropIndicator cropRect={cropRect} />
                      )}
                    </div>
                  )}

                  {/* Static matplotlib */}
                  {!hasPlotly && localOutput && (
                    <div className="flex-1 flex items-center justify-center p-4 min-h-0">
                      <img src={`data:image/png;base64,${localOutput}`} alt="Plot" className="max-w-full max-h-full object-contain" draggable={false} />
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
                        <><Play size={20} /><span className="text-sm">Click Run to execute your code</span><span className="text-xs opacity-60">Cmd+Enter</span></>
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
