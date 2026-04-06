export type ElementType = 'image' | 'text' | 'rectangle' | 'arrow' | 'group' | 'plot';
export type FitMode = 'contain' | 'cover' | 'stretch' | 'center';
export type ImageMode = 'exact' | 'relative' | 'glob';
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';

export interface ElementStyle {
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  shadow?: boolean;
  background?: string;
  fitMode?: FitMode;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
  color?: string;
  padding?: number;
  textAlign?: 'left' | 'center' | 'right';
  lineHeight?: number;
  strokeColor?: string;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle;
  fill?: string;
  opacity?: number;
  italic?: boolean;
}

export interface ImageSource {
  mode: ImageMode;
  path: string;
  followLatest: boolean;
  autoRefresh: boolean;
  pinnedPath?: string;
}

export interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoardElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  z_index: number;
  locked: boolean;
  visible: boolean;
  rotation: number;
  style: ElementStyle;
  source?: ImageSource;
  crop?: CropRegion;
  text?: string;
  metadata: Record<string, any>;
  children?: string[];
  points?: Array<{ x: number; y: number }>;
}

export type GridPattern = 'dots' | 'lines' | 'cross';

export interface CanvasSettings {
  width: number;
  height: number;
  infinite: boolean;
  background: string;
  grid_enabled: boolean;
  grid_size: number;
  grid_pattern: GridPattern;
  snap_enabled: boolean;
  snap_size: number;
}

export type ExportFormat = 'png' | 'jpg' | 'pdf' | 'svg';

export type ExportSizeMode = 'fit' | 'fixed' | 'canvas';

export interface AutoExportSettings {
  enabled: boolean;
  outputPath: string;       // absolute path to export file
  format: ExportFormat;
  dpi: number;              // pixel ratio multiplier
  transparent: boolean;
  sizeMode: ExportSizeMode; // 'fit' = crop to elements, 'fixed' = user W/H, 'canvas' = canvas W/H
  fixedWidth?: number;
  fixedHeight?: number;
}

export interface Board {
  schema_version: number;
  id: string;
  name: string;
  canvas: CanvasSettings;
  elements: BoardElement[];
  autoExport?: AutoExportSettings;
  created_at: string;
  updated_at: string;
  app_version: string;
}

export interface BoardSummary {
  id: string;
  name: string;
  updated_at: string;
  element_count: number;
}

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  modified_time: string;
  dimensions?: { width: number; height: number };
}

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified_time: string;
  dimensions?: { width: number; height: number };
}

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified_time: string;
  dimensions?: { width: number; height: number };
}

export interface FileEvent {
  event_type: 'file_changed' | 'file_created' | 'file_deleted' | 'file_moved';
  path: string;
  relative_path?: string;
  modified_time: string;
  size: number;
}

export const DEFAULT_CANVAS: CanvasSettings = {
  width: 2400,
  height: 1600,
  infinite: true,
  background: '#ffffff',
  grid_enabled: true,
  grid_size: 20,
  grid_pattern: 'dots',
  snap_enabled: true,
  snap_size: 10,
};

export const DEFAULT_IMAGE_STYLE: ElementStyle = {
  borderColor: '#d0d0d0',
  borderWidth: 0,
  borderRadius: 0,
  shadow: false,
  background: 'transparent',
  opacity: 1,
};

export const DEFAULT_TEXT_STYLE: ElementStyle = {
  fontSize: 14,
  fontWeight: 400,
  fontFamily: 'Inter, sans-serif',
  color: '#111111',
  background: 'transparent',
  padding: 4,
  textAlign: 'left',
  lineHeight: 1.4,
  opacity: 1,
};

export const DEFAULT_RECT_STYLE: ElementStyle = {
  strokeColor: '#333333',
  strokeWidth: 2,
  strokeStyle: 'solid',
  fill: 'transparent',
  borderRadius: 0,
  opacity: 1,
};

export const DEFAULT_ARROW_STYLE: ElementStyle = {
  strokeColor: '#333333',
  strokeWidth: 2,
  strokeStyle: 'solid',
  opacity: 1,
};

export const DEFAULT_PLOT_STYLE: ElementStyle = {
  borderColor: '#d0d0d0',
  borderWidth: 0,
  borderRadius: 0,
  shadow: false,
  background: 'transparent',
  opacity: 1,
};
