import { create } from 'zustand';

export type InsertMode = null | 'image' | 'text' | 'rectangle' | 'arrow';
export type PanelTab = 'insert' | 'layers';

interface UIState {
  // Selection
  selectedIds: string[];

  // Panels
  showInspector: boolean;
  showInsertPanel: boolean;
  insertPanelTab: PanelTab;

  // Insert mode
  insertMode: InsertMode;

  // Zoom
  zoom: number;

  // Dialogs
  showBoardDialog: boolean;
  showExportDialog: boolean;
  showFolderDialog: boolean;

  // Status
  connectionStatus: 'connected' | 'disconnected' | 'connecting';
  watchedRoots: string[];
  recentEvents: Array<{ path: string; type: string; time: string }>;

  // Auto-save
  autoSaveEnabled: boolean;

  // Actions
  setSelectedIds: (ids: string[]) => void;
  addToSelection: (id: string) => void;
  removeFromSelection: (id: string) => void;
  clearSelection: () => void;

  toggleInspector: () => void;
  toggleInsertPanel: () => void;
  setInsertPanelTab: (tab: PanelTab) => void;
  setInsertMode: (mode: InsertMode) => void;

  setZoom: (zoom: number) => void;

  setShowBoardDialog: (show: boolean) => void;
  setShowExportDialog: (show: boolean) => void;
  setShowFolderDialog: (show: boolean) => void;

  setConnectionStatus: (status: 'connected' | 'disconnected' | 'connecting') => void;
  setWatchedRoots: (roots: string[]) => void;
  addRecentEvent: (event: { path: string; type: string; time: string }) => void;

  setAutoSaveEnabled: (enabled: boolean) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  selectedIds: [],
  showInspector: true,
  showInsertPanel: true,
  insertPanelTab: 'insert',
  insertMode: null,
  zoom: 1,
  showBoardDialog: false,
  showExportDialog: false,
  showFolderDialog: false,
  connectionStatus: 'disconnected',
  watchedRoots: [],
  recentEvents: [],
  autoSaveEnabled: true,

  setSelectedIds: (ids) => set({ selectedIds: ids }),
  addToSelection: (id) => set(s => ({ selectedIds: [...s.selectedIds, id] })),
  removeFromSelection: (id) => set(s => ({ selectedIds: s.selectedIds.filter(i => i !== id) })),
  clearSelection: () => set({ selectedIds: [] }),

  toggleInspector: () => set(s => ({ showInspector: !s.showInspector })),
  toggleInsertPanel: () => set(s => ({ showInsertPanel: !s.showInsertPanel })),
  setInsertPanelTab: (tab) => set({ insertPanelTab: tab }),
  setInsertMode: (mode) => set({ insertMode: mode }),

  setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(5, zoom)) }),

  setShowBoardDialog: (show) => set({ showBoardDialog: show }),
  setShowExportDialog: (show) => set({ showExportDialog: show }),
  setShowFolderDialog: (show) => set({ showFolderDialog: show }),

  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setWatchedRoots: (roots) => set({ watchedRoots: roots }),
  addRecentEvent: (event) => set(s => ({
    recentEvents: [event, ...s.recentEvents].slice(0, 50),
  })),

  setAutoSaveEnabled: (enabled) => set({ autoSaveEnabled: enabled }),
}));
