import { useCallback } from 'react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import type { BoardElement, ElementStyle, CanvasSettings } from '@/types/board';
import { formatFileSize, formatTimestamp, getFileName } from '@/utils/helpers';
import { RefreshCw, Trash2, Copy, Lock, Unlock, Eye, EyeOff, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { ResizeHandle } from '@/components/InsertPanel/InsertPanel';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-inspector-border">
      <div className="px-3 py-1.5 text-2xs font-semibold text-gray-500 uppercase tracking-wider bg-inspector-section">
        {title}
      </div>
      <div className="px-2.5 py-2 space-y-2 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1 min-w-0">
      <label className="text-2xs text-gray-500 w-12 shrink-0 truncate">{label}</label>
      <div className="flex-1 min-w-[40px] overflow-hidden">{children}</div>
    </div>
  );
}

function CompactField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-0.5 min-w-0">
      <label className="text-2xs text-gray-400 shrink-0">{label}</label>
      <div className="flex-1 min-w-[30px] overflow-hidden">{children}</div>
    </div>
  );
}

function NumberInput({ value, onChange, min, max, step, className }: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}) {
  return (
    <input
      type="number"
      value={Math.round(value * 100) / 100}
      onChange={e => onChange(Number(e.target.value))}
      min={min}
      max={max}
      step={step || 1}
      className={`w-full min-w-[40px] px-1 py-px text-2xs border border-gray-200 rounded bg-white focus:border-accent focus:outline-none ${className || ''}`}
    />
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1 min-w-0">
      <div className="relative w-2.5 h-2.5 shrink-0 border border-gray-300 overflow-hidden cursor-pointer">
        <div className="absolute inset-0" style={{ backgroundColor: value || 'transparent' }} />
        <input
          type="color"
          value={value || '#000000'}
          onChange={e => onChange(e.target.value)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
      </div>
      <input
        type="text"
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        className="flex-1 min-w-[40px] px-1 py-px text-2xs border border-gray-200 rounded bg-white focus:border-accent focus:outline-none font-mono"
        placeholder="transparent"
      />
    </div>
  );
}

function SelectInput({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full min-w-[40px] px-1 py-px text-2xs border border-gray-200 rounded bg-white focus:border-accent focus:outline-none"
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function BoardInspector() {
  const board = useBoardStore(s => s.board);
  const setBoardName = useBoardStore(s => s.setBoardName);
  const updateCanvas = useBoardStore(s => s.updateCanvas);

  if (!board) return null;

  return (
    <>
      <Section title="Board">
        <Field label="Name">
          <input
            type="text"
            value={board.name}
            onChange={e => setBoardName(e.target.value)}
            className="w-full min-w-[40px] px-1 py-px text-2xs border border-gray-200 rounded bg-white focus:border-accent focus:outline-none"
          />
        </Field>
        <Field label="ID">
          <span className="text-2xs text-gray-400 font-mono truncate block">{board.id}</span>
        </Field>
      </Section>

      <Section title="Canvas">
        <div className="grid grid-cols-2 gap-1.5">
          <CompactField label="W">
            <NumberInput value={board.canvas.width} onChange={v => updateCanvas({ width: v })} min={100} />
          </CompactField>
          <CompactField label="H">
            <NumberInput value={board.canvas.height} onChange={v => updateCanvas({ height: v })} min={100} />
          </CompactField>
        </div>
        <Field label="Background">
          <ColorInput value={board.canvas.background} onChange={v => updateCanvas({ background: v })} />
        </Field>
        <Field label="Grid Size">
          <NumberInput value={board.canvas.grid_size} onChange={v => updateCanvas({ grid_size: v })} min={5} max={100} />
        </Field>
        <Field label="Grid Style">
          <SelectInput
            value={board.canvas.grid_pattern || 'dots'}
            onChange={v => updateCanvas({ grid_pattern: v as any })}
            options={[
              { value: 'dots', label: 'Dots' },
              { value: 'lines', label: 'Lines' },
              { value: 'cross', label: 'Cross' },
            ]}
          />
        </Field>
      </Section>

      <Section title="Info">
        <div className="text-2xs text-gray-500 space-y-0.5">
          <div>Elements: {board.elements.length}</div>
          <div>Updated: {formatTimestamp(board.updated_at)}</div>
          <div>Schema v{board.schema_version}</div>
        </div>
      </Section>
    </>
  );
}

function ElementInspector({ element }: { element: BoardElement }) {
  const updateElement = useBoardStore(s => s.updateElement);
  const pushHistory = useBoardStore(s => s.pushHistory);
  const removeElements = useBoardStore(s => s.removeElements);
  const duplicateElements = useBoardStore(s => s.duplicateElements);
  const toggleLock = useBoardStore(s => s.toggleLock);
  const bumpImageVersion = useBoardStore(s => s.bumpImageVersion);
  const clearSelection = useUIStore(s => s.clearSelection);
  const setSelectedIds = useUIStore(s => s.setSelectedIds);

  const update = useCallback((changes: Partial<BoardElement>) => {
    updateElement(element.id, changes);
  }, [element.id, updateElement]);

  const updateStyle = useCallback((styleChanges: Partial<ElementStyle>) => {
    update({ style: { ...element.style, ...styleChanges } });
  }, [element.style, update]);

  return (
    <>
      <Section title={`${element.type.charAt(0).toUpperCase() + element.type.slice(1)}`}>
        <div className="flex items-center gap-1 mb-2">
          <button
            onClick={() => { removeElements([element.id]); clearSelection(); }}
            className="p-1 text-gray-400 hover:text-red-500 rounded"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
          <button
            onClick={() => {
              const duped = duplicateElements([element.id]);
              setSelectedIds(duped.map(e => e.id));
            }}
            className="p-1 text-gray-400 hover:text-gray-700 rounded"
            title="Duplicate"
          >
            <Copy size={14} />
          </button>
          <button
            onClick={() => toggleLock([element.id])}
            className="p-1 text-gray-400 hover:text-gray-700 rounded"
            title={element.locked ? 'Unlock' : 'Lock'}
          >
            {element.locked ? <Lock size={14} /> : <Unlock size={14} />}
          </button>
          <span className="text-2xs text-gray-400 ml-auto font-mono">{element.id.slice(0, 8)}</span>
        </div>
      </Section>

      <Section title="Position & Size">
        <div className="grid grid-cols-2 gap-1.5">
          <CompactField label="X">
            <NumberInput value={element.x} onChange={v => { pushHistory('Move'); update({ x: v }); }} />
          </CompactField>
          <CompactField label="Y">
            <NumberInput value={element.y} onChange={v => { pushHistory('Move'); update({ y: v }); }} />
          </CompactField>
          <CompactField label="W">
            <NumberInput value={element.width} onChange={v => { pushHistory('Resize'); update({ width: v }); }} min={10} />
          </CompactField>
          <CompactField label="H">
            <NumberInput value={element.height} onChange={v => { pushHistory('Resize'); update({ height: v }); }} min={10} />
          </CompactField>
        </div>
        <Field label="Z-Index">
          <NumberInput value={element.z_index} onChange={v => update({ z_index: v })} />
        </Field>
        <Field label="Rotation">
          <NumberInput value={element.rotation} onChange={v => update({ rotation: v })} min={0} max={360} />
        </Field>
        <Field label="Opacity">
          <NumberInput value={element.style.opacity ?? 1} onChange={v => updateStyle({ opacity: v })} min={0} max={1} step={0.1} />
        </Field>
      </Section>

      {/* Image-specific */}
      {element.type === 'image' && element.source && (
        <Section title="Image Source">
          <Field label="Path">
            <input
              type="text"
              value={element.source.path}
              onChange={e => {
                pushHistory('Change path');
                update({ source: { ...element.source!, path: e.target.value } });
              }}
              className="w-full min-w-[40px] px-1 py-px text-2xs border border-gray-200 rounded bg-white focus:border-accent focus:outline-none font-mono"
              placeholder="/path/to/image.png"
            />
          </Field>
          {element.source.path && (
            <div className="text-2xs text-gray-400 truncate">{getFileName(element.source.path)}</div>
          )}
          <Field label="Fit">
            <SelectInput
              value={element.style.fitMode || 'contain'}
              onChange={v => updateStyle({ fitMode: v as any })}
              options={[
                { value: 'contain', label: 'Contain' },
                { value: 'cover', label: 'Cover' },
                { value: 'stretch', label: 'Stretch' },
                { value: 'center', label: 'Center (no scale)' },
              ]}
            />
          </Field>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-2xs text-gray-500">
              <input
                type="checkbox"
                checked={element.source.autoRefresh}
                onChange={e => update({ source: { ...element.source!, autoRefresh: e.target.checked } })}
                className="rounded"
              />
              Auto-refresh
            </label>
            <button
              onClick={() => element.source?.path && bumpImageVersion(element.source.path)}
              className="p-1 text-gray-400 hover:text-gray-700 rounded ml-auto"
              title="Refresh now"
            >
              <RefreshCw size={12} />
            </button>
          </div>
        </Section>
      )}

      {/* Image style */}
      {element.type === 'image' && (
        <Section title="Image Style">
          <Field label="Border">
            <ColorInput value={element.style.borderColor || '#d0d0d0'} onChange={v => updateStyle({ borderColor: v })} />
          </Field>
          <Field label="B. Width">
            <NumberInput value={element.style.borderWidth ?? 1} onChange={v => updateStyle({ borderWidth: v })} min={0} max={20} />
          </Field>
          <Field label="Radius">
            <NumberInput value={element.style.borderRadius ?? 4} onChange={v => updateStyle({ borderRadius: v })} min={0} max={100} />
          </Field>
          <Field label="Bg">
            <ColorInput value={element.style.background || '#ffffff'} onChange={v => updateStyle({ background: v })} />
          </Field>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-2xs text-gray-500">
              <input
                type="checkbox"
                checked={element.style.shadow ?? true}
                onChange={e => updateStyle({ shadow: e.target.checked })}
                className="rounded"
              />
              Shadow
            </label>
          </div>
        </Section>
      )}

      {/* Text-specific */}
      {element.type === 'text' && (
        <Section title="Text">
          <Field label="Content">
            <input
              type="text"
              value={element.text || ''}
              onChange={e => { update({ text: e.target.value }); }}
              className="w-full min-w-[40px] px-1 py-px text-2xs border border-gray-200 rounded bg-white focus:border-accent focus:outline-none"
            />
          </Field>
          <Field label="Font Size">
            <NumberInput value={element.style.fontSize ?? 14} onChange={v => updateStyle({ fontSize: v })} min={6} max={200} />
          </Field>
          <Field label="Weight">
            <SelectInput
              value={String(element.style.fontWeight ?? 400)}
              onChange={v => updateStyle({ fontWeight: Number(v) })}
              options={[
                { value: '300', label: 'Light' },
                { value: '400', label: 'Normal' },
                { value: '500', label: 'Medium' },
                { value: '600', label: 'Semibold' },
                { value: '700', label: 'Bold' },
                { value: '900', label: 'Black' },
              ]}
            />
          </Field>
          <Field label="Color">
            <ColorInput value={element.style.color || '#111111'} onChange={v => updateStyle({ color: v })} />
          </Field>
          <Field label="Align">
            <SelectInput
              value={element.style.textAlign || 'left'}
              onChange={v => updateStyle({ textAlign: v as any })}
              options={[
                { value: 'left', label: 'Left' },
                { value: 'center', label: 'Center' },
                { value: 'right', label: 'Right' },
              ]}
            />
          </Field>
          <Field label="Bg">
            <ColorInput value={element.style.background || 'transparent'} onChange={v => updateStyle({ background: v })} />
          </Field>
        </Section>
      )}

      {/* Rectangle-specific */}
      {element.type === 'rectangle' && (
        <Section title="Shape Style">
          <Field label="Fill">
            <ColorInput value={element.style.fill || 'transparent'} onChange={v => updateStyle({ fill: v })} />
          </Field>
          <Field label="Stroke">
            <ColorInput value={element.style.strokeColor || '#333333'} onChange={v => updateStyle({ strokeColor: v })} />
          </Field>
          <Field label="S. Width">
            <NumberInput value={element.style.strokeWidth ?? 2} onChange={v => updateStyle({ strokeWidth: v })} min={0} max={20} />
          </Field>
          <Field label="Style">
            <SelectInput
              value={element.style.strokeStyle || 'solid'}
              onChange={v => updateStyle({ strokeStyle: v as any })}
              options={[
                { value: 'solid', label: 'Solid' },
                { value: 'dashed', label: 'Dashed' },
                { value: 'dotted', label: 'Dotted' },
              ]}
            />
          </Field>
          <Field label="Radius">
            <NumberInput value={element.style.borderRadius ?? 0} onChange={v => updateStyle({ borderRadius: v })} min={0} max={100} />
          </Field>
        </Section>
      )}

      {/* Arrow-specific */}
      {element.type === 'arrow' && (
        <Section title="Arrow Style">
          <Field label="Color">
            <ColorInput value={element.style.strokeColor || '#333333'} onChange={v => updateStyle({ strokeColor: v })} />
          </Field>
          <Field label="Width">
            <NumberInput value={element.style.strokeWidth ?? 2} onChange={v => updateStyle({ strokeWidth: v })} min={1} max={20} />
          </Field>
          <Field label="Style">
            <SelectInput
              value={element.style.strokeStyle || 'solid'}
              onChange={v => updateStyle({ strokeStyle: v as any })}
              options={[
                { value: 'solid', label: 'Solid' },
                { value: 'dashed', label: 'Dashed' },
                { value: 'dotted', label: 'Dotted' },
              ]}
            />
          </Field>
        </Section>
      )}
    </>
  );
}

function MultiSelectInspector({ ids }: { ids: string[] }) {
  const board = useBoardStore(s => s.board);
  const alignElements = useBoardStore(s => s.alignElements);
  const distributeElements = useBoardStore(s => s.distributeElements);
  const toggleLock = useBoardStore(s => s.toggleLock);

  return (
    <>
      <Section title={`${ids.length} Elements Selected`}>
        <div className="space-y-2">
          <div className="text-xs text-gray-500">Alignment</div>
          <div className="grid grid-cols-3 gap-1">
            {(['left', 'centerH', 'right', 'top', 'centerV', 'bottom'] as const).map(align => (
              <button
                key={align}
                onClick={() => alignElements(ids, align)}
                className="px-2 py-1 text-2xs bg-gray-50 hover:bg-gray-100 rounded border border-gray-200 text-gray-600"
              >
                {align.replace('centerH', 'Center H').replace('centerV', 'Center V')}
              </button>
            ))}
          </div>
          {ids.length >= 3 && (
            <>
              <div className="text-xs text-gray-500 mt-2">Distribution</div>
              <div className="grid grid-cols-2 gap-1">
                <button
                  onClick={() => distributeElements(ids, 'horizontal')}
                  className="px-2 py-1 text-2xs bg-gray-50 hover:bg-gray-100 rounded border border-gray-200 text-gray-600"
                >
                  Distribute H
                </button>
                <button
                  onClick={() => distributeElements(ids, 'vertical')}
                  className="px-2 py-1 text-2xs bg-gray-50 hover:bg-gray-100 rounded border border-gray-200 text-gray-600"
                >
                  Distribute V
                </button>
              </div>
            </>
          )}
          <button
            onClick={() => toggleLock(ids)}
            className="w-full px-2 py-1 text-2xs bg-gray-50 hover:bg-gray-100 rounded border border-gray-200 text-gray-600"
          >
            Toggle Lock
          </button>
        </div>
      </Section>
    </>
  );
}

export function Inspector() {
  const board = useBoardStore(s => s.board);
  const selectedIds = useUIStore(s => s.selectedIds);
  const showInspector = useUIStore(s => s.showInspector);
  const toggleInspector = useUIStore(s => s.toggleInspector);
  const inspectorWidth = useUIStore(s => s.inspectorWidth);
  const setInspectorWidth = useUIStore(s => s.setInspectorWidth);

  if (!board) return null;

  if (!showInspector) {
    return (
      <button
        onClick={toggleInspector}
        className="w-8 bg-inspector-bg border-l border-inspector-border flex flex-col items-center pt-2 shrink-0 hover:bg-gray-100 transition-colors"
        title="Show Properties"
      >
        <PanelRightOpen size={16} className="text-gray-400" />
      </button>
    );
  }

  const selectedElements = board.elements.filter(el => selectedIds.includes(el.id));

  return (
    <div className="flex shrink-0">
      <ResizeHandle side="left" onResize={(delta) => setInspectorWidth(inspectorWidth + delta)} />
      <div className="bg-inspector-bg overflow-y-auto overflow-x-hidden flex flex-col" style={{ width: inspectorWidth }}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-inspector-border">
          <span className="text-xs font-semibold text-gray-700">Properties</span>
          <button onClick={toggleInspector} className="text-gray-400 hover:text-gray-600" title="Collapse panel">
            <PanelRightClose size={14} />
          </button>
        </div>
        {selectedElements.length === 0 && <BoardInspector />}
        {selectedElements.length === 1 && <ElementInspector element={selectedElements[0]} />}
        {selectedElements.length > 1 && <MultiSelectInspector ids={selectedIds} />}
      </div>
    </div>
  );
}
