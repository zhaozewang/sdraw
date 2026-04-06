import { useState, useCallback, useRef, useEffect } from 'react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import { api } from '@/api/client';
import { Play, Loader2, X, Code2 } from 'lucide-react';

export function PlotEditor() {
  const elementId = useUIStore(s => s.plotEditorElementId);
  const element = useBoardStore(s =>
    elementId ? s.board?.elements.find(el => el.id === elementId) : undefined
  );
  const updateElement = useBoardStore(s => s.updateElement);
  const pushHistory = useBoardStore(s => s.pushHistory);
  const theme = useUIStore(s => s.theme);
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const [localCode, setLocalCode] = useState('');
  const [localOutput, setLocalOutput] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const initRef = useRef<string | null>(null);

  // Sync local state when opening for a (possibly different) element
  useEffect(() => {
    if (elementId && element && initRef.current !== elementId) {
      initRef.current = elementId;
      setLocalCode(element.metadata?.code || '');
      setLocalOutput(element.metadata?.lastOutput || null);
      setLocalError(element.metadata?.lastError || null);
      setIsRunning(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [elementId, element]);

  const handleRun = useCallback(async () => {
    if (isRunning || !elementId) return;
    setIsRunning(true);
    setLocalError(null);

    try {
      const pythonEnv = useUIStore.getState().pythonEnvPath;
      const result = await api.executePlot(localCode, 30, 150, pythonEnv);
      if (result.success) {
        setLocalOutput(result.image_base64);
        setLocalError(null);
      } else {
        setLocalError(result.error);
      }
    } catch (err: any) {
      setLocalError(String(err));
    } finally {
      setIsRunning(false);
    }
  }, [elementId, localCode, isRunning]);

  const handleClose = useCallback(() => {
    if (elementId) {
      const el = useBoardStore.getState().board?.elements.find(e => e.id === elementId);
      if (el) {
        const changed =
          localCode !== el.metadata?.code ||
          localOutput !== el.metadata?.lastOutput ||
          localError !== el.metadata?.lastError;
        if (changed) {
          updateElement(elementId, {
            metadata: {
              ...el.metadata,
              code: localCode,
              lastOutput: localOutput,
              lastError: localError,
            },
          });
          pushHistory('Edit plot');
        }
      }
    }
    initRef.current = null;
    useUIStore.getState().setPlotEditorElementId(null);
  }, [elementId, localCode, localOutput, localError, updateElement, pushHistory]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = textareaRef.current;
      if (ta) {
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const val = ta.value;
        const newVal = val.substring(0, start) + '    ' + val.substring(end);
        setLocalCode(newVal);
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + 4;
        });
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleRun();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      handleClose();
    }
  }, [handleRun, handleClose]);

  if (!elementId || !element) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/30" onClick={handleClose}>
      <div
        className="m-6 flex-1 flex flex-col bg-surface-primary rounded-lg shadow-2xl overflow-hidden border border-border"
        onClick={e => e.stopPropagation()}
      >
        {/* Header — matches toolbar style */}
        <div className="h-10 bg-toolbar-bg border-b border-toolbar-border flex items-center px-3 gap-2 shrink-0 select-none">
          <Code2 size={15} className="text-on-surface-secondary shrink-0" />
          <span className="text-xs font-semibold text-on-surface-primary">Plot Editor</span>

          <div className="w-px h-5 bg-toolbar-border mx-1" />

          <button
            onClick={handleRun}
            disabled={isRunning}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
              isRunning
                ? 'text-on-surface-disabled cursor-not-allowed'
                : 'text-green-100 dark:text-green-100'
            }`}
            style={{
              backgroundColor: isRunning
                ? 'rgba(128,128,128,0.12)'
                : isDark ? 'rgba(34,197,94,0.2)' : 'rgba(74,186,120,0.75)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: isRunning
                ? '1px solid rgba(128,128,128,0.15)'
                : isDark ? '1px solid rgba(34,197,94,0.35)' : '1px solid rgba(74,186,120,0.45)',
              boxShadow: isRunning ? 'none' : isDark ? '0 0 8px rgba(34,197,94,0.1)' : '0 0 6px rgba(22,163,74,0.15)',
            }}
            onMouseEnter={e => { if (!isRunning) { e.currentTarget.style.backgroundColor = isDark ? 'rgba(34,197,94,0.35)' : 'rgba(74,186,120,0.85)'; } }}
            onMouseLeave={e => { if (!isRunning) { e.currentTarget.style.backgroundColor = isDark ? 'rgba(34,197,94,0.2)' : 'rgba(74,186,120,0.85)'; } }}
            title="Run (Cmd+Enter)"
          >
            {isRunning ? (
              <><Loader2 size={12} className="animate-spin" /> Running...</>
            ) : (
              <><Play size={12} /> Run</>
            )}
          </button>

          <span className="text-2xs text-on-surface-muted select-none">
            {isRunning ? '' : 'Cmd+Enter'}
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
            <textarea
              ref={textareaRef}
              value={localCode}
              onChange={e => setLocalCode(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 resize-none outline-none p-4 text-xs leading-relaxed bg-surface-secondary text-on-surface-primary border-none"
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                tabSize: 4,
              }}
              spellCheck={false}
              placeholder="# Write your matplotlib or plotly code here..."
            />
          </div>

          {/* Output panel */}
          <div className="w-1/2 flex flex-col">
            <div className="px-3 py-1.5 border-b border-border bg-inspector-section shrink-0">
              <span className="text-2xs font-semibold text-on-surface-muted uppercase tracking-wider">Output</span>
            </div>
            <div className="flex-1 overflow-auto bg-surface-primary">
              {isRunning ? (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="flex items-center gap-2 text-sm text-on-surface-muted">
                    <Loader2 size={18} className="animate-spin" />
                    Executing...
                  </div>
                </div>
              ) : localError ? (
                <pre
                  className="p-4 text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap break-words"
                  style={{ fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' }}
                >
                  {localError}
                </pre>
              ) : localOutput ? (
                <div className="w-full h-full flex items-center justify-center p-4">
                  <img
                    src={`data:image/png;base64,${localOutput}`}
                    alt="Plot output"
                    className="max-w-full max-h-full object-contain"
                    draggable={false}
                  />
                </div>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-on-surface-muted select-none">
                  <Play size={20} />
                  <span className="text-sm">Click Run to execute your code</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
