import { useBoardStore } from '@/store/boardStore';
import type { BoardElement } from '@/types/board';

/** Maximum on-canvas size for a freshly pasted image. Keeps screenshots
 *  from filling the entire viewport — the user can always resize larger. */
const MAX_W = 600;
const MAX_H = 500;

/** Strip a `data:<mime>;base64,` prefix to get the bare base64 payload that
 *  ImageNode expects in `source.embeddedData`. */
function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const result = r.result;
      if (typeof result !== 'string') return reject(new Error('FileReader returned non-string'));
      resolve(stripDataUrlPrefix(result));
    };
    r.onerror = () => reject(r.error ?? new Error('FileReader failed'));
    r.readAsDataURL(blob);
  });
}

function imageDimensions(blob: Blob): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || 1;
      const h = img.naturalHeight || 1;
      URL.revokeObjectURL(url);
      resolve({ w, h });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to decode image'));
    };
    img.src = url;
  });
}

/**
 * Paste an image blob (from the OS clipboard) onto the active board as an
 * embedded image element. Returns the new element, or null if no board is
 * open or decoding failed.
 *
 * The image is stored entirely inside the board (no source.path) — there
 * is no on-disk file to link back to. ImageNode renders directly from
 * `source.embeddedData` so this round-trips through save/load with the
 * board JSON.
 */
export async function pasteImageFromBlob(
  blob: Blob,
  mime: string,
): Promise<BoardElement | null> {
  const store = useBoardStore.getState();
  if (!store.board) return null;

  let dims: { w: number; h: number };
  try {
    dims = await imageDimensions(blob);
  } catch {
    return null;
  }

  const base64 = await blobToBase64(blob);

  // Scale the placement size down to fit MAX_W / MAX_H while keeping the
  // intrinsic aspect ratio. The base64 bytes are unchanged — only the
  // element's display dimensions are scaled.
  const scale = Math.min(1, MAX_W / dims.w, MAX_H / dims.h);
  const width = Math.max(1, Math.round(dims.w * scale));
  const height = Math.max(1, Math.round(dims.h * scale));

  return store.addElement('image', {
    width,
    height,
    source: {
      mode: 'exact',
      path: '',
      followLatest: false,
      autoRefresh: false,
      embeddedData: base64,
      embeddedMime: mime,
      linkStatus: 'unlinked',
    },
  });
}
