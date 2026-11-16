import { ARROW_LENGTH, ARROW_HALF_WIDTH, markerInset, trimArrowPath, returnArrowPath } from './arrowGeometry';
/**
 * Off-screen DOM rendering for pixel-perfect board export.
 *
 * Creates a hidden DOM tree mirroring each node component's visual output.
 * Non-text elements (images, shapes, plots) are captured with html2canvas.
 * Text elements are pre-rasterized via SVG foreignObject (data URI), which
 * uses the browser's own rendering engine — giving pixel-perfect text with
 * KaTeX math, line breaks, and all CSS properties. The two layers are
 * composited into the final export.
 *
 * The board snapshot is rendered in an isolated container, so there is no
 * cross-board contamination regardless of which board is currently visible.
 */

import { api } from '@/api/client';
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
    case 'return': return [{ x: mx, y: Math.max(p0.y, p1.y) + 50 }];
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

function buildPath(p0: Pt, p1: Pt, lineType: string, ctrl: Pt[], stepRadius = 20, returnDirection = 'down'): string {
  switch (lineType) {
    case 'return': {
      return returnArrowPath(p0,p1,ctrl[0],returnDirection);
    }
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
  color: string, headSize: number, strokeWidth: number,
): SVGDefsElement | null {
  const defs = document.createElementNS(SVG_NS, 'defs');
  let hasMarkers = false;

  const addMarker = (type: string, suffix: string, isStart: boolean) => {
    if (type === 'none') return;
    hasMarkers = true;
    const s = headSize * strokeWidth;
    const markerId = `${id}-${suffix}`;

    if (type === 'arrow' || type === 'arrow-open') {
      const w = ARROW_LENGTH * s, h = 2 * ARROW_HALF_WIDTH * s, mid = ARROW_HALF_WIDTH * s;
      const marker = createSvgElement('marker', {
        id: markerId, markerWidth: w, markerHeight: h,
        refX: isStart ? 0 : w, refY: mid,
        orient: 'auto', markerUnits: 'userSpaceOnUse',
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
        refX: c, refY: c, orient: 'auto', markerUnits: 'userSpaceOnUse',
      });
      marker.appendChild(createSvgElement('circle', { cx: c, cy: c, r, fill: color }));
      defs.appendChild(marker);
    } else if (type === 'diamond') {
      const d = 8 * s, mid = 4 * s;
      const marker = createSvgElement('marker', {
        id: markerId, markerWidth: d, markerHeight: d,
        refX: mid, refY: mid, orient: 'auto', markerUnits: 'userSpaceOnUse',
      });
      marker.appendChild(createSvgElement('polygon', {
        points: `${mid} 0, ${d} ${mid}, ${mid} ${d}, 0 ${mid}`, fill: color,
      }));
      defs.appendChild(marker);
    } else if (type === 'bar') {
      const w = 2 * s, h = 8 * s, cx = 1 * s;
      const marker = createSvgElement('marker', {
        id: markerId, markerWidth: w, markerHeight: h,
        refX: cx, refY: h / 2, orient: 'auto', markerUnits: 'userSpaceOnUse',
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
  if (el.rotation) {
    wrapper.style.transform = `rotate(${el.rotation}deg)`;
  }

  const path = el.source?.path;
  if (path) {
    const img = document.createElement('img');
    img.crossOrigin = 'anonymous';
    // Prefer the embedded base64 copy when the board carries one —
    // avoids a redundant /api/image round-trip during every auto-export
    // (which can otherwise fire multi-MB fetches per linked image each
    // time the fingerprint changes).
    const embedded = el.source?.embeddedData;
    const mime = el.source?.embeddedMime || 'image/png';
    img.src = embedded
      ? `data:${mime};base64,${embedded}`
      : `${new URL('api/image', document.baseURI).pathname}?path=${encodeURIComponent(path)}`;
    img.style.cssText = `width:100%;height:100%;object-fit:${style.fitMode === 'contain' ? 'contain' : style.fitMode === 'cover' ? 'cover' : 'fill'};display:block;`;
    img.draggable = false;
    wrapper.appendChild(img);
  }
  return wrapper;
}

function buildPlotElement(el: BoardElement, ox: number, oy: number): HTMLElement {
  const style = el.style || {};
  const meta = el.metadata || {};
  const wrapper = document.createElement('div');
  // Background: the live PlotNode renders `style.background || 'transparent'`,
  // but html2canvas treats `background: transparent` on an inner element as
  // black when compositing against the offscreen container. Fall back to
  // white when the element has no explicit background so transparent plots
  // don't get a black frame in the export (the visible bug was that a plot
  // with transparent bg rendered with a huge black rectangle around it,
  // because the image only filled its natural size — see below).
  const plotBg = (style.background && style.background !== 'transparent')
    ? style.background
    : '#ffffff';
  wrapper.style.cssText = `
    position: absolute;
    left: ${el.x - ox}px; top: ${el.y - oy}px;
    width: ${el.width}px; height: ${el.height}px;
    overflow: hidden;
    border-color: ${style.borderColor || '#d0d0d0'};
    border-width: ${style.borderWidth ?? 0}px;
    border-style: ${(style.borderWidth ?? 0) > 0 ? 'solid' : 'none'};
    border-radius: ${style.borderRadius ?? 0}px;
    background-color: ${plotBg};
    opacity: ${style.opacity ?? 1};
    z-index: ${el.z_index};
  `;
  if (el.rotation) {
    wrapper.style.transform = `rotate(${el.rotation}deg)`;
  }

  const lastOutput = meta.lastOutput as string | undefined;
  if (lastOutput) {
    // The live PlotNode uses `object-fit: fill` — the cached image is
    // stretched to exactly match the element's width/height box. The
    // export must match: `max-width:100%; max-height:100%` was a
    // simulated object-contain that only CAPPED the image, so a cached
    // image smaller than the element rendered at its natural size and
    // left a visible margin around it (which then showed the plot
    // wrapper's background — black for transparent, white otherwise —
    // making identically-sized panels look completely different).
    const img = document.createElement('img');
    img.src = `data:image/png;base64,${lastOutput}`;
    img.style.cssText = `width:100%;height:100%;object-fit:${style.fitMode === 'contain' ? 'contain' : style.fitMode === 'cover' ? 'cover' : 'fill'};display:block;`;
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
  if (el.rotation && !isGroup) {
    wrapper.style.transform = `rotate(${el.rotation}deg)`;
  }

  if (isGroup) {
    // Groups are invisible in export (no dashed border)
    return wrapper;
  }

  if (shape && shape !== 'rect') {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.cssText = 'position: absolute; inset: 0; width: 100%; height: 100%;';

    const sw = (meta.shaftWidth as number) ?? 0.5;
    const hl = (meta.headLength as number) ?? 0.4;
    const polyPoints = getExportShapePoints(shape, sw, hl);
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
function buildPenOverlay(
  strokes: BoardElement[], ox: number, oy: number, w: number, h: number,
): SVGSVGElement | null {
  const valid = strokes.filter(el => (el.points?.length ?? 0) >= 2);
  if (valid.length === 0) return null;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.style.cssText = `
    position: absolute;
    left: 0; top: 0;
    width: ${w}px; height: ${h}px;
    pointer-events: none;
    z-index: 999998;
  `;

  for (const el of valid) {
    const style = el.style || {};
    const pts = el.points!;
    const strokeColor = style.strokeColor || '#333333';
    const strokeWidth = style.strokeWidth ?? 2;
    const dashArray = style.strokeStyle === 'dashed' ? '8,4' : style.strokeStyle === 'dotted' ? '2,4' : '';

    let d = `M ${el.x - ox + pts[0].x},${el.y - oy + pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` L ${el.x - ox + pts[i].x},${el.y - oy + pts[i].y}`;
    }

    const g = document.createElementNS(SVG_NS, 'g');
    g.style.opacity = String(style.opacity ?? 1);
    if (el.rotation) {
      const cx = el.x - ox + el.width / 2;
      const cy = el.y - oy + el.height / 2;
      g.setAttribute('transform', `rotate(${el.rotation} ${cx} ${cy})`);
    }

    const path = createSvgElement('path', {
      d,
      fill: 'none',
      stroke: strokeColor,
      'stroke-width': strokeWidth,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    });
    if (dashArray) path.setAttribute('stroke-dasharray', dashArray);
    g.appendChild(path);
    svg.appendChild(g);
  }

  return svg;
}

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
    const ctrlRaw: Array<Pt | undefined> = (meta.controlPoints as Array<Pt | undefined>) || [];
    const headSize = (meta.arrowHeadSize as number) || 1;
    const startMarker = (meta.startMarker as string) || 'none';
    let endMarker = (meta.endMarker as string) ?? (meta.arrowHead !== false ? 'arrow' : 'none');
    if ('endMarker' in meta) endMarker = meta.endMarker as string;

    const hasCurve = ['quadratic', 'cubic', 'arc', 'smooth', 'return'].includes(lineType);
    // Heal holes from a prior buggy save (idx=1 written before idx=0) by
    // filling missing slots with the auto-defaults — otherwise the .map
    // below would crash on the undefined entry.
    const ctrlDefaults = hasCurve ? defaultControlPoints(pts[0], pts[1], lineType) : [];
    const effectiveCtrl: Pt[] = hasCurve
      ? ctrlDefaults.map((d, i) => ctrlRaw[i] ?? d)
      : (ctrlRaw.filter(Boolean) as Pt[]);

    // Convert to absolute coordinates relative to container
    const absP0 = { x: el.x - ox + pts[0].x, y: el.y - oy + pts[0].y };
    const absP1 = { x: el.x - ox + pts[1].x, y: el.y - oy + pts[1].y };
    if (meta.arrowBody === 'filled' && ['straight','step'].includes(lineType)) {
      const path = createSvgElement('path', {
        d: filledArrowPath(absP0, absP1, meta), fill: style.fill || '#dce9ef',
        stroke: style.strokeColor || '#333333', 'stroke-width': style.strokeWidth ?? 2,
        opacity: style.opacity ?? 1,
      });
      if (style.strokeStyle === 'dashed') path.setAttribute('stroke-dasharray','8,4');
      if (style.strokeStyle === 'dotted') path.setAttribute('stroke-dasharray','2,4');
      svg.appendChild(path);
      continue;
    }
    const absCtrl = effectiveCtrl.map(c => ({ x: el.x - ox + c.x, y: el.y - oy + c.y }));

    const pathD = buildPath(absP0, absP1, lineType, absCtrl, (meta.stepRadius as number) || 20,
      (meta.returnDirection as string) || 'down');

    const strokeColor = style.strokeColor || '#333333';
    const strokeWidth = style.strokeWidth ?? 2;
    const dashArray = style.strokeStyle === 'dashed' ? '8,4' : style.strokeStyle === 'dotted' ? '2,4' : '';

    // Marker defs for this arrow
    const markerId = `export-${el.id}`;
    const markerDefs = buildMarkerDefs(markerId, startMarker, endMarker, strokeColor, headSize, strokeWidth);
    if (markerDefs) {
      while (markerDefs.firstChild) defs.appendChild(markerDefs.firstChild);
    }

    // Path
    const g = document.createElementNS(SVG_NS, 'g');
    g.style.opacity = String(style.opacity ?? 1);

    const path = createSvgElement('path', {
      d: trimArrowPath(pathD, markerInset(startMarker, strokeWidth, headSize), markerInset(endMarker, strokeWidth, headSize)),
      fill: 'none',
      stroke: strokeColor,
      'stroke-width': strokeWidth,
    });
    if (dashArray) path.setAttribute('stroke-dasharray', dashArray);
    g.appendChild(path);
    const markerPath = createSvgElement('path', { d: pathD, fill: 'none', stroke: 'none', 'stroke-width': strokeWidth });
    if (startMarker !== 'none') markerPath.setAttribute('marker-start', `url(#${markerId}-start)`);
    if (endMarker !== 'none') markerPath.setAttribute('marker-end', `url(#${markerId}-end)`);
    g.appendChild(markerPath);
    svg.appendChild(g);
  }

  return svg;
}

async function buildTextElement(el: BoardElement, ox: number, oy: number): Promise<HTMLElement> {
  const style = el.style || {};
  const layout = await api.textLayout({text: el.text || '', width: el.width, height: el.height, style});
  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-text-element', 'true');
  wrapper.style.cssText = `position:absolute;left:${el.x-ox}px;top:${el.y-oy}px;
    width:${el.width}px;height:${el.height}px;z-index:${el.z_index};
    background:${style.background || 'transparent'};opacity:${style.opacity ?? 1};`;
  if (el.rotation) wrapper.style.transform = `rotate(${el.rotation}deg)`;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%');
  svg.style.overflow = 'visible'; svg.style.display = 'block';
  if (layout.formula) {
    const image = document.createElementNS(ns, 'image');
    for (const [key, value] of Object.entries(layout.formula)) image.setAttribute(key, String(value));
    svg.appendChild(image);
  } else {
    const text = document.createElementNS(ns, 'text');
    for (const [key, value] of Object.entries({
      'font-family': layout.fontFamily, 'font-size': layout.fontSize, 'font-weight': layout.fontWeight,
      'font-style': layout.italic ? 'italic' : 'normal', fill: layout.color, 'text-anchor': layout.anchor,
    })) text.setAttribute(key, String(value));
    text.style.whiteSpace = 'pre';
    for (const line of layout.lines) {
      const span = document.createElementNS(ns, 'tspan');
      span.setAttribute('x', String(line.x)); span.setAttribute('y', String(line.y));
      span.textContent = line.text; text.appendChild(span);
    }
    svg.appendChild(text);
  }
  wrapper.appendChild(svg);
  return wrapper;
}

/** Compute polygon points for export shapes (same logic as RectangleNode) */
function getExportShapePoints(shape: string, sw: number, hl: number): string {
  const s = Math.max(0.05, Math.min(0.95, sw));
  const h = Math.max(0.05, Math.min(0.95, hl));
  const top = 50 - s * 50, bot = 50 + s * 50, neck = 100 - h * 100;
  switch (shape) {
    case 'encoder': return '0,0 100,18 100,82 0,100';
    case 'decoder': return '0,18 100,0 100,100 0,82';
    case 'arrow-right': return `0,${top} ${neck},${top} ${neck},0 100,50 ${neck},100 ${neck},${bot} 0,${bot}`;
    case 'arrow-left': return `0,50 ${h*100},0 ${h*100},${top} 100,${top} 100,${bot} ${h*100},${bot} ${h*100},100`;
    case 'arrow-up': return `50,0 100,${h*100} ${bot},${h*100} ${bot},100 ${top},100 ${top},${h*100} 0,${h*100}`;
    case 'arrow-down': return `${top},0 ${bot},0 ${bot},${neck} 100,${neck} 50,100 0,${neck} ${top},${neck}`;
    case 'arrow-double': return `0,50 ${h*50},0 ${h*50},${top} ${100-h*50},${top} ${100-h*50},0 100,50 ${100-h*50},100 ${100-h*50},${bot} ${h*50},${bot} ${h*50},100`;
    case 'chevron': { const indent = h*100; return `0,0 ${100-indent},0 100,50 ${100-indent},100 0,100 ${indent},50`; }
    case 'diamond': return '50,0 100,50 50,100 0,50';
    case 'triangle': return '50,0 100,100 0,100';
    default: return '50,0 100,100 0,100';
  }
}

// -----------------------------------------------------------------------
//  foreignObject text rendering helpers
// -----------------------------------------------------------------------

/** Recursively inline all computed styles from original onto clone. */
function inlineAllStyles(original: Element, clone: Element) {
  if (original instanceof HTMLElement && clone instanceof HTMLElement) {
    const computed = getComputedStyle(original);
    clone.removeAttribute('class');
    for (let i = 0; i < computed.length; i++) {
      const prop = computed[i];
      clone.style.setProperty(prop, computed.getPropertyValue(prop), computed.getPropertyPriority(prop));
    }
  }
  const origChildren = Array.from(original.children);
  const cloneChildren = Array.from(clone.children);
  for (let i = 0; i < Math.min(origChildren.length, cloneChildren.length); i++) {
    inlineAllStyles(origChildren[i], cloneChildren[i]);
  }
}

/** Collect used font families from a set of DOM nodes. */
function getUsedFontFamilies(nodes: HTMLElement[]): Set<string> {
  const families = new Set<string>();
  function walk(el: Element) {
    if (el instanceof HTMLElement) {
      const ff = getComputedStyle(el).fontFamily;
      ff.split(',').forEach(f => families.add(f.trim().replace(/["']/g, '').toLowerCase()));
    }
    for (const child of Array.from(el.children)) walk(child);
  }
  for (const node of nodes) walk(node);
  return families;
}

/** Embed only the @font-face rules whose families are in `usedFamilies`. */
async function embedUsedFonts(usedFamilies: Set<string>): Promise<string> {
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      if (!sheet.cssRules) continue;
      for (const rule of Array.from(sheet.cssRules)) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        const family = rule.style.getPropertyValue('font-family').replace(/["']/g, '').toLowerCase();
        if (!usedFamilies.has(family)) continue;

        let cssText = rule.cssText;
        const urlRegex = /url\(["']?([^"')]+)["']?\)/g;
        let match;
        const replacements: [string, string][] = [];
        while ((match = urlRegex.exec(cssText)) !== null) {
          const url = match[1];
          if (url.startsWith('data:')) continue; // already embedded
          try {
            const resp = await fetch(url);
            if (!resp.ok) continue;
            const blob = await resp.blob();
            const b64 = await new Promise<string>(resolve => {
              const r = new FileReader();
              r.onload = () => resolve(r.result as string);
              r.readAsDataURL(blob);
            });
            replacements.push([match[0], `url(${b64})`]);
          } catch { /* skip */ }
        }
        for (const [orig, repl] of replacements) {
          cssText = cssText.replace(orig, repl);
        }
        rules.push(cssText);
      }
    } catch { /* cross-origin */ }
  }
  return rules.join('\n');
}

// -----------------------------------------------------------------------
//  Main capture function
// -----------------------------------------------------------------------

export async function captureOffscreen(
  board: Board,
  opts: OffscreenCaptureOptions,
): Promise<HTMLCanvasElement> {
  const elements = board.elements.filter(e => e.visible !== false && !e.hidden);
  if (elements.length === 0) throw new Error('No visible elements to export');

  const sorted = [...elements].sort((a, b) => (a.z_index || 0) - (b.z_index || 0));
  const renderable = sorted.filter(e => e.type !== 'group');

  // Compute content bounds from element positions
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
    // Inject ALL page stylesheets into the off-screen container so
    // html2canvas renders text with the same CSS as the live page
    // (Tailwind preflight, KaTeX fonts, font-face rules, etc.)
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        if (!sheet.cssRules) continue;
        const style = document.createElement('style');
        style.textContent = Array.from(sheet.cssRules).map(r => r.cssText).join('\n');
        container.appendChild(style);
      } catch {
        // Cross-origin stylesheets can't be read — skip
      }
    }

    // Build DOM elements for each board element
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
          domEl = await buildTextElement(el, ox, oy);
          break;
        // arrows and pen strokes handled below as SVG overlays
      }

      if (domEl) container.appendChild(domEl);
    }

    // Build arrow overlay: one SVG covering the full container so arrows
    // (and their markers) are never clipped by small bounding boxes.
    const arrows = sorted.filter(e => e.type === 'arrow');
    const arrowSvg = buildArrowOverlay(arrows, ox, oy, captureW, captureH);
    if (arrowSvg) container.appendChild(arrowSvg);

    // Build pen stroke overlay
    const penStrokes = sorted.filter(e => e.type === 'pen');
    const penSvg = buildPenOverlay(penStrokes, ox, oy, captureW, captureH);
    if (penSvg) container.appendChild(penSvg);

    // Wait for fonts + images before capturing
    await document.fonts.ready;

    const images = container.querySelectorAll('img');
    if (images.length > 0) {
      await Promise.all(Array.from(images).map(img =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>(resolve => {
              img.onload = () => resolve();
              img.onerror = () => resolve();
            })
      ));
    }

    // Pre-rasterize text elements via manual SVG foreignObject.
    // The browser's own renderer draws the foreignObject content — giving
    // pixel-perfect text, KaTeX math subscripts, and line breaks.
    // We inline all computed styles and embed fonts as base64 so the SVG
    // is fully self-contained when loaded as a data URI.

    // Step 1: Embed only fonts used by text elements (not ALL page fonts)
    const allTextNodes = Array.from(container.querySelectorAll<HTMLElement>('[data-text-element]'));
    const usedFamilies = getUsedFontFamilies(allTextNodes);
    const fontCSS = await embedUsedFonts(usedFamilies);

    // Step 2: For each text element, render via foreignObject → data URI → img
    // Rasterize each text element via SVG foreignObject → data URI → Image.
    // The browser's own renderer draws the foreignObject content, giving
    // pixel-perfect text with KaTeX math and proper line breaks.
    const textNodes = Array.from(container.querySelectorAll<HTMLElement>('[data-text-element]'));
    for (const textNode of textNodes) {
      const w = textNode.offsetWidth;
      const h = textNode.offsetHeight;
      if (w === 0 || h === 0) continue;

      try {
        // Clone and inline all computed styles
        const clone = textNode.cloneNode(true) as HTMLElement;
        inlineAllStyles(textNode, clone);
        clone.style.position = 'static';
        clone.style.left = '0';
        clone.style.top = '0';
        clone.style.transform = 'none';
        clone.style.margin = '0';
        clone.removeAttribute('data-text-element');

        // Add padding around the SVG so KaTeX subscripts/superscripts
        // that overflow the element bounds don't get clipped
        const pad = 20;
        const svgW = w + pad * 2;
        const svgH = h + pad * 2;

        const wrapper = document.createElement('div');
        wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
        wrapper.style.cssText = `width:${w}px;height:${h}px;overflow:visible;margin:${pad}px;`;
        wrapper.appendChild(clone);

        const xhtml = new XMLSerializer().serializeToString(wrapper);

        const svgStr = [
          `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}">`,
          `<defs><style type="text/css">${fontCSS.replace(/</g, '&lt;')}</style></defs>`,
          `<foreignObject x="0" y="0" width="${svgW}" height="${svgH}">`,
          xhtml,
          `</foreignObject></svg>`,
        ].join('');

        // Use data URI (not blob URL) to avoid canvas taint from foreignObject
        const dataUri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);

        const svgImg = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = (e) => reject(new Error(`SVG load failed: ${e}`));
          img.src = dataUri;
        });

        // Rasterize at requested scale (full padded SVG)
        const textCanvas = document.createElement('canvas');
        textCanvas.width = Math.ceil(svgW * opts.scale);
        textCanvas.height = Math.ceil(svgH * opts.scale);
        const tctx = textCanvas.getContext('2d')!;
        tctx.scale(opts.scale, opts.scale);
        tctx.drawImage(svgImg, 0, 0, svgW, svgH);

        const imgDataUrl = textCanvas.toDataURL('image/png');

        // Position the padded image so the content aligns with original bounds
        const origLeft = parseFloat(textNode.style.left) || 0;
        const origTop = parseFloat(textNode.style.top) || 0;
        const img = document.createElement('img');
        img.src = imgDataUrl;
        img.style.position = textNode.style.position;
        img.style.left = `${origLeft - pad}px`;
        img.style.top = `${origTop - pad}px`;
        img.style.width = `${svgW}px`;
        img.style.height = `${svgH}px`;
        img.style.zIndex = textNode.style.zIndex;
        if (textNode.style.transform && textNode.style.transform !== 'none') {
          img.style.transform = textNode.style.transform;
        }
        textNode.replaceWith(img);

        if (!img.complete) {
          await new Promise<void>(resolve => {
            img.onload = () => resolve();
            img.onerror = () => resolve();
          });
        }
      } catch (e) {
        // On failure, leave text node for html2canvas fallback
        console.warn('[export] foreignObject text failed:', e);
      }
    }

    // Final capture: html2canvas for images/shapes/arrows + pre-rasterized text
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

    return canvas;
  } finally {
    document.body.removeChild(container);
  }
}
import { filledArrowPath } from './filledArrow';
