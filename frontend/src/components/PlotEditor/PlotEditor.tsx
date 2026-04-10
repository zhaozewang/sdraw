import { useState, useCallback, useRef, useEffect } from 'react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import { api } from '@/api/client';
import { Play, Square, Loader2, X, Code2, Camera, Crop, RotateCcw } from 'lucide-react';
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

/** Overlay that positions the crop rectangle over the actual rendered image area (respects object-contain) */
function CropOverlay({ imageRef, cropRect, isCropping }: {
  imageRef: React.RefObject<HTMLImageElement | null>;
  cropRect: CropRect | null;
  isCropping: boolean;
}) {
  const [style, setStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    const update = () => {
      const img = imageRef.current;
      if (!img || !img.parentElement) return;
      const parent = img.parentElement.getBoundingClientRect();
      const nat = { w: img.naturalWidth, h: img.naturalHeight };
      if (!nat.w || !nat.h) return;
      const imgAspect = nat.w / nat.h;
      const containerAspect = parent.width / parent.height;
      let rw: number, rh: number;
      if (imgAspect > containerAspect) {
        rw = parent.width;
        rh = parent.width / imgAspect;
      } else {
        rh = parent.height;
        rw = parent.height * imgAspect;
      }
      setStyle({
        position: 'absolute',
        left: (parent.width - rw) / 2,
        top: (parent.height - rh) / 2,
        width: rw,
        height: rh,
        pointerEvents: 'none',
      });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [imageRef, cropRect, isCropping]);

  if (!cropRect || cropRect.w <= 0) return null;

  return (
    <div style={style}>
      <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 1 1">
        <defs>
          <mask id="crop-mask-static">
            <rect x="0" y="0" width="1" height="1" fill="white" />
            <rect x={cropRect.x} y={cropRect.y} width={cropRect.w} height={cropRect.h} fill="black" />
          </mask>
        </defs>
        <rect x="0" y="0" width="1" height="1" fill="rgba(0,0,0,0.5)" mask="url(#crop-mask-static)" />
        <rect x={cropRect.x} y={cropRect.y} width={cropRect.w} height={cropRect.h}
          fill="none" stroke="#3b82f6" strokeWidth="0.003" />
      </svg>
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
  const [localOutput, setLocalOutput] = useState<string | null>(null); // full uncropped base64
  const [localStdout, setLocalStdout] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [plotlyJson, setPlotlyJson] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [captureDpi, setCaptureDpi] = useState(2);

  // Crop state
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [isCropping, setIsCropping] = useState(false); // actively dragging crop
  const [cropStart, setCropStart] = useState<{ x: number; y: number } | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null); // full capture for crop UI

  const plotlyDivRef = useRef<HTMLDivElement>(null);
  const cropContainerRef = useRef<HTMLDivElement>(null);
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
        metadata: {
          ...el.metadata,
          code,
          lastOutput: localOutput,
          lastStdout: localStdout,
          lastError: localError,
        },
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
      setLocalCode(code);
      codeRef.current = code;
      setLocalOutput(element.metadata?.lastOutput || null);
      setLocalStdout(element.metadata?.lastStdout || null);
      setLocalError(element.metadata?.lastError || null);
      setCropRect(element.metadata?.plotCrop || null);
      setCapturedImage(null);
      setPlotlyJson(element.metadata?.plotlyJson || null);
      setIsRunning(false);
      setHasRun(false);
      setExecutionId(null);
    }
  }, [elementId, element]);

  // Setup CodeMirror editor
  useEffect(() => {
    if (!editorRef.current || !elementId) return;
    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    const runKeymap = keymap.of([{
      key: 'Mod-Enter',
      run: () => { handleRunRef.current(); return true; },
    }, {
      key: 'Escape',
      run: () => { handleCloseRef.current(); return true; },
    }, {
      key: 'Shift-Tab',
      run: (view) => { indentLess(view); return true; }
    }]);

    const extensions = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),
      indentOnInput(),
      bracketMatching(),
      python(),
      syntaxHighlighting(defaultHighlightStyle),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      runKeymap,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const newCode = update.state.doc.toString();
          codeRef.current = newCode;
          setLocalCode(newCode);
          schedulePersist();
        }
      }),
      EditorView.theme({
        '&': { height: '100%', fontSize: '12px' },
        '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' },
        '.cm-content': { padding: '8px 0' },
        '.cm-gutters': { borderRight: 'none' },
      }),
    ];

    if (isDark) {
      extensions.push(oneDark);
    } else {
      extensions.push(EditorView.theme({
        '.cm-gutters': { backgroundColor: '#f8f9fa', color: '#999' },
      }));
    }

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
    setIsRunning(true);
    setExecutionId(execId);
    setLocalError(null);
    setLocalStdout(null);
    setCapturedImage(null);

    try {
      const pythonEnv = useBoardStore.getState().board?.pythonEnvPath ?? useUIStore.getState().pythonEnvPath;
      const boardPath = useBoardStore.getState().boardFilePath;
      const cwd = boardPath ? boardPath.replace(/\/[^/]+$/, '') : null;
      const result = await api.executePlot(codeRef.current, 30, 150, pythonEnv, execId, cwd);
      if (result.success) {
        setLocalOutput(result.image_base64);
        setLocalStdout(result.stdout);
        setLocalError(null);
        setPlotlyJson(result.plotly_json);
      } else {
        setLocalOutput(result.image_base64);
        setLocalStdout(result.stdout);
        setLocalError(result.error);
        setPlotlyJson(result.plotly_json);
      }
    } catch (err: any) {
      if (!String(err).includes('abort')) {
        setLocalError(String(err));
      }
    } finally {
      setIsRunning(false);
      setHasRun(true);
      setExecutionId(null);
    }
  }, [elementId, isRunning]);

  const handleAbort = useCallback(async () => {
    if (executionId) {
      try { await api.abortPlot(executionId); } catch {}
    }
  }, [executionId]);

  // Capture: snapshot plotly at current angle → enter crop mode
  const handleCapture = useCallback(async () => {
    if (!plotlyDivRef.current) return;
    try {
      const dataUrl = await Plotly.toImage(plotlyDivRef.current, {
        format: 'png', width: 800, height: 700, scale: captureDpi,
      });
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
      setCapturedImage(base64);
      setIsCropping(true);
    } catch (e) {
      console.warn('[PlotEditor] Capture failed:', e);
    }
  }, [captureDpi]);

  // Get the actual rendered image bounds within its container (accounts for object-contain)
  const cropImageRef = useRef<HTMLImageElement>(null);
  const getImageRect = useCallback((): DOMRect | null => {
    const img = cropImageRef.current;
    if (!img || !img.naturalWidth || !img.naturalHeight) return null;
    const containerRect = img.getBoundingClientRect();
    const imgAspect = img.naturalWidth / img.naturalHeight;
    const containerAspect = containerRect.width / containerRect.height;
    let renderW: number, renderH: number, offsetX: number, offsetY: number;
    if (imgAspect > containerAspect) {
      // Image is wider — fits width, has vertical gaps
      renderW = containerRect.width;
      renderH = containerRect.width / imgAspect;
      offsetX = 0;
      offsetY = (containerRect.height - renderH) / 2;
    } else {
      // Image is taller — fits height, has horizontal gaps
      renderH = containerRect.height;
      renderW = containerRect.height * imgAspect;
      offsetX = (containerRect.width - renderW) / 2;
      offsetY = 0;
    }
    return new DOMRect(
      containerRect.left + offsetX,
      containerRect.top + offsetY,
      renderW,
      renderH,
    );
  }, []);

  // Use a ref for cropRect so mouseUp always reads the latest value
  const cropRectRef = useRef<CropRect | null>(null);
  cropRectRef.current = cropRect;
  const cropStartRef = useRef<{ x: number; y: number } | null>(null);
  cropStartRef.current = cropStart;

  // Crop drag handlers — coordinates relative to the image, not the container
  const handleCropMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = getImageRect();
    if (!rect) return;
    e.preventDefault();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setCropStart({ x, y });
    setCropRect({ x, y, w: 0, h: 0 });
    setIsCropping(true);
  }, [getImageRect]);

  const handleCropMouseMove = useCallback((e: MouseEvent | React.MouseEvent) => {
    const start = cropStartRef.current;
    if (!start) return;
    const rect = getImageRect();
    if (!rect) return;
    const x2 = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y2 = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setCropRect({
      x: Math.min(start.x, x2),
      y: Math.min(start.y, y2),
      w: Math.abs(x2 - start.x),
      h: Math.abs(y2 - start.y),
    });
  }, [getImageRect]);

  const handleCropMouseUp = useCallback(() => {
    if (!cropStartRef.current) return;
    setCropStart(null);
    setIsCropping(false);
    // Check using ref for latest value
    const cr = cropRectRef.current;
    if (cr && (cr.w < 0.01 || cr.h < 0.01)) {
      setCropRect(null);
    }
  }, []);

  // Attach mousemove/mouseup to document while cropping so dragging outside works
  useEffect(() => {
    if (!isCropping) return;
    const onMove = (e: MouseEvent) => handleCropMouseMove(e);
    const onUp = () => handleCropMouseUp();
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [isCropping, handleCropMouseMove, handleCropMouseUp]);

  const clearCrop = useCallback(() => {
    setCropRect(null);
    setCapturedImage(null);
  }, []);

  // Apply crop to a base64 image and return cropped base64
  const applyCrop = useCallback((base64: string, crop: CropRect): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const sx = Math.round(crop.x * img.width);
        const sy = Math.round(crop.y * img.height);
        const sw = Math.round(crop.w * img.width);
        const sh = Math.round(crop.h * img.height);
        const canvas = document.createElement('canvas');
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        resolve(canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''));
      };
      img.src = `data:image/png;base64,${base64}`;
    });
  }, []);

  const handleClose = useCallback(async () => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }

    // Capture plotly view if interactive figure is showing
    let finalImage = capturedImage || localOutput;
    if (plotlyJson && plotlyDivRef.current) {
      try {
        const dataUrl = await Plotly.toImage(plotlyDivRef.current, {
          format: 'png', width: 800, height: 700, scale: captureDpi,
        });
        finalImage = dataUrl.replace(/^data:image\/png;base64,/, '');
      } catch {}
    }

    // Apply crop if set
    let croppedOutput = finalImage;
    if (finalImage && cropRect && cropRect.w > 0.02 && cropRect.h > 0.02) {
      try {
        croppedOutput = await applyCrop(finalImage, cropRect);
      } catch {}
    }

    if (elementId) {
      const el = useBoardStore.getState().board?.elements.find(e => e.id === elementId);
      if (el) {
        const code = codeRef.current;
        // If we have a new image output, match the node aspect ratio to the image
        const updates: Record<string, any> = {
          metadata: {
            ...el.metadata,
            code,
            lastOutput: croppedOutput,
            lastStdout: localStdout,
            lastError: localError,
            plotCrop: cropRect,
            plotlyJson: plotlyJson,
          },
        };
        // Adjust element size to match image aspect ratio (keep width, adjust height)
        if (croppedOutput && croppedOutput !== el.metadata?.lastOutput) {
          try {
            const img = new Image();
            img.src = `data:image/png;base64,${croppedOutput}`;
            // Use naturalWidth/Height if loaded, otherwise estimate from base64
            await new Promise<void>((resolve) => { img.onload = () => resolve(); img.onerror = () => resolve(); });
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              const ratio = img.naturalHeight / img.naturalWidth;
              updates.height = Math.round(el.width * ratio);
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
      const data = spec.data || [];
      const layout = {
        ...(spec.layout || {}),
        autosize: true,
        margin: spec.layout?.margin || { l: 0, r: 0, t: 30, b: 0 },
      };
      Plotly.react(plotlyDivRef.current, data, layout, {
        responsive: true,
        displayModeBar: true,
        modeBarButtonsToRemove: ['sendDataToCloud', 'toImage'],
      });
    } catch (e) {
      console.warn('[PlotEditor] Failed to render plotly:', e);
    }
    return () => {
      if (plotlyDivRef.current) {
        Plotly.purge(plotlyDivRef.current);
      }
    };
  }, [plotlyJson]);

  handleRunRef.current = handleRun;
  handleCloseRef.current = handleClose;

  useEffect(() => {
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, []);

  if (!elementId || !element) return null;

  const showInteractive = !!plotlyJson && !capturedImage;
  const showCropUI = !!capturedImage;
  const showStaticImage = !plotlyJson && !capturedImage && !!localOutput;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/30" onClick={handleClose}>
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
            <button
              onClick={handleAbort}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-all text-red-100"
              style={{
                backgroundColor: isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.75)',
                border: isDark ? '1px solid rgba(239,68,68,0.35)' : '1px solid rgba(239,68,68,0.45)',
              }}
              title="Stop execution"
            >
              <Square size={10} fill="currentColor" /> Stop
            </button>
          ) : (
            <button
              onClick={handleRun}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-all text-green-100"
              style={{
                backgroundColor: isDark ? 'rgba(34,197,94,0.2)' : 'rgba(74,186,120,0.75)',
                border: isDark ? '1px solid rgba(34,197,94,0.35)' : '1px solid rgba(74,186,120,0.45)',
                boxShadow: isDark ? '0 0 8px rgba(34,197,94,0.1)' : '0 0 6px rgba(22,163,74,0.15)',
              }}
              title="Run (Cmd+Enter)"
            >
              <Play size={12} /> Run
            </button>
          )}

          <span className="text-2xs text-on-surface-muted select-none">
            {isRunning ? 'Running...' : 'Cmd+Enter'}
          </span>

          <div className="flex-1" />

          <span className="text-2xs text-on-surface-muted select-none">Esc to close</span>
          <button
            onClick={handleClose}
            className="p-1 text-on-surface-muted hover:text-on-surface-primary hover:bg-toolbar-hover rounded transition-colors"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body: code left, output right */}
        <div className="flex-1 flex min-h-0">
          {/* Code editor */}
          <div className="w-1/2 flex flex-col border-r border-border">
            <div className="px-3 py-1.5 border-b border-border bg-inspector-section shrink-0">
              <span className="text-2xs font-semibold text-on-surface-muted uppercase tracking-wider">Code</span>
            </div>
            <div
              ref={editorRef}
              className="flex-1 overflow-hidden"
              style={{ minHeight: 0 }}
            />
          </div>

          {/* Output panel */}
          <div className="w-1/2 flex flex-col">
            <div className="px-3 py-1.5 border-b border-border bg-inspector-section shrink-0 flex items-center gap-2">
              <span className="text-2xs font-semibold text-on-surface-muted uppercase tracking-wider">Output</span>
              <div className="flex-1" />

              {/* DPI selector */}
              {plotlyJson && (
                <div className="flex items-center gap-1">
                  <span className="text-2xs text-on-surface-muted">Resolution:</span>
                  {([1, 2, 3] as const).map(d => (
                    <button
                      key={d}
                      onClick={() => setCaptureDpi(d)}
                      title={`${800 * d} × ${700 * d} px`}
                      className={`px-1 py-0.5 text-2xs rounded transition-colors ${
                        captureDpi === d
                          ? 'bg-blue-500 text-white'
                          : 'text-on-surface-muted hover:bg-toolbar-hover'
                      }`}
                    >{d === 1 ? 'Low' : d === 2 ? 'Med' : 'High'}</button>
                  ))}
                </div>
              )}

              {/* Capture / crop controls */}
              {plotlyJson && !capturedImage && (
                <button
                  onClick={handleCapture}
                  className="flex items-center gap-1 px-1.5 py-0.5 text-2xs text-on-surface-secondary hover:text-on-surface-primary hover:bg-toolbar-hover rounded transition-colors"
                  title="Capture current view and crop"
                >
                  <Camera size={10} /> Capture & Crop
                </button>
              )}
              {capturedImage && (
                <>
                  <button
                    onClick={() => setCapturedImage(null)}
                    className="flex items-center gap-1 px-1.5 py-0.5 text-2xs text-on-surface-secondary hover:text-on-surface-primary hover:bg-toolbar-hover rounded transition-colors"
                    title="Back to interactive view"
                  >
                    <RotateCcw size={10} /> Back to Interactive
                  </button>
                  {cropRect && (
                    <button
                      onClick={clearCrop}
                      className="flex items-center gap-1 px-1.5 py-0.5 text-2xs text-red-500 hover:text-red-600 hover:bg-toolbar-hover rounded transition-colors"
                      title="Clear crop"
                    >
                      <X size={10} /> Clear Crop
                    </button>
                  )}
                </>
              )}
            </div>

            <div className="flex-1 overflow-auto bg-surface-primary flex flex-col">
              {isRunning ? (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="flex items-center gap-2 text-sm text-on-surface-muted">
                    <Loader2 size={18} className="animate-spin" />
                    Executing...
                  </div>
                </div>
              ) : (
                <>
                  {/* Interactive plotly with optional crop overlay */}
                  {showInteractive && (
                    <div className="flex-1 min-h-0 relative">
                      <div ref={plotlyDivRef} className="absolute inset-0" />
                      {/* Crop overlay on interactive view */}
                      {cropRect && cropRect.w > 0.02 && (
                        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 10 }}>
                          {/* Gray overlay with cutout */}
                          <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 1 1">
                            <defs>
                              <mask id="crop-mask">
                                <rect x="0" y="0" width="1" height="1" fill="white" />
                                <rect x={cropRect.x} y={cropRect.y} width={cropRect.w} height={cropRect.h} fill="black" />
                              </mask>
                            </defs>
                            <rect x="0" y="0" width="1" height="1" fill="rgba(0,0,0,0.4)" mask="url(#crop-mask)" />
                            <rect x={cropRect.x} y={cropRect.y} width={cropRect.w} height={cropRect.h}
                              fill="none" stroke="#3b82f6" strokeWidth="0.003" strokeDasharray="0.01 0.005" />
                          </svg>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Crop UI: static image with drag-to-crop */}
                  {showCropUI && capturedImage && (
                    <div
                      className="flex-1 min-h-0 relative select-none overflow-hidden"
                      style={{ cursor: 'crosshair' }}
                      onMouseDown={handleCropMouseDown}
                    >
                      <img
                        ref={cropImageRef}
                        src={`data:image/png;base64,${capturedImage}`}
                        alt="Captured view"
                        className="absolute inset-0 w-full h-full"
                        style={{ objectFit: 'contain' }}
                        draggable={false}
                      />
                      {/* Crop overlay — uses CropOverlay to position over actual image area */}
                      <CropOverlay imageRef={cropImageRef} cropRect={cropRect} isCropping={isCropping} />
                      {!cropRect && !isCropping && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="bg-black/60 text-white text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5">
                            <Crop size={12} /> Drag to select crop region
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Static plot image (matplotlib or no plotly) */}
                  {showStaticImage && (
                    <div className="flex-1 flex items-center justify-center p-4 min-h-0">
                      <img
                        src={`data:image/png;base64,${localOutput}`}
                        alt="Plot output"
                        className="max-w-full max-h-full object-contain"
                        draggable={false}
                      />
                    </div>
                  )}

                  {/* Stdout */}
                  {localStdout && (
                    <div className={`border-t border-border ${!showInteractive && !showCropUI && !showStaticImage ? 'flex-1' : ''}`}>
                      <div className="px-3 py-1 bg-inspector-section border-b border-border">
                        <span className="text-2xs font-semibold text-on-surface-muted uppercase tracking-wider">Console</span>
                      </div>
                      <pre
                        className="p-3 text-xs text-on-surface-primary whitespace-pre-wrap break-words overflow-auto max-h-[200px]"
                        style={{ fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' }}
                      >
                        {localStdout}
                      </pre>
                    </div>
                  )}

                  {/* Error */}
                  {localError && (
                    <div className={`border-t border-border ${!showInteractive && !showCropUI && !showStaticImage && !localStdout ? 'flex-1 flex items-start' : ''}`}>
                      <pre
                        className="p-4 text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap break-words w-full"
                        style={{ fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' }}
                      >
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
