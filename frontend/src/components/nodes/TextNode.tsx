import { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { NodeProps } from '@xyflow/react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import { Resizer } from './Resizer';
import katex from 'katex';
import 'katex/dist/katex.min.css';

interface TextNodeData {
  elementId: string;
  [key: string]: unknown;
}

/** Parse text with $...$ (inline) and $$...$$ (display) math delimiters.
 *  fontSize is passed so we can force KaTeX to render at matching size. */
function renderMathText(text: string, color: string, fontSize: number): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\$\$[\s\S]+?\$\$|\$[^$]+?\$)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const mathStr = match[0];
    const isDisplay = mathStr.startsWith('$$');
    const tex = isDisplay ? mathStr.slice(2, -2) : mathStr.slice(1, -1);
    try {
      const html = katex.renderToString(tex, {
        displayMode: isDisplay,
        throwOnError: false,
        output: 'html',
      });
      // Force the KaTeX container to render at the parent font size.
      // KaTeX's CSS `font: normal 1.21em ...` resets font-size; we
      // override it with an explicit px value via inline style on the
      // .katex element wrapper.
      parts.push(
        <span
          key={match.index}
          dangerouslySetInnerHTML={{ __html: html }}
          className="katex-override"
          style={{ color, display: 'inline-block', willChange: 'transform', fontSize: `${fontSize}px` }}
        />
      );
    } catch {
      parts.push(mathStr);
    }
    lastIndex = match.index + mathStr.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function TextNodeComponent({ id, data, selected }: NodeProps) {
  const elementId = (data as TextNodeData).elementId;
  const element = useBoardStore(s => s.board?.elements.find(el => el.id === elementId));
  const updateElement = useBoardStore(s => s.updateElement);
  const pushHistory = useBoardStore(s => s.pushHistory);
  const [editing, setEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasAutoEdited = useRef(false);
  const selectAllOnEdit = useRef(false);
  const isSelectedInStore = useUIStore(s => s.selectedIds.includes(elementId));

  // Auto-enter edit mode for newly created text boxes
  useEffect(() => {
    if ((selected || isSelectedInStore) && (element?.text === 'Text' || element?.text === 'Label') && !hasAutoEdited.current) {
      hasAutoEdited.current = true;
      selectAllOnEdit.current = true;
      setTimeout(() => setEditing(true), 50);
    }
  }, [selected, isSelectedInStore, element?.text]);

  const handleDoubleClick = useCallback(() => {
    if (element && !element.locked) {
      setEditing(true);
    }
  }, [element?.locked]);

  const handleBlur = useCallback(() => {
    setEditing(false);
    if (textareaRef.current && element) {
      const newText = textareaRef.current.value;
      if (newText !== element.text) {
        pushHistory('Edit text');
        updateElement(elementId, { text: newText });
      }
    }
  }, [elementId, element?.text, updateElement, pushHistory]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 's') {
      // Let the global save shortcut handle it.
      return;
    }
    if (e.key === 'Escape') {
      setEditing(false);
      textareaRef.current?.blur();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      // Enter alone: unfocus. Shift+Enter: newline (default behavior).
      e.preventDefault();
      textareaRef.current?.blur();
    }
    e.stopPropagation();
  }, []);

  // Grow the textarea to exactly match its content height so it occupies
  // the same visual box as the rendered div, letting the parent's
  // justifyContent position it per verticalAlign.
  const autosizeTextarea = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, []);

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      autosizeTextarea();
      if (selectAllOnEdit.current) {
        selectAllOnEdit.current = false;
        textareaRef.current.select();
      } else {
        // Place cursor at end by default
        const len = textareaRef.current.value.length;
        textareaRef.current.setSelectionRange(len, len);
      }
    }
  }, [editing, autosizeTextarea]);

  const onResizeAbsolute = useCallback((x: number, y: number, w: number, h: number) => {
    updateElement(elementId, { x, y, width: w, height: h });
  }, [elementId, updateElement]);

  const onResizeEnd = useCallback(() => {
    pushHistory('Resize');
  }, [pushHistory]);

  const getRect = useCallback(() => {
    const el = useBoardStore.getState().board?.elements.find(e => e.id === elementId);
    return el ? { x: el.x, y: el.y, width: el.width, height: el.height } : { x: 0, y: 0, width: 100, height: 100 };
  }, [elementId]);

  const text = element?.type === 'text' ? element.text : undefined;
  const style = element?.type === 'text' ? element.style : undefined;
  const hasMath = text ? /\$/.test(text) : false;
  const fontFamily = style?.fontFamily || 'Inter, sans-serif';

  const renderedContent = useMemo(() => {
    if (!text || !hasMath) return null;
    return renderMathText(text, style?.color || '#111111', style?.fontSize ?? 14);
  }, [text, hasMath, style?.color, style?.fontSize]);

  if (!element || element.type !== 'text') return null;

  const rotation = element.rotation || 0;

  const textStyles: React.CSSProperties = {
    fontSize: style!.fontSize ?? 14,
    fontWeight: style!.fontWeight ?? 400,
    fontFamily,
    color: style!.color || '#111111',
    textAlign: (style!.textAlign as any) || 'left',
    lineHeight: style!.lineHeight ?? 1.4,
    fontStyle: style!.italic ? 'italic' : 'normal',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  };

  return (
    <div style={rotation ? { transform: `rotate(${rotation}deg)`, width: '100%', height: '100%' } : { width: '100%', height: '100%' }}>
      <Resizer
        isVisible={(selected || isSelectedInStore) && !element.locked}
        nodeId={id}
        minWidth={30}
        minHeight={20}
        onResizeAbsolute={onResizeAbsolute}
        onResizeEnd={onResizeEnd}
        getRect={getRect}
        lockAspect={!!element.metadata?.lockAspectRatio}
        rotation={rotation}
        onRotate={r => updateElement(elementId, { rotation: r })}
        onRotateEnd={() => pushHistory('Rotate')}
      />
      <div
        className="w-full h-full"
        style={{
          backgroundColor: style!.background || 'transparent',
          opacity: style!.opacity ?? 1,
          border: (selected || isSelectedInStore)
            ? '1px dashed #3b82f6'
            : '1px solid transparent',
          overflow: 'hidden',
        }}
        onDoubleClick={handleDoubleClick}
      >
        {/* Text renders in canvas coordinate space — React Flow's viewport
            transform handles zoom, so fontSize stays fixed in canvas units. */}
        <div style={{
          width: '100%',
          height: '100%',
          padding: style!.padding ?? 4,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: style!.verticalAlign === 'center' ? 'center'
            : style!.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start',
          overflow: editing ? 'visible' : 'hidden',
        }}>
          {editing ? (
            <textarea
              ref={textareaRef}
              defaultValue={text || ''}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              onInput={autosizeTextarea}
              rows={1}
              className="w-full outline-none resize-none border-none bg-transparent p-0 m-0 block"
              style={{
                ...textStyles,
                cursor: 'text',
                userSelect: 'text',
                height: 'auto',
                overflow: 'hidden',
              }}
            />
          ) : (
            <div
              className="w-full"
              style={{
                ...textStyles,
                cursor: 'default',
                userSelect: 'none',
              }}
            >
              {renderedContent || text || ''}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const TextNode = memo(TextNodeComponent);
