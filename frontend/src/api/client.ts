import type { Board, BoardSummary, FileInfo, DirEntry } from '@/types/board';

// In packaged mode the backend runs on a dynamic port passed via query param or same origin
const API_BASE = '/api';

async function request<T>(url: string, options?: RequestInit, timeoutMs = 5000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${url}`, {
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      ...options,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error ${res.status}: ${text}`);
    }
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export interface WorkspaceBoardSummary {
  id: string;
  name: string;
  updated_at: string;
  path: string;
  element_count: number;
  image_count: number;
  canvas: { width?: number; height?: number; infinite?: boolean; background?: string };
  thumbnail?: string | null;
}

export const api = {
  // Workspace boards (from workspace/boards/)
  listWorkspaceBoards: () =>
    request<WorkspaceBoardSummary[]>('/boards/'),

  // Board file operations
  saveBoardToFile: (board: Board, path: string) =>
    request<{ path: string; board: Board }>('/boards/save', {
      method: 'POST',
      body: JSON.stringify({ board, path }),
    }),

  openBoardFromFile: (path: string) =>
    request<{ path: string; board: Board }>('/boards/open', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  boardSummary: (path: string) =>
    request<WorkspaceBoardSummary>('/boards/summary', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  deleteBoardFile: (path: string) =>
    request<{ deleted: string }>('/boards/delete-file', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  // Checkpoint / crash recovery
  saveCheckpoint: (board: Board, path: string) =>
    request<{ path: string }>('/boards/checkpoint/save', {
      method: 'POST',
      body: JSON.stringify({ board, path }),
    }),

  checkCheckpoint: (path: string) =>
    request<{ exists: boolean; newer?: boolean }>('/boards/checkpoint/check', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  loadCheckpoint: (path: string) =>
    request<{ path: string; board: Board }>('/boards/checkpoint/load', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  deleteCheckpoint: (path: string) =>
    request<{ deleted: boolean }>('/boards/checkpoint/delete', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  // Files
  getImageUrl: (path: string, version?: string | number) => {
    const params = new URLSearchParams({ path });
    if (version !== undefined) params.set('v', String(version));
    return `${API_BASE}/image?${params.toString()}`;
  },

  embedImage: (path: string) =>
    request<{ exists: boolean; data: string | null; mime: string | null; mtime: number | null }>(
      '/image/embed',
      { method: 'POST', body: JSON.stringify({ path }) },
      30000, // larger timeout for big images
    ),

  checkImage: (path: string) =>
    request<{ exists: boolean; mtime: number | null }>('/image/check', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  validatePath: (path: string) =>
    request<{ valid: boolean; exists: boolean; is_file: boolean; is_dir: boolean }>(
      '/path/validate',
      { method: 'POST', body: JSON.stringify({ path }) }
    ),

  mkdir: (path: string) =>
    request<{ path: string }>('/path/mkdir', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  browse: (path: string, showHidden?: boolean) =>
    request<{ path: string; parent: string; entries: DirEntry[] }>('/path/browse', {
      method: 'POST',
      body: JSON.stringify({ path, show_hidden: showHidden ?? false }),
    }),

  listFiles: (path: string, extensions?: string[], sort_by?: string) =>
    request<FileInfo[]>('/path/list_files', {
      method: 'POST',
      body: JSON.stringify({ path, extensions, sort_by: sort_by || 'name' }),
    }),

  getFileMetadata: (path: string) =>
    request<FileInfo>(`/file_metadata?path=${encodeURIComponent(path)}`),

  // Watch
  registerWatch: (path: string) =>
    request<{ status: string }>('/watch/register', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  unregisterWatch: (path: string) =>
    request<{ status: string }>('/watch/unregister', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  // Plot execution
  executePlot: (code: string, timeout = 30, dpi = 150, pythonPath?: string | null, executionId?: string, cwd?: string | null) =>
    request<{ success: boolean; image_base64: string | null; stdout: string | null; error: string | null }>(
      '/plot/execute',
      {
        method: 'POST',
        body: JSON.stringify({ code, timeout, dpi, python_path: pythonPath || null, execution_id: executionId || null, cwd: cwd || null }),
      },
      (timeout + 5) * 1000,
    ),

  abortPlot: (executionId: string) =>
    request<{ aborted: boolean }>('/plot/abort', {
      method: 'POST',
      body: JSON.stringify({ execution_id: executionId }),
    }),

  // Python environment
  getDefaultPythonEnv: () =>
    request<{ valid: boolean; python: string | null; version: string | null; packages: string[]; is_default: boolean; error: string | null }>(
      '/plot/default-env',
    ),

  discoverPythonEnvs: (projectDir?: string | null) => {
    const params = projectDir ? `?project_dir=${encodeURIComponent(projectDir)}` : '';
    return request<{ environments: Array<{ name: string; path: string; source: string }> }>(
      `/plot/discover-envs${params}`,
      undefined,
      15000,
    );
  },

  validatePythonEnv: (pythonPath: string) =>
    request<{ valid: boolean; python: string | null; version: string | null; packages: string[]; is_default: boolean; error: string | null }>(
      '/plot/validate-env',
      { method: 'POST', body: JSON.stringify({ python_path: pythonPath }) },
      15000,
    ),
};
