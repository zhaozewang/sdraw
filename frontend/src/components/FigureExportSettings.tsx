import { useBoardStore } from '@/store/boardStore';
import type { ExportSizeMode } from '@/types/board';

/** Uses the full editor's persisted export settings, without changing canvas geometry. */
export function FigureExportSettings({ disabled = false }: { disabled?: boolean }) {
  const settings = useBoardStore(s => s.board?.autoExport);
  const update = useBoardStore(s => s.updateAutoExport);
  const mode = settings?.sizeMode ?? 'fit';
  const inputClass = 'w-20 min-w-0 rounded border border-toolbar-border bg-white px-2 py-1 text-xs text-gray-700';
  return <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Figure export settings">
    <select
      aria-label="Export framing"
      title="Export framing"
      disabled={disabled}
      value={mode}
      onChange={event => update({ sizeMode: event.target.value as ExportSizeMode })}
      className="rounded border border-toolbar-border bg-white px-2 py-1 text-xs text-gray-700"
    >
      <option value="fit">Fit content</option>
      <option value="canvas">Full canvas</option>
      <option value="fixed">Fixed size</option>
    </select>
    {mode === 'fixed' && <>
      <input
        aria-label="Export width"
        title="Export width"
        type="number" min={100} step={1} disabled={disabled}
        className={inputClass}
        value={settings?.fixedWidth ?? 1920}
        onChange={event => {
          const value = event.target.valueAsNumber;
          if (Number.isFinite(value) && value >= 100) update({ fixedWidth: Math.round(value) });
        }}
      />
      <span aria-hidden="true" className="text-xs text-gray-400">x</span>
      <input
        aria-label="Export height"
        title="Export height"
        type="number" min={100} step={1} disabled={disabled}
        className={inputClass}
        value={settings?.fixedHeight ?? 1080}
        onChange={event => {
          const value = event.target.valueAsNumber;
          if (Number.isFinite(value) && value >= 100) update({ fixedHeight: Math.round(value) });
        }}
      />
    </>}
  </div>;
}
