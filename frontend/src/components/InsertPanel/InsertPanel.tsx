import { useState, useCallback } from 'react';
import { useBoardStore } from '@/store/boardStore';
import { useUIStore } from '@/store/uiStore';
import { api } from '@/api/client';
import type { FileInfo } from '@/types/board';
import { Image, Type, Square, ArrowRight, FolderOpen, File, ChevronDown, ChevronRight, Layers } from 'lucide-react';
import { getFileName } from '@/utils/helpers';

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

function FolderBrowser() {
  const [folderPath, setFolderPath] = useState('');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const addElement = useBoardStore(s => s.addElement);
  const setSelectedIds = useUIStore(s => s.setSelectedIds);

  const loadFolder = useCallback(async () => {
    if (!folderPath.trim()) return;
    setLoading(true);
    try {
      const result = await api.listFiles(folderPath, ['.png', '.jpg', '.jpeg', '.svg', '.gif', '.webp'], 'mtime');
      setFiles(result);
      // Register watch for this folder
      try { await api.registerWatch(folderPath); } catch {}
    } catch (err) {
      setFiles([]);
    }
    setLoading(false);
  }, [folderPath]);

  const insertSingle = useCallback((file: FileInfo) => {
    const el = addElement('image', {
      source: { mode: 'exact', path: file.path, followLatest: false, autoRefresh: true },
      width: Math.min(file.dimensions?.width || 400, 500),
      height: Math.min(file.dimensions?.height || 300, 400),
    });
    setSelectedIds([el.id]);
  }, [addElement, setSelectedIds]);

  const insertAll = useCallback(() => {
    const ids: string[] = [];
    const cols = Math.ceil(Math.sqrt(files.length));
    const gap = 20;
    const w = 300;
    const h = 220;
    files.forEach((file, i) => {
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
  }, [files, addElement, setSelectedIds]);

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
        <div className="px-3 py-2 space-y-2">
          <div className="flex gap-1">
            <input
              type="text"
              value={folderPath}
              onChange={e => setFolderPath(e.target.value)}
              placeholder="/path/to/plots"
              className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:border-accent focus:outline-none font-mono"
              onKeyDown={e => e.key === 'Enter' && loadFolder()}
            />
            <button
              onClick={loadFolder}
              className="px-2 py-1 text-xs bg-accent text-white rounded hover:bg-accent/90"
            >
              Load
            </button>
          </div>

          {loading && <div className="text-2xs text-gray-400">Loading...</div>}

          {files.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-2xs text-gray-400">{files.length} files</span>
                <button
                  onClick={insertAll}
                  className="text-2xs text-accent hover:underline"
                >
                  Insert all as grid
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto space-y-0.5">
                {files.map(file => (
                  <button
                    key={file.path}
                    onClick={() => insertSingle(file)}
                    className="flex items-center gap-1.5 w-full px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 rounded truncate"
                    title={file.path}
                  >
                    <File size={12} className="text-gray-400 shrink-0" />
                    <span className="truncate">{file.name}</span>
                    {file.dimensions && (
                      <span className="text-2xs text-gray-400 ml-auto shrink-0">
                        {file.dimensions.width}x{file.dimensions.height}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
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
            const icon = el.type === 'image' ? Image : el.type === 'text' ? Type : el.type === 'rectangle' ? Square : el.type === 'arrow' ? ArrowRight : Layers;
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

export function InsertPanel() {
  const showInsertPanel = useUIStore(s => s.showInsertPanel);
  const board = useBoardStore(s => s.board);
  const addElement = useBoardStore(s => s.addElement);
  const setSelectedIds = useUIStore(s => s.setSelectedIds);

  if (!showInsertPanel || !board) return null;

  const handleInsertImage = () => {
    const path = window.prompt('Enter image file path:');
    if (path) {
      const el = addElement('image', {
        source: { mode: 'exact', path, followLatest: false, autoRefresh: true },
        width: 400,
        height: 300,
      });
      setSelectedIds([el.id]);
    }
  };

  const handleInsertText = () => {
    const el = addElement('text', {
      text: 'Label',
      width: 100,
      height: 32,
      style: { fontSize: 16, fontWeight: 700, color: '#111111', background: 'transparent', padding: 4, textAlign: 'left' },
    });
    setSelectedIds([el.id]);
  };

  const handleInsertFigureLabel = (label: string) => {
    const el = addElement('text', {
      text: label,
      width: 36,
      height: 36,
      style: { fontSize: 24, fontWeight: 700, color: '#111111', background: 'transparent', padding: 2, textAlign: 'center' },
    });
    setSelectedIds([el.id]);
  };

  const handleInsertRect = () => {
    const el = addElement('rectangle', { width: 200, height: 150 });
    setSelectedIds([el.id]);
  };

  const handleInsertArrow = () => {
    const el = addElement('arrow', { width: 200, height: 4 });
    setSelectedIds([el.id]);
  };

  return (
    <div className="w-52 bg-inspector-bg border-r border-inspector-border overflow-y-auto shrink-0">
      <div className="text-xs font-semibold text-gray-700 px-3 py-2 border-b border-inspector-border">
        Insert
      </div>

      <div className="py-1">
        <InsertButton icon={Image} label="Image from file" onClick={handleInsertImage} />
        <InsertButton icon={FolderOpen} label="Images from folder" onClick={() => {}} />
        <InsertButton icon={Type} label="Text box" onClick={handleInsertText} />
        <InsertButton icon={Square} label="Rectangle" onClick={handleInsertRect} />
        <InsertButton icon={ArrowRight} label="Arrow / Line" onClick={handleInsertArrow} />
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
              className="w-7 h-7 text-xs font-bold text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded flex items-center justify-center"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <FolderBrowser />
      <LayersList />
    </div>
  );
}
