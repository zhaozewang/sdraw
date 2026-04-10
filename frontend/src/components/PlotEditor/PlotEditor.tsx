import { useState, useCallback, useRef, useEffect } from 'react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import { api } from '@/api/client';
import { Play, Square, Loader2, X, Code2 } from 'lucide-react';

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
  const [isRunning, setIsRunning] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const initRef = useRef<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const codeRef = useRef('');
  // Debounced persist timer
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

  // Auto-persist on code changes (debounced 2s)
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
      setIsRunning(false);
      setExecutionId(null);
    }
  }, [elementId, element]);

  // Setup CodeMirror editor
  useEffect(() => {
    if (!editorRef.current || !elementId) return;

    // Don't re-create if already initialized for this element
    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    const runKeymap = keymap.of([{
      key: 'Mod-Enter',
      run: () => {
        handleRunRef.current();
        return true;
      },
    }, {
      key: 'Escape',
      run: () => {
        handleCloseRef.current();
        return true;
      },
    }, {
      key: 'Shift-Tab',
      run: (view) => {
        indentLess(view);
        return true;
      }
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

    const state = EditorState.create({
      doc: codeRef.current,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;
    // Focus after a tick
    requestAnimationFrame(() => view.focus());

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [elementId, isDark]); // re-create on theme change too

  // Refs for stable callbacks in keymap
  const handleRunRef = useRef<() => void>(() => {});
  const handleCloseRef = useRef<() => void>(() => {});

  const handleRun = useCallback(async () => {
    if (isRunning || !elementId) return;
    const execId = generateId();
    setIsRunning(true);
    setExecutionId(execId);
    setLocalError(null);
    setLocalStdout(null);

    try {
      // Per-board env takes precedence over global
      const pythonEnv = useBoardStore.getState().board?.pythonEnvPath ?? useUIStore.getState().pythonEnvPath;
      // Use board file's directory as working directory for relative imports
      const boardPath = useBoardStore.getState().boardFilePath;
      const cwd = boardPath ? boardPath.replace(/\/[^/]+$/, '') : null;
      console.log('[PlotEditor] executing with python env:', pythonEnv, 'cwd:', cwd);
      const result = await api.executePlot(codeRef.current, 30, 150, pythonEnv, execId, cwd);
      if (result.success) {
        setLocalOutput(result.image_base64);
        setLocalStdout(result.stdout);
        setLocalError(null);
      } else {
        setLocalOutput(result.image_base64);
        setLocalStdout(result.stdout);
        setLocalError(result.error);
      }
    } catch (err: any) {
      // Don't show error if it was an abort
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
      try {
        await api.abortPlot(executionId);
      } catch {}
    }
  }, [executionId]);

  const handleClose = useCallback(() => {
    // Persist any pending changes immediately
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    if (elementId) {
      const el = useBoardStore.getState().board?.elements.find(e => e.id === elementId);
      if (el) {
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
          pushHistory('Edit plot');
        }
      }
    }
    initRef.current = null;
    useUIStore.getState().setPlotEditorElementId(null);
  }, [elementId, localOutput, localStdout, localError, updateElement, pushHistory]);

  // Keep refs current
  handleRunRef.current = handleRun;
  handleCloseRef.current = handleClose;

  // Cleanup persist timer on unmount
  useEffect(() => {
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, []);

  if (!elementId || !element) return null;

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
            <div className="px-3 py-1.5 border-b border-border bg-inspector-section shrink-0">
              <span className="text-2xs font-semibold text-on-surface-muted uppercase tracking-wider">Output</span>
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
                  {/* Plot image */}
                  {localOutput && (
                    <div className="flex-1 flex items-center justify-center p-4 min-h-0">
                      <img
                        src={`data:image/png;base64,${localOutput}`}
                        alt="Plot output"
                        className="max-w-full max-h-full object-contain"
                        draggable={false}
                      />
                    </div>
                  )}

                  {/* Stdout text output */}
                  {localStdout && (
                    <div className={`border-t border-border ${localOutput ? '' : 'flex-1'}`}>
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
                    <div className={`border-t border-border ${!localOutput && !localStdout ? 'flex-1 flex items-start' : ''}`}>
                      <pre
                        className="p-4 text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap break-words w-full"
                        style={{ fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' }}
                      >
                        {localError}
                      </pre>
                    </div>
                  )}

                  {/* Empty state */}
                  {!localOutput && !localStdout && !localError && (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-on-surface-muted select-none">
                      {hasRun ? (
                        <>
                          <span className="text-sm">Code executed — no output captured</span>
                          <span className="text-xs opacity-60 text-center px-8">
                            Add print() statements to debug, or make sure your code creates a matplotlib/plotly figure
                          </span>
                        </>
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
