import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Loader2, X, RotateCcw, Braces } from 'lucide-react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import { api } from '@/api/client';
import { CodeMirrorEditor } from '@/components/shared/CodeMirrorEditor';

/**
 * Standalone modal editor for the board-level "Python Setup" block.
 *
 * This is the same code that appears under the "Python Setup" tab inside
 * PlotEditor — both surfaces edit `board.setup.code`. This standalone
 * modal exists so users can edit setup even when no plot is selected
 * (opened from the toolbar button or Cmd+;).
 */
export function SetupEditor() {
  const open = useUIStore(s => s.setupEditorOpen);
  const closeSetupEditor = useUIStore(s => s.closeSetupEditor);
  const theme = useUIStore(s => s.theme);
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const board = useBoardStore(s => s.board);
  const setSetupCode = useBoardStore(s => s.setSetupCode);
  const runSetup = useBoardStore(s => s.runSetup);
  const restartKernel = useBoardStore(s => s.restartKernel);

  const [localCode, setLocalCode] = useState('');
  const [localStdout, setLocalStdout] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  // Code changes: keep a ref so handleRun always reads the latest value
  // regardless of the React closure it was captured in.
  const codeRef = useRef('');
  codeRef.current = localCode;

  const initializedForBoardRef = useRef<string | null>(null);

  // Initialize / reinitialize when the modal opens for a new board.
  useEffect(() => {
    if (!open || !board) return;
    if (initializedForBoardRef.current !== board.id) {
      initializedForBoardRef.current = board.id;
      setLocalCode(board.setup?.code ?? '');
      setLocalStdout(null);
      setLocalError(null);
      setHasRun(false);
    }
  }, [open, board]);

  // Reset when closed so the next open starts clean.
  useEffect(() => {
    if (!open) {
      initializedForBoardRef.current = null;
    }
  }, [open]);

  const handleCodeChange = useCallback((code: string) => {
    setLocalCode(code);
    setSetupCode(code);
  }, [setSetupCode]);

  const handleRun = useCallback(async () => {
    if (isRunning || !board) return;
    setIsRunning(true);
    setLocalError(null);
    setLocalStdout(null);
    try {
      const r = await runSetup(codeRef.current);
      setLocalStdout(r.stdout);
      setLocalError(r.ok ? null : r.error);
    } catch (err: any) {
      setLocalError(String(err));
    } finally {
      setIsRunning(false);
      setHasRun(true);
    }
  }, [isRunning, board, runSetup]);

  const handleRestart = useCallback(async () => {
    if (!board) return;
    try {
      await restartKernel();
      setLocalStdout('Kernel restarted.');
      setLocalError(null);
    } catch (err: any) {
      setLocalError(String(err));
    }
  }, [board, restartKernel]);

  const handleClose = useCallback(() => {
    closeSetupEditor();
  }, [closeSetupEditor]);

  if (!open || !board) return null;

  const hasConsole = !!localStdout || !!localError;

  return (
    <div className="fixed inset-0 z-50 flex flex-col" onClick={handleClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      <div
        className={`relative m-4 flex-1 flex flex-col rounded-xl shadow-2xl overflow-hidden ${
          isDark ? 'border border-white/10' : 'border border-gray-200'
        }`}
        style={{ backgroundColor: isDark ? '#1e1e2e' : '#ffffff' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Toolbar */}
        <div
          className="h-10 flex items-center px-3 gap-2 shrink-0 select-none"
          style={{
            backgroundColor: isDark ? '#181825' : '#f8f8f8',
            borderBottom: isDark ? '1px solid rgba(255,255,255,0.06)' : '1px solid #e5e5e5',
          }}
        >
          <Braces size={14} className={isDark ? 'text-white/40' : 'text-gray-500'} />
          <span className={`text-xs font-medium ${isDark ? 'text-white/70' : 'text-gray-700'}`}>
            Python Setup
          </span>
          <span className={`text-2xs ${isDark ? 'text-white/30' : 'text-gray-400'}`}>
            shared imports & data loading — runs once per board, visible to every plot
          </span>

          <div className="flex-1" />

          {isRunning ? (
            <button
              disabled
              className={`flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded ${
                isDark ? 'text-white/30' : 'text-gray-400'
              }`}
            >
              <Loader2 size={12} className="animate-spin" /> Running…
            </button>
          ) : (
            <button
              onClick={handleRun}
              className={`flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded ${
                isDark ? 'text-green-300' : 'text-green-700'
              }`}
              style={{ backgroundColor: isDark ? 'rgba(34,197,94,0.15)' : 'rgba(34,197,94,0.1)' }}
            >
              <Play size={12} /> Run setup
            </button>
          )}
          <span className={`text-xs ${isDark ? 'text-white/30' : 'text-gray-400'}`}>
            {isRunning ? '' : '\u2318\u23CE'}
          </span>

          <div className={`w-px h-4 mx-1 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />

          <button
            onClick={handleRestart}
            title="Restart kernel (clears all state)"
            className={`flex items-center gap-1 px-2 py-0.5 text-xs rounded ${
              isDark
                ? 'text-white/40 hover:text-white/70 hover:bg-white/5'
                : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
            }`}
          >
            <RotateCcw size={12} /> Restart kernel
          </button>

          <button
            onClick={handleClose}
            className={`p-0.5 rounded ml-0.5 ${
              isDark
                ? 'text-white/30 hover:text-white/60 hover:bg-white/5'
                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
            }`}
            title="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body: code editor (top) + console (bottom) */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="overflow-hidden" style={{ height: hasConsole ? '65%' : '100%', minHeight: 0 }}>
            <CodeMirrorEditor
              initialCode={localCode}
              remountKey={`${board.id}:${isDark}`}
              onChange={handleCodeChange}
              onRun={handleRun}
              onEscape={handleClose}
              isDark={isDark}
            />
          </div>

          {hasConsole && (
            <div
              className="overflow-auto min-h-0"
              style={{ height: '35%', backgroundColor: isDark ? '#11111b' : '#f5f5f5' }}
            >
              {localStdout && (
                <pre
                  className={`px-3 py-2 text-xs whitespace-pre-wrap break-words ${
                    isDark ? 'text-[#a6adc8]' : 'text-gray-600'
                  }`}
                  style={{ fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace' }}
                >
                  {localStdout}
                </pre>
              )}
              {localError && (
                <pre
                  className={`px-3 py-2 text-xs whitespace-pre-wrap break-words ${
                    isDark ? 'text-[#f38ba8]' : 'text-red-600'
                  }`}
                  style={{ fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace' }}
                >
                  {localError}
                </pre>
              )}
            </div>
          )}

          {!hasConsole && !hasRun && (
            <div
              className={`h-10 shrink-0 flex items-center justify-center text-2xs ${
                isDark ? 'text-white/25' : 'text-gray-400'
              }`}
            >
              Press <kbd className="mx-1">⌘↵</kbd> to run. Setup variables become available to every plot on this board.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
