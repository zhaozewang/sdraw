import { useEffect, useRef } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine } from '@codemirror/view';
import { EditorState, Prec } from '@codemirror/state';
import { python } from '@codemirror/lang-python';
import { indentWithTab, defaultKeymap, history, historyKeymap, indentLess } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching, indentUnit } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';

/**
 * Thin wrapper around a CodeMirror 6 editor tuned for sDraw.
 *
 * Important quirks (both hard-won):
 *   1. Mod-Enter / Escape / Shift-Tab keybindings are wrapped in
 *      `Prec.highest(...)` so they beat `defaultKeymap`'s Mod-Enter binding
 *      (which would otherwise insert a blank line instead of running code).
 *   2. In dark mode, oneDark's bundled highlight style is used; the default
 *      light highlight style is skipped. Mixing them makes dark-mode token
 *      colors invisible.
 */
export interface CodeMirrorEditorProps {
  /** Initial code for first mount. Changes to this prop remount the editor. */
  initialCode: string;
  /** Remount key — when this changes, the editor is rebuilt from `initialCode`. */
  remountKey?: string | number;
  /** Fired on every document change. */
  onChange: (code: string) => void;
  /** Fired when Mod+Enter is pressed. Return true to acknowledge. */
  onRun?: () => void;
  /** Fired when Escape is pressed. */
  onEscape?: () => void;
  /** Dark-mode toggle (usually derived from the app theme). */
  isDark: boolean;
  /** Autofocus on mount. */
  autoFocus?: boolean;
}

export function CodeMirrorEditor({
  initialCode,
  remountKey,
  onChange,
  onRun,
  onEscape,
  isDark,
  autoFocus = true,
}: CodeMirrorEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Keep the latest handlers in refs so the editor doesn't rebuild when
  // they change between renders.
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  const onEscapeRef = useRef(onEscape);
  onChangeRef.current = onChange;
  onRunRef.current = onRun;
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!hostRef.current) return;
    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    const km = Prec.highest(keymap.of([
      { key: 'Mod-Enter', run: () => { onRunRef.current?.(); return true; } },
      { key: 'Escape',    run: () => { onEscapeRef.current?.(); return true; } },
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
        if (u.docChanged) {
          onChangeRef.current(u.state.doc.toString());
        }
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

    const view = new EditorView({
      state: EditorState.create({ doc: initialCode, extensions: exts }),
      parent: hostRef.current,
    });
    viewRef.current = view;
    if (autoFocus) requestAnimationFrame(() => view.focus());

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark, remountKey]);

  return <div ref={hostRef} className="w-full h-full overflow-hidden" />;
}
