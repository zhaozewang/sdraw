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

/** Whether the backend supports gzip-encoded request bodies. Auto-detected
 *  on the first `compressedPost` call: if the server returns 400, we flip
 *  to false and every subsequent call uses plain JSON. This makes the
 *  feature safe even if the backend hasn't been restarted with the
 *  decompression middleware yet. */
let gzipRequestSupported: boolean | null = null;

async function compressedPost<T>(url: string, data: unknown, timeoutMs = 30000): Promise<T> {
  const json = JSON.stringify(data);

  // Try gzip when capability is unknown or confirmed
  if (gzipRequestSupported !== false && typeof CompressionStream !== 'undefined') {
    try {
      const blob = new Blob([json]);
      const stream = blob.stream().pipeThrough(new CompressionStream('gzip'));
      const compressed = await new Response(stream).arrayBuffer();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(`${API_BASE}${url}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Encoding': 'gzip',
          },
          body: compressed,
          signal: controller.signal,
        });
        if (res.ok) {
          gzipRequestSupported = true;
          return res.json();
        }
        // 400 likely means server can't decompress — fall through
        if (res.status === 400) {
          gzipRequestSupported = false;
        } else {
          const text = await res.text();
          throw new Error(`API error ${res.status}: ${text}`);
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      // CompressionStream failed or network error on compressed attempt.
      // If it was a genuine server rejection (gzipRequestSupported set
      // to false above), fall through. Otherwise re-throw.
      if (gzipRequestSupported !== false) throw err;
    }
  }

  // Fallback: plain JSON POST
  return request<T>(url, { method: 'POST', body: json }, timeoutMs);
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
    compressedPost<{ path: string; size?: number; mtime?: number; oversized?: boolean; soft_limit?: number }>(
      '/boards/save',
      { board, path },
      60000,
    ),

  boardCodeDigest: (path: string) =>
    request<{ digest: string; mtime?: number }>('/boards/digest', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  saveBoardDelta: (delta: {
    path: string;
    board_id: string;
    updated_at: string;
    thumbnail?: string | null;
    dirty_elements: any[];
    removed_ids: string[];
    setup?: any;
    plot_codes?: any;
    canvas?: any;
    auto_export?: any;
  }) =>
    compressedPost<{ path: string; size?: number; mtime?: number }>(
      '/boards/save-delta',
      delta,
      60000,
    ),

  openBoardFromFile: (path: string) =>
    request<{ path: string; board: Board; mtime?: number }>(
      '/boards/open',
      {
        method: 'POST',
        body: JSON.stringify({ path }),
      },
      30000, // big boards over slow links can easily exceed the 5s default
    ),

  // Plot specs for PlotEditor are multi-MB per plot and live in
  // ~/.sdraw/cache/. We fetch them lazily when the editor modal opens
  // instead of shipping them with every /boards/open response.
  getPlotlyJson: (boardId: string, elementId: string) =>
    request<{ plotly_json: string | null }>(
      '/boards/plotly-json',
      {
        method: 'POST',
        body: JSON.stringify({ board_id: boardId, element_id: elementId }),
      },
      15000,
    ),

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
    compressedPost<{ path: string }>(
      '/boards/checkpoint/save',
      { board, path },
      30000,
    ),

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
    request<{
      exists: boolean;
      data: string | null;
      mime: string | null;
      mtime: number | null;
      oversized?: boolean;
      size?: number;
      max_size?: number;
    }>(
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
  executePlot: (
    code: string,
    timeout = 30,
    dpi = 150,
    pythonPath?: string | null,
    executionId?: string,
    cwd?: string | null,
    kernel?: { boardId?: string; setupCode?: string; setupTimeout?: number },
  ) =>
    request<{
      success: boolean;
      image_base64: string | null;
      stdout: string | null;
      error: string | null;
      plotly_json: string | null;
      figures: Array<{ image: string | null; plotly_json: string | null }>;
    }>(
      '/plot/execute',
      {
        method: 'POST',
        body: JSON.stringify({
          code,
          timeout,
          dpi,
          python_path: pythonPath || null,
          execution_id: executionId || null,
          cwd: cwd || null,
          board_id: kernel?.boardId ?? null,
          setup_code: kernel?.setupCode ?? null,
          setup_timeout: kernel?.setupTimeout ?? 120,
        }),
      },
      (Math.max(timeout, kernel?.setupTimeout ?? 0) + 5) * 1000,
    ),

  abortPlot: (executionId: string) =>
    request<{ aborted: boolean }>('/plot/abort', {
      method: 'POST',
      body: JSON.stringify({ execution_id: executionId }),
    }),

  // Kernel lifecycle (per-board persistent Python process)
  runSetup: (boardId: string, setupCode: string, pythonPath?: string | null, timeout = 120, cwd?: string | null) =>
    request<{ success: boolean; image_base64: string | null; stdout: string | null; error: string | null; plotly_json: string | null }>(
      '/plot/kernel/setup',
      {
        method: 'POST',
        body: JSON.stringify({
          board_id: boardId,
          setup_code: setupCode,
          python_path: pythonPath || null,
          timeout,
          cwd: cwd || null,
        }),
      },
      (timeout + 5) * 1000,
    ),

  restartKernel: (boardId: string) =>
    request<{ restarted: boolean; board_id: string }>('/plot/kernel/restart', {
      method: 'POST',
      body: JSON.stringify({ board_id: boardId }),
    }),

  reloadKernelModules: (boardId: string) =>
    request<{
      ok: boolean;
      reloaded: string[];
      errors: Array<{ module: string; error: string }>;
      rebound: number;
      kernel_running: boolean;
    }>('/plot/kernel/reload-modules', {
      method: 'POST',
      body: JSON.stringify({ board_id: boardId }),
    }, 30000),

  shutdownKernel: (boardId: string) =>
    request<{ shutdown: boolean; board_id: string }>('/plot/kernel/shutdown', {
      method: 'POST',
      body: JSON.stringify({ board_id: boardId }),
    }),

  kernelStatus: (boardId: string) =>
    request<{
      running: boolean;
      last_setup_hash: string | null;
      python_path: string | null;
      recent_stderr: string[];
    }>(`/plot/kernel/status?board_id=${encodeURIComponent(boardId)}`),

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
