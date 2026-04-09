/**
 * Off-screen DOM rendering for pixel-perfect board export.
 *
 * Instead of building a separate SVG from the data model (which inevitably
 * drifts from the React component rendering), this module creates a hidden
 * DOM tree that mirrors the visual output of each node component, then
 * captures it with html2canvas.
 *
 * Advantages over the SVG-builder approach:
 * - Uses the browser's own CSS engine for layout, text, and image scaling
 * - Images load via native <img> tags (no fetch + base64 conversion)
 * - Text renders identically (same CSS properties, same font metrics)
 * - Arrow SVG markers render natively (no manual polygon workarounds)
 *
 * The board snapshot is rendered in an isolated container, so there is no
 * cross-board contamination regardless of which board is currently visible.
 */

import type { Board, BoardElement } from '@/types/board';

export interface OffscreenCaptureOptions {
  scale: number;
  transparent: boolean;
  mode: 'fit' | 'fixed' | 'canvas';
  fixedW?: number;
  fixedH?: number;
}

// -----------------------------------------------------------------------
//  Arrow path building — identical to ArrowNode.tsx
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
//  SVG marker builder — identical to ArrowNode.tsx MarkerDefs
// -----------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSvgElement(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  return el;
}

function buildMarkerDefs(
  id: string, startMarker: string, endMarker: string,
  color: string, headSize: number,
): SVGDefsElement | null {
  const defs = document.createElementNS(SVG_NS, 'defs');
  let hasMarkers = false;

  const addMarker = (type: string, suffix: string, isStart: boolean) => {
    if (type === 'none') return;
    hasMarkers = true;
    const s = headSize;
    const markerId = `${id}-${suffix}`;

    if (type === 'arrow' || type === 'arrow-open') {
      const w = 10 * s, h = 8 * s, mid = 4 * s;
      const marker = createSvgElement('marker', {
        id: markerId, markerWidth: w, markerHeight: h,
        refX: isStart ? 0 : w, refY: mid,
        orient: 'auto', markerUnits: 'strokeWidth',
      });
      const pts = isStart ? `${w} 0, 0 ${mid}, ${w} ${h}` : `0 0, ${w} ${mid}, 0 ${h}`;
      if (type === 'arrow') {
        marker.appendChild(createSvgElement('polygon', { points: pts, fill: color }));
      } else {
        marker.appendChild(createSvgElement('polyline', {
          points: pts, fill: 'none', stroke: color, 'stroke-width': 1.5 * s,
        }));
      }
      defs.appendChild(marker);
    } else if (type === 'dot') {
      const d = 6 * s, c = 3 * s, r = 2.5 * s;
      const marker = createSvgElement('marker', {
        id: markerId, markerWidth: d, markerHeight: d,
        refX: c, refY: c, orient: 'auto', markerUnits: 'strokeWidth',
      });
      marker.appendChild(createSvgElement('circle', { cx: c, cy: c, r, fill: color }));
      defs.appendChild(marker);
    } else if (type === 'diamond') {
      const d = 8 * s, mid = 4 * s;
      const marker = createSvgElement('marker', {
        id: markerId, markerWidth: d, markerHeight: d,
        refX: mid, refY: mid, orient: 'auto', markerUnits: 'strokeWidth',
      });
      marker.appendChild(createSvgElement('polygon', {
        points: `${mid} 0, ${d} ${mid}, ${mid} ${d}, 0 ${mid}`, fill: color,
      }));
      defs.appendChild(marker);
    } else if (type === 'bar') {
      const w = 2 * s, h = 8 * s, cx = 1 * s;
      const marker = createSvgElement('marker', {
        id: markerId, markerWidth: w, markerHeight: h,
        refX: cx, refY: h / 2, orient: 'auto', markerUnits: 'strokeWidth',
      });
      marker.appendChild(createSvgElement('line', {
        x1: cx, y1: 0, x2: cx, y2: h, stroke: color, 'stroke-width': 2 * s,
      }));
      defs.appendChild(marker);
    }
  };

  addMarker(startMarker, 'start', true);
  addMarker(endMarker, 'end', false);
  return hasMarkers ? defs : null;
}

// -----------------------------------------------------------------------
//  Build DOM element for each board element type
// -----------------------------------------------------------------------

function buildImageElement(el: BoardElement, ox: number, oy: number): HTMLElement {
  const style = el.style || {};
  const wrapper = document.createElement('div');
  wrapper.style.cssText = `
    position: absolute;
    left: ${el.x - ox}px; top: ${el.y - oy}px;
    width: ${el.width}px; height: ${el.height}px;
    overflow: hidden;
    border-color: ${style.borderColor || '#d0d0d0'};
    border-width: ${style.borderWidth ?? 0}px;
    border-style: ${(style.borderWidth ?? 0) > 0 ? 'solid' : 'none'};
    border-radius: ${style.borderRadius ?? 0}px;
    background-color: ${style.background || 'transparent'};
    opacity: ${style.opacity ?? 1};
    z-index: ${el.z_index};
  `;

  const path = el.source?.path;
  if (path) {
    const img = document.createElement('img');
    img.crossOrigin = 'anonymous';
    img.src = `/api/image?path=${encodeURIComponent(path)}`;
    img.style.cssText = 'width: 100%; height: 100%; object-fit: fill; display: block;';
    img.draggable = false;
    wrapper.appendChild(img);
  }
  return wrapper;
}

function buildPlotElement(el: BoardElement, ox: number, oy: number): HTMLElement {
  const style = el.style || {};
  const meta = el.metadata || {};
  const wrapper = document.createElement('div');
  wrapper.style.cssText = `
    position: absolute;
    left: ${el.x - ox}px; top: ${el.y - oy}px;
    width: ${el.width}px; height: ${el.height}px;
    overflow: hidden;
    border-color: ${style.borderColor || '#d0d0d0'};
    border-width: ${style.borderWidth ?? 0}px;
    border-style: ${(style.borderWidth ?? 0) > 0 ? 'solid' : 'none'};
    border-radius: ${style.borderRadius ?? 0}px;
    background-color: ${style.background || 'transparent'};
    opacity: ${style.opacity ?? 1};
    z-index: ${el.z_index};
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  const lastOutput = meta.lastOutput as string | undefined;
  if (lastOutput) {
    // html2canvas doesn't respect object-fit:contain, so we manually
    // compute the contained size using a flex centering approach.
    // The image's max-width/max-height constrain it to fit while
    // preserving aspect ratio — equivalent to object-fit:contain.
    const img = document.createElement('img');
    img.src = `data:image/png;base64,${lastOutput}`;
    img.style.cssText = 'max-width: 100%; max-height: 100%; display: block;';
    img.draggable = false;
    wrapper.appendChild(img);
  }
  return wrapper;
}

function buildRectangleElement(el: BoardElement, ox: number, oy: number): HTMLElement {
  const style = el.style || {};
  const meta = el.metadata || {};
  const shape = (meta.shape as string) || 'rect';
  const isGroup = el.type === 'group';

  const wrapper = document.createElement('div');
  wrapper.style.cssText = `
    position: absolute;
    left: ${el.x - ox}px; top: ${el.y - oy}px;
    width: ${el.width}px; height: ${el.height}px;
    z-index: ${el.z_index};
  `;

  if (isGroup) {
    // Groups are invisible in export (no dashed border)
    return wrapper;
  }

  if (shape === 'triangle' || shape === 'diamond') {
    // Use inline SVG with polygon — matches RectangleNode.tsx
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.cssText = 'position: absolute; inset: 0; width: 100%; height: 100%;';

    const polyPoints = shape === 'diamond' ? '50,0 100,50 50,100 0,50' : '50,0 100,100 0,100';
    const polygon = createSvgElement('polygon', {
      points: polyPoints,
      fill: style.fill || 'transparent',
      stroke: style.strokeColor || '#333333',
      'stroke-width': (style.strokeWidth ?? 2) * 2,
      'vector-effect': 'non-scaling-stroke',
    });
    if (style.strokeStyle === 'dashed') {
      polygon.setAttribute('stroke-dasharray', '8,4');
    } else if (style.strokeStyle === 'dotted') {
      polygon.setAttribute('stroke-dasharray', '2,4');
    }
    polygon.style.opacity = String(style.opacity ?? 1);
    svg.appendChild(polygon);
    wrapper.appendChild(svg);
  } else {
    // Regular rectangle — CSS div, matches RectangleNode.tsx
    const div = document.createElement('div');
    div.style.cssText = `
      width: 100%; height: 100%;
      background-color: ${style.fill || 'transparent'};
      border-color: ${style.strokeColor || '#333333'};
      border-width: ${style.strokeWidth ?? 2}px;
      border-style: ${style.strokeStyle || 'solid'};
      border-radius: ${style.borderRadius ?? 0}px;
      opacity: ${style.opacity ?? 1};
      box-sizing: border-box;
    `;
    wrapper.appendChild(div);
  }
  return wrapper;
}

/**
 * Build a single SVG overlay containing ALL arrow elements.
 * Uses absolute coordinates so that arrows are not clipped by small bounding
 * boxes (html2canvas ignores overflow:visible on SVG elements).
 */
function buildArrowOverlay(
  arrows: BoardElement[], ox: number, oy: number, w: number, h: number,
): SVGSVGElement | null {
  const valid = arrows.filter(el => (el.points?.length ?? 0) >= 2);
  if (valid.length === 0) return null;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.style.cssText = `
    position: absolute;
    left: 0; top: 0;
    width: ${w}px; height: ${h}px;
    pointer-events: none;
    z-index: 999999;
  `;

  const defs = document.createElementNS(SVG_NS, 'defs');
  svg.appendChild(defs);

  for (const el of valid) {
    const style = el.style || {};
    const meta = el.metadata || {};
    const pts = el.points!;

    const lineType = (meta.lineType as string) || 'straight';
    const ctrl: Pt[] = (meta.controlPoints as Pt[]) || [];
    const headSize = (meta.arrowHeadSize as number) || 1;
    const startMarker = (meta.startMarker as string) || 'none';
    let endMarker = (meta.endMarker as string) ?? (meta.arrowHead !== false ? 'arrow' : 'none');
    if ('endMarker' in meta) endMarker = meta.endMarker as string;

    const hasCurve = ['quadratic', 'cubic', 'arc', 'smooth'].includes(lineType);
    const effectiveCtrl = hasCurve && ctrl.length === 0
      ? defaultControlPoints(pts[0], pts[1], lineType)
      : ctrl;

    // Convert to absolute coordinates relative to container
    const absP0 = { x: el.x - ox + pts[0].x, y: el.y - oy + pts[0].y };
    const absP1 = { x: el.x - ox + pts[1].x, y: el.y - oy + pts[1].y };
    const absCtrl = effectiveCtrl.map(c => ({ x: el.x - ox + c.x, y: el.y - oy + c.y }));

    const pathD = buildPath(absP0, absP1, lineType, absCtrl, (meta.stepRadius as number) || 20);

    const strokeColor = style.strokeColor || '#333333';
    const strokeWidth = style.strokeWidth ?? 2;
    const dashArray = style.strokeStyle === 'dashed' ? '8,4' : style.strokeStyle === 'dotted' ? '2,4' : '';

    // Marker defs for this arrow
    const markerId = `export-${el.id}`;
    const markerDefs = buildMarkerDefs(markerId, startMarker, endMarker, strokeColor, headSize);
    if (markerDefs) {
      while (markerDefs.firstChild) defs.appendChild(markerDefs.firstChild);
    }

    // Path
    const g = document.createElementNS(SVG_NS, 'g');
    g.style.opacity = String(style.opacity ?? 1);

    const path = createSvgElement('path', {
      d: pathD,
      fill: 'none',
      stroke: strokeColor,
      'stroke-width': strokeWidth,
    });
    if (dashArray) path.setAttribute('stroke-dasharray', dashArray);
    if (startMarker !== 'none') path.setAttribute('marker-start', `url(#${markerId}-start)`);
    if (endMarker !== 'none') path.setAttribute('marker-end', `url(#${markerId}-end)`);
    g.appendChild(path);
    svg.appendChild(g);
  }

  return svg;
}

function buildTextElement(el: BoardElement, ox: number, oy: number): HTMLElement {
  const style = el.style || {};
  const text = el.text || '';
  const fontFamily = style.fontFamily || 'Inter, sans-serif';

  // Position text at the exact pixel offset it appears on canvas.
  // On canvas: React Flow node at (el.x, el.y), TextNode outer div adds
  // padding (default 4px), text content starts inside that padding.
  // We position a single div at the padded offset, avoiding nested
  // box-model interactions that html2canvas renders slightly differently.
  const padding = style.padding ?? 4;

  const wrapper = document.createElement('div');
  wrapper.style.cssText = `
    position: absolute;
    left: ${el.x - ox}px; top: ${el.y - oy}px;
    width: ${el.width}px; height: ${el.height}px;
    z-index: ${el.z_index};
    opacity: ${style.opacity ?? 1};
  `;

  // Background fills the full element area
  if (style.background && style.background !== 'transparent') {
    wrapper.style.backgroundColor = style.background;
  }

  // Text positioned at padding offset, no nested padding/border
  const textDiv = document.createElement('div');
  textDiv.style.cssText = `
    position: absolute;
    left: ${padding}px; top: ${padding}px;
    right: ${padding}px; bottom: ${padding}px;
    font-size: ${style.fontSize ?? 14}px;
    font-weight: ${style.fontWeight ?? 400};
    font-family: ${fontFamily};
    color: ${style.color || '#111111'};
    text-align: ${style.textAlign || 'left'};
    line-height: ${style.lineHeight ?? 1.4};
    font-style: ${style.italic ? 'italic' : 'normal'};
    white-space: pre-wrap;
    word-break: break-word;
    overflow: visible;
  `;

  // Handle math rendering (KaTeX)
  if (/\$/.test(text)) {
    try {
      const katex = (window as any).katex;
      if (katex) {
        // Parse text with $...$ and $$...$$ delimiters
        let html = '';
        const regex = /(\$\$[\s\S]+?\$\$|\$[^$]+?\$)/g;
        let lastIndex = 0;
        let match;
        while ((match = regex.exec(text)) !== null) {
          if (match.index > lastIndex) {
            html += escapeHtml(text.slice(lastIndex, match.index));
          }
          const mathStr = match[0];
          const isDisplay = mathStr.startsWith('$$');
          const tex = isDisplay ? mathStr.slice(2, -2) : mathStr.slice(1, -1);
          html += katex.renderToString(tex, {
            displayMode: isDisplay, throwOnError: false, output: 'html',
          });
          lastIndex = match.index + mathStr.length;
        }
        if (lastIndex < text.length) {
          html += escapeHtml(text.slice(lastIndex));
        }
        textDiv.innerHTML = html;
      } else {
        textDiv.textContent = text;
      }
    } catch {
      textDiv.textContent = text;
    }
  } else {
    textDiv.textContent = text;
  }

  wrapper.appendChild(textDiv);
  return wrapper;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// -----------------------------------------------------------------------
//  Main capture function
// -----------------------------------------------------------------------

export async function captureOffscreen(
  board: Board,
  opts: OffscreenCaptureOptions,
): Promise<HTMLCanvasElement> {
  const elements = board.elements.filter(e => e.visible !== false);
  if (elements.length === 0) throw new Error('No visible elements to export');

  const sorted = [...elements].sort((a, b) => (a.z_index || 0) - (b.z_index || 0));
  const renderable = sorted.filter(e => e.type !== 'group');

  // Compute content bounds
  const pad = 20;
  const minX = Math.min(...renderable.map(e => e.x)) - pad;
  const minY = Math.min(...renderable.map(e => e.y)) - pad;
  const maxX = Math.max(...renderable.map(e => e.x + e.width)) + pad;
  const maxY = Math.max(...renderable.map(e => e.y + e.height)) + pad;
  const contentW = maxX - minX;
  const contentH = maxY - minY;

  let captureW: number, captureH: number;
  if (opts.mode === 'canvas') {
    captureW = board.canvas.width || 2400;
    captureH = board.canvas.height || 1600;
  } else if (opts.mode === 'fixed') {
    captureW = opts.fixedW || 1920;
    captureH = opts.fixedH || 1080;
  } else {
    captureW = contentW;
    captureH = contentH;
  }

  // Offset for positioning elements: in 'canvas' mode, origin is (0,0)
  const ox = opts.mode === 'canvas' ? 0 : minX;
  const oy = opts.mode === 'canvas' ? 0 : minY;

  // Create hidden container
  const container = document.createElement('div');
  container.style.cssText = `
    position: fixed;
    left: -99999px;
    top: 0;
    width: ${captureW}px;
    height: ${captureH}px;
    overflow: hidden;
    background: ${opts.transparent ? 'transparent' : (board.canvas.background || '#ffffff')};
  `;
  document.body.appendChild(container);

  try {
    // Build DOM elements for each board element (text and arrows handled separately)
    const textElements: BoardElement[] = [];
    for (const el of sorted) {
      let domEl: HTMLElement | null = null;

      switch (el.type) {
        case 'image':
          domEl = buildImageElement(el, ox, oy);
          break;
        case 'plot':
          domEl = buildPlotElement(el, ox, oy);
          break;
        case 'rectangle':
        case 'group':
          domEl = buildRectangleElement(el, ox, oy);
          break;
        case 'text':
          // Collect text elements — drawn directly on canvas after html2canvas
          // to avoid html2canvas's text positioning approximation.
          textElements.push(el);
          // Still build background rect if needed
          if (el.style?.background && el.style.background !== 'transparent') {
            const bgDiv = document.createElement('div');
            bgDiv.style.cssText = `
              position: absolute;
              left: ${el.x - ox}px; top: ${el.y - oy}px;
              width: ${el.width}px; height: ${el.height}px;
              background-color: ${el.style.background};
              z-index: ${el.z_index};
            `;
            container.appendChild(bgDiv);
          }
          break;
        // arrows handled below as a single SVG overlay
      }

      if (domEl) container.appendChild(domEl);
    }

    // Build arrow overlay: one SVG covering the full container so arrows
    // (and their markers) are never clipped by small bounding boxes.
    const arrows = sorted.filter(e => e.type === 'arrow');
    const arrowSvg = buildArrowOverlay(arrows, ox, oy, captureW, captureH);
    if (arrowSvg) container.appendChild(arrowSvg);

    // Wait for fonts + images before capturing
    await document.fonts.ready;

    const images = container.querySelectorAll('img');
    if (images.length > 0) {
      await Promise.all(Array.from(images).map(img =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>(resolve => {
              img.onload = () => resolve();
              img.onerror = () => resolve(); // Don't block on failed images
            })
      ));
    }

    // Capture non-text elements with html2canvas
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(container, {
      scale: opts.scale,
      backgroundColor: opts.transparent ? null : (board.canvas.background || '#ffffff'),
      useCORS: true,
      allowTaint: true,
      logging: false,
      width: captureW,
      height: captureH,
    });

    // Draw text directly using the native Canvas 2D API on a fresh canvas.
    // This uses the browser's own font rendering — no html2canvas approximation.
    // We composite onto a new canvas to avoid any state html2canvas may have set.
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = canvas.width;
    finalCanvas.height = canvas.height;
    const ctx = finalCanvas.getContext('2d')!;

    // Draw html2canvas result (shapes, images, arrows) as base layer
    ctx.drawImage(canvas, 0, 0);

    // Draw text on top
    const scale = opts.scale;
    for (const el of textElements) {
      const style = el.style || {};
      const text = el.text || '';
      if (!text) continue;

      const fontSize = style.fontSize ?? 14;
      const fontWeight = style.fontWeight ?? 400;
      const fontFamily = style.fontFamily || 'Inter, sans-serif';
      const color = style.color || '#111111';
      const textAlign = (style.textAlign || 'left') as CanvasTextAlign;
      const lineHeight = (style.lineHeight ?? 1.4) * fontSize;
      const fontStyle = style.italic ? 'italic' : 'normal';
      const padding = style.padding ?? 4;
      const opacity = style.opacity ?? 1;

      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = opacity;
      ctx.font = `${fontStyle} ${fontWeight} ${fontSize * scale}px ${fontFamily}`;
      ctx.fillStyle = color;
      ctx.textAlign = textAlign;
      ctx.textBaseline = 'top';

      // Text position within the element (matches TextNode padding + border)
      const border = 1; // 1px transparent border in TextNode
      const inset = (padding + border) * scale;
      const elX = (el.x - ox) * scale;
      const elY = (el.y - oy) * scale;

      let tx: number;
      if (textAlign === 'center') {
        tx = elX + (el.width * scale) / 2;
      } else if (textAlign === 'right') {
        tx = elX + el.width * scale - inset;
      } else {
        tx = elX + inset;
      }

      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const ly = elY + inset + i * lineHeight * scale;
        ctx.fillText(lines[i], tx, ly);
      }

      ctx.restore();
    }

    return finalCanvas;
  } finally {
    document.body.removeChild(container);
  }
}
