import { useState, useCallback, useRef, useEffect } from 'react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import { api } from '@/api/client';
import type { DirEntry, FileInfo } from '@/types/board';
import { Type, Square, ArrowRight, File, ChevronDown, ChevronRight, Layers, PanelLeftClose, PanelLeftOpen, Folder, ArrowLeft, Home, RefreshCw, Circle, RectangleHorizontal, Triangle, Diamond, Minus, Image as ImageIcon } from 'lucide-react';
import { getFileName, getLastDirectory, saveLastDirectory } from '@/utils/helpers';

function InsertButton({ icon: Icon, label, onClick }: { icon: any; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-gray-700 hover:bg-toolbar-hover rounded transition-colors"
    >
      <Icon size={14} className="text-gray-400 shrink-0" />
      <span>{label}</span>
    </button>
  );
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.svg', '.gif', '.webp', '.bmp', '.tiff']);

function FolderBrowser() {
  const [currentPath, setCurrentPath] = useState('');
  const [parentPath, setParentPath] = useState('');
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const addElement = useBoardStore(s => s.addElement);
  const setSelectedIds = useUIStore(s => s.setSelectedIds);

  const navigate = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const result = await api.browse(path);
      setCurrentPath(result.path);
      setParentPath(result.parent);
      setEntries(result.entries);
      saveLastDirectory(result.path);
      // Auto-watch for live refresh
      try { await api.registerWatch(result.path); } catch {}
    } catch {
      setEntries([]);
    }
    setLoading(false);
  }, []);

  // Navigate to last directory on mount
  useEffect(() => {
    const last = getLastDirectory();
    if (last) navigate(last);
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

  return (
    <div className="border-t border-inspector-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 w-full px-3 py-1.5 text-2xs font-semibold text-gray-500 uppercase tracking-wider hover:bg-gray-50"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Folder Browser
      </button>
      {expanded && (
        <div className="px-2 py-2 space-y-1.5">
          {/* Navigation buttons */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => parentPath && parentPath !== currentPath && navigate(parentPath)}
              disabled={!parentPath || parentPath === currentPath}
              title="Go up"
              className="p-1 rounded text-gray-500 hover:bg-gray-100 disabled:text-gray-300 disabled:cursor-not-allowed"
            >
              <ArrowLeft size={16} />
            </button>
            <button onClick={() => navigate('/')} title="Root" className="p-1 rounded text-gray-500 hover:bg-gray-100">
              <Home size={16} />
            </button>
            <button onClick={() => currentPath && navigate(currentPath)} title="Refresh" className="p-1 rounded text-gray-500 hover:bg-gray-100">
              <RefreshCw size={16} />
            </button>
          </div>

          {/* Current path */}
          <div
            className="px-1.5 py-1 text-2xs text-gray-500 bg-gray-50 rounded border border-gray-200 truncate font-mono cursor-pointer hover:border-gray-300"
            title={currentPath}
            onClick={() => {
              const input = window.prompt('Navigate to path:', currentPath);
              if (input) navigate(input);
            }}
          >
            {currentPath || 'Click to navigate...'}
          </div>

          {/* Directory listing */}
          <div className="max-h-64 overflow-y-auto space-y-0">
            {loading ? (
              <div className="text-2xs text-gray-400 text-center py-2">Loading...</div>
            ) : (
              <>
                {dirs.map(entry => (
                  <button
                    key={entry.path}
                    onClick={() => navigate(entry.path)}
                    className="flex items-center gap-1.5 w-full px-1.5 py-1 text-xs text-gray-600 hover:bg-blue-50 rounded truncate"
                    title={entry.path}
                  >
                    <Folder size={11} className="text-blue-400 shrink-0" />
                    <span className="truncate">{entry.name}</span>
                  </button>
                ))}
                {imageFiles.length > 0 && (
                  <div className="flex items-center justify-between px-1.5 pt-1.5 pb-0.5">
                    <span className="text-2xs text-gray-400">{imageFiles.length} image{imageFiles.length !== 1 ? 's' : ''}</span>
                    <button onClick={insertAll} className="text-2xs text-accent hover:underline">
                      Insert all
                    </button>
                  </div>
                )}
                {imageFiles.map(entry => (
                  <button
                    key={entry.path}
                    onClick={() => insertSingle(entry)}
                    className="flex items-center gap-1.5 w-full px-1.5 py-1 text-xs text-gray-600 hover:bg-green-50 rounded truncate"
                    title={entry.path}
                  >
                    <File size={11} className="text-green-500 shrink-0" />
                    <span className="truncate">{entry.name}</span>
                    {entry.dimensions && (
                      <span className="text-2xs text-gray-400 ml-auto shrink-0">
                        {entry.dimensions.width}x{entry.dimensions.height}
                      </span>
                    )}
                  </button>
                ))}
                {dirs.length === 0 && imageFiles.length === 0 && (
                  <div className="text-2xs text-gray-400 text-center py-2">No folders or images here</div>
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
        className="flex items-center gap-1 w-full px-3 py-1.5 text-2xs font-semibold text-gray-500 uppercase tracking-wider hover:bg-gray-50"
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
                className={`flex items-center gap-1.5 w-full px-3 py-1 text-xs truncate ${
                  isSelected ? 'bg-accent/10 text-accent' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Icon size={12} className="shrink-0" />
                <span className="truncate">{label}</span>
                <span className="text-2xs text-gray-400 ml-auto">{el.z_index}</span>
              </button>
            );
          })}
        </div>
      )}
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

  if (!board) return null;

  // Collapsed state: show a thin strip with expand button
  if (!showInsertPanel) {
    return (
      <button
        onClick={toggleInsertPanel}
        className="w-8 bg-inspector-bg border-r border-inspector-border flex flex-col items-center pt-2 shrink-0 hover:bg-gray-100 transition-colors"
        title="Show Insert Panel"
      >
        <PanelLeftOpen size={16} className="text-gray-400" />
      </button>
    );
  }

  const insert = (type: string, overrides: any = {}) => {
    const el = addElement(type as any, overrides);
    setSelectedIds([el.id]);
  };

  const handleInsertText = () => insert('text', {
    text: 'Label', width: 100, height: 32,
    style: { fontSize: 16, fontWeight: 700, color: '#111111', background: 'transparent', padding: 4, textAlign: 'left' },
  });

  const handleInsertFigureLabel = (label: string) => insert('text', {
    text: label, width: 36, height: 36,
    style: { fontSize: 24, fontWeight: 700, color: '#111111', background: 'transparent', padding: 2, textAlign: 'center' },
  });

  return (
    <div className="flex shrink-0">
      <div className="bg-inspector-bg overflow-y-auto overflow-x-hidden flex flex-col" style={{ width: insertPanelWidth }}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-inspector-border">
          <span className="text-xs font-semibold text-gray-700">Insert</span>
          <button onClick={toggleInsertPanel} className="text-gray-400 hover:text-gray-600" title="Collapse panel">
            <PanelLeftClose size={14} />
          </button>
        </div>

        <div className="py-1">
          <InsertButton icon={Type} label="Text box" onClick={handleInsertText} />
          <InsertButton icon={Square} label="Rectangle" onClick={() => insert('rectangle', { width: 200, height: 150 })} />
          <InsertButton icon={Circle} label="Circle / Ellipse" onClick={() => insert('rectangle', { width: 150, height: 150, style: { borderRadius: 9999 } })} />
          <InsertButton icon={Diamond} label="Diamond" onClick={() => insert('rectangle', { width: 150, height: 150, metadata: { shape: 'diamond' } })} />
          <InsertButton icon={Triangle} label="Triangle" onClick={() => insert('rectangle', { width: 150, height: 130, metadata: { shape: 'triangle' } })} />
          <InsertButton icon={Minus} label="Line" onClick={() => insert('arrow', { width: 200, height: 4, points: [{ x: 0, y: 2 }, { x: 200, y: 2 }], metadata: { arrowHead: false } })} />
          <InsertButton icon={ArrowRight} label="Arrow" onClick={() => insert('arrow', { width: 200, height: 4, points: [{ x: 0, y: 2 }, { x: 200, y: 2 }], metadata: { arrowHead: true } })} />
        </div>

        {/* Figure label quick-insert */}
        <div className="border-t border-inspector-border">
          <div className="px-3 py-1.5 text-2xs font-semibold text-gray-500 uppercase tracking-wider">
            Figure Labels
          </div>
          <div className="px-3 py-1 flex flex-wrap gap-1">
            {['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map(label => (
              <button
                key={label}
                onClick={() => handleInsertFigureLabel(label)}
                className="w-5 h-5 text-2xs font-bold text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded flex items-center justify-center"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <FolderBrowser />
        <LayersList />
      </div>
      <ResizeHandle side="right" onResize={(delta) => setInsertPanelWidth(insertPanelWidth + delta)} />
    </div>
  );
}

export { ResizeHandle };
