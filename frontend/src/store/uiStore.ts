import { create } from 'zustand';
import {
  getTheme,
  setTheme as persistTheme,
  getPythonEnv,
  setPythonEnv as persistPythonEnv,
} from '@/utils/localStorage';

export type ThemeMode = 'light' | 'dark' | 'system';
export type InsertMode = null | 'image' | 'text' | 'rectangle' | 'arrow' | 'pen' | 'plot';

/** Pending insert payload: element type + any style/metadata overrides for the shape */
export interface InsertPayload {
  type: 'text' | 'rectangle' | 'arrow' | 'pen' | 'plot';
  overrides?: Record<string, any>;
}
export type PanelTab = 'insert' | 'layers';

interface UIState {
  // Theme
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;

  // Selection
  selectedIds: string[];

  // Panels
  showInspector: boolean;
  showInsertPanel: boolean;
  insertPanelTab: PanelTab;
  insertPanelWidth: number;
  inspectorWidth: number;

  // Insert mode
  insertMode: InsertMode;
  insertPayload: InsertPayload | null;

  // Zoom
  zoom: number;

  // Dialogs
  showBoardDialog: boolean;
  showExportDialog: boolean;
  showFolderDialog: boolean;
  showSettings: boolean;

  // Status
  connectionStatus: 'connected' | 'disconnected' | 'connecting';
  watchedRoots: string[];
  recentEvents: Array<{ path: string; type: string; time: string }>;

  // Auto-save
  autoSaveEnabled: boolean;

  // Flag to suppress Canvas position handling during endpoint drags
  suppressPositionSync: boolean;
  setSuppressPositionSync: (v: boolean) => void;

  // Resize alignment guides (set by Resizer via node, read by Canvas overlay)
  resizeGuides: Array<{ axis: 'x' | 'y'; pos: number }>;
  resizeSpacing: Array<{ axis: 'x' | 'y'; from: number; to: number; pos: number; label: string }>;
  setResizeGuides: (guides: Array<{ axis: 'x' | 'y'; pos: number }>, spacing: Array<{ axis: 'x' | 'y'; from: number; to: number; pos: number; label: string }>) => void;

  // Snap target highlight (element ID whose edge should glow)
  snapTargetId: string | null;
  setSnapTargetId: (id: string | null) => void;

  // Plot editor modal
  plotEditorElementId: string | null;
  setPlotEditorElementId: (id: string | null) => void;

  // Board setup editor modal (per-board Python kernel setup code)
  setupEditorOpen: boolean;
  openSetupEditor: () => void;
  closeSetupEditor: () => void;

  // Python environment for plot execution
  pythonEnvPath: string | null; // null = default (built-in)
  setPythonEnvPath: (path: string | null) => void;

  // Auto-export status
  exportStatus: 'idle' | 'exporting' | 'success' | 'error';
  setExportStatus: (status: 'idle' | 'exporting' | 'success' | 'error') => void;

  // Save/export progress for the global progress bar
  progressLabel: string | null;
  setProgressLabel: (label: string | null) => void;

  // Zoom callbacks (set by Canvas, called by Toolbar)
  zoomTo: ((zoom: number) => void) | null;
  fitView: (() => void) | null;
  setZoomTo: (fn: ((zoom: number) => void) | null) => void;
  setFitView: (fn: (() => void) | null) => void;

  // Actions
  setSelectedIds: (ids: string[]) => void;
  addToSelection: (id: string) => void;
  removeFromSelection: (id: string) => void;
  clearSelection: () => void;

  toggleInspector: () => void;
  toggleInsertPanel: () => void;
  setInsertPanelTab: (tab: PanelTab) => void;
  setInsertMode: (mode: InsertMode) => void;
  setInsertPayload: (payload: InsertPayload | null) => void;
  setInsertPanelWidth: (width: number) => void;
  setInspectorWidth: (width: number) => void;

  setZoom: (zoom: number) => void;

  setShowBoardDialog: (show: boolean) => void;
  setShowExportDialog: (show: boolean) => void;
  setShowFolderDialog: (show: boolean) => void;
  setShowSettings: (show: boolean) => void;

  setConnectionStatus: (status: 'connected' | 'disconnected' | 'connecting') => void;
  setWatchedRoots: (roots: string[]) => void;
  addRecentEvent: (event: { path: string; type: string; time: string }) => void;

  setAutoSaveEnabled: (enabled: boolean) => void;
}

function applyThemeToDOM(theme: ThemeMode) {
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', isDark);
}

// Apply on load
applyThemeToDOM(getTheme());

// Listen for OS theme changes when in 'system' mode
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (getTheme() === 'system') applyThemeToDOM('system');
});

export const useUIStore = create<UIState>((set, get) => ({
  theme: getTheme(),
  setTheme: (theme) => {
    persistTheme(theme);
    applyThemeToDOM(theme);
    set({ theme });
  },

  selectedIds: [],
  showInspector: true,
  showInsertPanel: true,
  insertPanelTab: 'insert',
  insertPanelWidth: 220,
  inspectorWidth: 240,
  insertMode: null,
  insertPayload: null,
  zoom: 1,
  showBoardDialog: false,
  showExportDialog: false,
  showFolderDialog: false,
  showSettings: false,
  connectionStatus: 'disconnected',
  watchedRoots: [],
  recentEvents: [],
  autoSaveEnabled: false,
  suppressPositionSync: false,
  setSuppressPositionSync: (v) => set({ suppressPositionSync: v }),
  resizeGuides: [],
  resizeSpacing: [],
  setResizeGuides: (guides, spacing) => set({ resizeGuides: guides, resizeSpacing: spacing }),
  snapTargetId: null,
  setSnapTargetId: (id) => set({ snapTargetId: id }),
  plotEditorElementId: null,
  setPlotEditorElementId: (id) => set({ plotEditorElementId: id }),
  setupEditorOpen: false,
  openSetupEditor: () => set({ setupEditorOpen: true }),
  closeSetupEditor: () => set({ setupEditorOpen: false }),
  pythonEnvPath: getPythonEnv(),
  setPythonEnvPath: (path) => {
    persistPythonEnv(path);
    set({ pythonEnvPath: path });
  },
  exportStatus: 'idle',
  setExportStatus: (status) => set({ exportStatus: status }),

  progressLabel: null,
  setProgressLabel: (label) => set({ progressLabel: label }),
  zoomTo: null,
  fitView: null,
  setZoomTo: (fn) => set({ zoomTo: fn }),
  setFitView: (fn) => set({ fitView: fn }),

  setSelectedIds: (ids) => set({ selectedIds: ids }),
  addToSelection: (id) => set(s => ({ selectedIds: [...s.selectedIds, id] })),
  removeFromSelection: (id) => set(s => ({ selectedIds: s.selectedIds.filter(i => i !== id) })),
  clearSelection: () => set({ selectedIds: [] }),

  toggleInspector: () => set(s => ({ showInspector: !s.showInspector })),
  toggleInsertPanel: () => set(s => ({ showInsertPanel: !s.showInsertPanel })),
  setInsertPanelTab: (tab) => set({ insertPanelTab: tab }),
  setInsertMode: (mode) => set({ insertMode: mode }),
  setInsertPayload: (payload) => set({ insertPayload: payload, insertMode: payload ? payload.type as InsertMode : null }),
  setInsertPanelWidth: (width) => set({ insertPanelWidth: Math.max(160, Math.min(400, width)) }),
  setInspectorWidth: (width) => set({ inspectorWidth: Math.max(180, Math.min(400, width)) }),

  setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(5, zoom)) }),

  setShowBoardDialog: (show) => set({ showBoardDialog: show }),
  setShowExportDialog: (show) => set({ showExportDialog: show }),
  setShowFolderDialog: (show) => set({ showFolderDialog: show }),
  setShowSettings: (show) => set({ showSettings: show }),

  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setWatchedRoots: (roots) => set({ watchedRoots: roots }),
  addRecentEvent: (event) => set(s => ({
    recentEvents: [event, ...s.recentEvents].slice(0, 50),
  })),

  setAutoSaveEnabled: (enabled) => set({ autoSaveEnabled: enabled }),
}));
