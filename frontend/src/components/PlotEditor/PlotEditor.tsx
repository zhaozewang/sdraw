import { useState, useCallback, useRef, useEffect } from 'react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import { api } from '@/api/client';
import { Play, Square, Loader2, X, Crop, Check, Save } from 'lucide-react';
import Plotly from 'plotly.js-dist-min';

import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { python } from '@codemirror/lang-python';
import { indentWithTab } from '@codemirror/commands';
import { defaultKeymap, history, historyKeymap, indentMore, indentLess } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';

function generateId() { return Math.random().toString(36).slice(2, 10); }

interface CropRect { x: number; y: number; w: number; h: number; }

// ─── Draggable Splitter ────────────────────────────────────────
// During drag: updates layout via direct DOM style (no React re-renders).
// On mouseup: commits final value to state → single React re-render + Plotly resize.
function Splitter({ dir, containerRef, siblingRef, onCommit, clamp }: {
  dir: 'h' | 'v';
  containerRef: React.RefObject<HTMLElement | null>;
  siblingRef: React.RefObject<HTMLElement | null>;  // the element whose size changes
  onCommit: (pct: number) => void;
  clamp: (pct: number) => number;
}) {
  const onDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    const sibling = siblingRef.current;
    if (!container || !sibling) return;

    const prop = dir === 'h' ? 'width' : 'height';

    const onMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const pct = clamp(dir === 'h'
        ? ((ev.clientX - rect.left) / rect.width) * 100
        : ((ev.clientY - rect.top) / rect.height) * 100);
      sibling.style[prop] = `${pct}%`;
    };

    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const rect = container.getBoundingClientRect();
      const pct = clamp(dir === 'h'
        ? ((ev.clientX - rect.left) / rect.width) * 100
        : ((ev.clientY - rect.top) / rect.height) * 100);
      sibling.style[prop] = '';  // clear inline style, let React take over
      onCommit(pct);
      // Trigger plotly resize after layout settles
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [dir, containerRef, siblingRef, onCommit, clamp]);

  return (
    <div
      onMouseDown={onDown}
      className={dir === 'h'
        ? 'w-1 shrink-0 cursor-col-resize hover:bg-blue-500/30 active:bg-blue-500/50 transition-colors'
        : 'h-1 shrink-0 cursor-row-resize hover:bg-blue-500/30 active:bg-blue-500/50 transition-colors'
      }
      style={{ backgroundColor: 'rgba(128,128,128,0.15)' }}
    />
  );
}

// ─── Crop Editor (Phase A) ─────────────────────────────────────
const HS = 8;
type Dir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const DC: Record<Dir, string> = { nw:'nwse-resize', n:'ns-resize', ne:'nesw-resize', e:'ew-resize', se:'nwse-resize', s:'ns-resize', sw:'nesw-resize', w:'ew-resize' };

function CropEditor({ cropRect, onChange, containerRef }: {
  cropRect: CropRect | null; onChange: (r: CropRect | null) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const cr = useRef(cropRect); cr.current = cropRect;
  const toF = useCallback((e: MouseEvent | React.MouseEvent) => {
    const el = containerRef.current; if (!el) return { fx: 0, fy: 0 };
    const r = el.getBoundingClientRect();
    return { fx: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), fy: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
  }, [containerRef]);
  const drag = useCallback((onM: (ev: MouseEvent) => void, onD?: () => void) => {
    const m = (ev: MouseEvent) => { ev.preventDefault(); onM(ev); };
    const u = () => { document.removeEventListener('mousemove', m); document.removeEventListener('mouseup', u); onD?.(); };
    document.addEventListener('mousemove', m); document.addEventListener('mouseup', u);
  }, []);
  const onBg = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).dataset.crop) return; e.preventDefault();
    const { fx, fy } = toF(e); const sx = fx, sy = fy;
    onChange({ x: fx, y: fy, w: 0, h: 0 });
    drag((ev) => { const { fx: mx, fy: my } = toF(ev); onChange({ x: Math.min(sx, mx), y: Math.min(sy, my), w: Math.abs(mx - sx), h: Math.abs(my - sy) }); },
      () => { const c = cr.current; if (c && (c.w < 0.01 || c.h < 0.01)) onChange(null); });
  }, [toF, onChange, drag]);
  const onH = useCallback((d: Dir, e: React.MouseEvent) => {
    e.stopPropagation(); e.preventDefault(); if (!cr.current) return;
    const s = { ...cr.current }; const { fx: sx, fy: sy } = toF(e);
    drag((ev) => {
      const { fx, fy } = toF(ev); const dx = fx - sx, dy = fy - sy;
      let { x, y, w, h } = s; const rb = s.x + s.w, bb = s.y + s.h;
      if (d.includes('w')) { x = Math.max(0, Math.min(rb - 0.02, s.x + dx)); w = rb - x; }
      if (d.includes('e')) { w = Math.max(0.02, Math.min(1 - s.x, s.w + dx)); }
      if (d.includes('n')) { y = Math.max(0, Math.min(bb - 0.02, s.y + dy)); h = bb - y; }
      if (d.includes('s')) { h = Math.max(0.02, Math.min(1 - s.y, s.h + dy)); }
      if (d === 'n' || d === 's') { x = s.x; w = s.w; }
      if (d === 'e' || d === 'w') { y = s.y; h = s.h; }
      onChange({ x, y, w, h });
    });
  }, [toF, onChange, drag]);
  const onMv = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); e.preventDefault(); if (!cr.current) return;
    const s = { ...cr.current }; const { fx: sx, fy: sy } = toF(e);
    drag((ev) => { const { fx, fy } = toF(ev); onChange({ x: Math.max(0, Math.min(1 - s.w, s.x + fx - sx)), y: Math.max(0, Math.min(1 - s.h, s.y + fy - sy)), w: s.w, h: s.h }); });
  }, [toF, onChange, drag]);

  const handles: { d: Dir; x: number; y: number }[] = cropRect ? [
    { d:'nw', x:cropRect.x, y:cropRect.y }, { d:'n', x:cropRect.x+cropRect.w/2, y:cropRect.y },
    { d:'ne', x:cropRect.x+cropRect.w, y:cropRect.y }, { d:'e', x:cropRect.x+cropRect.w, y:cropRect.y+cropRect.h/2 },
    { d:'se', x:cropRect.x+cropRect.w, y:cropRect.y+cropRect.h }, { d:'s', x:cropRect.x+cropRect.w/2, y:cropRect.y+cropRect.h },
    { d:'sw', x:cropRect.x, y:cropRect.y+cropRect.h }, { d:'w', x:cropRect.x, y:cropRect.y+cropRect.h/2 },
  ] : [];

  return (
    <div className="absolute inset-0" style={{ zIndex: 20, cursor: 'crosshair', pointerEvents: 'auto' }} onMouseDown={onBg}>
      {cropRect && cropRect.w > 0.01 && (<>
        <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }} preserveAspectRatio="none" viewBox="0 0 1 1">
          <defs><mask id="sdraw-crop-edit"><rect x="0" y="0" width="1" height="1" fill="white" /><rect x={cropRect.x} y={cropRect.y} width={cropRect.w} height={cropRect.h} fill="black" /></mask></defs>
          <rect x="0" y="0" width="1" height="1" fill="rgba(0,0,0,0.5)" mask="url(#sdraw-crop-edit)" />
          <rect x={cropRect.x} y={cropRect.y} width={cropRect.w} height={cropRect.h} fill="none" stroke="#3b82f6" strokeWidth="0.003" />
        </svg>
        <div data-crop="move" onMouseDown={onMv} style={{ position:'absolute', left:`${cropRect.x*100}%`, top:`${cropRect.y*100}%`, width:`${cropRect.w*100}%`, height:`${cropRect.h*100}%`, cursor:'move', zIndex:21 }} />
        {handles.map(({ d, x, y }) => (
          <div key={d} data-crop="handle" onMouseDown={(e) => onH(d, e)} style={{
            position:'absolute', left:`calc(${x*100}% - ${HS/2}px)`, top:`calc(${y*100}% - ${HS/2}px)`,
            width:HS, height:HS, backgroundColor:'#3b82f6', border:'1.5px solid white', borderRadius:2, cursor:DC[d], zIndex:22,
          }} />
        ))}
      </>)}
      {!cropRect && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-black/60 text-white text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5"><Crop size={12} /> Drag to select crop region</div>
        </div>
      )}
    </div>
  );
}

// ─── Crop Indicator (Phase B) ──────────────────────────────────
function CropIndicator({ cropRect }: { cropRect: CropRect }) {
  return (
    <div className="absolute inset-0" style={{ zIndex: 10, pointerEvents: 'none' }}>
      <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 1 1">
        <defs><mask id="sdraw-crop-view"><rect x="0" y="0" width="1" height="1" fill="white" /><rect x={cropRect.x} y={cropRect.y} width={cropRect.w} height={cropRect.h} fill="black" /></mask></defs>
        <rect x="0" y="0" width="1" height="1" fill="rgba(0,0,0,0.3)" mask="url(#sdraw-crop-view)" />
        <rect x={cropRect.x} y={cropRect.y} width={cropRect.w} height={cropRect.h} fill="none" stroke="#3b82f6" strokeWidth="0.002" strokeDasharray="0.01 0.005" />
      </svg>
    </div>
  );
}

// ─── PlotEditor ────────────────────────────────────────────────

export function PlotEditor() {
  const elementId = useUIStore(s => s.plotEditorElementId);
  const element = useBoardStore(s => elementId ? s.board?.elements.find(el => el.id === elementId) : undefined);
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
  const captureScale = 2; // pixel density multiplier — preserves on-screen layout, just sharper
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [cropMode, setCropMode] = useState(false);

  // Layout: horizontal split (left width %), vertical split (code height %)
  const [leftPct, setLeftPct] = useState(45);
  const [codePct, setCodePct] = useState(75);
  const bodyRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);

  const codeWrapRef = useRef<HTMLDivElement>(null);
  const plotlyContainerRef = useRef<HTMLDivElement>(null);
  const plotlyDivRef = useRef<HTMLDivElement | null>(null);
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
    if (code !== el.metadata?.code || localOutput !== el.metadata?.lastOutput || localStdout !== el.metadata?.lastStdout || localError !== el.metadata?.lastError) {
      updateElement(elementId, { metadata: { ...el.metadata, code, lastOutput: localOutput, lastStdout: localStdout, lastError: localError } });
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

  // CodeMirror — follows canvas theme
  useEffect(() => {
    if (!editorRef.current || !elementId) return;
    if (viewRef.current) { viewRef.current.destroy(); viewRef.current = null; }
    const km = keymap.of([
      { key: 'Mod-Enter', run: () => { handleRunRef.current(); return true; } },
      { key: 'Escape', run: () => { handleCloseRef.current(); return true; } },
      { key: 'Shift-Tab', run: (v) => { indentLess(v); return true; } },
    ]);
    const monoFont = '"JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';
    const exts = [
      lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(),
      history(), indentOnInput(), bracketMatching(), python(),
      syntaxHighlighting(defaultHighlightStyle),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]), km,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) { const c = u.state.doc.toString(); codeRef.current = c; setLocalCode(c); schedulePersist(); }
      }),
      EditorView.theme({
        '&': { height: '100%', fontSize: '13px' },
        '.cm-scroller': { overflow: 'auto', fontFamily: monoFont },
        '.cm-content': { padding: '12px 0' },
        '.cm-gutters': { borderRight: 'none', minWidth: '3em' },
      }),
    ];
    if (isDark) {
      exts.push(oneDark);
    } else {
      exts.push(EditorView.theme({
        '&': { backgroundColor: '#fafafa' },
        '.cm-gutters': { backgroundColor: '#f5f5f5', color: '#999' },
        '.cm-activeLine': { backgroundColor: 'rgba(0,0,0,0.04)' },
        '.cm-activeLineGutter': { backgroundColor: 'rgba(0,0,0,0.06)' },
      }));
    }
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
    setIsRunning(true); setExecutionId(execId); setLocalError(null); setLocalStdout(null);
    try {
      const env = useBoardStore.getState().board?.pythonEnvPath ?? useUIStore.getState().pythonEnvPath;
      const bp = useBoardStore.getState().boardFilePath;
      const cwd = bp ? bp.replace(/\/[^/]+$/, '') : null;
      const r = await api.executePlot(codeRef.current, 30, 150, env, execId, cwd);
      setLocalOutput(r.image_base64); setLocalStdout(r.stdout);
      setLocalError(r.success ? null : r.error); setPlotlyJson(r.plotly_json);
    } catch (err: any) { if (!String(err).includes('abort')) setLocalError(String(err)); }
    finally { setIsRunning(false); setHasRun(true); setExecutionId(null); }
  }, [elementId, isRunning]);

  const handleAbort = useCallback(async () => { if (executionId) { try { await api.abortPlot(executionId); } catch {} } }, [executionId]);


  const getCurrentPlotlyJson = useCallback(() => {
    if (!plotlyJson || !plotlyDivRef.current) return plotlyJson;
    try { const d = plotlyDivRef.current as any; if (d.data && d.layout) return JSON.stringify({ data: d.data, layout: d.layout }); } catch {}
    return plotlyJson;
  }, [plotlyJson]);

  // Load a base64 image and return its natural dimensions
  const loadImage = useCallback((b64: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = `data:image/png;base64,${b64}`;
    });
  }, []);

  // Refs for save — avoids stale closures entirely
  const cropRectRef = useRef(cropRect);
  cropRectRef.current = cropRect;
  const localOutputRef = useRef(localOutput);
  localOutputRef.current = localOutput;
  const localStdoutRef = useRef(localStdout);
  localStdoutRef.current = localStdout;
  const localErrorRef = useRef(localError);
  localErrorRef.current = localError;

  // Save: capture + crop + update canvas node + close
  // Uses refs for ALL state to guarantee freshness regardless of useCallback deps
  const handleSave = useCallback(async () => {
    if (!elementId) return;

    // 1. Read current state from refs
    const currentCrop = cropRectRef.current;
    const currentJson = getCurrentPlotlyJson();

    // 2. Capture plotly view
    let capturedB64: string | null = localOutputRef.current;
    if (plotlyDivRef.current) {
      try {
        const dataUrl = await Plotly.toImage(plotlyDivRef.current, { format: 'png', scale: captureScale });
        capturedB64 = dataUrl.replace(/^data:image\/png;base64,/, '');
      } catch (e) {
        console.warn('[PlotEditor] capture failed:', e);
      }
    }

    if (!capturedB64) {
      console.warn('[PlotEditor] no image to save');
      return;
    }

    // 3. Apply crop if set
    let outputB64 = capturedB64;
    if (currentCrop && currentCrop.w > 0.02 && currentCrop.h > 0.02) {
      try {
        const full = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = `data:image/png;base64,${capturedB64}`;
        });
        const sx = Math.round(currentCrop.x * full.naturalWidth);
        const sy = Math.round(currentCrop.y * full.naturalHeight);
        const sw = Math.max(1, Math.round(currentCrop.w * full.naturalWidth));
        const sh = Math.max(1, Math.round(currentCrop.h * full.naturalHeight));
        const c = document.createElement('canvas');
        c.width = sw; c.height = sh;
        c.getContext('2d')!.drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
        outputB64 = c.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
      } catch (e) {
        console.warn('[PlotEditor] crop failed:', e);
      }
    }

    // 4. Compute correct aspect ratio from the output image
    let newHeight: number | undefined;
    try {
      const out = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = `data:image/png;base64,${outputB64}`;
      });
      if (out.naturalWidth > 0 && out.naturalHeight > 0) {
        const el = useBoardStore.getState().board?.elements.find(e => e.id === elementId);
        if (el) newHeight = Math.round(el.width * (out.naturalHeight / out.naturalWidth));
      }
    } catch {}

    // 5. Update element
    const el = useBoardStore.getState().board?.elements.find(e => e.id === elementId);
    if (el) {
      const updates: Record<string, any> = {
        metadata: {
          ...el.metadata,
          code: codeRef.current,
          lastOutput: outputB64,
          lastStdout: localStdoutRef.current,
          lastError: localErrorRef.current,
          plotCrop: currentCrop,
          plotlyJson: currentJson,
        },
      };
      if (newHeight !== undefined) updates.height = newHeight;
      updateElement(elementId, updates);
      pushHistory('Save plot');
    }
  }, [elementId, updateElement, pushHistory, getCurrentPlotlyJson]);

  const handleClose = useCallback(() => {
    if (persistTimerRef.current) { clearTimeout(persistTimerRef.current); persistTimerRef.current = null; }
    initRef.current = null; useUIStore.getState().setPlotEditorElementId(null);
  }, []);

  const handleSaveAndClose = useCallback(async () => { await handleSave(); handleClose(); }, [handleSave, handleClose]);

  // Plotly render
  const plotlyJsonRef = useRef(plotlyJson); plotlyJsonRef.current = plotlyJson;
  const renderPlotly = useCallback((div: HTMLDivElement) => {
    const json = plotlyJsonRef.current; if (!json) return;
    try {
      const spec = JSON.parse(json);
      const { width: _w, height: _h, ...rest } = (spec.layout || {});
      Plotly.react(div, spec.data || [], { ...rest, autosize: true }, { responsive: true, displayModeBar: true, modeBarButtonsToRemove: ['sendDataToCloud', 'toImage'] });
    } catch (e) { console.warn('[PlotEditor] plotly error:', e); }
  }, []);
  const plotlyRefCallback = useCallback((node: HTMLDivElement | null) => {
    if (plotlyDivRef.current && !node) Plotly.purge(plotlyDivRef.current);
    plotlyDivRef.current = node;
    if (node) renderPlotly(node);
  }, [renderPlotly]);
  useEffect(() => { if (plotlyJson && plotlyDivRef.current) renderPlotly(plotlyDivRef.current); }, [plotlyJson, renderPlotly]);

  handleRunRef.current = handleRun;
  handleCloseRef.current = handleSaveAndClose;
  useEffect(() => { return () => { if (persistTimerRef.current) clearTimeout(persistTimerRef.current); }; }, []);

  const clampH = useCallback((p: number) => Math.max(25, Math.min(75, p)), []);
  const clampV = useCallback((p: number) => Math.max(30, Math.min(90, p)), []);

  if (!elementId || !element) return null;
  const hasPlotly = !!plotlyJson;
  const hasOutput = !!localOutput || hasPlotly;
  const hasConsole = !!localStdout || !!localError;

  return (
    <div className="fixed inset-0 z-50 flex flex-col" onClick={handleSaveAndClose}>
      {/* Dark translucent backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      <div className={`relative m-4 flex-1 flex flex-col rounded-xl shadow-2xl overflow-hidden ${isDark ? 'border border-white/10' : 'border border-gray-200'}`}
        style={{ backgroundColor: isDark ? '#1e1e2e' : '#ffffff' }}
        onClick={e => e.stopPropagation()}>

        {/* Compact toolbar */}
        <div className="h-10 flex items-center px-3 gap-2 shrink-0 select-none"
          style={{ backgroundColor: isDark ? '#181825' : '#f8f8f8', borderBottom: isDark ? '1px solid rgba(255,255,255,0.06)' : '1px solid #e5e5e5' }}>
          {/* Run/Stop */}
          {isRunning ? (
            <button onClick={handleAbort} className={`flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded ${isDark ? 'text-red-300' : 'text-red-600'}`}
              style={{ backgroundColor: isDark ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.1)' }}>
              <Square size={12} fill="currentColor" /> Stop
            </button>
          ) : (
            <button onClick={handleRun} className={`flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded ${isDark ? 'text-green-300' : 'text-green-700'}`}
              style={{ backgroundColor: isDark ? 'rgba(34,197,94,0.15)' : 'rgba(34,197,94,0.1)' }}>
              <Play size={12} /> Run
            </button>
          )}
          <span className={`text-xs ${isDark ? 'text-white/30' : 'text-gray-400'}`}>{isRunning ? '' : '\u2318\u23CE'}</span>

          <div className={`w-px h-4 mx-1 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />

          <span className={`text-xs truncate max-w-[140px] ${isDark ? 'text-white/30' : 'text-gray-400'}`} title={activePythonEnv || 'default'}>
            {(activePythonEnv || 'default').split('/').pop()}
          </span>

          <div className="flex-1" />

          {hasOutput && !cropMode && (
            <button onClick={() => setCropMode(true)} className={`flex items-center gap-1 px-2 py-0.5 text-xs rounded ${cropRect ? 'text-blue-400' : (isDark ? 'text-white/40 hover:text-white/60' : 'text-gray-500 hover:text-gray-700')}`}>
              <Crop size={12} /> {cropRect ? 'Edit Crop' : 'Crop'}
            </button>
          )}
          {cropMode && (
            <div className="flex items-center gap-1">
              <button onClick={() => setCropMode(false)} className={`flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded ${isDark ? 'text-blue-300 bg-blue-500/20' : 'text-blue-600 bg-blue-100'}`}>
                <Check size={12} /> Done
              </button>
              {cropRect && (
                <button onClick={() => { setCropRect(null); setCropMode(false); }} className={`px-1.5 py-0.5 text-xs rounded ${isDark ? 'text-white/25 hover:text-red-400' : 'text-gray-400 hover:text-red-500'}`}>
                  Clear
                </button>
              )}
            </div>
          )}

          <div className={`w-px h-4 mx-1 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />

          {hasOutput && (
            <button onClick={handleSaveAndClose} className="flex items-center gap-1 px-3 py-1 text-xs font-medium rounded text-white bg-blue-600 hover:bg-blue-700">
              <Save size={12} /> Save
            </button>
          )}
          <button onClick={handleClose} className={`p-0.5 rounded ml-0.5 ${isDark ? 'text-white/30 hover:text-white/60 hover:bg-white/5' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`} title="Close without saving">
            <X size={14} />
          </button>
        </div>

        {/* Body: code+console | splitter | output */}
        <div className="flex-1 flex min-h-0" ref={bodyRef}>
          {/* Left: code + console */}
          <div className="flex flex-col min-h-0 overflow-hidden" style={{ width: `${leftPct}%` }} ref={leftRef}>
            {/* Code editor */}
            <div ref={codeWrapRef} className="overflow-hidden" style={{ height: hasConsole ? `${codePct}%` : '100%', minHeight: 0 }}>
              <div ref={editorRef} className="w-full h-full overflow-hidden" />
            </div>

            {/* Console/Error */}
            {hasConsole && (
              <>
                <Splitter dir="v" containerRef={leftRef} siblingRef={codeWrapRef} onCommit={setCodePct} clamp={clampV} />
                <div className="overflow-auto min-h-0" style={{ height: `${100 - codePct}%`, backgroundColor: isDark ? '#11111b' : '#f5f5f5' }}>
                  {localStdout && (
                    <pre className={`px-3 py-2 text-xs whitespace-pre-wrap break-words ${isDark ? 'text-[#a6adc8]' : 'text-gray-600'}`}
                      style={{ fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace' }}>{localStdout}</pre>
                  )}
                  {localError && (
                    <pre className={`px-3 py-2 text-xs whitespace-pre-wrap break-words ${isDark ? 'text-[#f38ba8]' : 'text-red-600'}`}
                      style={{ fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace' }}>{localError}</pre>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Horizontal splitter */}
          <Splitter dir="h" containerRef={bodyRef} siblingRef={leftRef} onCommit={setLeftPct} clamp={clampH} />

          {/* Right: output */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden" style={{ backgroundColor: isDark ? '#1a1a2e' : '#fafafa' }}>
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">
              {isRunning ? (
                <div className="w-full h-full flex items-center justify-center">
                  <div className={`flex items-center gap-2 text-sm ${isDark ? 'text-white/30' : 'text-gray-400'}`}><Loader2 size={18} className="animate-spin" /> Executing...</div>
                </div>
              ) : (
                <>
                  {hasPlotly && (
                    <div className="flex-1 min-h-0 relative overflow-hidden bg-white" ref={plotlyContainerRef}>
                      <div ref={plotlyRefCallback} className="absolute inset-0 overflow-hidden" />
                      {cropMode && <CropEditor cropRect={cropRect} onChange={setCropRect} containerRef={plotlyContainerRef} />}
                      {!cropMode && cropRect && cropRect.w > 0.01 && <CropIndicator cropRect={cropRect} />}
                    </div>
                  )}

                  {!hasPlotly && localOutput && (
                    <div className="flex-1 flex items-center justify-center p-4 min-h-0">
                      <img src={`data:image/png;base64,${localOutput}`} alt="Plot" className="max-w-full max-h-full object-contain" draggable={false} />
                    </div>
                  )}

                  {!hasOutput && (
                    <div className={`w-full h-full flex flex-col items-center justify-center gap-3 select-none px-8 ${isDark ? 'text-white/25' : 'text-gray-300'}`}>
                      {hasRun ? (
                        <>
                          <span className="text-sm">No output captured</span>
                          <span className={`text-xs text-center ${isDark ? 'text-white/15' : 'text-gray-300'}`}>Create a matplotlib figure or a plotly <code className={isDark ? 'text-white/25' : 'text-gray-400'}>fig = go.Figure(...)</code></span>
                        </>
                      ) : (
                        <>
                          <Play size={20} />
                          <span className="text-sm">Run to see output</span>
                          <span className={`text-xs ${isDark ? 'text-white/15' : 'text-gray-300'}`}>{'\u2318'}+Enter</span>
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
