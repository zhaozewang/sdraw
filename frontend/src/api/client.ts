import type { Board, BoardSummary, FileInfo, DirEntry } from '@/types/board';

const API_BASE = '/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

export const api = {
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

  deleteBoardFile: (path: string) =>
    request<{ deleted: string }>('/boards/delete-file', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  // Files
  getImageUrl: (path: string, version?: string | number) => {
    const params = new URLSearchParams({ path });
    if (version !== undefined) params.set('v', String(version));
    return `${API_BASE}/image?${params.toString()}`;
  },

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
};
