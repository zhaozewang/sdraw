import { useCallback, useState } from 'react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import type { BoardElement, ElementStyle, CanvasSettings } from '@/types/board';
import { formatFileSize, formatTimestamp, getFileName } from '@/utils/helpers';
import { RefreshCw, Trash2, Copy, Lock, Unlock, Eye, EyeOff, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { ResizeHandle } from '@/components/InsertPanel/InsertPanel';

/** Color preset groups for shape fill+border pairs */
type ColorPreset = { name: string; fill: string; border: string };
const COLOR_GROUPS: { label: string; presets: ColorPreset[] }[] = [
  {
    label: 'Scientific',
    presets: [
      { name: 'Tol Blue',   fill: '#BBCCEE', border: '#4477AA' },
      { name: 'Tol Cyan',   fill: '#CCEEFF', border: '#44AAAA' },
      { name: 'Tol Green',  fill: '#CCDDAA', border: '#558833' },
      { name: 'Tol Yellow', fill: '#EEEEBB', border: '#AAAA44' },
      { name: 'Tol Red',    fill: '#EECCCC', border: '#AA4455' },
      { name: 'Tol Purple', fill: '#DDCCEE', border: '#7744AA' },
      { name: 'Tol Orange', fill: '#FFDDCC', border: '#CC6644' },
      { name: 'Tol Pink',   fill: '#EEDDDD', border: '#AA6688' },
      { name: 'Brewer Slate', fill: '#D0D1E6', border: '#3F5D7D' },
      { name: 'Brewer Sage',  fill: '#D5E8D4', border: '#4E8542' },
    ],
  },
  {
    label: 'Pastel',
    presets: [
      { name: 'Blue',     fill: '#DBEAFE', border: '#3B82F6' },
      { name: 'Rose',     fill: '#FFE4E6', border: '#E11D48' },
      { name: 'Mint',     fill: '#D1FAE5', border: '#10B981' },
      { name: 'Lavender', fill: '#EDE9FE', border: '#8B5CF6' },
      { name: 'Peach',    fill: '#FFF1E6', border: '#F97316' },
      { name: 'Sky',      fill: '#E0F2FE', border: '#0EA5E9' },
      { name: 'Lemon',    fill: '#FEF9C3', border: '#CA8A04' },
      { name: 'Fuchsia',  fill: '#FAE8FF', border: '#C026D3' },
      { name: 'Teal',     fill: '#CCFBF1', border: '#14B8A6' },
    ],
  },
  {
    label: 'Vivid',
    presets: [
      { name: 'Blue',   fill: '#93C5FD', border: '#1E3A5F' },
      { name: 'Red',    fill: '#FCA5A5', border: '#7F1D1D' },
      { name: 'Green',  fill: '#86EFAC', border: '#14532D' },
      { name: 'Amber',  fill: '#FCD34D', border: '#78350F' },
      { name: 'Purple', fill: '#C4B5FD', border: '#3B0764' },
      { name: 'Cyan',   fill: '#67E8F9', border: '#164E63' },
      { name: 'Orange', fill: '#FDBA74', border: '#7C2D12' },
      { name: 'Pink',   fill: '#F9A8D4', border: '#701A45' },
      { name: 'Lime',   fill: '#BEF264', border: '#365314' },
      { name: 'Indigo', fill: '#A5B4FC', border: '#1E1B4B' },
    ],
  },
  {
    label: 'Neutral',
    presets: [
      { name: 'Light Gray', fill: '#F3F4F6', border: '#6B7280' },
      { name: 'Cool Gray',  fill: '#E5E7EB', border: '#4B5563' },
      { name: 'Warm Gray',  fill: '#F5F5F4', border: '#78716C' },
      { name: 'Silver',     fill: '#E2E8F0', border: '#475569' },
      { name: 'Zinc',       fill: '#E4E4E7', border: '#52525B' },
      { name: 'Slate',      fill: '#CBD5E1', border: '#334155' },
    ],
  },
  {
    label: 'Earth',
    presets: [
      { name: 'Sand',       fill: '#FEF3C7', border: '#92400E' },
      { name: 'Terracotta', fill: '#FED7AA', border: '#9A3412' },
      { name: 'Moss',       fill: '#D9F99D', border: '#4D7C0F' },
      { name: 'Clay',       fill: '#E8D5C4', border: '#7C5B3A' },
      { name: 'Forest',     fill: '#BBF7D0', border: '#166534' },
      { name: 'Sienna',     fill: '#F5DEB3', border: '#8B4513' },
    ],
  },
];

/** Marker picker with inline SVG previews */
const MARKER_TYPES: Array<{ value: string; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'arrow', label: 'Arrow' },
  { value: 'arrow-open', label: 'Open' },
  { value: 'dot', label: 'Dot' },
  { value: 'diamond', label: 'Diamond' },
  { value: 'bar', label: 'Bar' },
];

/** Line type options with SVG path builders for thumbnails */
const LINE_TYPES: Array<{ value: string; label: string; path: (w: number, h: number) => string }> = [
  {
    value: 'straight', label: 'Straight',
    path: (w, h) => `M2,${h / 2} L${w - 2},${h / 2}`,
  },
  {
    value: 'smooth', label: 'Smooth',
    path: (w, h) => {
      const t = w * 0.3;
      return `M2,${h * 0.7} C${2 + t},${h * 0.7} ${w - 2 - t},${h * 0.3} ${w - 2},${h * 0.3}`;
    },
  },
  {
    value: 'quadratic', label: 'Curve',
    path: (w, h) => `M2,${h * 0.8} Q${w / 2},${h * -0.2} ${w - 2},${h * 0.8}`,
  },
  {
    value: 'cubic', label: 'S-Curve',
    path: (w, h) => `M2,${h * 0.8} C${w * 0.35},${h * -0.1} ${w * 0.65},${h * 1.1} ${w - 2},${h * 0.2}`,
  },
  {
    value: 'step', label: 'Step',
    path: (w, h) => {
      const mx = w / 2;
      return `M2,${h * 0.3} L${mx},${h * 0.3} L${mx},${h * 0.7} L${w - 2},${h * 0.7}`;
    },
  },
  {
    value: 'step-rounded', label: 'Rounded Step',
    path: (w, h) => {
      const mx = w / 2, r = 3;
      const y0 = h * 0.3, y1 = h * 0.7;
      return `M2,${y0} L${mx - r},${y0} Q${mx},${y0} ${mx},${y0 + r} L${mx},${y1 - r} Q${mx},${y1} ${mx + r},${y1} L${w - 2},${y1}`;
    },
  },
];

/** Stroke style options with SVG illustrations */
const STROKE_STYLES: Array<{ value: string; label: string; dashArray?: string }> = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed', dashArray: '5,3' },
  { value: 'dotted', label: 'Dotted', dashArray: '1.5,3' },
];

/** Small square SVG icon for a marker type (14x14) */
function MarkerThumb({ type, side }: { type: string; side: 'start' | 'end' }) {
  const s = 14, mid = s / 2;
  const lx1 = 1, lx2 = s - 1;
  const mx = side === 'start' ? lx1 + 1 : lx2 - 1;
  const col = 'currentColor';
  let mk: React.ReactNode = null;

  if (type === 'arrow') {
    const d = side === 'start'
      ? `M${mx + 4},${mid - 2.5} L${mx},${mid} L${mx + 4},${mid + 2.5}Z`
      : `M${mx - 4},${mid - 2.5} L${mx},${mid} L${mx - 4},${mid + 2.5}Z`;
    mk = <path d={d} fill={col} />;
  } else if (type === 'arrow-open') {
    const d = side === 'start'
      ? `M${mx + 4},${mid - 2.5} L${mx},${mid} L${mx + 4},${mid + 2.5}`
      : `M${mx - 4},${mid - 2.5} L${mx},${mid} L${mx - 4},${mid + 2.5}`;
    mk = <path d={d} fill="none" stroke={col} strokeWidth="1.2" />;
  } else if (type === 'dot') {
    mk = <circle cx={mx} cy={mid} r={2} fill={col} />;
  } else if (type === 'diamond') {
    mk = <path d={`M${mx},${mid - 2.5} L${mx + 2.5},${mid} L${mx},${mid + 2.5} L${mx - 2.5},${mid}Z`} fill={col} />;
  } else if (type === 'bar') {
    mk = <line x1={mx} y1={mid - 3} x2={mx} y2={mid + 3} stroke={col} strokeWidth="1.5" />;
  }

  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
      <line x1={lx1} y1={mid} x2={lx2} y2={mid} stroke={col} strokeWidth="1" />
      {mk}
    </svg>
  );
}

/** Icon button row for line type selection */
function LineTypeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-0.5 p-px flex-wrap">
      {LINE_TYPES.map(t => {
        const active = value === t.value;
        const sw = 36, sh = 20;
        return (
          <button
            key={t.value}
            title={t.label}
            onClick={() => onChange(t.value)}
            className={`flex items-center justify-center rounded transition-colors ${
              active ? 'bg-blue-50 dark:bg-blue-900/30 outline outline-1 outline-blue-400' : 'hover:bg-gray-100 dark:hover:bg-surface-tertiary'
            }`}
            style={{ width: sw, height: sh }}
          >
            <svg width={sw - 4} height={sh - 4} viewBox={`0 0 ${sw - 4} ${sh - 4}`}>
              <path
                d={t.path(sw - 4, sh - 4)}
                fill="none"
                stroke={active ? '#3b82f6' : '#6b7280'}
                strokeWidth="1.5"
              />
            </svg>
          </button>
        );
      })}
    </div>
  );
}

/** Icon button row for stroke style selection */
function StrokeStyleSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-0.5 p-px">
      {STROKE_STYLES.map(t => {
        const active = value === t.value;
        const sw = 40, sh = 18;
        return (
          <button
            key={t.value}
            title={t.label}
            onClick={() => onChange(t.value)}
            className={`flex items-center justify-center rounded transition-colors ${
              active ? 'bg-blue-50 dark:bg-blue-900/30 outline outline-1 outline-blue-400' : 'hover:bg-gray-100 dark:hover:bg-surface-tertiary'
            }`}
            style={{ width: sw, height: sh }}
          >
            <svg width={sw - 6} height={sh - 4} viewBox={`0 0 ${sw - 6} ${sh - 4}`}>
              <line
                x1="0" y1={(sh - 4) / 2}
                x2={sw - 6} y2={(sh - 4) / 2}
                stroke={active ? '#3b82f6' : '#6b7280'}
                strokeWidth="2"
                strokeDasharray={t.dashArray}
                strokeLinecap="round"
              />
            </svg>
          </button>
        );
      })}
    </div>
  );
}

function MarkerSelect({ value, side, onChange }: {
  value: string; side: 'start' | 'end'; onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-0.5 p-px">
      {MARKER_TYPES.map(t => {
        const active = value === t.value;
        return (
          <button
            key={t.value}
            title={t.label}
            onClick={() => onChange(t.value)}
            className={`flex items-center justify-center rounded transition-colors text-gray-500 ${
              active ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 outline outline-1 outline-blue-400' : 'hover:bg-gray-100 dark:hover:bg-surface-tertiary'
            }`}
            style={{ width: 20, height: 20 }}
          >
            {t.value === 'none' ? (
              <svg width={14} height={14} viewBox="0 0 14 14">
                <line x1={1} y1={7} x2={13} y2={7} stroke="currentColor" strokeWidth="1" />
              </svg>
            ) : (
              <MarkerThumb type={t.value} side={side} />
            )}
          </button>
        );
      })}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-inspector-border">
      <div className="px-3 py-1.5 text-2xs font-semibold text-gray-500 dark:text-on-surface-muted uppercase tracking-wider bg-inspector-section">
        {title}
      </div>
      <div className="px-2.5 py-2 space-y-2">
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1 min-w-0">
      <label className="text-2xs text-gray-500 dark:text-on-surface-muted w-12 shrink-0 truncate">{label}</label>
      <div className="flex-1 min-w-[40px] overflow-hidden">{children}</div>
    </div>
  );
}

function CompactField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-0.5 min-w-0">
      <label className="text-2xs text-gray-400 dark:text-on-surface-muted shrink-0">{label}</label>
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
      className={`w-full min-w-[40px] px-1 py-px text-2xs border border-gray-200 dark:border-border rounded bg-white dark:bg-surface-tertiary dark:text-on-surface-primary focus:border-accent focus:outline-none ${className || ''}`}
    />
  );
}

const RECENT_COLORS_KEY = 'sdraw_recent_colors';
const MAX_RECENT_COLORS = 8;

function getRecentColors(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_COLORS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function addRecentColor(color: string) {
  if (!color || color === 'transparent') return;
  const normalized = color.toLowerCase();
  const colors = getRecentColors().filter(c => c.toLowerCase() !== normalized);
  colors.unshift(color);
  localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(colors.slice(0, MAX_RECENT_COLORS)));
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const isTransparent = !value || value === 'transparent';
  const [recentColors, setRecentColors] = useState<string[]>(getRecentColors);

  const handleChange = useCallback((color: string) => {
    onChange(color);
    if (color && color !== 'transparent') {
      addRecentColor(color);
      setRecentColors(getRecentColors());
    }
  }, [onChange]);

  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1 min-w-0">
        <div className="relative w-2.5 h-2.5 shrink-0 border border-gray-300 dark:border-border overflow-hidden cursor-pointer">
          {isTransparent ? (
            <div className="absolute inset-0" style={{ background: 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 5px 5px' }} />
          ) : (
            <div className="absolute inset-0" style={{ backgroundColor: value }} />
          )}
          <input
            type="color"
            value={value && value !== 'transparent' ? value : '#000000'}
            onChange={e => handleChange(e.target.value)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </div>
        <button
          onClick={() => handleChange(isTransparent ? '#ffffff' : 'transparent')}
          className={`shrink-0 px-1 py-px text-2xs rounded border ${isTransparent ? 'border-accent text-accent bg-accent/5' : 'border-gray-200 dark:border-border text-gray-400 dark:text-on-surface-muted hover:border-gray-300'}`}
          title={isTransparent ? 'Set to white' : 'Set to transparent'}
        >
          {isTransparent ? '∅' : '∅'}
        </button>
        <input
          type="text"
          value={value || ''}
          onChange={e => handleChange(e.target.value)}
          className="flex-1 min-w-[30px] px-1 py-px text-2xs border border-gray-200 dark:border-border rounded bg-white dark:bg-surface-tertiary dark:text-on-surface-primary focus:border-accent focus:outline-none font-mono"
          placeholder="transparent"
        />
      </div>
      {recentColors.length > 0 && (
        <div className="flex gap-0.5">
          {recentColors.map((c, i) => (
            <button
              key={`${c}-${i}`}
              onClick={() => handleChange(c)}
              className="w-3 h-3 rounded-sm border border-gray-300 dark:border-border hover:scale-125 transition-transform"
              style={{ backgroundColor: c }}
              title={c}
            />
          ))}
        </div>
      )}
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
      className="w-full min-w-[40px] px-1 py-px text-2xs border border-gray-200 dark:border-border rounded bg-white dark:bg-surface-tertiary dark:text-on-surface-primary focus:border-accent focus:outline-none"
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function ColorPalette({ onApply }: { onApply: (fill: string, border: string) => void }) {
  const [activeGroup, setActiveGroup] = useState(0);
  const group = COLOR_GROUPS[activeGroup];

  return (
    <div className="mb-2">
      {/* Group tabs */}
      <div className="flex gap-0.5 mb-1.5 px-1 flex-wrap">
        {COLOR_GROUPS.map((g, i) => (
          <button
            key={g.label}
            onClick={() => setActiveGroup(i)}
            className={`px-1.5 py-0.5 text-2xs rounded transition-colors ${
              i === activeGroup
                ? 'bg-gray-700 dark:bg-gray-500 text-white'
                : 'text-gray-500 dark:text-on-surface-muted hover:bg-gray-100 dark:hover:bg-surface-tertiary'
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>
      {/* Color swatches */}
      <div className="flex flex-wrap gap-1 px-1">
        {group.presets.map(p => (
          <button
            key={p.name}
            title={p.name}
            onClick={() => onApply(p.fill, p.border)}
            className="w-5 h-5 rounded-sm border border-gray-200 dark:border-border hover:scale-125 transition-transform"
            style={{ background: p.fill, boxShadow: `inset 0 0 0 1.5px ${p.border}` }}
          />
        ))}
        <button
          title="No fill"
          onClick={() => onApply('transparent', '#333333')}
          className="w-5 h-5 rounded-sm border border-gray-300 dark:border-border hover:scale-125 transition-transform relative overflow-hidden"
          style={{ background: '#fff' }}
        >
          <div className="absolute inset-0" style={{ background: 'linear-gradient(to top right, transparent 45%, #ef4444 45%, #ef4444 55%, transparent 55%)' }} />
        </button>
      </div>
    </div>
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
            className="w-full min-w-[40px] px-1 py-px text-2xs border border-gray-200 dark:border-border rounded bg-white dark:bg-surface-tertiary dark:text-on-surface-primary focus:border-accent focus:outline-none"
          />
        </Field>
        <Field label="ID">
          <span className="text-2xs text-gray-400 dark:text-on-surface-muted font-mono truncate block">{board.id}</span>
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
        <div className="text-2xs text-gray-500 dark:text-on-surface-muted space-y-0.5">
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
  const bringToFront = useBoardStore(s => s.bringToFront);
  const sendToBack = useBoardStore(s => s.sendToBack);
  const ungroupElements = useBoardStore(s => s.ungroupElements);
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
            onClick={() => { const id = element.id; clearSelection(); removeElements([id]); }}
            className="p-1 text-gray-400 dark:text-on-surface-muted hover:text-red-500 rounded"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
          <button
            onClick={() => {
              const duped = duplicateElements([element.id]);
              setSelectedIds(duped.map(e => e.id));
            }}
            className="p-1 text-gray-400 dark:text-on-surface-muted hover:text-gray-700 dark:hover:text-on-surface-primary rounded"
            title="Duplicate"
          >
            <Copy size={14} />
          </button>
          <button
            onClick={() => toggleLock([element.id])}
            className="p-1 text-gray-400 dark:text-on-surface-muted hover:text-gray-700 dark:hover:text-on-surface-primary rounded"
            title={element.locked ? 'Unlock' : 'Lock'}
          >
            {element.locked ? <Lock size={14} /> : <Unlock size={14} />}
          </button>
          <span className="text-2xs text-gray-400 dark:text-on-surface-muted ml-auto font-mono">{element.id.slice(0, 8)}</span>
        </div>
        {element.type === 'group' && (
          <button
            onClick={() => {
              const childIds = element.children || [];
              ungroupElements(element.id);
              setSelectedIds(childIds);
            }}
            className="w-full px-2 py-1 text-2xs bg-gray-50 dark:bg-surface-tertiary hover:bg-gray-100 dark:hover:bg-toolbar-hover rounded border border-gray-200 dark:border-border text-gray-600 dark:text-on-surface-secondary"
          >
            Ungroup ({element.children?.length ?? 0} items)
          </button>
        )}
      </Section>

      {element.type === 'arrow' ? (
        <Section title="Endpoints">
          {(() => {
            const pts = element.points && element.points.length >= 2
              ? element.points
              : [{ x: 0, y: element.height / 2 }, { x: element.width, y: element.height / 2 }];
            const startAbs = { x: element.x + pts[0].x, y: element.y + pts[0].y };
            const endAbs = { x: element.x + pts[1].x, y: element.y + pts[1].y };
            const setEndpoints = (sx: number, sy: number, ex: number, ey: number) => {
              const minX = Math.min(sx, ex);
              const minY = Math.min(sy, ey);
              const w = Math.max(Math.abs(ex - sx), 1);
              const h = Math.max(Math.abs(ey - sy), 1);
              pushHistory('Move endpoint');
              update({
                x: minX, y: minY, width: w, height: h,
                points: [{ x: sx - minX, y: sy - minY }, { x: ex - minX, y: ey - minY }],
              });
            };
            return (
              <>
                <div className="text-2xs text-gray-400 dark:text-on-surface-muted mb-0.5">Start</div>
                <div className="grid grid-cols-2 gap-1.5 mb-1.5">
                  <CompactField label="X">
                    <NumberInput value={Math.round(startAbs.x)} onChange={v => setEndpoints(v, startAbs.y, endAbs.x, endAbs.y)} />
                  </CompactField>
                  <CompactField label="Y">
                    <NumberInput value={Math.round(startAbs.y)} onChange={v => setEndpoints(startAbs.x, v, endAbs.x, endAbs.y)} />
                  </CompactField>
                </div>
                <div className="text-2xs text-gray-400 dark:text-on-surface-muted mb-0.5">End</div>
                <div className="grid grid-cols-2 gap-1.5">
                  <CompactField label="X">
                    <NumberInput value={Math.round(endAbs.x)} onChange={v => setEndpoints(startAbs.x, startAbs.y, v, endAbs.y)} />
                  </CompactField>
                  <CompactField label="Y">
                    <NumberInput value={Math.round(endAbs.y)} onChange={v => setEndpoints(startAbs.x, startAbs.y, endAbs.x, v)} />
                  </CompactField>
                </div>
              </>
            );
          })()}
          <Field label="Z-Index">
            <div className="flex items-center gap-1">
              <NumberInput value={element.z_index} onChange={v => update({ z_index: v })} />
              <button onClick={() => bringToFront([element.id])} className="px-1.5 py-px text-2xs bg-gray-50 dark:bg-surface-tertiary hover:bg-gray-100 dark:hover:bg-toolbar-hover rounded border border-gray-200 dark:border-border text-gray-600 dark:text-on-surface-secondary shrink-0" title="Bring to front">Top</button>
              <button onClick={() => sendToBack([element.id])} className="px-1.5 py-px text-2xs bg-gray-50 dark:bg-surface-tertiary hover:bg-gray-100 dark:hover:bg-toolbar-hover rounded border border-gray-200 dark:border-border text-gray-600 dark:text-on-surface-secondary shrink-0" title="Send to back">Btm</button>
            </div>
          </Field>
          <Field label="Opacity">
            <NumberInput value={element.style.opacity ?? 1} onChange={v => updateStyle({ opacity: v })} min={0} max={1} step={0.1} />
          </Field>
        </Section>
      ) : (
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
          {element.type !== 'image' && (
            <div className="flex items-center gap-1 mt-1">
              <label className="flex items-center gap-1 text-2xs text-gray-500 dark:text-on-surface-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!element.metadata?.lockAspectRatio}
                  onChange={e => update({ metadata: { ...element.metadata, lockAspectRatio: e.target.checked } })}
                  className="rounded"
                />
                Lock aspect ratio
              </label>
            </div>
          )}
          <Field label="Z-Index">
            <div className="flex items-center gap-1">
              <NumberInput value={element.z_index} onChange={v => update({ z_index: v })} />
              <button onClick={() => bringToFront([element.id])} className="px-1.5 py-px text-2xs bg-gray-50 dark:bg-surface-tertiary hover:bg-gray-100 dark:hover:bg-toolbar-hover rounded border border-gray-200 dark:border-border text-gray-600 dark:text-on-surface-secondary shrink-0" title="Bring to front">Top</button>
              <button onClick={() => sendToBack([element.id])} className="px-1.5 py-px text-2xs bg-gray-50 dark:bg-surface-tertiary hover:bg-gray-100 dark:hover:bg-toolbar-hover rounded border border-gray-200 dark:border-border text-gray-600 dark:text-on-surface-secondary shrink-0" title="Send to back">Btm</button>
            </div>
          </Field>
          <Field label="Rotation">
            <NumberInput value={element.rotation} onChange={v => update({ rotation: v })} min={0} max={360} />
          </Field>
          <Field label="Opacity">
            <NumberInput value={element.style.opacity ?? 1} onChange={v => updateStyle({ opacity: v })} min={0} max={1} step={0.1} />
          </Field>
        </Section>
      )}

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
            <div className="text-2xs text-gray-400 dark:text-on-surface-muted truncate">{getFileName(element.source.path)}</div>
          )}
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-2xs text-gray-500 dark:text-on-surface-muted">
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
            <NumberInput value={element.style.borderWidth ?? 0} onChange={v => updateStyle({ borderWidth: v })} min={0} max={20} />
          </Field>
          <Field label="Radius">
            <NumberInput value={element.style.borderRadius ?? 0} onChange={v => updateStyle({ borderRadius: v })} min={0} max={100} />
          </Field>
        </Section>
      )}

      {/* Plot style */}
      {element.type === 'plot' && (
        <Section title="Plot Style">
          <Field label="Border">
            <ColorInput value={element.style.borderColor || '#d0d0d0'} onChange={v => updateStyle({ borderColor: v })} />
          </Field>
          <Field label="B. Width">
            <NumberInput value={element.style.borderWidth ?? 0} onChange={v => updateStyle({ borderWidth: v })} min={0} max={20} />
          </Field>
          <Field label="Radius">
            <NumberInput value={element.style.borderRadius ?? 0} onChange={v => updateStyle({ borderRadius: v })} min={0} max={100} />
          </Field>
          <Field label="Bg">
            <ColorInput value={element.style.background || 'transparent'} onChange={v => updateStyle({ background: v })} />
          </Field>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-2xs text-gray-500 dark:text-on-surface-muted">
              <input
                type="checkbox"
                checked={element.style.shadow ?? false}
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
              className="w-full min-w-[40px] px-1 py-px text-2xs border border-gray-200 dark:border-border rounded bg-white dark:bg-surface-tertiary dark:text-on-surface-primary focus:border-accent focus:outline-none"
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
          <ColorPalette onApply={(fill, border) => { pushHistory('Apply preset'); updateStyle({ fill, strokeColor: border }); }} />
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
            <StrokeStyleSelect
              value={element.style.strokeStyle || 'solid'}
              onChange={v => updateStyle({ strokeStyle: v as any })}
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
          <Field label="Type">
            <LineTypeSelect
              value={(element.metadata?.lineType as string) || 'straight'}
              onChange={v => {
                pushHistory('Change line type');
                update({ metadata: { ...element.metadata, lineType: v, controlPoints: undefined } });
              }}
            />
          </Field>
          {(element.metadata?.lineType as string) === 'step-rounded' && (
            <Field label="Radius">
              <NumberInput
                value={(element.metadata?.stepRadius as number) ?? 20}
                onChange={v => {
                  pushHistory('Change step radius');
                  update({ metadata: { ...element.metadata, stepRadius: v } });
                }}
                min={0}
                max={200}
              />
            </Field>
          )}
          <Field label="Start">
            <MarkerSelect
              value={(element.metadata?.startMarker as string) || 'none'}
              side="start"
              onChange={v => {
                pushHistory('Change start marker');
                update({ metadata: { ...element.metadata, startMarker: v } });
              }}
            />
          </Field>
          <Field label="End">
            <MarkerSelect
              value={(element.metadata?.endMarker as string) || (element.metadata?.arrowHead === false ? 'none' : 'arrow')}
              side="end"
              onChange={v => {
                pushHistory('Change end marker');
                update({ metadata: { ...element.metadata, endMarker: v, arrowHead: undefined } });
              }}
            />
          </Field>
          <Field label="Head Size">
            <NumberInput
              value={(element.metadata?.arrowHeadSize as number) ?? 1}
              onChange={v => update({ metadata: { ...element.metadata, arrowHeadSize: v } })}
              min={0.5}
              max={5}
              step={0.25}
            />
          </Field>
          <Field label="Color">
            <ColorInput value={element.style.strokeColor || '#333333'} onChange={v => updateStyle({ strokeColor: v })} />
          </Field>
          <Field label="Width">
            <NumberInput value={element.style.strokeWidth ?? 2} onChange={v => updateStyle({ strokeWidth: v })} min={1} max={20} />
          </Field>
          <Field label="Style">
            <StrokeStyleSelect
              value={element.style.strokeStyle || 'solid'}
              onChange={v => updateStyle({ strokeStyle: v as any })}
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
  const groupElements = useBoardStore(s => s.groupElements);
  const ungroupElements = useBoardStore(s => s.ungroupElements);
  const toggleLock = useBoardStore(s => s.toggleLock);
  const bringToFront = useBoardStore(s => s.bringToFront);
  const sendToBack = useBoardStore(s => s.sendToBack);
  const updateElements = useBoardStore(s => s.updateElements);
  const setSelectedIds = useUIStore(s => s.setSelectedIds);

  const groupsInSelection = ids.filter(id =>
    board?.elements.find(e => e.id === id)?.type === 'group'
  );

  const allLocked = ids.every(id => board?.elements.find(e => e.id === id)?.locked);

  const btnClass = "px-2 py-1 text-2xs bg-gray-50 dark:bg-surface-tertiary hover:bg-gray-100 dark:hover:bg-toolbar-hover rounded border border-gray-200 dark:border-border text-gray-600 dark:text-on-surface-secondary disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <>
      <Section title={`${ids.length} Elements Selected`}>
        <div className="space-y-2">
          {/* Group / Ungroup */}
          <div className="text-xs text-gray-500 dark:text-on-surface-muted">Group</div>
          <div className="grid grid-cols-2 gap-1">
            <button
              onClick={() => {
                if (ids.length >= 2) {
                  const groupId = groupElements(ids);
                  setSelectedIds([groupId]);
                }
              }}
              disabled={ids.length < 2}
              className={btnClass}
            >
              Group
            </button>
            <button
              onClick={() => {
                const allChildIds: string[] = [];
                for (const gid of groupsInSelection) {
                  const el = board?.elements.find(e => e.id === gid);
                  if (el?.children) allChildIds.push(...el.children);
                  ungroupElements(gid);
                }
                const nonGroupIds = ids.filter(id => !groupsInSelection.includes(id));
                setSelectedIds([...nonGroupIds, ...allChildIds]);
              }}
              disabled={groupsInSelection.length === 0}
              className={btnClass}
            >
              Ungroup
            </button>
          </div>

          {/* Alignment */}
          <div className="text-xs text-gray-500 dark:text-on-surface-muted">Alignment</div>
          <select
            defaultValue=""
            onChange={e => { if (e.target.value) { alignElements(ids, e.target.value as any); e.target.value = ''; } }}
            className="w-full px-2 py-1 text-2xs border border-gray-200 dark:border-border rounded bg-white dark:bg-surface-tertiary dark:text-on-surface-primary focus:outline-none cursor-pointer"
          >
            <option value="" disabled>Choose alignment...</option>
            <option value="left">Align Left</option>
            <option value="centerH">Align Center (Horizontal)</option>
            <option value="right">Align Right</option>
            <option value="top">Align Top</option>
            <option value="centerV">Align Center (Vertical)</option>
            <option value="bottom">Align Bottom</option>
          </select>
          {ids.length >= 3 && (
            <>
              <div className="text-xs text-gray-500 dark:text-on-surface-muted mt-1">Distribution</div>
              <div className="grid grid-cols-2 gap-1">
                <button onClick={() => distributeElements(ids, 'horizontal')} className={btnClass}>
                  Distribute H
                </button>
                <button onClick={() => distributeElements(ids, 'vertical')} className={btnClass}>
                  Distribute V
                </button>
              </div>
            </>
          )}

          {/* Z-order */}
          <div className="text-xs text-gray-500 dark:text-on-surface-muted mt-1">Z-Index</div>
          <div className="flex items-center gap-1">
            <NumberInput
              value={(() => {
                const zVals = ids.map(id => board?.elements.find(e => e.id === id)?.z_index ?? 0);
                return zVals.every(z => z === zVals[0]) ? zVals[0] : 0;
              })()}
              onChange={v => updateElements(ids.map(id => ({ id, changes: { z_index: v } })))}
            />
            <button onClick={() => bringToFront(ids)} className={btnClass + ' shrink-0'} title="Bring to front">Top</button>
            <button onClick={() => sendToBack(ids)} className={btnClass + ' shrink-0'} title="Send to back">Btm</button>
          </div>

          {/* Lock / Unlock */}
          <div className="grid grid-cols-1 gap-1 mt-1">
            <button
              onClick={() => toggleLock(ids)}
              className={btnClass}
            >
              {allLocked ? 'Unlock' : 'Lock'}
            </button>
          </div>
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
        className="w-8 bg-inspector-bg border-l border-inspector-border flex flex-col items-center pt-2 shrink-0 hover:bg-gray-100 dark:hover:bg-surface-tertiary transition-colors"
        title="Show Properties"
      >
        <PanelRightOpen size={16} className="text-gray-400 dark:text-on-surface-muted" />
      </button>
    );
  }

  const selectedElements = board.elements.filter(el => selectedIds.includes(el.id));

  return (
    <div className="flex shrink-0">
      <ResizeHandle side="left" onResize={(delta) => setInspectorWidth(inspectorWidth + delta)} />
      <div className="bg-inspector-bg overflow-y-auto overflow-x-hidden flex flex-col" style={{ width: inspectorWidth }}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-inspector-border">
          <span className="text-xs font-semibold text-gray-700 dark:text-on-surface-primary">Properties</span>
          <button onClick={toggleInspector} className="text-gray-400 dark:text-on-surface-muted hover:text-gray-600 dark:hover:text-on-surface-primary" title="Collapse panel">
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
