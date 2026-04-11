import { useState, useCallback, useRef, useEffect } from 'react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import { api } from '@/api/client';
import { Play, Square, Loader2, X, Code2, Camera, Crop, RotateCcw, Check } from 'lucide-react';
import Plotly from 'plotly.js-dist-min';

// CodeMirror imports
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

/** Crop region as fractions of image dimensions (0–1) */
interface CropRect {
  x: number; y: number; w: number; h: number;
}

const HANDLE_SIZE = 10;
type HandlePos = 'nw' | 'ne' | 'sw' | 'se';
const HANDLE_CURSORS: Record<HandlePos, string> = { nw: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', se: 'nwse-resize' };

/**
 * Self-contained crop overlay. Renders over a container and handles:
 * - Drawing a new crop rectangle (mousedown on empty area)
 * - Resizing via corner handles
 * - Moving the crop box by dragging inside it
 * All coordinates are fractions (0–1) of the container size.
 */
function CropOverlay({ cropRect, onCropChange, containerRef }: {
  cropRect: CropRect | null;
  onCropChange: (rect: CropRect | null) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const cropRef = useRef(cropRect);
  cropRef.current = cropRect;
  const suppressClickRef = useRef(false);

  const toFrac = useCallback((e: MouseEvent | React.MouseEvent) => {
    const el = containerRef.current;
    if (!el) return { fx: 0, fy: 0 };
    const r = el.getBoundingClientRect();
    return {
      fx: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      fy: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  }, [containerRef]);

  // Start drawing a new crop (on background click)
  const handleBgMouseDown = useCallback((e: React.MouseEvent) => {
    // Only if clicking outside existing crop area
    if ((e.target as HTMLElement).dataset.cropArea) return;
    e.preventDefault();
    const { fx, fy } = toFrac(e);
    const startFx = fx, startFy = fy;
    onCropChange({ x: fx, y: fy, w: 0, h: 0 });
    suppressClickRef.current = true;

    const onMove = (ev: MouseEvent) => {
      const { fx: mx, fy: my } = toFrac(ev);
      onCropChange({
        x: Math.min(startFx, mx),
        y: Math.min(startFy, my),
        w: Math.abs(mx - startFx),
        h: Math.abs(my - startFy),
      });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const cr = cropRef.current;
      if (cr && (cr.w < 0.01 || cr.h < 0.01)) onCropChange(null);
      setTimeout(() => { suppressClickRef.current = false; }, 100);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [toFrac, onCropChange]);

  // Resize from corner handle
  const handleResize = useCallback((corner: HandlePos, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!cropRef.current) return;
    const startCrop = { ...cropRef.current };
    const { fx: sx, fy: sy } = toFrac(e);
    suppressClickRef.current = true;

    const onMove = (ev: MouseEvent) => {
      const { fx, fy } = toFrac(ev);
      const dx = fx - sx, dy = fy - sy;
      const c = startCrop;
      let x = c.x, y = c.y, w = c.w, h = c.h;
      if (corner === 'nw') {
        x = Math.max(0, Math.min(c.x + c.w - 0.02, c.x + dx));
        y = Math.max(0, Math.min(c.y + c.h - 0.02, c.y + dy));
        w = c.x + c.w - x; h = c.y + c.h - y;
      } else if (corner === 'ne') {
        w = Math.max(0.02, Math.min(1 - c.x, c.w + dx));
        y = Math.max(0, Math.min(c.y + c.h - 0.02, c.y + dy));
        h = c.y + c.h - y;
      } else if (corner === 'sw') {
        x = Math.max(0, Math.min(c.x + c.w - 0.02, c.x + dx));
        w = c.x + c.w - x;
        h = Math.max(0.02, Math.min(1 - c.y, c.h + dy));
      } else {
        w = Math.max(0.02, Math.min(1 - c.x, c.w + dx));
        h = Math.max(0.02, Math.min(1 - c.y, c.h + dy));
      }
      onCropChange({ x, y, w, h });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setTimeout(() => { suppressClickRef.current = false; }, 100);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [toFrac, onCropChange]);

  // Move entire crop box
  const handleMove = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!cropRef.current) return;
    const startCrop = { ...cropRef.current };
    const { fx: sx, fy: sy } = toFrac(e);
    suppressClickRef.current = true;

    const onMove = (ev: MouseEvent) => {
      const { fx, fy } = toFrac(ev);
      let nx = startCrop.x + (fx - sx);
      let ny = startCrop.y + (fy - sy);
      nx = Math.max(0, Math.min(1 - startCrop.w, nx));
      ny = Math.max(0, Math.min(1 - startCrop.h, ny));
      onCropChange({ x: nx, y: ny, w: startCrop.w, h: startCrop.h });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setTimeout(() => { suppressClickRef.current = false; }, 100);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [toFrac, onCropChange]);

  // Expose suppressClickRef for parent backdrop handler
  (CropOverlay as any)._suppressClick = suppressClickRef;

  const handles: { pos: HandlePos; cx: number; cy: number }[] = cropRect ? [
    { pos: 'nw', cx: cropRect.x, cy: cropRect.y },
    { pos: 'ne', cx: cropRect.x + cropRect.w, cy: cropRect.y },
    { pos: 'sw', cx: cropRect.x, cy: cropRect.y + cropRect.h },
    { pos: 'se', cx: cropRect.x + cropRect.w, cy: cropRect.y + cropRect.h },
  ] : [];

  return (
    <div
      className="absolute inset-0"
      style={{ cursor: 'crosshair', zIndex: 5 }}
      onMouseDown={handleBgMouseDown}
    >
      {cropRect && cropRect.w > 0 && (
        <>
          {/* Gray mask */}
          <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }} preserveAspectRatio="none" viewBox="0 0 1 1">
            <defs>
              <mask id="crop-mask-editor">
                <rect x="0" y="0" width="1" height="1" fill="white" />
                <rect x={cropRect.x} y={cropRect.y} width={cropRect.w} height={cropRect.h} fill="black" />
              </mask>
            </defs>
            <rect x="0" y="0" width="1" height="1" fill="rgba(0,0,0,0.5)" mask="url(#crop-mask-editor)" />
            <rect x={cropRect.x} y={cropRect.y} width={cropRect.w} height={cropRect.h}
              fill="none" stroke="#3b82f6" strokeWidth="0.003" />
          </svg>
          {/* Move area */}
          <div
            data-crop-area="move"
            onMouseDown={handleMove}
            style={{
              position: 'absolute',
              left: `${cropRect.x * 100}%`, top: `${cropRect.y * 100}%`,
              width: `${cropRect.w * 100}%`, height: `${cropRect.h * 100}%`,
              cursor: 'move', zIndex: 6,
            }}
          />
          {/* Corner handles */}
          {handles.map(({ pos, cx, cy }) => (
            <div
              key={pos}
              data-crop-area="handle"
              onMouseDown={(e) => handleResize(pos, e)}
              style={{
                position: 'absolute',
                left: `calc(${cx * 100}% - ${HANDLE_SIZE / 2}px)`,
                top: `calc(${cy * 100}% - ${HANDLE_SIZE / 2}px)`,
                width: HANDLE_SIZE, height: HANDLE_SIZE,
                backgroundColor: '#3b82f6', border: '1.5px solid white',
                borderRadius: 2, cursor: HANDLE_CURSORS[pos], zIndex: 10,
              }}
            />
          ))}
        </>
      )}
      {/* Hint when no crop */}
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

  // Crop state
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const cropContainerRef = useRef<HTMLDivElement>(null);

  const plotlyDivRef = useRef<HTMLDivElement>(null);
  const initRef = useRef<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const codeRef = useRef('');
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist local state to board store (debounced)
  const persistToStore = useCallback(() => {
    if (!elementId) return;
    const el = useBoardStore.getState().board?.elements.find(e => e.id === elementId);
    if (!el) return;
    const code = codeRef.current;
    const changed =
      code !== el.metadata?.code ||
      localOutput !== el.metadata?.lastOutput ||
      localStdout !== el.metadata?.lastStdout ||
      localError !== el.metadata?.lastError;
    if (changed) {
      updateElement(elementId, {
        metadata: { ...el.metadata, code, lastOutput: localOutput, lastStdout: localStdout, lastError: localError },
      });
    }
  }, [elementId, localOutput, localStdout, localError, updateElement]);

  const schedulePersist = useCallback(() => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => persistToStore(), 2000);
  }, [persistToStore]);

  // Sync local state when opening for a (possibly different) element
  useEffect(() => {
    if (elementId && element && initRef.current !== elementId) {
      initRef.current = elementId;
      const code = element.metadata?.code || '';
      setLocalCode(code); codeRef.current = code;
      setLocalOutput(element.metadata?.lastOutput || null);
      setLocalStdout(element.metadata?.lastStdout || null);
      setLocalError(element.metadata?.lastError || null);
      setCropRect(element.metadata?.plotCrop || null);
      setCapturedImage(null);
      setPlotlyJson(element.metadata?.plotlyJson || null);
      setIsRunning(false); setHasRun(false); setExecutionId(null);
    }
  }, [elementId, element]);

  // Setup CodeMirror editor
  useEffect(() => {
    if (!editorRef.current || !elementId) return;
    if (viewRef.current) { viewRef.current.destroy(); viewRef.current = null; }

    const runKeymap = keymap.of([
      { key: 'Mod-Enter', run: () => { handleRunRef.current(); return true; } },
      { key: 'Escape', run: () => { handleCloseRef.current(); return true; } },
      { key: 'Shift-Tab', run: (view) => { indentLess(view); return true; } },
    ]);

    const extensions = [
      lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(),
      history(), indentOnInput(), bracketMatching(), python(),
      syntaxHighlighting(defaultHighlightStyle),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      runKeymap,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const newCode = update.state.doc.toString();
          codeRef.current = newCode; setLocalCode(newCode); schedulePersist();
        }
      }),
      EditorView.theme({
        '&': { height: '100%', fontSize: '12px' },
        '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' },
        '.cm-content': { padding: '8px 0' },
        '.cm-gutters': { borderRight: 'none' },
      }),
    ];
    if (isDark) extensions.push(oneDark);
    else extensions.push(EditorView.theme({ '.cm-gutters': { backgroundColor: '#f8f9fa', color: '#999' } }));

    const state = EditorState.create({ doc: codeRef.current, extensions });
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
    setLocalError(null); setLocalStdout(null); setCapturedImage(null);

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
    } finally {
      setIsRunning(false); setHasRun(true); setExecutionId(null);
    }
  }, [elementId, isRunning]);

  const handleAbort = useCallback(async () => {
    if (executionId) { try { await api.abortPlot(executionId); } catch {} }
  }, [executionId]);

  // Capture: snapshot plotly at current angle → enter crop mode
  const handleCapture = useCallback(async () => {
    if (!plotlyDivRef.current) return;
    try {
      const dataUrl = await Plotly.toImage(plotlyDivRef.current, {
        format: 'png', width: 800, height: 700, scale: captureDpi,
      });
      setCapturedImage(dataUrl.replace(/^data:image\/png;base64,/, ''));
    } catch (e) {
      console.warn('[PlotEditor] Capture failed:', e);
    }
  }, [captureDpi]);

  // Apply crop to a base64 image and return cropped base64
  const applyCrop = useCallback((base64: string, crop: CropRect): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const sx = Math.round(crop.x * img.width), sy = Math.round(crop.y * img.height);
        const sw = Math.round(crop.w * img.width), sh = Math.round(crop.h * img.height);
        const canvas = document.createElement('canvas');
        canvas.width = sw; canvas.height = sh;
        canvas.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        resolve(canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''));
      };
      img.src = `data:image/png;base64,${base64}`;
    });
  }, []);

  const handleClose = useCallback(async () => {
    if (persistTimerRef.current) { clearTimeout(persistTimerRef.current); persistTimerRef.current = null; }

    // Capture plotly view if interactive
    let finalImage = capturedImage || localOutput;
    if (plotlyJson && plotlyDivRef.current) {
      try {
        const dataUrl = await Plotly.toImage(plotlyDivRef.current, { format: 'png', width: 800, height: 700, scale: captureDpi });
        finalImage = dataUrl.replace(/^data:image\/png;base64,/, '');
      } catch {}
    }

    // Apply crop
    let croppedOutput = finalImage;
    if (finalImage && cropRect && cropRect.w > 0.02 && cropRect.h > 0.02) {
      try { croppedOutput = await applyCrop(finalImage, cropRect); } catch {}
    }

    if (elementId) {
      const el = useBoardStore.getState().board?.elements.find(e => e.id === elementId);
      if (el) {
        const updates: Record<string, any> = {
          metadata: {
            ...el.metadata, code: codeRef.current,
            lastOutput: croppedOutput, lastStdout: localStdout, lastError: localError,
            plotCrop: cropRect, plotlyJson: plotlyJson,
          },
        };
        if (croppedOutput && croppedOutput !== el.metadata?.lastOutput) {
          try {
            const img = new Image();
            img.src = `data:image/png;base64,${croppedOutput}`;
            await new Promise<void>((resolve) => { img.onload = () => resolve(); img.onerror = () => resolve(); });
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              updates.height = Math.round(el.width * (img.naturalHeight / img.naturalWidth));
            }
          } catch {}
        }
        updateElement(elementId, updates);
        pushHistory('Edit plot');
      }
    }
    initRef.current = null;
    useUIStore.getState().setPlotEditorElementId(null);
  }, [elementId, localOutput, localStdout, localError, plotlyJson, cropRect, capturedImage, captureDpi, updateElement, pushHistory, applyCrop]);

  // Render plotly figure interactively
  useEffect(() => {
    if (!plotlyJson || !plotlyDivRef.current) return;
    try {
      const spec = JSON.parse(plotlyJson);
      Plotly.react(plotlyDivRef.current, spec.data || [], {
        ...(spec.layout || {}), autosize: true,
        margin: spec.layout?.margin || { l: 0, r: 0, t: 30, b: 0 },
      }, { responsive: true, displayModeBar: true, modeBarButtonsToRemove: ['sendDataToCloud', 'toImage'] });
    } catch (e) { console.warn('[PlotEditor] Failed to render plotly:', e); }
    return () => { if (plotlyDivRef.current) Plotly.purge(plotlyDivRef.current); };
  }, [plotlyJson]);

  handleRunRef.current = handleRun;
  handleCloseRef.current = handleClose;

  useEffect(() => { return () => { if (persistTimerRef.current) clearTimeout(persistTimerRef.current); }; }, []);

  if (!elementId || !element) return null;

  const showInteractive = !!plotlyJson && !capturedImage;
  const showCropUI = !!capturedImage;
  const showStaticImage = !plotlyJson && !capturedImage && !!localOutput;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/30" onClick={(e) => {
      // Suppress close if crop overlay just handled a drag
      if ((CropOverlay as any)._suppressClick?.current) return;
      handleClose();
    }}>
      <div
        className="m-6 flex-1 flex flex-col bg-surface-primary rounded-lg shadow-2xl overflow-hidden border border-border"
        onClick={e => e.stopPropagation()}
      >
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
              style={{ backgroundColor: isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.75)', border: isDark ? '1px solid rgba(239,68,68,0.35)' : '1px solid rgba(239,68,68,0.45)' }}
              title="Stop execution">
              <Square size={10} fill="currentColor" /> Stop
            </button>
          ) : (
            <button onClick={handleRun}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md text-green-100"
              style={{ backgroundColor: isDark ? 'rgba(34,197,94,0.2)' : 'rgba(74,186,120,0.75)', border: isDark ? '1px solid rgba(34,197,94,0.35)' : '1px solid rgba(74,186,120,0.45)', boxShadow: isDark ? '0 0 8px rgba(34,197,94,0.1)' : '0 0 6px rgba(22,163,74,0.15)' }}
              title="Run (Cmd+Enter)">
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
          {/* Code editor */}
          <div className="w-1/2 flex flex-col border-r border-border">
            <div className="px-3 py-1.5 border-b border-border bg-inspector-section shrink-0">
              <span className="text-2xs font-semibold text-on-surface-muted uppercase tracking-wider">Code</span>
            </div>
            <div ref={editorRef} className="flex-1 overflow-hidden" style={{ minHeight: 0 }} />
          </div>

          {/* Output panel */}
          <div className="w-1/2 flex flex-col">
            <div className="px-3 py-1.5 border-b border-border bg-inspector-section shrink-0 flex items-center gap-2">
              <span className="text-2xs font-semibold text-on-surface-muted uppercase tracking-wider">Output</span>
              <div className="flex-1" />

              {/* Resolution selector */}
              {plotlyJson && (
                <div className="flex items-center gap-1">
                  <span className="text-2xs text-on-surface-muted">Resolution:</span>
                  {([1, 2, 3] as const).map(d => (
                    <button key={d} onClick={() => setCaptureDpi(d)} title={`${800 * d} × ${700 * d} px`}
                      className={`px-1 py-0.5 text-2xs rounded transition-colors ${captureDpi === d ? 'bg-blue-500 text-white' : 'text-on-surface-muted hover:bg-toolbar-hover'}`}
                    >{d === 1 ? 'Low' : d === 2 ? 'Med' : 'High'}</button>
                  ))}
                </div>
              )}

              {/* Capture / crop controls */}
              {plotlyJson && !capturedImage && (
                <button onClick={handleCapture}
                  className="flex items-center gap-1 px-1.5 py-0.5 text-2xs text-on-surface-secondary hover:text-on-surface-primary hover:bg-toolbar-hover rounded transition-colors"
                  title="Capture current view and crop">
                  <Camera size={10} /> Capture & Crop
                </button>
              )}
              {capturedImage && (
                <>
                  {cropRect && (
                    <button onClick={() => setCapturedImage(null)}
                      className="flex items-center gap-1 px-2 py-0.5 text-2xs font-medium text-white rounded" style={{ backgroundColor: '#3b82f6' }}
                      title="Apply crop and return to interactive">
                      <Check size={10} /> Apply Crop
                    </button>
                  )}
                  <button onClick={() => { setCapturedImage(null); }}
                    className="flex items-center gap-1 px-1.5 py-0.5 text-2xs text-on-surface-secondary hover:text-on-surface-primary hover:bg-toolbar-hover rounded transition-colors"
                    title="Back to interactive view">
                    <RotateCcw size={10} /> Back
                  </button>
                  {cropRect && (
                    <button onClick={() => { setCropRect(null); setCapturedImage(null); }}
                      className="flex items-center gap-1 px-1.5 py-0.5 text-2xs text-red-500 hover:text-red-600 hover:bg-toolbar-hover rounded transition-colors" title="Clear crop">
                      <X size={10} /> Clear
                    </button>
                  )}
                </>
              )}
            </div>

            <div className="flex-1 overflow-hidden bg-surface-primary flex flex-col min-h-0">
              {isRunning ? (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="flex items-center gap-2 text-sm text-on-surface-muted"><Loader2 size={18} className="animate-spin" /> Executing...</div>
                </div>
              ) : (
                <>
                  {/* Interactive plotly with optional crop overlay */}
                  {showInteractive && (
                    <div className="flex-1 min-h-0 relative">
                      <div ref={plotlyDivRef} className="absolute inset-0" />
                      {/* Show crop overlay on interactive view (display only, no interaction) */}
                      {cropRect && cropRect.w > 0.02 && (
                        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 10 }}>
                          <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 1 1">
                            <defs><mask id="crop-mask-interactive">
                              <rect x="0" y="0" width="1" height="1" fill="white" />
                              <rect x={cropRect.x} y={cropRect.y} width={cropRect.w} height={cropRect.h} fill="black" />
                            </mask></defs>
                            <rect x="0" y="0" width="1" height="1" fill="rgba(0,0,0,0.4)" mask="url(#crop-mask-interactive)" />
                            <rect x={cropRect.x} y={cropRect.y} width={cropRect.w} height={cropRect.h}
                              fill="none" stroke="#3b82f6" strokeWidth="0.003" strokeDasharray="0.01 0.005" />
                          </svg>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Crop UI: static captured image with interactive crop overlay */}
                  {showCropUI && capturedImage && (
                    <div className="flex-1 min-h-0 relative" ref={cropContainerRef}>
                      <img
                        src={`data:image/png;base64,${capturedImage}`}
                        alt="Captured view"
                        className="absolute inset-0 w-full h-full"
                        style={{ objectFit: 'contain' }}
                        draggable={false}
                      />
                      <CropOverlay
                        cropRect={cropRect}
                        onCropChange={setCropRect}
                        containerRef={cropContainerRef}
                      />
                    </div>
                  )}

                  {/* Static plot image (matplotlib or no plotly) */}
                  {showStaticImage && (
                    <div className="flex-1 flex items-center justify-center p-4 min-h-0">
                      <img src={`data:image/png;base64,${localOutput}`} alt="Plot output" className="max-w-full max-h-full object-contain" draggable={false} />
                    </div>
                  )}

                  {/* Stdout */}
                  {localStdout && (
                    <div className={`border-t border-border ${!showInteractive && !showCropUI && !showStaticImage ? 'flex-1' : ''}`}>
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
                  {localError && (
                    <div className={`border-t border-border ${!showInteractive && !showCropUI && !showStaticImage && !localStdout ? 'flex-1 flex items-start' : ''}`}>
                      <pre className="p-4 text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap break-words w-full"
                        style={{ fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' }}>
                        {localError}
                      </pre>
                    </div>
                  )}

                  {/* Empty state */}
                  {!showInteractive && !showCropUI && !showStaticImage && !localStdout && !localError && (
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
                            <p className="opacity-80">Use <code className="bg-surface-secondary rounded px-1">print()</code> for debugging — output appears in the Console panel below.</p>
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
