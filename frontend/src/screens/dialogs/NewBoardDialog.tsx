import { useState, useMemo } from 'react';

export function NewBoardDialog({
  folderPath,
  onClose,
  onCreate,
}: {
  folderPath: string;
  onClose: () => void;
  onCreate: (name: string, filePath: string, width: number, height: number, infinite: boolean) => void;
}) {
  const [format, setFormat] = useState('.html');
  const [boardName, setBoardName] = useState('');
  const [canvasWidth, setCanvasWidth] = useState(2400);
  const [canvasHeight, setCanvasHeight] = useState(1600);
  const [infinite, setInfinite] = useState(true);

  const safeFileName = useMemo(() => {
    const name = boardName.trim() || 'Untitled Board';
    return name.replace(/[^a-zA-Z0-9_\- ]/g, '_') + format;
  }, [boardName, format]);

  const handleSubmit = () => {
    const name = boardName.trim() || 'Untitled Board';
    onCreate(name, `${folderPath}/${safeFileName}`, canvasWidth, canvasHeight, infinite);
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white dark:bg-surface-primary rounded-lg shadow-xl w-[420px]" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-200 dark:border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-on-surface-primary">New Board</h2>
          <button onClick={onClose} className="text-gray-400 dark:text-on-surface-muted hover:text-gray-600 dark:hover:text-on-surface-primary text-lg leading-none">&times;</button>
        </div>
        <div className="px-4 py-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600 dark:text-on-surface-secondary block mb-1">Board name</label>
            <div className="flex items-center gap-0">
              <input
                type="text"
                value={boardName}
                onChange={e => setBoardName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
                placeholder="e.g. Figure 3 — Dose Response"
                className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-200 dark:border-border dark:bg-surface-tertiary dark:text-on-surface-primary rounded-l-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
                autoFocus
              />
              <span className="px-2.5 py-2 text-sm text-gray-400 dark:text-on-surface-muted bg-gray-50 dark:bg-surface-secondary border border-l-0 border-gray-200 dark:border-border rounded-r-md select-none">{format}</span>
            </div>
            <select aria-label="Board format" value={format} onChange={e => setFormat(e.target.value)}>
              <option value=".html">HTML</option><option value=".json">JSON</option><option value=".sdraw">Legacy sdraw</option>
            </select>
            <div className="mt-1 text-2xs text-gray-400 truncate">
              {folderPath}/{safeFileName}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 dark:text-on-surface-secondary block mb-1.5">Canvas size</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              <button
                onClick={() => setInfinite(true)}
                className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                  infinite
                    ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-400 text-blue-600 dark:text-blue-400'
                    : 'border-gray-200 dark:border-border text-gray-600 dark:text-on-surface-secondary hover:border-gray-300 hover:bg-gray-50 dark:hover:bg-surface-tertiary'
                }`}
              >
                Infinite
              </button>
              {[
                { label: 'Single column', w: 1200, h: 1600 },
                { label: '1.5 column', w: 1800, h: 1200 },
                { label: 'Full page', w: 2400, h: 1600 },
                { label: 'Wide', w: 3200, h: 1200 },
                { label: 'Poster', w: 4800, h: 3200 },
              ].map(p => {
                const active = !infinite && canvasWidth === p.w && canvasHeight === p.h;
                return (
                  <button
                    key={p.label}
                    onClick={() => { setInfinite(false); setCanvasWidth(p.w); setCanvasHeight(p.h); }}
                    className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                      active
                        ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-400 text-blue-600 dark:text-blue-400'
                        : 'border-gray-200 dark:border-border text-gray-600 dark:text-on-surface-secondary hover:border-gray-300 hover:bg-gray-50 dark:hover:bg-surface-tertiary'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            {!infinite && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <span className="text-xs text-gray-500">W</span>
                <input
                  type="number"
                  value={canvasWidth}
                  onChange={e => setCanvasWidth(Math.max(100, parseInt(e.target.value) || 100))}
                  className="w-20 px-2 py-1 text-xs border border-gray-200 dark:border-border dark:bg-surface-tertiary dark:text-on-surface-primary rounded focus:border-blue-500 focus:outline-none text-center"
                />
              </div>
              <span className="text-gray-400 dark:text-on-surface-muted text-xs">&times;</span>
              <div className="flex items-center gap-1">
                <span className="text-xs text-gray-500">H</span>
                <input
                  type="number"
                  value={canvasHeight}
                  onChange={e => setCanvasHeight(Math.max(100, parseInt(e.target.value) || 100))}
                  className="w-20 px-2 py-1 text-xs border border-gray-200 dark:border-border dark:bg-surface-tertiary dark:text-on-surface-primary rounded focus:border-blue-500 focus:outline-none text-center"
                />
              </div>
              <span className="text-2xs text-gray-400">px</span>
            </div>
            )}
          </div>
        </div>
        <div className="px-4 py-3 border-t border-gray-100 dark:border-border flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-gray-600 dark:text-on-surface-secondary hover:bg-gray-100 dark:hover:bg-surface-tertiary rounded">Cancel</button>
          <button onClick={handleSubmit} className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600">
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
