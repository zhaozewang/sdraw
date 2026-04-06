import { useState } from 'react';
import { useUIStore, type ThemeMode } from '@/store/uiStore';
import { X, Sun, Moon, Monitor } from 'lucide-react';

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: any }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-500 dark:text-on-surface-muted uppercase tracking-wider mb-2">{title}</h3>
      <div className="space-y-3 pl-1">{children}</div>
    </div>
  );
}

function SettingsRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm text-gray-700 dark:text-on-surface-primary">{label}</div>
        {description && <div className="text-xs text-gray-400 dark:text-on-surface-muted mt-0.5">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-9 h-5 rounded-full transition-colors ${
        checked ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4' : ''
        }`}
      />
    </button>
  );
}

export function Settings() {
  const showSettings = useUIStore(s => s.showSettings);
  const setShowSettings = useUIStore(s => s.setShowSettings);
  const theme = useUIStore(s => s.theme);
  const setTheme = useUIStore(s => s.setTheme);
  // Grid and snap defaults (stored in localStorage)
  const [defaultGridSize, setDefaultGridSize] = useState(() => {
    try { return Number(localStorage.getItem('sdraw_default_grid_size')) || 20; } catch { return 20; }
  });
  const [defaultSnapEnabled, setDefaultSnapEnabled] = useState(() => {
    try { return localStorage.getItem('sdraw_default_snap') !== 'false'; } catch { return true; }
  });
  const [defaultGridEnabled, setDefaultGridEnabled] = useState(() => {
    try { return localStorage.getItem('sdraw_default_grid') !== 'false'; } catch { return true; }
  });

  // Default canvas size
  const [defaultCanvasWidth, setDefaultCanvasWidth] = useState(() => {
    try { return Number(localStorage.getItem('sdraw_default_canvas_w')) || 2400; } catch { return 2400; }
  });
  const [defaultCanvasHeight, setDefaultCanvasHeight] = useState(() => {
    try { return Number(localStorage.getItem('sdraw_default_canvas_h')) || 1600; } catch { return 1600; }
  });

  // Default export settings
  const [defaultExportDpi, setDefaultExportDpi] = useState(() => {
    try { return Number(localStorage.getItem('sdraw_default_export_dpi')) || 2; } catch { return 2; }
  });
  const [defaultExportFormat, setDefaultExportFormat] = useState(() => {
    try { return localStorage.getItem('sdraw_default_export_format') || 'png'; } catch { return 'png'; }
  });

  if (!showSettings) return null;

  const saveAndClose = () => {
    // Persist all settings
    localStorage.setItem('sdraw_default_grid_size', String(defaultGridSize));
    localStorage.setItem('sdraw_default_snap', String(defaultSnapEnabled));
    localStorage.setItem('sdraw_default_grid', String(defaultGridEnabled));
    localStorage.setItem('sdraw_default_canvas_w', String(defaultCanvasWidth));
    localStorage.setItem('sdraw_default_canvas_h', String(defaultCanvasHeight));
    localStorage.setItem('sdraw_default_export_dpi', String(defaultExportDpi));
    localStorage.setItem('sdraw_default_export_format', defaultExportFormat);
    setShowSettings(false);
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={saveAndClose}>
      <div
        className="bg-white dark:bg-surface-primary rounded-lg shadow-xl w-[480px] max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-gray-200 dark:border-border flex items-center justify-between shrink-0">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-on-surface-primary">Preferences</h2>
          <button
            onClick={saveAndClose}
            className="p-1 text-gray-400 dark:text-on-surface-muted hover:text-gray-600 dark:hover:text-on-surface-primary rounded"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-5 overflow-y-auto">
          {/* Appearance */}
          <SettingsSection title="Appearance">
            <SettingsRow label="Theme">
              <div className="flex gap-1">
                {THEME_OPTIONS.map(opt => {
                  const Icon = opt.icon;
                  const active = theme === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setTheme(opt.value)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border transition-colors ${
                        active
                          ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-400 text-blue-600 dark:text-blue-400'
                          : 'border-gray-200 dark:border-border text-gray-600 dark:text-on-surface-secondary hover:bg-gray-50 dark:hover:bg-surface-tertiary'
                      }`}
                    >
                      <Icon size={13} />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </SettingsRow>
          </SettingsSection>

          {/* Editor */}
          <SettingsSection title="Editor">
            <SettingsRow label="Show grid by default">
              <Toggle checked={defaultGridEnabled} onChange={setDefaultGridEnabled} />
            </SettingsRow>
            <SettingsRow label="Snap to grid by default">
              <Toggle checked={defaultSnapEnabled} onChange={setDefaultSnapEnabled} />
            </SettingsRow>
            <SettingsRow label="Default grid size">
              <input
                type="number"
                value={defaultGridSize}
                onChange={e => setDefaultGridSize(Math.max(5, Math.min(100, Number(e.target.value) || 20)))}
                className="w-16 px-2 py-1 text-xs text-center border border-gray-200 dark:border-border rounded bg-white dark:bg-surface-tertiary dark:text-on-surface-primary focus:border-blue-500 focus:outline-none"
                min={5}
                max={100}
              />
            </SettingsRow>
          </SettingsSection>

          {/* Canvas Defaults */}
          <SettingsSection title="New Board Defaults">
            <SettingsRow label="Canvas width" description="Default width for new boards (px)">
              <input
                type="number"
                value={defaultCanvasWidth}
                onChange={e => setDefaultCanvasWidth(Math.max(100, Number(e.target.value) || 2400))}
                className="w-20 px-2 py-1 text-xs text-center border border-gray-200 dark:border-border rounded bg-white dark:bg-surface-tertiary dark:text-on-surface-primary focus:border-blue-500 focus:outline-none"
                min={100}
              />
            </SettingsRow>
            <SettingsRow label="Canvas height" description="Default height for new boards (px)">
              <input
                type="number"
                value={defaultCanvasHeight}
                onChange={e => setDefaultCanvasHeight(Math.max(100, Number(e.target.value) || 1600))}
                className="w-20 px-2 py-1 text-xs text-center border border-gray-200 dark:border-border rounded bg-white dark:bg-surface-tertiary dark:text-on-surface-primary focus:border-blue-500 focus:outline-none"
                min={100}
              />
            </SettingsRow>
          </SettingsSection>

          {/* Export Defaults */}
          <SettingsSection title="Export Defaults">
            <SettingsRow label="DPI multiplier" description="Pixel density for exported images">
              <select
                value={defaultExportDpi}
                onChange={e => setDefaultExportDpi(Number(e.target.value))}
                className="px-2 py-1 text-xs border border-gray-200 dark:border-border rounded bg-white dark:bg-surface-tertiary dark:text-on-surface-primary focus:outline-none cursor-pointer"
              >
                <option value={1}>1x</option>
                <option value={2}>2x</option>
                <option value={3}>3x</option>
                <option value={4}>4x</option>
              </select>
            </SettingsRow>
            <SettingsRow label="Default format">
              <select
                value={defaultExportFormat}
                onChange={e => setDefaultExportFormat(e.target.value)}
                className="px-2 py-1 text-xs border border-gray-200 dark:border-border rounded bg-white dark:bg-surface-tertiary dark:text-on-surface-primary focus:outline-none cursor-pointer"
              >
                <option value="png">PNG</option>
                <option value="jpg">JPG</option>
                <option value="pdf">PDF</option>
                <option value="svg">SVG</option>
              </select>
            </SettingsRow>
          </SettingsSection>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 dark:border-border flex justify-between items-center shrink-0">
          <span className="text-2xs text-gray-400 dark:text-on-surface-muted">
            Settings are saved automatically
          </span>
          <button
            onClick={saveAndClose}
            className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
