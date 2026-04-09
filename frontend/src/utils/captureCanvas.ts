/**
 * Export a board to an image by building a self-contained SVG from the data
 * model, then rasterising it through the browser's native SVG renderer.
 *
 * This is the same approach tldraw uses — each element is serialised to SVG,
 * assembled into a single document, loaded as an Image, drawn to a canvas,
 * and exported as PNG/JPG.  Because the browser's real SVG engine handles
 * markers, transforms, fonts, etc., the output is pixel-perfect.
 */

import type { Board, BoardElement } from '@/types/board';

export interface CaptureOptions {
  scale: number;
  transparent: boolean;
  mode: 'fit' | 'fixed' | 'canvas';
  fixedW?: number;
  fixedH?: number;
}

// -----------------------------------------------------------------------
//  Path building — mirrors ArrowNode.tsx exactly
// -----------------------------------------------------------------------

type Pt = { x: number; y: number };

function defaultControlPoints(p0: Pt, p1: Pt, lineType: string): Pt[] {
  const mx = (p0.x + p1.x) / 2;
  const my = (p0.y + p1.y) / 2;
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const offX = (-dy / len) * len * 0.3;
  const offY = (dx / len) * len * 0.3;
  switch (lineType) {
    case 'quadratic':
    case 'arc':
      return [{ x: mx + offX, y: my + offY }];
    case 'smooth':
      return [{ x: mx + offX * 0.4, y: my + offY * 0.4 }];
    case 'cubic':
      return [
        { x: p0.x + dx * 0.25 + offX, y: p0.y + dy * 0.25 + offY },
        { x: p0.x + dx * 0.75 - offX, y: p0.y + dy * 0.75 - offY },
      ];
    default:
      return [];
  }
}

function buildPath(p0: Pt, p1: Pt, lineType: string, ctrl: Pt[], stepRadius = 20): string {
  switch (lineType) {
    case 'quadratic':
    case 'arc': {
      const c = ctrl[0] || { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      return `M ${p0.x},${p0.y} Q ${c.x},${c.y} ${p1.x},${p1.y}`;
    }
    case 'smooth': {
      if (ctrl.length > 0) {
        const c = ctrl[0];
        return `M ${p0.x},${p0.y} Q ${c.x},${c.y} ${p1.x},${p1.y}`;
      }
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const tension = Math.min(Math.abs(dx), Math.abs(dy)) * 0.5 + Math.abs(dx) * 0.25;
      return `M ${p0.x},${p0.y} C ${p0.x + tension},${p0.y} ${p1.x - tension},${p1.y} ${p1.x},${p1.y}`;
    }
    case 'cubic': {
      const c1 = ctrl[0] || { x: p0.x + (p1.x - p0.x) * 0.25, y: p0.y };
      const c2 = ctrl[1] || { x: p0.x + (p1.x - p0.x) * 0.75, y: p1.y };
      return `M ${p0.x},${p0.y} C ${c1.x},${c1.y} ${c2.x},${c2.y} ${p1.x},${p1.y}`;
    }
    case 'step': {
      const mx = (p0.x + p1.x) / 2;
      return `M ${p0.x},${p0.y} L ${mx},${p0.y} L ${mx},${p1.y} L ${p1.x},${p1.y}`;
    }
    case 'step-rounded': {
      const mx = (p0.x + p1.x) / 2;
      const dy = p1.y - p0.y;
      const maxR = Math.min(Math.abs(mx - p0.x), Math.abs(dy) / 2, stepRadius);
      const r = Math.max(maxR, 0);
      if (r < 1) return `M ${p0.x},${p0.y} L ${mx},${p0.y} L ${mx},${p1.y} L ${p1.x},${p1.y}`;
      const sy = dy > 0 ? 1 : -1;
      return [
        `M ${p0.x},${p0.y}`, `L ${mx - r},${p0.y}`,
        `Q ${mx},${p0.y} ${mx},${p0.y + r * sy}`,
        `L ${mx},${p1.y - r * sy}`,
        `Q ${mx},${p1.y} ${mx + r * (p1.x > p0.x ? 1 : -1)},${p1.y}`,
        `L ${p1.x},${p1.y}`,
      ].join(' ');
    }
    default:
      return `M ${p0.x},${p0.y} L ${p1.x},${p1.y}`;
  }
}

// -----------------------------------------------------------------------
//  Marker SVG — mirrors ArrowNode.tsx MarkerDefs exactly
// -----------------------------------------------------------------------

function markerSvg(
  markerId: string, type: string, color: string, headSize: number, isStart: boolean,
): string {
  const s = headSize;
  switch (type) {
    case 'arrow': {
      const w = 10 * s, h = 8 * s, mid = 4 * s;
      const pts = isStart ? `${w} 0, 0 ${mid}, ${w} ${h}` : `0 0, ${w} ${mid}, 0 ${h}`;
      return `<marker id="${markerId}" markerWidth="${w}" markerHeight="${h}" refX="${isStart ? 0 : w}" refY="${mid}" orient="auto" markerUnits="strokeWidth"><polygon points="${pts}" fill="${color}"/></marker>`;
    }
    case 'arrow-open': {
      const w = 10 * s, h = 8 * s, mid = 4 * s;
      const pts = isStart ? `${w} 0, 0 ${mid}, ${w} ${h}` : `0 0, ${w} ${mid}, 0 ${h}`;
      return `<marker id="${markerId}" markerWidth="${w}" markerHeight="${h}" refX="${isStart ? 0 : w}" refY="${mid}" orient="auto" markerUnits="strokeWidth"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="${1.5 * s}"/></marker>`;
    }
    case 'dot': {
      const d = 6 * s, c = 3 * s, r = 2.5 * s;
      return `<marker id="${markerId}" markerWidth="${d}" markerHeight="${d}" refX="${c}" refY="${c}" orient="auto" markerUnits="strokeWidth"><circle cx="${c}" cy="${c}" r="${r}" fill="${color}"/></marker>`;
    }
    case 'diamond': {
      const d = 8 * s, mid = 4 * s;
      return `<marker id="${markerId}" markerWidth="${d}" markerHeight="${d}" refX="${mid}" refY="${mid}" orient="auto" markerUnits="strokeWidth"><polygon points="${mid} 0, ${d} ${mid}, ${mid} ${d}, 0 ${mid}" fill="${color}"/></marker>`;
    }
    case 'bar': {
      const w = 2 * s, h = 8 * s, cx = 1 * s;
      return `<marker id="${markerId}" markerWidth="${w}" markerHeight="${h}" refX="${cx}" refY="${h / 2}" orient="auto" markerUnits="strokeWidth"><line x1="${cx}" y1="0" x2="${cx}" y2="${h}" stroke="${color}" stroke-width="${2 * s}"/></marker>`;
    }
    default:
      return '';
  }
}

// -----------------------------------------------------------------------
//  Escape helpers
// -----------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// -----------------------------------------------------------------------
//  Element → SVG fragment
// -----------------------------------------------------------------------

function elementToSvg(el: BoardElement, markerDefs: string[], markerIds: Set<string>): string {
  const style = el.style || {};
  const meta = el.metadata || {};
  const opacity = style.opacity ?? 1;

  switch (el.type) {
    case 'rectangle': {
      const shape = (meta.shape as string) || 'rect';
      const fill = style.fill || 'transparent';
      const stroke = style.strokeColor || 'transparent';
      const sw = style.strokeWidth ?? 0;
      const br = style.borderRadius ?? 0;
      const x = el.x, y = el.y, w = el.width, h = el.height;

      if (shape === 'triangle') {
        const pts = `${x + w / 2},${y} ${x + w},${y + h} ${x},${y + h}`;
        return `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="${opacity}"/>`;
      }
      if (shape === 'diamond') {
        const pts = `${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`;
        return `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="${opacity}"/>`;
      }
      // rect / circle (high borderRadius)
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(br, w / 2, h / 2)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="${opacity}"/>`;
    }

    case 'arrow': {
      const pts = el.points || [];
      if (pts.length < 2) return '';
      const lineType = (meta.lineType as string) || 'straight';
      const ctrl: Pt[] = (meta.controlPoints as Pt[]) || [];
      const headSize = (meta.arrowHeadSize as number) || 1;
      const startMarker = (meta.startMarker as string) || 'none';
      let endMarker = (meta.endMarker as string) ?? ((meta.arrowHead !== false) ? 'arrow' : 'none');
      if ('endMarker' in meta) endMarker = meta.endMarker as string;

      const p0 = { x: el.x + pts[0].x, y: el.y + pts[0].y };
      const p1 = { x: el.x + pts[1].x, y: el.y + pts[1].y };
      const hasCurve = ['quadratic', 'cubic', 'arc', 'smooth'].includes(lineType);
      const effectiveCtrl = hasCurve && ctrl.length === 0
        ? defaultControlPoints(pts[0], pts[1], lineType).map(c => ({ x: el.x + c.x, y: el.y + c.y }))
        : ctrl.map(c => ({ x: el.x + c.x, y: el.y + c.y }));

      const pathD = buildPath(p0, p1, lineType, effectiveCtrl, (meta.stepRadius as number) || 20);

      const strokeColor = style.strokeColor || '#333333';
      const strokeWidth = style.strokeWidth ?? 2;
      const dasharray = style.strokeStyle === 'dashed' ? '8,4' : style.strokeStyle === 'dotted' ? '2,4' : '';

      // Marker defs
      let smAttr = '', emAttr = '';
      if (startMarker !== 'none') {
        const mid = `m-${el.id}-s`;
        if (!markerIds.has(mid)) {
          markerDefs.push(markerSvg(mid, startMarker, strokeColor, headSize, true));
          markerIds.add(mid);
        }
        smAttr = ` marker-start="url(#${mid})"`;
      }
      if (endMarker !== 'none') {
        const mid = `m-${el.id}-e`;
        if (!markerIds.has(mid)) {
          markerDefs.push(markerSvg(mid, endMarker, strokeColor, headSize, false));
          markerIds.add(mid);
        }
        emAttr = ` marker-end="url(#${mid})"`;
      }

      return `<path d="${pathD}" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}" opacity="${opacity}"${dasharray ? ` stroke-dasharray="${dasharray}"` : ''}${smAttr}${emAttr}/>`;
    }

    case 'text': {
      const text = el.text || '';
      if (!text) return '';
      const fontSize = style.fontSize ?? 14;
      const color = style.color || '#111111';
      const bg = style.background || 'transparent';
      const padding = style.padding ?? 4;
      const textAlign = style.textAlign || 'left';
      const anchor = textAlign === 'center' ? 'middle' : textAlign === 'right' ? 'end' : 'start';
      const tx = textAlign === 'center' ? el.x + el.width / 2
        : textAlign === 'right' ? el.x + el.width - padding
        : el.x + padding;

      let bgRect = '';
      if (bg && bg !== 'transparent') {
        bgRect = `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" fill="${bg}"/>`;
      }

      // NOTE: foreignObject would give pixel-perfect text but taints the canvas
      // (browser security restriction), so we use SVG <text> as fallback.
      // The primary export path uses captureOffscreen.ts (html2canvas) instead.
      const lines = text.split('\n');
      const tspans = lines.map((line, i) =>
        `<tspan x="${tx}" dy="${i === 0 ? 0 : '1.2em'}">${esc(line)}</tspan>`
      ).join('');

      return `${bgRect}<text x="${tx}" y="${el.y + padding + fontSize * 0.85}" font-family="system-ui, -apple-system, sans-serif" font-size="${fontSize}" fill="${color}" text-anchor="${anchor}" opacity="${opacity}">${tspans}</text>`;
    }

    case 'image': {
      const src = el.source?.path;
      if (!src) return '';
      // Images will be replaced with base64 data URIs before rendering
      return `<image x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" href="__IMAGE_${el.id}__" preserveAspectRatio="none" opacity="${opacity}"/>`;
    }

    case 'plot': {
      const lastOutput = (meta.lastOutput as string);
      if (!lastOutput) return '';
      // xMidYMid meet = object-fit:contain (matches PlotNode.tsx)
      return `<image x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" href="data:image/png;base64,${lastOutput}" preserveAspectRatio="xMidYMid meet" opacity="${opacity}"/>`;
    }

    default:
      return '';
  }
}

// -----------------------------------------------------------------------
//  Build complete SVG document from board data
// -----------------------------------------------------------------------

async function boardToSvg(board: Board, opts: CaptureOptions): Promise<string> {
  const elements = board.elements.filter(e => e.visible !== false);
  if (elements.length === 0) return '';

  // Sort by z_index
  const sorted = [...elements].sort((a, b) => (a.z_index || 0) - (b.z_index || 0));

  // Compute content bounds (skip groups)
  const renderable = sorted.filter(e => e.type !== 'group');
  const pad = 20;
  const minX = Math.min(...renderable.map(e => e.x)) - pad;
  const minY = Math.min(...renderable.map(e => e.y)) - pad;
  const maxX = Math.max(...renderable.map(e => e.x + e.width)) + pad;
  const maxY = Math.max(...renderable.map(e => e.y + e.height)) + pad;
  const cw = maxX - minX;
  const ch = maxY - minY;

  let vbX = minX, vbY = minY, vbW = cw, vbH = ch;
  if (opts.mode === 'canvas') {
    vbX = 0; vbY = 0;
    vbW = board.canvas.width || 2400;
    vbH = board.canvas.height || 1600;
  }

  const svgW = (opts.mode === 'fixed' ? (opts.fixedW || 1920) : vbW) * opts.scale;
  const svgH = (opts.mode === 'fixed' ? (opts.fixedH || 1080) : vbH) * opts.scale;

  // Build element SVG fragments
  const markerDefs: string[] = [];
  const markerIds = new Set<string>();
  const fragments: string[] = [];

  // Collect image paths that need base64 conversion
  const imageElements = sorted.filter(e => e.type === 'image' && e.source?.path);

  for (const el of sorted) {
    const svg = elementToSvg(el, markerDefs, markerIds);
    if (svg) fragments.push(svg);
  }

  let body = fragments.join('\n');

  // Fetch images and convert to base64 data URIs
  for (const el of imageElements) {
    const placeholder = `__IMAGE_${el.id}__`;
    if (!body.includes(placeholder)) continue;
    try {
      const res = await fetch(`/api/image?path=${encodeURIComponent(el.source!.path)}`);
      if (res.ok) {
        const blob = await res.blob();
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
        body = body.replace(placeholder, dataUrl);
      } else {
        body = body.replace(placeholder, '');
      }
    } catch {
      body = body.replace(placeholder, '');
    }
  }

  const bg = opts.transparent ? 'none' : (board.canvas.background || '#ffffff');
  const bgRect = bg !== 'none' ? `<rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="${bg}"/>` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${svgW}" height="${svgH}" viewBox="${vbX} ${vbY} ${vbW} ${vbH}">
<defs>${markerDefs.join('\n')}</defs>
${bgRect}
${body}
</svg>`;
}

// -----------------------------------------------------------------------
//  Rasterise SVG → Canvas (browser-native renderer)
// -----------------------------------------------------------------------

function rasterizeSvg(svgString: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to rasterize SVG'));
    };
    img.src = url;
  });
}

// -----------------------------------------------------------------------
//  Public API
// -----------------------------------------------------------------------

export async function captureCanvasForExport(
  opts: CaptureOptions,
  board?: Board,
): Promise<HTMLCanvasElement> {
  const { useBoardStore } = await import('@/store/boardStore');
  const b = board ?? useBoardStore.getState().board;
  if (!b) throw new Error('No board loaded');

  const svgString = await boardToSvg(b, opts);
  if (!svgString) throw new Error('No elements to export');

  return rasterizeSvg(svgString);
}
