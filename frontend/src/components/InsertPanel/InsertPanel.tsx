import { useState, useCallback, useRef, useEffect } from 'react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import { api } from '@/api/client';
import type { DirEntry, FileInfo } from '@/types/board';
import { Type, Square, ArrowRight, File, ChevronDown, ChevronRight, Layers, PanelLeftClose, PanelLeftOpen, Folder, ArrowLeft, Home, RefreshCw, Circle, Triangle, Diamond, Minus, Image as ImageIcon, FolderPlus, Spline, CornerDownRight } from 'lucide-react';
import { getFileName, getLastDirectory, saveLastDirectory, fetchUserHome } from '@/utils/helpers';

function InsertButton({ icon: Icon, label, onClick }: { icon: any; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 w-full px-2.5 py-1 text-2xs text-gray-700 dark:text-on-surface-secondary hover:bg-toolbar-hover rounded transition-colors"
    >
      <Icon size={12} className="text-gray-400 dark:text-on-surface-muted shrink-0" />
      <span>{label}</span>
    </button>
  );
}

function InsertGroup({ label, children, defaultOpen = true }: { label: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 w-full px-2.5 py-1 text-2xs font-semibold text-gray-500 dark:text-on-surface-muted hover:text-gray-700 dark:hover:text-on-surface-primary uppercase tracking-wider"
      >
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        {label}
      </button>
      {open && <div className="pb-0.5">{children}</div>}
    </div>
  );
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.svg', '.gif', '.webp', '.bmp', '.tiff']);

function NavBtn2({ icon: Icon, title, onClick, disabled }: { icon: any; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1 rounded ${disabled ? 'text-gray-300 dark:text-on-surface-disabled cursor-not-allowed' : 'text-gray-500 dark:text-on-surface-muted hover:bg-gray-100 dark:hover:bg-surface-tertiary hover:text-gray-700 dark:hover:text-on-surface-primary'}`}
    >
      <Icon size={15} />
    </button>
  );
}

function FolderBrowser() {
  const [currentPath, setCurrentPath] = useState('');
  const [parentPath, setParentPath] = useState('');
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const addElement = useBoardStore(s => s.addElement);
  const setSelectedIds = useUIStore(s => s.setSelectedIds);

  const navigate = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const result = await api.browse(path);
      setCurrentPath(result.path);
      setParentPath(result.parent);
      setEntries(result.entries);
      setCreatingFolder(false);
      saveLastDirectory(result.path);
      try { await api.registerWatch(result.path); } catch {}
    } catch {
      setEntries([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const last = getLastDirectory();
    if (last && last !== '/Users') {
      navigate(last);
    } else {
      fetchUserHome().then(home => navigate(home));
    }
  }, [navigate]);

  const dirs = entries.filter(e => e.is_dir);
  const imageFiles = entries.filter(e => {
    if (e.is_dir) return false;
    const ext = e.name.substring(e.name.lastIndexOf('.')).toLowerCase();
    return IMAGE_EXTS.has(ext);
  });

  const insertSingle = useCallback((entry: DirEntry) => {
    const el = addElement('image', {
      source: { mode: 'exact', path: entry.path, followLatest: false, autoRefresh: true },
      width: Math.min(entry.dimensions?.width || 400, 500),
      height: Math.min(entry.dimensions?.height || 300, 400),
    });
    setSelectedIds([el.id]);
  }, [addElement, setSelectedIds]);

  const insertAll = useCallback(() => {
    const ids: string[] = [];
    const cols = Math.ceil(Math.sqrt(imageFiles.length));
    const gap = 20;
    const w = 300;
    const h = 220;
    imageFiles.forEach((file, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const el = addElement('image', {
        x: 60 + col * (w + gap),
        y: 60 + row * (h + gap),
        width: w,
        height: h,
        source: { mode: 'exact', path: file.path, followLatest: false, autoRefresh: true },
      });
      ids.push(el.id);
    });
    setSelectedIds(ids);
  }, [imageFiles, addElement, setSelectedIds]);

  const handleCreateFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      const result = await api.mkdir(`${currentPath}/${name}`);
      setNewFolderName('');
      setCreatingFolder(false);
      navigate(result.path);
    } catch {}
  }, [newFolderName, currentPath, navigate]);

  return (
    <div className="border-t border-inspector-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 w-full px-3 py-1.5 text-2xs font-semibold text-gray-500 dark:text-on-surface-muted uppercase tracking-wider hover:bg-gray-50 dark:hover:bg-surface-tertiary"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Folder Browser
      </button>
      {expanded && (
        <div className="px-2 py-1.5 space-y-1">
          {/* Nav buttons */}
          <div className="flex items-center gap-0.5">
            <NavBtn2 icon={ArrowLeft} title="Back" onClick={() => parentPath && parentPath !== currentPath && navigate(parentPath)} disabled={!parentPath || parentPath === currentPath} />
            <NavBtn2 icon={Home} title="Home" onClick={() => fetchUserHome().then(navigate)} />
            <NavBtn2 icon={RefreshCw} title="Refresh" onClick={() => currentPath && navigate(currentPath)} />
            <NavBtn2 icon={FolderPlus} title="New Folder" onClick={() => { setCreatingFolder(true); setNewFolderName(''); }} />
          </div>

          {/* New folder input */}
          {creatingFolder && (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreateFolder();
                  if (e.key === 'Escape') setCreatingFolder(false);
                }}
                placeholder="New folder..."
                autoFocus
                className="flex-1 px-1.5 py-0.5 text-2xs border border-blue-400 rounded bg-white dark:bg-surface-tertiary dark:text-on-surface-primary focus:outline-none min-w-0"
              />
              <button onClick={handleCreateFolder} className="px-1.5 py-0.5 text-2xs bg-blue-500 text-white rounded">OK</button>
            </div>
          )}

          {/* Listing */}
          <div className="h-40 overflow-y-auto">
            {loading ? (
              <div className="text-2xs text-gray-400 dark:text-on-surface-muted text-center py-2">Loading...</div>
            ) : (
              <>
                {dirs.map(entry => (
                  <button
                    key={entry.path}
                    onClick={() => navigate(entry.path)}
                    className="flex items-center gap-1.5 w-full px-2.5 py-1 text-2xs text-gray-600 dark:text-on-surface-secondary hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded truncate"
                    title={entry.path}
                  >
                    <Folder size={13} className="text-blue-400 shrink-0" />
                    <span className="truncate">{entry.name}</span>
                  </button>
                ))}
                {imageFiles.length > 0 && (
                  <div className="flex items-center justify-between px-2.5 pt-1.5 pb-0.5">
                    <span className="text-2xs text-gray-400 dark:text-on-surface-muted">{imageFiles.length} image{imageFiles.length !== 1 ? 's' : ''}</span>
                    <button onClick={insertAll} className="text-2xs text-accent hover:underline">
                      Insert all
                    </button>
                  </div>
                )}
                {imageFiles.map(entry => (
                  <button
                    key={entry.path}
                    onClick={() => insertSingle(entry)}
                    className="flex items-center gap-1.5 w-full px-2.5 py-1 text-2xs text-gray-600 dark:text-on-surface-secondary hover:bg-green-50 dark:hover:bg-green-900/20 rounded truncate"
                    title={entry.path}
                  >
                    <File size={13} className="text-green-500 shrink-0" />
                    <span className="truncate">{entry.name}</span>
                    {entry.dimensions && (
                      <span className="text-2xs text-gray-400 dark:text-on-surface-muted ml-auto shrink-0">
                        {entry.dimensions.width}x{entry.dimensions.height}
                      </span>
                    )}
                  </button>
                ))}
                {dirs.length === 0 && imageFiles.length === 0 && (
                  <div className="text-2xs text-gray-400 dark:text-on-surface-muted text-center py-2">No folders or images here</div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function LayersList() {
  const board = useBoardStore(s => s.board);
  const selectedIds = useUIStore(s => s.selectedIds);
  const setSelectedIds = useUIStore(s => s.setSelectedIds);
  const [expanded, setExpanded] = useState(false);

  if (!board) return null;

  const sorted = [...board.elements].sort((a, b) => b.z_index - a.z_index);

  return (
    <div className="border-t border-inspector-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 w-full px-3 py-1.5 text-2xs font-semibold text-gray-500 dark:text-on-surface-muted uppercase tracking-wider hover:bg-gray-50 dark:hover:bg-surface-tertiary"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Layers ({board.elements.length})
      </button>
      {expanded && (
        <div className="max-h-64 overflow-y-auto">
          {sorted.map(el => {
            const isSelected = selectedIds.includes(el.id);
            const icon = el.type === 'image' ? ImageIcon : el.type === 'text' ? Type : el.type === 'rectangle' ? Square : el.type === 'arrow' ? ArrowRight : Layers;
            const Icon = icon;
            const label = el.type === 'text' ? (el.text?.slice(0, 20) || 'Text') :
                          el.type === 'image' ? (el.source?.path ? getFileName(el.source.path) : 'Image') :
                          el.type;
            return (
              <button
                key={el.id}
                onClick={() => setSelectedIds([el.id])}
                className={`flex items-center gap-1.5 w-full px-2.5 py-1 text-2xs truncate ${
                  isSelected ? 'bg-accent/10 text-accent' : 'text-gray-600 dark:text-on-surface-secondary hover:bg-gray-50 dark:hover:bg-surface-tertiary'
                }`}
              >
                <Icon size={12} className="shrink-0" />
                <span className="truncate">{label}</span>
                <span className="text-2xs text-gray-400 dark:text-on-surface-muted ml-auto">{el.z_index}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const LABEL_SETS = {
  'A-H': ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
  'a-h': ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
  '1-8': ['1', '2', '3', '4', '5', '6', '7', '8'],
  'i-viii': ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii'],
  'Greek': ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ'],
};

function LabelPicker({ onInsert }: { onInsert: (label: string) => void }) {
  const [activeSet, setActiveSet] = useState<keyof typeof LABEL_SETS>('A-H');
  const labels = LABEL_SETS[activeSet];

  return (
    <div className="px-3 pt-0 pb-4 space-y-1">
      <select
        value={activeSet}
        onChange={e => setActiveSet(e.target.value as keyof typeof LABEL_SETS)}
        className="w-full px-1.5 py-0.5 text-2xs border border-gray-200 dark:border-border rounded bg-white dark:bg-surface-tertiary text-gray-600 dark:text-on-surface-secondary focus:outline-none focus:border-accent"
      >
        {(Object.keys(LABEL_SETS) as (keyof typeof LABEL_SETS)[]).map(key => (
          <option key={key} value={key}>{key}</option>
        ))}
      </select>
      <div className="flex flex-wrap gap-1">
        {labels.map(label => (
          <button
            key={label}
            onClick={() => onInsert(label)}
            className="w-5 h-5 text-2xs font-bold text-gray-600 dark:text-on-surface-secondary bg-gray-50 dark:bg-surface-tertiary hover:bg-gray-100 dark:hover:bg-toolbar-hover border border-gray-200 dark:border-border rounded flex items-center justify-center"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ResizeHandle({ side, onResize }: { side: 'right' | 'left'; onResize: (delta: number) => void }) {
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    let lastX = e.clientX;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = side === 'right' ? ev.clientX - lastX : lastX - ev.clientX;
      lastX = ev.clientX;
      onResizeRef.current(delta);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [side]);

  return (
    <div
      onMouseDown={onMouseDown}
      className="group relative shrink-0 cursor-col-resize"
      style={{ width: 5 }}
    >
      <div className="absolute inset-y-0 -left-1 -right-1" />
      <div className="absolute inset-y-0 left-1/2 w-px bg-inspector-border group-hover:w-0.5 group-hover:bg-blue-400 group-hover:-translate-x-[1px] transition-all" />
    </div>
  );
}

export function InsertPanel() {
  const showInsertPanel = useUIStore(s => s.showInsertPanel);
  const toggleInsertPanel = useUIStore(s => s.toggleInsertPanel);
  const insertPanelWidth = useUIStore(s => s.insertPanelWidth);
  const setInsertPanelWidth = useUIStore(s => s.setInsertPanelWidth);
  const board = useBoardStore(s => s.board);
  const addElement = useBoardStore(s => s.addElement);
  const setSelectedIds = useUIStore(s => s.setSelectedIds);
  const setInsertPayload = useUIStore(s => s.setInsertPayload);

  if (!board) return null;

  // Collapsed state: show a thin strip with expand button
  if (!showInsertPanel) {
    return (
      <button
        onClick={toggleInsertPanel}
        className="w-8 bg-inspector-bg border-r border-inspector-border flex flex-col items-center pt-2 shrink-0 hover:bg-gray-100 dark:hover:bg-surface-tertiary transition-colors"
        title="Show Insert Panel"
      >
        <PanelLeftOpen size={16} className="text-gray-400 dark:text-on-surface-muted" />
      </button>
    );
  }

  /** Insert at viewport center (for text/labels that don't need drag-to-draw) */
  const insertAtCenter = (type: string, overrides: any = {}) => {
    const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null;
    const container = viewport?.parentElement;
    if (viewport && container) {
      const transform = viewport.style.transform;
      const match = transform.match(/translate\((.+?)px,\s*(.+?)px\)\s*scale\((.+?)\)/);
      if (match) {
        const tx = parseFloat(match[1]);
        const ty = parseFloat(match[2]);
        const scale = parseFloat(match[3]);
        const rect = container.getBoundingClientRect();
        const w = overrides.width ?? 200;
        const h = overrides.height ?? 150;
        const centerX = (rect.width / 2 - tx) / scale - w / 2;
        const centerY = (rect.height / 2 - ty) / scale - h / 2;
        overrides = { ...overrides, x: Math.round(centerX), y: Math.round(centerY) };
      }
    }
    const el = addElement(type as any, overrides);
    setSelectedIds([el.id]);
  };

  /** Enter drag-to-draw mode for shapes */
  const startDraw = (type: 'rectangle' | 'arrow', overrides: any = {}) => {
    setInsertPayload({ type, overrides });
  };

  const handleInsertText = () => insertAtCenter('text', {
    text: 'Label', width: 100, height: 32,
    style: { fontSize: 16, fontWeight: 700, color: '#111111', background: 'transparent', padding: 4, textAlign: 'left' },
  });

  const handleInsertFigureLabel = (label: string) => insertAtCenter('text', {
    text: label, width: 36, height: 36,
    style: { fontSize: 24, fontWeight: 700, color: '#111111', background: 'transparent', padding: 2, textAlign: 'center' },
  });

  return (
    <div className="flex shrink-0">
      <div className="bg-inspector-bg overflow-y-auto overflow-x-hidden flex flex-col" style={{ width: insertPanelWidth }}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-inspector-border">
          <span className="text-xs font-semibold text-gray-700 dark:text-on-surface-primary">Insert</span>
          <button onClick={toggleInsertPanel} className="text-gray-400 dark:text-on-surface-muted hover:text-gray-600 dark:hover:text-on-surface-primary" title="Collapse panel">
            <PanelLeftClose size={14} />
          </button>
        </div>

        <div className="py-0.5">
          <InsertButton icon={Type} label="Text" onClick={handleInsertText} />
        </div>
        <InsertGroup label="Shapes">
          <InsertButton icon={Square} label="Rectangle" onClick={() => startDraw('rectangle', {})} />
          <InsertButton icon={Circle} label="Circle" onClick={() => startDraw('rectangle', { style: { borderRadius: 9999 } })} />
          <InsertButton icon={Diamond} label="Diamond" onClick={() => startDraw('rectangle', { metadata: { shape: 'diamond' } })} />
          <InsertButton icon={Triangle} label="Triangle" onClick={() => startDraw('rectangle', { metadata: { shape: 'triangle' } })} />
        </InsertGroup>
        <InsertGroup label="Lines">
          <InsertButton icon={Minus} label="Line" onClick={() => startDraw('arrow', { metadata: { startMarker: 'none', endMarker: 'none', lineType: 'straight' } })} />
          <InsertButton icon={ArrowRight} label="Arrow" onClick={() => startDraw('arrow', { metadata: { startMarker: 'none', endMarker: 'arrow', lineType: 'straight' } })} />
          <InsertButton icon={Spline} label="Smooth" onClick={() => startDraw('arrow', { metadata: { startMarker: 'none', endMarker: 'arrow', lineType: 'smooth' } })} />
          <InsertButton icon={Spline} label="Curve" onClick={() => startDraw('arrow', { metadata: { startMarker: 'none', endMarker: 'arrow', lineType: 'quadratic' } })} />
          <InsertButton icon={CornerDownRight} label="Step" onClick={() => startDraw('arrow', { metadata: { startMarker: 'none', endMarker: 'arrow', lineType: 'step' } })} />
        </InsertGroup>

        {/* Figure label quick-insert */}
        <div className="border-t border-inspector-border">
          <div className="px-3 py-1.5 text-2xs font-semibold text-gray-500 uppercase tracking-wider">
            <span className="text-gray-500 dark:text-on-surface-muted">Figure Labels</span>
          </div>
          <LabelPicker onInsert={handleInsertFigureLabel} />
        </div>

        <FolderBrowser />
        <LayersList />
      </div>
      <ResizeHandle side="right" onResize={(delta) => setInsertPanelWidth(insertPanelWidth + delta)} />
    </div>
  );
}

export { ResizeHandle };
