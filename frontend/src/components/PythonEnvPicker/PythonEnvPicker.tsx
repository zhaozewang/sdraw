import { useState, useEffect, useRef, useCallback } from 'react';
import { useUIStore } from '@/store/uiStore';
import { useBoardStore } from '@/store/boardStore';
import { api } from '@/api/client';
import { CheckCircle2, XCircle, Loader2, Terminal, ChevronDown, Search, FolderOpen } from 'lucide-react';

interface EnvInfo {
  valid: boolean;
  python: string | null;
  version: string | null;
  packages: string[];
  error: string | null;
  is_default: boolean;
}

interface DiscoveredEnv {
  name: string;
  path: string;
  source: string;
}

const SOURCE_LABELS: Record<string, string> = {
  venv: 'venv',
  conda: 'conda',
  pyenv: 'pyenv',
  system: 'system',
};

export function PythonEnvPicker() {
  const globalPythonEnvPath = useUIStore(s => s.pythonEnvPath);
  const setGlobalPythonEnvPath = useUIStore(s => s.setPythonEnvPath);
  const boardPythonEnvPath = useBoardStore(s => s.board?.pythonEnvPath);
  const setBoardPythonEnv = useBoardStore(s => s.setBoardPythonEnv);
  const boardFilePath = useBoardStore(s => s.boardFilePath);

  // Per-board env overrides global
  const pythonEnvPath = boardPythonEnvPath ?? globalPythonEnvPath;
  const setPythonEnvPath = (path: string | null) => {
    // Always set per-board when a board is open
    setBoardPythonEnv(path);
  };

  const [open, setOpen] = useState(false);
  const [inputPath, setInputPath] = useState(pythonEnvPath || '');
  const [defaultEnv, setDefaultEnv] = useState<EnvInfo | null>(null);
  const [customEnv, setCustomEnv] = useState<EnvInfo | null>(null);
  const [validating, setValidating] = useState(false);
  const [discoveredEnvs, setDiscoveredEnvs] = useState<DiscoveredEnv[]>([]);
  const [scanning, setScanning] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isCustom = !!pythonEnvPath;

  // Get the directory of the current .sdraw file
  const projectDir = boardFilePath ? boardFilePath.replace(/\/[^/]+$/, '') : null;

  // Fetch default env info + scan for envs when panel opens
  const hasFetchedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      hasFetchedRef.current = false;
      return;
    }
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    api.getDefaultPythonEnv().then(setDefaultEnv).catch(e => console.warn('Failed to get default env:', e));

    setScanning(true);
    api.discoverPythonEnvs(projectDir)
      .then(res => {
        setDiscoveredEnvs(res.environments || []);
      })
      .catch(e => {
        console.warn('Failed to discover envs:', e);
        setDiscoveredEnvs([]);
      })
      .finally(() => setScanning(false));
  }, [open, projectDir]);

  // Validate current custom env on open
  useEffect(() => {
    if (open && pythonEnvPath && !customEnv) {
      setValidating(true);
      api.validatePythonEnv(pythonEnvPath)
        .then(setCustomEnv)
        .catch(() => setCustomEnv(null))
        .finally(() => setValidating(false));
    }
  }, [open, pythonEnvPath]);

  // Sync input when env changes externally
  useEffect(() => {
    setInputPath(pythonEnvPath || '');
  }, [pythonEnvPath]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSelectEnv = useCallback(async (path: string) => {
    setPythonEnvPath(path);
    setInputPath(path);
    setValidating(true);
    try {
      const result = await api.validatePythonEnv(path);
      setCustomEnv(result);
    } catch {
      setCustomEnv(null);
    } finally {
      setValidating(false);
    }
  }, [setPythonEnvPath]);

  const handleApplyManual = useCallback(async () => {
    const path = inputPath.trim();
    if (!path) return;
    await handleSelectEnv(path);
  }, [inputPath, handleSelectEnv]);

  const handleSelectDefault = useCallback(() => {
    setPythonEnvPath(null);
    setInputPath('');
    setCustomEnv(null);
  }, []);

  const handleRescan = useCallback(() => {
    setScanning(true);
    api.discoverPythonEnvs(projectDir)
      .then(res => setDiscoveredEnvs(res.environments))
      .catch(() => {})
      .finally(() => setScanning(false));
  }, [projectDir]);

  const label = pythonEnvPath
    ? pythonEnvPath.split('/').filter(Boolean).pop() || 'Custom'
    : 'Default';

  return (
    <div className="relative" ref={panelRef}>
      {/* Toolbar trigger */}
      <button
        onClick={() => setOpen(!open)}
        title={pythonEnvPath || 'Python: Default (built-in)'}
        className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs transition-colors truncate max-w-[160px] ${
          open
            ? 'bg-toolbar-hover text-on-surface-primary'
            : 'text-on-surface-secondary hover:bg-toolbar-hover'
        }`}
      >
        <Terminal size={12} className="shrink-0" />
        <span className="truncate">{label}</span>
        <ChevronDown size={10} className="shrink-0 opacity-50" />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute top-full mt-1 right-0 w-[420px] bg-surface-primary border border-border rounded-lg shadow-xl z-50 overflow-hidden text-xs">
          {/* Header */}
          <div className="px-2 py-1 border-b border-border bg-inspector-section flex items-center justify-between">
            <span className="font-semibold text-on-surface-muted uppercase tracking-wider text-2xs">Interpreter</span>
            <button
              onClick={handleRescan}
              disabled={scanning}
              className="text-on-surface-muted hover:text-on-surface-secondary flex items-center gap-1"
            >
              {scanning ? <Loader2 size={8} className="animate-spin" /> : <Search size={8} />}
              {scanning ? 'Scanning' : 'Rescan'}
            </button>
          </div>

          {/* Manual path input — at top */}
          <div className="px-2 py-1 border-b border-border">
            <div className="flex gap-1">
              <input
                ref={inputRef}
                type="text"
                value={inputPath}
                onChange={e => setInputPath(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleApplyManual(); }}
                placeholder="/path/to/venv or python binary"
                className="flex-1 px-1.5 py-px border border-border rounded bg-surface-tertiary text-on-surface-primary placeholder:text-on-surface-muted focus:border-blue-500 focus:outline-none"
              />
              <button
                onClick={handleApplyManual}
                disabled={validating || !inputPath.trim()}
                className="px-1.5 py-px bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                {validating ? <Loader2 size={9} className="animate-spin" /> : 'Apply'}
              </button>
            </div>
            {customEnv && !customEnv.valid && (
              <div className="flex items-center gap-1 text-red-600 dark:text-red-400 mt-0.5">
                <XCircle size={9} className="shrink-0" />
                <span className="truncate">{customEnv.error}</span>
              </div>
            )}
          </div>

          <div className="max-h-[280px] overflow-y-auto pb-1" style={{ fontSize: 12 }}>
            {/* Default option */}
            <button
              onClick={handleSelectDefault}
              className={`w-full text-left px-2 py-1 flex items-center justify-between transition-colors ${
                !isCustom ? 'bg-blue-50/50 dark:bg-blue-900/15' : 'hover:bg-surface-secondary'
              }`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${!isCustom ? 'bg-green-500' : 'bg-on-surface-disabled'}`} />
                <span className="font-medium text-on-surface-primary">Default (built-in interpreter)</span>
                {defaultEnv && <span className="text-on-surface-muted truncate">{defaultEnv.version}</span>}
              </div>
              {!isCustom && <CheckCircle2 size={10} className="text-blue-500 shrink-0" />}
            </button>

            {/* Discovered environments grouped by source with dividers */}
            {(() => {
              const sourceOrder = ['conda', 'venv', 'pyenv', 'system'];
              const groups = sourceOrder
                .map(source => ({ source, envs: discoveredEnvs.filter(e => e.source === source) }))
                .filter(g => g.envs.length > 0);
              // Collect any sources not in sourceOrder
              const knownSources = new Set(sourceOrder);
              const otherEnvs = discoveredEnvs.filter(e => !knownSources.has(e.source));
              if (otherEnvs.length > 0) groups.push({ source: 'other', envs: otherEnvs });

              return groups.map((group, gi) => (
                <div key={group.source}>
                  {/* Divider with source label */}
                  <div className="flex items-center gap-1.5 px-2 py-0.5 bg-inspector-section border-t border-border">
                    <span className="text-on-surface-muted uppercase tracking-wider font-semibold" style={{ fontSize: 9 }}>
                      {SOURCE_LABELS[group.source] || group.source}
                    </span>
                  </div>
                  {group.envs.map((env) => {
                    const isActive = pythonEnvPath === env.path;
                    return (
                      <button
                        key={env.path}
                        onClick={() => handleSelectEnv(env.path)}
                        className={`w-full text-left px-2 py-1 flex items-center justify-between transition-colors ${
                          isActive ? 'bg-blue-50/50 dark:bg-blue-900/15' : 'hover:bg-surface-secondary'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? 'bg-green-500' : 'bg-on-surface-disabled'}`} />
                          <span className="font-medium text-on-surface-primary shrink-0">{env.name}</span>
                          <span className="text-on-surface-muted truncate">{env.path}</span>
                        </div>
                        {isActive && <CheckCircle2 size={10} className="text-blue-500 shrink-0 ml-1" />}
                      </button>
                    );
                  })}
                </div>
              ));
            })()}

            {scanning && discoveredEnvs.length === 0 && (
              <div className="px-2 py-2 flex items-center justify-center gap-1.5 text-on-surface-muted">
                <Loader2 size={10} className="animate-spin" />
                Scanning...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
