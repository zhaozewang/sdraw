import { useState, useCallback, useRef, useEffect } from 'react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import { api } from '@/api/client';
import { Play, Square, Loader2, X, Crop, Check, Save, Braces } from 'lucide-react';
import { CodeMirrorEditor } from '@/components/shared/CodeMirrorEditor';
import Plotly from 'plotly.js-dist-min';

import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine } from '@codemirror/view';
import { EditorState, Prec } from '@codemirror/state';
import { python } from '@codemirror/lang-python';
import { indentWithTab } from '@codemirror/commands';
import { defaultKeymap, history, historyKeymap, indentMore, indentLess } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching, indentUnit } from '@codemirror/language';
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
// aspectRatio: w/h ratio to enforce (null = free), expressed in container fraction space.
// Since crop fractions are image-relative, the aspect ratio needs to account for the
// container's pixel dimensions to convert between fraction-space and pixel-space.
const HS = 8;
type Dir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const DC: Record<Dir, string> = { nw:'nwse-resize', n:'ns-resize', ne:'nesw-resize', e:'ew-resize', se:'nwse-resize', s:'ns-resize', sw:'nesw-resize', w:'ew-resize' };

function CropEditor({ cropRect, onChange, containerRef, aspectRatio }: {
  cropRect: CropRect | null; onChange: (r: CropRect | null) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  aspectRatio?: number | null; // w/h in pixels. null = free
}) {
  const cr = useRef(cropRect); cr.current = cropRect;
  const toF = useCallback((e: MouseEvent | React.MouseEvent) => {
    const el = containerRef.current; if (!el) return { fx: 0, fy: 0 };
    const r = el.getBoundingClientRect();
    return { fx: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), fy: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
  }, [containerRef]);

  // Convert pixel aspect ratio to fraction-space ratio
  // fraction w/h ratio = (pixelRatio) * (containerH / containerW)
  const getFracRatio = useCallback(() => {
    if (!aspectRatio) return null;
    const el = containerRef.current;
    if (!el) return aspectRatio;
    const r = el.getBoundingClientRect();
    return aspectRatio * (r.height / r.width);
  }, [aspectRatio, containerRef]);

  // Enforce aspect ratio: given a width in fraction space, compute height
  const enforceAR = useCallback((w: number, h: number): { w: number; h: number } => {
    const fr = getFracRatio();
    if (!fr) return { w, h };
    // Use the larger dimension to constrain
    const hFromW = w / fr;
    const wFromH = h * fr;
    if (hFromW <= 1 && hFromW >= 0.01) return { w, h: hFromW };
    return { w: wFromH, h };
  }, [getFracRatio]);

  const drag = useCallback((onM: (ev: MouseEvent) => void, onD?: () => void) => {
    const m = (ev: MouseEvent) => { ev.preventDefault(); onM(ev); };
    const u = () => { document.removeEventListener('mousemove', m); document.removeEventListener('mouseup', u); onD?.(); };
    document.addEventListener('mousemove', m); document.addEventListener('mouseup', u);
  }, []);

  // Draw new crop
  const onBg = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).dataset.crop) return; e.preventDefault();
    const { fx, fy } = toF(e); const sx = fx, sy = fy;
    onChange({ x: fx, y: fy, w: 0, h: 0 });
    drag((ev) => {
      const { fx: mx, fy: my } = toF(ev);
      let w = Math.abs(mx - sx), h = Math.abs(my - sy);
      const ar = enforceAR(w, h);
      w = ar.w; h = ar.h;
      const x = mx >= sx ? sx : sx - w;
      const y = my >= sy ? sy : sy - h;
      onChange({ x: Math.max(0, x), y: Math.max(0, y), w, h });
    }, () => { const c = cr.current; if (c && (c.w < 0.01 || c.h < 0.01)) onChange(null); });
  }, [toF, onChange, drag, enforceAR]);

  // Resize from handle
  const onH = useCallback((d: Dir, e: React.MouseEvent) => {
    e.stopPropagation(); e.preventDefault(); if (!cr.current) return;
    const s = { ...cr.current }; const { fx: sx, fy: sy } = toF(e);
    const fr = getFracRatio();
    drag((ev) => {
      const { fx, fy } = toF(ev); const dx = fx - sx, dy = fy - sy;
      let { x, y, w, h } = s; const rb = s.x + s.w, bb = s.y + s.h;
      if (d.includes('w')) { x = Math.max(0, Math.min(rb - 0.02, s.x + dx)); w = rb - x; }
      if (d.includes('e')) { w = Math.max(0.02, Math.min(1 - s.x, s.w + dx)); }
      if (d.includes('n')) { y = Math.max(0, Math.min(bb - 0.02, s.y + dy)); h = bb - y; }
      if (d.includes('s')) { h = Math.max(0.02, Math.min(1 - s.y, s.h + dy)); }
      if (d === 'n' || d === 's') { x = s.x; w = s.w; }
      if (d === 'e' || d === 'w') { y = s.y; h = s.h; }
      // Enforce aspect ratio on corner drags
      if (fr && (d === 'nw' || d === 'ne' || d === 'sw' || d === 'se')) {
        h = w / fr;
        if (d === 'nw' || d === 'ne') y = bb - h;
      }
      onChange({ x, y, w, h });
    });
  }, [toF, onChange, drag, getFracRatio]);

  // Move
  const onMv = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); e.preventDefault(); if (!cr.current) return;
    const s = { ...cr.current }; const { fx: sx, fy: sy } = toF(e);
    drag((ev) => { const { fx, fy } = toF(ev); onChange({ x: Math.max(0, Math.min(1 - s.w, s.x + fx - sx)), y: Math.max(0, Math.min(1 - s.h, s.y + fy - sy)), w: s.w, h: s.h }); });
  }, [toF, onChange, drag]);

  // Only show corner handles when aspect ratio is locked (edge handles don't make sense)
  const handles: { d: Dir; x: number; y: number }[] = cropRect ? (
    aspectRatio ? [
      { d:'nw', x:cropRect.x, y:cropRect.y },
      { d:'ne', x:cropRect.x+cropRect.w, y:cropRect.y },
      { d:'se', x:cropRect.x+cropRect.w, y:cropRect.y+cropRect.h },
      { d:'sw', x:cropRect.x, y:cropRect.y+cropRect.h },
    ] : [
      { d:'nw', x:cropRect.x, y:cropRect.y }, { d:'n', x:cropRect.x+cropRect.w/2, y:cropRect.y },
      { d:'ne', x:cropRect.x+cropRect.w, y:cropRect.y }, { d:'e', x:cropRect.x+cropRect.w, y:cropRect.y+cropRect.h/2 },
      { d:'se', x:cropRect.x+cropRect.w, y:cropRect.y+cropRect.h }, { d:'s', x:cropRect.x+cropRect.w/2, y:cropRect.y+cropRect.h },
      { d:'sw', x:cropRect.x, y:cropRect.y+cropRect.h }, { d:'w', x:cropRect.x, y:cropRect.y+cropRect.h/2 },
    ]
  ) : [];

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

// ─── Crop Image View ───────────────────────────────────────────
// Shows a static snapshot centered in a dark container with the
// CropEditor overlay sized exactly to the image. Crop coordinates
// are image-relative (0-1 fractions of image dimensions).
function CropImageView({ snapshot, cropRect, onChange, isDark, aspectRatio }: {
  snapshot: string;
  cropRect: CropRect | null;
  onChange: (r: CropRect | null) => void;
  aspectRatio?: number | null;
  isDark: boolean;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const cropAreaRef = useRef<HTMLDivElement>(null);
  const [imgLayout, setImgLayout] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  // Compute the rendered image position within the container (object-contain math)
  const updateLayout = useCallback(() => {
    const wrapper = wrapperRef.current;
    const img = imgRef.current;
    if (!wrapper || !img || !img.naturalWidth) return;
    const wr = wrapper.getBoundingClientRect();
    const imgAspect = img.naturalWidth / img.naturalHeight;
    const containerAspect = wr.width / wr.height;
    let rw: number, rh: number;
    if (imgAspect > containerAspect) {
      rw = wr.width; rh = wr.width / imgAspect;
    } else {
      rh = wr.height; rw = wr.height * imgAspect;
    }
    setImgLayout({
      left: (wr.width - rw) / 2, top: (wr.height - rh) / 2,
      width: rw, height: rh,
    });
  }, []);

  useEffect(() => {
    updateLayout();
    window.addEventListener('resize', updateLayout);
    return () => window.removeEventListener('resize', updateLayout);
  }, [updateLayout, snapshot]);

  return (
    <div ref={wrapperRef} className="flex-1 min-h-0 relative overflow-hidden" style={{ backgroundColor: isDark ? '#111' : '#e5e5e5' }}>
      <img
        ref={imgRef}
        src={`data:image/png;base64,${snapshot}`}
        alt="Crop preview"
        className="absolute inset-0 w-full h-full"
        style={{ objectFit: 'contain' }}
        draggable={false}
        onLoad={updateLayout}
      />
      {/* CropEditor positioned exactly over the rendered image area */}
      {imgLayout && (
        <div ref={cropAreaRef} className="absolute" style={{
          left: imgLayout.left, top: imgLayout.top,
          width: imgLayout.width, height: imgLayout.height,
        }}>
          <CropEditor cropRect={cropRect} onChange={onChange} containerRef={cropAreaRef} aspectRatio={aspectRatio} />
        </div>
      )}
    </div>
  );
}

// ─── PlotEditor ────────────────────────────────────────────────

export function PlotEditor() {
  const elementId = useUIStore(s => s.plotEditorElementId);
  const element = useBoardStore(s => elementId ? s.board?.elements.find(el => el.id === elementId) : undefined);
  // If the user clicked a sibling (a figure-N view of another element's
  // code), resolve the code-owning source element. For legacy single-figure
  // elements with no sourceElementId this is just the element itself.
  const sourceElement = useBoardStore(s => {
    if (!element) return element;
    const srcId = element.metadata?.sourceElementId;
    if (!srcId) return element;
    return s.board?.elements.find(e => e.id === srcId) ?? element;
  });
  const sourceElementId = sourceElement?.id ?? elementId;
  const activeFigureIndex: number = element?.metadata?.figureIndex ?? 0;
  const distributePlotFigures = useBoardStore(s => s.distributePlotFigures);
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
  const saveBoard = useBoardStore(s => s.saveBoard);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [cropMode, setCropMode] = useState(false);
  const [cropSnapshot, setCropSnapshot] = useState<string | null>(null);
  const [cropAspectRatio, setCropAspectRatio] = useState<number | null>(null); // w/h pixel ratio, null = free

  // Tab within the editor: plot code or shared board-level Python setup.
  const [activeTab, setActiveTab] = useState<'plot' | 'setup'>('plot');
  const board = useBoardStore(s => s.board);
  const setSetupCode = useBoardStore(s => s.setSetupCode);
  const runSetup = useBoardStore(s => s.runSetup);
  const kernelStatus = useBoardStore(s => s.kernelStatus);
  const setupCode = board?.setup?.code ?? '';
  const hasSetupCode = setupCode.trim().length > 0;
  const [setupStdout, setSetupStdout] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [isSetupRunning, setIsSetupRunning] = useState(false);

  const handleSetupRun = useCallback(async () => {
    if (isSetupRunning) return;
    setIsSetupRunning(true);
    setSetupError(null);
    setSetupStdout(null);
    try {
      const r = await runSetup();
      setSetupStdout(r.stdout);
      setSetupError(r.ok ? null : r.error);
    } catch (err: any) {
      setSetupError(String(err));
    } finally {
      setIsSetupRunning(false);
    }
  }, [isSetupRunning, runSetup]);

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

  // Code-only persist (debounced) — only saves code changes, never touches
  // width/height/lastOutput. The Save button handles everything else.
  // Writes always go to the SOURCE element (the code owner), even if the
  // user opened the editor from a sibling reference.
  const persistCode = useCallback(() => {
    const targetId = sourceElementId;
    if (!targetId) return;
    const el = useBoardStore.getState().board?.elements.find(e => e.id === targetId);
    if (!el) return;
    const code = codeRef.current;
    if (code !== el.metadata?.code) {
      updateElement(targetId, { metadata: { ...el.metadata, code } });
    }
  }, [sourceElementId, updateElement]);
  const schedulePersist = useCallback(() => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => persistCode(), 2000);
  }, [persistCode]);

  useEffect(() => {
    if (elementId && element && initRef.current !== elementId) {
      initRef.current = elementId;
      // Code comes from the SOURCE element (owner of metadata.code).
      // For legacy single-figure elements this is the clicked element itself.
      const code = sourceElement?.metadata?.code || '';
      setLocalCode(code); codeRef.current = code;
      // Preview / stdout / error / crop come from the CLICKED element,
      // which may be a per-figure sibling with its own cached output + crop.
      setLocalOutput(element.metadata?.lastOutput || null);
      setLocalStdout(element.metadata?.lastStdout || null);
      setLocalError(element.metadata?.lastError || null);
      setCropRect(element.metadata?.plotCrop || null);
      setPlotlyJson(element.metadata?.plotlyJson || null);
      setCropMode(false); setIsRunning(false); setHasRun(false); setExecutionId(null);
      setActiveTab('plot');
      setSetupStdout(null); setSetupError(null);
    }
  }, [elementId, element, sourceElement]);

  // Keyboard shortcuts for tab switching inside the editor.
  // Use a capture-phase listener so it beats CodeMirror's own key handling.
  useEffect(() => {
    if (!elementId) return;
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === '1') {
        e.preventDefault();
        setActiveTab('plot');
      } else if (mod && e.key === '2') {
        e.preventDefault();
        setActiveTab('setup');
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [elementId]);

  // CodeMirror — follows canvas theme
  useEffect(() => {
    if (!editorRef.current || !elementId) return;
    if (viewRef.current) { viewRef.current.destroy(); viewRef.current = null; }
    const km = Prec.highest(keymap.of([
      { key: 'Mod-Enter', run: () => { handleRunRef.current(); return true; } },
      { key: 'Escape', run: () => { handleCloseRef.current(); return true; } },
      { key: 'Shift-Tab', run: (v) => { indentLess(v); return true; } },
    ]));
    const monoFont = '"JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';
    const exts = [
      km,
      lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(),
      history(), indentOnInput(), bracketMatching(), python(),
      // Python convention: 4-space indent and 4-wide tab display
      indentUnit.of('    '),
      EditorState.tabSize.of(4),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
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
      // oneDark bundles its own syntax highlighting — don't add defaultHighlightStyle
      // which is designed for light backgrounds and would override oneDark's token colors.
      exts.push(oneDark);
    } else {
      exts.push(syntaxHighlighting(defaultHighlightStyle));
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
    if (isRunning || !elementId || !sourceElementId) return;
    const execId = generateId();
    setIsRunning(true); setExecutionId(execId); setLocalError(null); setLocalStdout(null);
    try {
      const boardState = useBoardStore.getState().board;
      const env = boardState?.pythonEnvPath ?? useUIStore.getState().pythonEnvPath;
      const bp = useBoardStore.getState().boardFilePath;
      const cwd = bp ? bp.replace(/\/[^/]+$/, '') : null;
      const r = await api.executePlot(codeRef.current, 30, 150, env, execId, cwd, {
        boardId: boardState?.id,
        setupCode: boardState?.setup?.code ?? '',
        setupTimeout: boardState?.setup?.timeout ?? 120,
      });
      // Normalize to figures[]: backend always returns it now, but be
      // defensive for any legacy caller or error path.
      const figures =
        r.figures && r.figures.length > 0
          ? r.figures
          : r.image_base64 || r.plotly_json
          ? [{ image: r.image_base64, plotly_json: r.plotly_json }]
          : [];
      // Distribute across all referencing elements (source + siblings),
      // auto-spawning new siblings when figures.length grows. This also
      // updates this editor's element metadata so the next effect can pick
      // up its figure, but we also set local state immediately for snappy UX.
      await distributePlotFigures(
        sourceElementId,
        figures,
        r.stdout,
        r.success ? null : r.error,
      );
      const myFig = figures[activeFigureIndex];
      if (myFig) {
        setLocalOutput(myFig.image); setPlotlyJson(myFig.plotly_json);
        setLocalError(r.success ? null : r.error);
      } else if (figures.length > 0) {
        // The clicked element's figureIndex is past the end of the new
        // figures list. Show the missing-figure placeholder.
        setLocalOutput(null); setPlotlyJson(null);
        setLocalError(
          `Figure ${activeFigureIndex} missing: code now produces only ${figures.length} figure${figures.length === 1 ? '' : 's'}.`,
        );
      } else {
        setLocalOutput(null); setPlotlyJson(null);
        setLocalError(r.success ? null : r.error);
      }
      setLocalStdout(r.stdout);
    } catch (err: any) { if (!String(err).includes('abort')) setLocalError(String(err)); }
    finally { setIsRunning(false); setHasRun(true); setExecutionId(null); }
  }, [elementId, sourceElementId, activeFigureIndex, isRunning, distributePlotFigures]);

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
  const cropSnapshotRef = useRef(cropSnapshot);
  cropSnapshotRef.current = cropSnapshot;

  // Save: capture → crop → update node → persist to file
  const isSavingRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);

  // Helper: relayout plotly to container size, capture, restore autosize.
  // Always restores autosize even if capture fails (try/finally).
  const captureFromPlotly = useCallback(async (): Promise<string | null> => {
    if (!plotlyDivRef.current || !plotlyContainerRef.current) return null;
    try {
      const rect = plotlyContainerRef.current.getBoundingClientRect();
      await (Plotly as any).relayout(plotlyDivRef.current, {
        width: Math.round(rect.width), height: Math.round(rect.height),
      });
      try {
        const url = await Plotly.toImage(plotlyDivRef.current, { format: 'png', scale: 2 });
        return url.replace(/^data:image\/png;base64,/, '');
      } finally {
        // Always restore autosize — even if toImage throws
        await (Plotly as any).relayout(plotlyDivRef.current, {
          autosize: true, width: undefined, height: undefined,
        }).catch(() => {}); // swallow restore errors
      }
    } catch {
      return null;
    }
  }, []);

  // Save: returns true if saved successfully, false if skipped/failed
  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!elementId || isSavingRef.current) return false;
    isSavingRef.current = true;
    setIsSaving(true);
    try {
      const currentCrop = cropRectRef.current;
      const currentJson = getCurrentPlotlyJson();
      const snapshot = cropSnapshotRef.current;

      // 1. Get the full image.
      //    Snapshot exists → use it (crop fractions are relative to it).
      //    No snapshot → capture from live plotly.
      let fullB64: string | null = snapshot || await captureFromPlotly();
      if (!fullB64) fullB64 = localOutputRef.current;
      if (!fullB64) return false;

      // 2. Crop (default = full image if no user crop)
      const crop = (currentCrop && currentCrop.w > 0.02 && currentCrop.h > 0.02)
        ? currentCrop : { x: 0, y: 0, w: 1, h: 1 };

      const full = await loadImage(fullB64);
      const sx = Math.max(0, Math.round(crop.x * full.naturalWidth));
      const sy = Math.max(0, Math.round(crop.y * full.naturalHeight));
      const sw = Math.max(1, Math.min(full.naturalWidth - sx, Math.round(crop.w * full.naturalWidth)));
      const sh = Math.max(1, Math.min(full.naturalHeight - sy, Math.round(crop.h * full.naturalHeight)));
      const cvs = document.createElement('canvas');
      cvs.width = sw; cvs.height = sh;
      cvs.getContext('2d')!.drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
      const outputB64 = cvs.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');

      // 3. Get output dimensions for aspect ratio
      const out = await loadImage(outputB64);

      // 4. Cancel pending debounce, update local state
      if (persistTimerRef.current) { clearTimeout(persistTimerRef.current); persistTimerRef.current = null; }
      setLocalOutput(outputB64);

      // 5. Update element with correct dimensions and all metadata
      const el = useBoardStore.getState().board?.elements.find(e => e.id === elementId);
      if (el) {
        const newHeight = out.naturalWidth > 0
          ? Math.round(el.width * (out.naturalHeight / out.naturalWidth)) : el.height;
        updateElement(elementId, {
          width: el.width, height: newHeight,
          metadata: {
            ...el.metadata, code: codeRef.current, lastOutput: outputB64,
            lastStdout: localStdoutRef.current, lastError: localErrorRef.current,
            plotCrop: currentCrop, plotlyJson: currentJson,
          },
        });
        pushHistory('Save plot');
        await new Promise(r => setTimeout(r, 100));
        await saveBoard();
      }
      return true;
    } catch (e) {
      console.warn('[PlotEditor] save failed:', e);
      return false;
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }, [elementId, updateElement, pushHistory, getCurrentPlotlyJson, saveBoard, loadImage, captureFromPlotly]);

  // Enter crop mode: capture snapshot, then switch to crop UI
  const enterCropMode = useCallback(async () => {
    const b64 = await captureFromPlotly();
    setCropSnapshot(b64 || localOutputRef.current || null);
    setCropMode(true);
  }, [captureFromPlotly]);

  const exitCropMode = useCallback(() => {
    setCropMode(false);
    setCropSnapshot(null);
  }, []);

  // Close: guarded against closing during save
  const handleClose = useCallback(() => {
    if (isSavingRef.current) return; // don't close while saving
    if (persistTimerRef.current) { clearTimeout(persistTimerRef.current); persistTimerRef.current = null; }
    initRef.current = null; useUIStore.getState().setPlotEditorElementId(null);
  }, []);

  // Save & Close: only close if save succeeded
  const handleSaveAndClose = useCallback(async () => {
    const saved = await handleSave();
    if (saved) handleClose();
  }, [handleSave, handleClose]);

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
  handleCloseRef.current = handleClose;
  useEffect(() => { return () => { if (persistTimerRef.current) clearTimeout(persistTimerRef.current); }; }, []);

  const clampH = useCallback((p: number) => Math.max(25, Math.min(75, p)), []);
  const clampV = useCallback((p: number) => Math.max(30, Math.min(90, p)), []);

  if (!elementId || !element) return null;
  const hasPlotly = !!plotlyJson;
  const hasOutput = !!localOutput || hasPlotly;
  const hasConsole = !!localStdout || !!localError;

  return (
    <div className="fixed inset-0 z-50 flex flex-col" onClick={handleClose}>
      {/* Dark translucent backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      <div className={`relative m-4 flex-1 flex flex-col rounded-xl shadow-2xl overflow-hidden ${isDark ? 'border border-white/10' : 'border border-gray-200'}`}
        style={{ backgroundColor: isDark ? '#1e1e2e' : '#ffffff' }}
        onClick={e => e.stopPropagation()}>

        {/* Floating close — pinned to the true upper-right corner of the
            dialog, floating over the tabs row's empty space. */}
        <button
          onClick={handleClose}
          title="Close without saving"
          className={`absolute top-1.5 right-2 z-20 p-1 rounded ${isDark ? 'text-white/40 hover:text-white/80 hover:bg-white/10' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'}`}
        >
          <X size={16} />
        </button>

        {/* Tabs row: Plot code | Python Setup */}
        <div
          className="h-9 flex items-end px-3 gap-0.5 shrink-0 select-none"
          style={{
            backgroundColor: isDark ? '#11111b' : '#f0f0f0',
            borderBottom: isDark ? '1px solid rgba(255,255,255,0.06)' : '1px solid #e5e5e5',
          }}
        >
          {([
            { id: 'plot' as const, label: 'Plot code', shortcut: '⌘1' },
            { id: 'setup' as const, label: 'Python Setup', shortcut: '⌘2' },
          ]).map(tab => {
            const isActive = activeTab === tab.id;
            const isSetupTab = tab.id === 'setup';
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 h-7 rounded-t-md text-xs font-medium transition-colors ${
                  isActive
                    ? (isDark ? 'bg-[#1e1e2e] text-white/90' : 'bg-white text-gray-800 border-t border-l border-r border-gray-200')
                    : (isDark ? 'text-white/40 hover:text-white/70' : 'text-gray-500 hover:text-gray-800')
                }`}
                style={isActive ? { marginBottom: '-1px' } : undefined}
                title={
                  isSetupTab
                    ? 'Shared Python setup for this board — runs once, visible to every plot'
                    : 'This plot\u2019s code'
                }
              >
                {isSetupTab && <Braces size={11} />}
                {tab.label}
                {isSetupTab && hasSetupCode && (
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      kernelStatus === 'running' ? 'bg-blue-400 animate-pulse'
                      : kernelStatus === 'ok' ? 'bg-green-500'
                      : kernelStatus === 'error' ? 'bg-red-500'
                      : 'bg-gray-400'
                    }`}
                  />
                )}
                {isSetupTab && !hasSetupCode && (
                  <span className={`text-2xs ${isDark ? 'text-white/30' : 'text-gray-400'}`}>empty</span>
                )}
                <span className={`text-2xs opacity-60 ${isDark ? 'text-white/40' : 'text-gray-400'}`}>{tab.shortcut}</span>
              </button>
            );
          })}
          <div className="flex-1" />
        </div>

        {/* Body: the plot tab renders code+console | splitter | output;
            the Python Setup tab renders a simpler shared setup editor. */}
        <div className="flex-1 flex min-h-0" ref={bodyRef} style={{ display: activeTab === 'plot' ? 'flex' : 'none' }}>
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
                  {localError && localError.startsWith('Setup failed:') && (
                    <div className={`px-3 py-2 flex items-start gap-2 border-b ${isDark ? 'bg-red-950/40 border-red-900/40' : 'bg-red-50 border-red-200'}`}>
                      <div className="flex-1 min-w-0">
                        <div className={`text-xs font-semibold mb-1 ${isDark ? 'text-red-300' : 'text-red-700'}`}>
                          Board setup failed
                        </div>
                        <div className={`text-2xs ${isDark ? 'text-red-200/70' : 'text-red-600/80'}`}>
                          Fix the setup code and re-run this plot.
                        </div>
                      </div>
                      <button
                        onClick={() => setActiveTab('setup')}
                        className={`shrink-0 px-2 py-0.5 text-2xs font-medium rounded ${
                          isDark
                            ? 'bg-red-900/60 text-red-200 hover:bg-red-900'
                            : 'bg-white text-red-700 hover:bg-red-100 border border-red-300'
                        }`}
                      >
                        Open setup
                      </button>
                    </div>
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
            {/* Thumbnail strip — shown when the source element has more than
                one figure (i.e. sibling references exist). Clicking a
                thumbnail re-points the editor at the element bound to that
                figure so the user sees its own crop and preview. */}
            {(() => {
              const allElements = board?.elements ?? [];
              const refs = allElements
                .filter(el =>
                  el.id === sourceElementId ||
                  el.metadata?.sourceElementId === sourceElementId
                )
                .sort(
                  (a, b) =>
                    (a.metadata?.figureIndex ?? 0) -
                    (b.metadata?.figureIndex ?? 0)
                );
              if (refs.length <= 1) return null;
              return (
                <div
                  className="shrink-0 flex items-center gap-2 px-3 py-2 overflow-x-auto"
                  style={{
                    borderBottom: isDark
                      ? '1px solid rgba(255,255,255,0.06)'
                      : '1px solid #e5e5e5',
                  }}
                >
                  <span className={`text-2xs shrink-0 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
                    {refs.length} figures
                  </span>
                  {refs.map((ref, i) => {
                    const isActive = ref.id === elementId;
                    const thumb = ref.metadata?.lastOutput;
                    const missing = ref.metadata?.figureMissing;
                    return (
                      <button
                        key={ref.id}
                        onClick={() =>
                          useUIStore.getState().setPlotEditorElementId(ref.id)
                        }
                        title={`Figure ${i} (${isActive ? 'current' : 'click to switch'})`}
                        className={`shrink-0 rounded overflow-hidden border-2 transition-all ${
                          isActive
                            ? (isDark ? 'border-blue-400' : 'border-blue-500')
                            : (isDark ? 'border-white/10 hover:border-white/30' : 'border-gray-200 hover:border-gray-400')
                        }`}
                        style={{ width: 56, height: 40 }}
                      >
                        {thumb ? (
                          <img
                            src={`data:image/png;base64,${thumb}`}
                            alt={`fig ${i}`}
                            className="w-full h-full object-cover"
                            draggable={false}
                          />
                        ) : (
                          <div
                            className={`w-full h-full flex items-center justify-center text-2xs ${
                              missing
                                ? (isDark ? 'text-red-300 bg-red-500/10' : 'text-red-600 bg-red-50')
                                : (isDark ? 'text-white/30 bg-white/5' : 'text-gray-400 bg-gray-100')
                            }`}
                          >
                            {missing ? '∅' : i}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })()}
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">
              {isRunning ? (
                <div className="w-full h-full flex items-center justify-center">
                  <div className={`flex items-center gap-2 text-sm ${isDark ? 'text-white/30' : 'text-gray-400'}`}><Loader2 size={18} className="animate-spin" /> Executing...</div>
                </div>
              ) : (
                <>
                  {hasPlotly && !cropMode && (
                    <div className="flex-1 min-h-0 relative overflow-hidden bg-white" ref={plotlyContainerRef}>
                      <div ref={plotlyRefCallback} className="absolute inset-0 overflow-hidden" />
                      {cropRect && cropRect.w > 0.01 && <CropIndicator cropRect={cropRect} />}
                    </div>
                  )}

                  {/* Crop mode: static snapshot with crop editor.
                      The crop wrapper is sized to the image via object-fit:contain math,
                      so crop coordinates are image-relative and viewport-independent. */}
                  {cropMode && cropSnapshot && (
                    <CropImageView
                      snapshot={cropSnapshot}
                      cropRect={cropRect}
                      onChange={setCropRect}
                      isDark={isDark}
                      aspectRatio={cropAspectRatio}
                    />
                  )}

                  {/* Static image only (matplotlib — no interactive view) */}
                  {!hasPlotly && localOutput && (
                    <div className="flex-1 min-h-0 relative flex items-center justify-center p-4">
                      <img src={`data:image/png;base64,${localOutput}`} alt="Plot" className="max-w-full max-h-full object-contain" draggable={false} />
                    </div>
                  )}

                  {/* Empty: no output at all */}
                  {!hasOutput && element?.metadata?.figureMissing && (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-3 select-none px-8">
                      <div className={`text-sm font-medium ${isDark ? 'text-red-300' : 'text-red-600'}`}>
                        Figure {activeFigureIndex} missing
                      </div>
                      <div className={`text-xs text-center max-w-sm ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
                        The shared code no longer produces this figure. Edit the code to produce at least {activeFigureIndex + 1} figure{activeFigureIndex === 0 ? '' : 's'}, or delete this view.
                      </div>
                    </div>
                  )}
                  {!hasOutput && !element?.metadata?.figureMissing && (
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

        {/* Python Setup tab body */}
        {activeTab === 'setup' && (
          <div className="flex-1 flex flex-col min-h-0">
            <div
              className={`h-7 shrink-0 flex items-center px-3 text-2xs ${
                isDark ? 'text-white/40 bg-[#181825] border-b border-white/5' : 'text-gray-500 bg-gray-50 border-b border-gray-200'
              }`}
            >
              Runs once per board. Variables you define here are visible to every plot on this board.
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <CodeMirrorEditor
                initialCode={setupCode}
                remountKey={`setup:${board?.id}:${isDark}`}
                onChange={setSetupCode}
                onRun={handleSetupRun}
                onEscape={handleClose}
                isDark={isDark}
                autoFocus
              />
            </div>
            {(setupStdout || setupError) && (
              <div
                className="shrink-0 max-h-[35%] overflow-auto"
                style={{ backgroundColor: isDark ? '#11111b' : '#f5f5f5' }}
              >
                {setupStdout && (
                  <pre
                    className={`px-3 py-2 text-xs whitespace-pre-wrap break-words ${isDark ? 'text-[#a6adc8]' : 'text-gray-600'}`}
                    style={{ fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace' }}
                  >
                    {setupStdout}
                  </pre>
                )}
                {setupError && (
                  <pre
                    className={`px-3 py-2 text-xs whitespace-pre-wrap break-words ${isDark ? 'text-[#f38ba8]' : 'text-red-600'}`}
                    style={{ fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace' }}
                  >
                    {setupError}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}

        {/* Bottom status bar — Run / Setup / Crop / Save controls. Pinned
            below the body like VS Code's bottom bar so the primary surface
            stays uncluttered and the close button lives in the true
            upper-right corner. */}
        <div className="h-10 flex items-center px-3 gap-2 shrink-0 select-none"
          style={{ backgroundColor: isDark ? '#181825' : '#f8f8f8', borderTop: isDark ? '1px solid rgba(255,255,255,0.06)' : '1px solid #e5e5e5' }}>
          {/* Run / Stop — context-aware to the active tab so Cmd+Enter feels natural */}
          {activeTab === 'plot' ? (
            isRunning ? (
              <button onClick={handleAbort} className={`flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded ${isDark ? 'text-red-300' : 'text-red-600'}`}
                style={{ backgroundColor: isDark ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.1)' }}>
                <Square size={12} fill="currentColor" /> Stop
              </button>
            ) : (
              <button onClick={handleRun} className={`flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded ${isDark ? 'text-green-300' : 'text-green-700'}`}
                style={{ backgroundColor: isDark ? 'rgba(34,197,94,0.15)' : 'rgba(34,197,94,0.1)' }}>
                <Play size={12} /> Run plot
              </button>
            )
          ) : isSetupRunning ? (
            <button disabled className={`flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded ${isDark ? 'text-white/30' : 'text-gray-400'}`}>
              <Loader2 size={12} className="animate-spin" /> Running…
            </button>
          ) : (
            <button onClick={handleSetupRun} className={`flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded ${isDark ? 'text-green-300' : 'text-green-700'}`}
              style={{ backgroundColor: isDark ? 'rgba(34,197,94,0.15)' : 'rgba(34,197,94,0.1)' }}>
              <Play size={12} /> Run setup
            </button>
          )}
          <span className={`text-xs ${isDark ? 'text-white/30' : 'text-gray-400'}`}>{(activeTab === 'plot' ? isRunning : isSetupRunning) ? '' : '\u2318\u23CE'}</span>

          {/* Always-visible "Run Setup" shortcut: runs the board's shared setup
              from either tab, so users never have to go hunting for it. */}
          <div className={`w-px h-4 mx-1 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
          <button
            onClick={handleSetupRun}
            disabled={isSetupRunning || !hasSetupCode}
            title={
              !hasSetupCode
                ? 'Python Setup is empty — switch to the "Python Setup" tab to add shared imports and data loading'
                : 'Run the board\u2019s shared Python setup'
            }
            className={`flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded border transition-colors ${
              !hasSetupCode
                ? (isDark ? 'text-white/25 border-white/10 cursor-not-allowed' : 'text-gray-400 border-gray-200 cursor-not-allowed')
                : isSetupRunning
                ? (isDark ? 'text-blue-300 border-blue-500/40 bg-blue-500/10' : 'text-blue-600 border-blue-300 bg-blue-50')
                : kernelStatus === 'error'
                ? (isDark ? 'text-red-300 border-red-500/40 bg-red-500/10 hover:bg-red-500/20' : 'text-red-700 border-red-300 bg-red-50 hover:bg-red-100')
                : kernelStatus === 'ok'
                ? (isDark ? 'text-green-300 border-green-500/40 bg-green-500/10 hover:bg-green-500/20' : 'text-green-700 border-green-300 bg-green-50 hover:bg-green-100')
                : (isDark ? 'text-white/70 border-white/15 hover:bg-white/5' : 'text-gray-700 border-gray-300 hover:bg-gray-50')
            }`}
          >
            {isSetupRunning ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Braces size={12} />
            )}
            Run Setup
            {hasSetupCode && !isSetupRunning && (
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  kernelStatus === 'ok' ? 'bg-green-500'
                  : kernelStatus === 'error' ? 'bg-red-500'
                  : 'bg-gray-400'
                }`}
              />
            )}
          </button>

          <div className={`w-px h-4 mx-1 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />

          <span className={`text-xs truncate max-w-[140px] ${isDark ? 'text-white/30' : 'text-gray-400'}`} title={activePythonEnv || 'default'}>
            {(activePythonEnv || 'default').split('/').pop()}
          </span>

          <div className="flex-1" />

          {hasPlotly && !cropMode && (
            <button onClick={enterCropMode} className={`flex items-center gap-1 px-2 py-0.5 text-xs rounded ${cropRect ? 'text-blue-400' : (isDark ? 'text-white/40 hover:text-white/60' : 'text-gray-500 hover:text-gray-700')}`}>
              <Crop size={12} /> {cropRect ? 'Edit Crop' : 'Crop'}
            </button>
          )}
          {cropMode && (
            <div className="flex items-center gap-1.5">
              {/* Aspect ratio selector */}
              {([
                { label: 'Free', ratio: null },
                { label: '1:1', ratio: 1 },
                { label: '4:3', ratio: 4/3 },
                { label: '3:4', ratio: 3/4 },
                { label: '16:9', ratio: 16/9 },
                { label: '9:16', ratio: 9/16 },
              ] as const).map(({ label, ratio }) => (
                <button key={label} onClick={() => setCropAspectRatio(ratio)}
                  className={`px-1.5 py-0.5 text-xs rounded ${
                    cropAspectRatio === ratio
                      ? (isDark ? 'text-blue-300 bg-blue-500/20' : 'text-blue-600 bg-blue-100')
                      : (isDark ? 'text-white/30 hover:text-white/50' : 'text-gray-400 hover:text-gray-600')
                  }`}>
                  {label}
                </button>
              ))}

              <div className={`w-px h-4 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />

              <button onClick={exitCropMode} className={`flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded ${isDark ? 'text-blue-300 bg-blue-500/20' : 'text-blue-600 bg-blue-100'}`}>
                <Check size={12} /> Crop
              </button>
              {cropRect && (
                <button onClick={() => { setCropRect(null); exitCropMode(); }} className={`px-1.5 py-0.5 text-xs rounded ${isDark ? 'text-white/25 hover:text-red-400' : 'text-gray-400 hover:text-red-500'}`}>
                  Clear
                </button>
              )}
            </div>
          )}

          <div className={`w-px h-4 mx-1 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />

          {hasOutput && (
            <button onClick={handleSaveAndClose} disabled={isSaving}
              className={`flex items-center gap-1 px-3 py-1 text-xs font-medium rounded text-white ${isSaving ? 'bg-blue-400 cursor-wait' : 'bg-blue-600 hover:bg-blue-700'}`}>
              {isSaving ? <><Loader2 size={12} className="animate-spin" /> Saving...</> : <><Save size={12} /> Save</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
