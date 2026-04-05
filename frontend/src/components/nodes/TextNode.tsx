import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { NodeProps, NodeResizer } from '@xyflow/react';
import { useBoardStore } from '@/store/boardStore';

interface TextNodeData {
  elementId: string;
  [key: string]: unknown;
}

function TextNodeComponent({ id, data, selected }: NodeProps) {
  const elementId = (data as TextNodeData).elementId;
  const element = useBoardStore(s => s.board?.elements.find(el => el.id === elementId));
  const updateElement = useBoardStore(s => s.updateElement);
  const pushHistory = useBoardStore(s => s.pushHistory);
  const [editing, setEditing] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const hasAutoEdited = useRef(false);

  // Auto-enter edit mode for newly created text boxes
  useEffect(() => {
    if (selected && element?.text === 'Label' && !hasAutoEdited.current) {
      hasAutoEdited.current = true;
      setEditing(true);
    }
  }, [selected, element?.text]);

  const handleDoubleClick = useCallback(() => {
    if (element && !element.locked) {
      setEditing(true);
    }
  }, [element?.locked]);

  const handleBlur = useCallback(() => {
    setEditing(false);
    if (textRef.current && element) {
      const newText = textRef.current.innerText;
      if (newText !== element.text) {
        pushHistory('Edit text');
        updateElement(elementId, { text: newText });
      }
    }
  }, [elementId, element?.text, updateElement, pushHistory]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setEditing(false);
      textRef.current?.blur();
    }
    e.stopPropagation();
  }, []);

  useEffect(() => {
    if (editing && textRef.current) {
      textRef.current.focus();
      const range = document.createRange();
      range.selectNodeContents(textRef.current);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, [editing]);

  if (!element || element.type !== 'text') return null;

  const { style, text } = element;

  return (
    <>
      <NodeResizer
        isVisible={selected && !element.locked}
        minWidth={30}
        minHeight={20}
        lineStyle={{ borderColor: '#3b82f6', borderWidth: 1 }}
        handleStyle={{ width: 8, height: 8, backgroundColor: 'white', borderColor: '#3b82f6', borderWidth: 2, borderRadius: 1 }}
      />
      <div
        className="w-full h-full"
        style={{
          backgroundColor: style.background || 'transparent',
          padding: style.padding ?? 4,
          opacity: style.opacity ?? 1,
          border: selected ? '1px dashed #3b82f6' : '1px solid transparent',
        }}
        onDoubleClick={handleDoubleClick}
      >
        <div
          ref={textRef}
          contentEditable={editing}
          suppressContentEditableWarning
          onBlur={handleBlur}
          onKeyDown={editing ? handleKeyDown : undefined}
          className="w-full h-full outline-none"
          style={{
            fontSize: style.fontSize ?? 14,
            fontWeight: style.fontWeight ?? 400,
            fontFamily: style.fontFamily || 'Inter, sans-serif',
            color: style.color || '#111111',
            textAlign: (style.textAlign as any) || 'left',
            lineHeight: style.lineHeight ?? 1.4,
            fontStyle: style.italic ? 'italic' : 'normal',
            cursor: editing ? 'text' : 'default',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            userSelect: editing ? 'text' : 'none',
          }}
        >
          {text || ''}
        </div>
      </div>
    </>
  );
}

export const TextNode = memo(TextNodeComponent);
