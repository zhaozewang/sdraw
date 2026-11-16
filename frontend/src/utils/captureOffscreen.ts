/**
 * Off-screen export rendering.
 *
 * The canonical approach: mount the SAME node components React Flow uses
 * (TextNode, ImageNode, PlotNode, RectangleNode) into a hidden container,
 * scoped to a board snapshot via `BoardSnapshotProvider`. Since the export
 * uses the live render path, there is no "second renderer" that can drift
 * out of sync with the canvas.
 *
 * Arrows and pen strokes are rendered as a single unified SVG overlay
 * because html2canvas ignores `overflow: visible` on per-node SVGs and
 * would clip arrowhead markers extending past their bounding box. The
 * overlay's geometry is built from the SAME shared functions
 * (`utils/arrowGeometry.ts`) the live ArrowNode uses, so the overlay can't
 * drift either.
 *
 * Text elements are pre-rasterized via SVG foreignObject so KaTeX subscripts
 * /superscripts that overflow the element bounds aren't clipped, and so
 * html2canvas isn't responsible for re-rendering text from CSS (which it
 * does imperfectly). The text DOM consumed by the foreignObject is the
 * exact tree the live TextNode produced.
 *
 * The board snapshot stays inside an isolated React tree, so cross-board
 * contamination is impossible regardless of which board is currently
 * visible in the live UI.
 */

import { createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';

import { filledArrowPath } from './filledArrow';
import type { Board, BoardElement } from '@/types/board';
import { BoardSnapshotProvider } from '@/store/exportContext';
import { TextNode, ImageNode, PlotNode, RectangleNode } from '@/components/nodes';
import {
  defaultControlPoints,
  buildPath,
  markerSpec,
  markerInset,
  trimArrowPath,
  type LineType,
  type MarkerType,
} from '@/utils/arrowGeometry';

export interface OffscreenCaptureOptions {
  scale: number;
  transparent: boolean;
  mode: 'fit' | 'fixed' | 'canvas';
  fixedW?: number;
  fixedH?: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// -----------------------------------------------------------------------
//  Arrow + pen overlay (built from shared geometry helpers)
// -----------------------------------------------------------------------

function createSvgElement(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  return el;
}

function appendMarker(
  defs: SVGDefsElement,
  id: string,
  type: MarkerType,
  isStart: boolean,
  color: string,
  headSize: number,
): boolean {
  const spec = markerSpec(type, isStart, color, headSize);
  if (!spec) return false;
  const marker = createSvgElement('marker', {
    id,
    markerWidth: spec.width,
    markerHeight: spec.height,
    refX: spec.refX,
    refY: spec.refY,
    orient: 'auto',
    markerUnits: 'userSpaceOnUse',
  });
  const sh = spec.shape;
  switch (sh.kind) {
    case 'polygon':
      marker.appendChild(createSvgElement('polygon', { points: sh.points, fill: sh.fill }));
      break;
    case 'polyline':
      marker.appendChild(createSvgElement('polyline', {
        points: sh.points, fill: 'none', stroke: sh.stroke, 'stroke-width': sh.strokeWidth,
      }));
      break;
    case 'circle':
      marker.appendChild(createSvgElement('circle', { cx: sh.cx, cy: sh.cy, r: sh.r, fill: sh.fill }));
      break;
    case 'line':
      marker.appendChild(createSvgElement('line', {
        x1: sh.x1, y1: sh.y1, x2: sh.x2, y2: sh.y2, stroke: sh.stroke, 'stroke-width': sh.strokeWidth,
      }));
      break;
  }
  defs.appendChild(marker);
  return true;
}

function buildArrowOverlay(
  arrows: BoardElement[], ox: number, oy: number, w: number, h: number,
): SVGSVGElement | null {
  const valid = arrows.filter(el => (el.points?.length ?? 0) >= 2);
  if (valid.length === 0) return null;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;pointer-events:none;z-index:999999;`;
  const defs = document.createElementNS(SVG_NS, 'defs');
  svg.appendChild(defs);

  for (const el of valid) {
    const style = el.style || {};
    const meta = el.metadata || {};
    const pts = el.points!;
    const lineType = (meta.lineType as LineType) || 'straight';
    const ctrlRaw: Array<{ x: number; y: number } | undefined> =
      (meta.controlPoints as Array<{ x: number; y: number }>) || [];
    const headSize = (meta.arrowHeadSize as number) || 1;
    const startMarker = (meta.startMarker as MarkerType) || 'none';
    const endMarker: MarkerType = (meta.endMarker as MarkerType)
      ?? (meta.arrowHead === false ? 'none' : 'arrow');
    const finalEndMarker: MarkerType = ('endMarker' in meta) ? (meta.endMarker as MarkerType) : endMarker;

    const hasCurve = ['quadratic', 'cubic', 'arc', 'smooth', 'return'].includes(lineType);
    const ctrlDefaults = hasCurve ? defaultControlPoints(pts[0], pts[1], lineType) : [];
    const effectiveCtrl = hasCurve
      ? ctrlDefaults.map((d, i) => ctrlRaw[i] ?? d)
      : (ctrlRaw.filter(Boolean) as Array<{ x: number; y: number }>);

    // Translate to absolute capture-region coordinates so the overlay can
    // span the full container and arrowheads aren't clipped.
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
    const pathD = buildPath(absP0, absP1, lineType, absCtrl, { stepRadius: (meta.stepRadius as number) || 20, returnDirection: meta.returnDirection as string });

    const strokeColor = style.strokeColor || '#333333';
    const strokeWidth = style.strokeWidth ?? 2;
    const dashArray = style.strokeStyle === 'dashed' ? '8,4'
      : style.strokeStyle === 'dotted' ? '2,4' : '';

    const startId = `export-${el.id}-start`;
    const endId = `export-${el.id}-end`;
    const hasStart = startMarker !== 'none' && appendMarker(defs, startId, startMarker, true, strokeColor, headSize * strokeWidth);
    const hasEnd = finalEndMarker !== 'none' && appendMarker(defs, endId, finalEndMarker, false, strokeColor, headSize * strokeWidth);

    const g = document.createElementNS(SVG_NS, 'g');
    g.style.opacity = String(style.opacity ?? 1);
    const path = createSvgElement('path', {
      d: trimArrowPath(pathD, markerInset(startMarker, strokeWidth, headSize), markerInset(finalEndMarker, strokeWidth, headSize)), fill: 'none', stroke: strokeColor, 'stroke-width': strokeWidth,
    });
    if (dashArray) path.setAttribute('stroke-dasharray', dashArray);
    g.appendChild(path);
    const markers = createSvgElement('path', {d: pathD, fill: 'none', stroke: 'none', 'stroke-width': strokeWidth});
    if (hasStart) markers.setAttribute('marker-start', `url(#${startId})`);
    if (hasEnd) markers.setAttribute('marker-end', `url(#${endId})`);
    g.appendChild(markers);
    svg.appendChild(g);
  }

  return svg;
}

function buildPenOverlay(
  strokes: BoardElement[], ox: number, oy: number, w: number, h: number,
): SVGSVGElement | null {
  const valid = strokes.filter(el => (el.points?.length ?? 0) >= 2);
  if (valid.length === 0) return null;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;pointer-events:none;z-index:999998;`;

  for (const el of valid) {
    const style = el.style || {};
    const pts = el.points!;
    const strokeColor = style.strokeColor || '#333333';
    const strokeWidth = style.strokeWidth ?? 2;
    const dashArray = style.strokeStyle === 'dashed' ? '8,4'
      : style.strokeStyle === 'dotted' ? '2,4' : '';

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
      d, fill: 'none', stroke: strokeColor, 'stroke-width': strokeWidth,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    });
    if (dashArray) path.setAttribute('stroke-dasharray', dashArray);
    g.appendChild(path);
    svg.appendChild(g);
  }

  return svg;
}

// -----------------------------------------------------------------------
//  Live React component mount — text/image/plot/rectangle/group
// -----------------------------------------------------------------------

const COMPONENT_FOR_TYPE: Record<string, React.ComponentType<any>> = {
  text: TextNode,
  image: ImageNode,
  plot: PlotNode,
  rectangle: RectangleNode,
  group: RectangleNode,
};

function ElementWrapper({ el, ox, oy }: { el: BoardElement; ox: number; oy: number }) {
  const Comp = COMPONENT_FOR_TYPE[el.type];
  if (!Comp) return null;

  return createElement(
    'div',
    {
      'data-export-element-id': el.id,
      'data-export-element-type': el.type,
      'data-export-text': el.type === 'text' ? 'true' : undefined,
      style: {
        position: 'absolute',
        left: `${el.x - ox}px`,
        top: `${el.y - oy}px`,
        width: `${el.width}px`,
        height: `${el.height}px`,
        zIndex: el.z_index,
      },
    },
    createElement(Comp, {
      id: el.id,
      data: { elementId: el.id },
      type: el.type,
      selected: false,
      // Minimum NodeProps — supplied so React Flow types are happy at compile.
      // None of these are read by our components, but TypeScript wants them.
      xPos: 0, yPos: 0, dragging: false, isConnectable: false, zIndex: el.z_index,
    } as any),
  );
}

// -----------------------------------------------------------------------
//  Pre-rasterize text via SVG foreignObject
// -----------------------------------------------------------------------

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
          if (url.startsWith('data:')) continue;
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

// TextNode receives SVG geometry asynchronously from the typesetter.
function waitForTextLayout(wrapper: HTMLElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(check);
    const timeout = window.setTimeout(() => finish(new Error('Text layout timed out')), 30000);
    function finish(error?: Error) {
      observer.disconnect();
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    }
    function check() {
      if (wrapper.querySelector('[data-layout-error]')) finish(new Error('Text layout failed'));
      else if (wrapper.querySelector('[data-layout-ready]')) finish();
    }
    observer.observe(wrapper, {childList: true, subtree: true});
    check();
  });
}

async function rasterizeTextElement(
  wrapper: HTMLElement, fontCSS: string, scale: number,
): Promise<void> {
  const w = wrapper.offsetWidth;
  const h = wrapper.offsetHeight;
  if (w === 0 || h === 0) return;

  // Clone the rendered DOM and inline all computed styles so the clone is
  // visually identical without depending on external CSS.
  const clone = wrapper.cloneNode(true) as HTMLElement;
  inlineAllStyles(wrapper, clone);
  // Strip positioning that came from the wrapper — inside the foreignObject
  // we want the content laid out from (0,0).
  clone.style.position = 'static';
  clone.style.left = '0';
  clone.style.top = '0';
  clone.style.transform = 'none';
  clone.style.margin = '0';
  clone.removeAttribute('data-export-text');

  // Pad the SVG so KaTeX subscripts/superscripts that overflow element
  // bounds are not clipped.
  const pad = 20;
  const svgW = w + pad * 2;
  const svgH = h + pad * 2;

  const xhtmlWrapper = document.createElement('div');
  xhtmlWrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  xhtmlWrapper.style.cssText = `width:${w}px;height:${h}px;overflow:visible;margin:${pad}px;`;
  xhtmlWrapper.appendChild(clone);

  const xhtml = new XMLSerializer().serializeToString(xhtmlWrapper);
  const svgStr = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}">`,
    `<defs><style type="text/css">${fontCSS.replace(/</g, '&lt;')}</style></defs>`,
    `<foreignObject x="0" y="0" width="${svgW}" height="${svgH}">`,
    xhtml,
    `</foreignObject></svg>`,
  ].join('');
  const dataUri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);

  const svgImg = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error(`SVG load failed: ${e}`));
    img.src = dataUri;
  });

  const textCanvas = document.createElement('canvas');
  textCanvas.width = Math.ceil(svgW * scale);
  textCanvas.height = Math.ceil(svgH * scale);
  const tctx = textCanvas.getContext('2d')!;
  tctx.scale(scale, scale);
  tctx.drawImage(svgImg, 0, 0, svgW, svgH);

  const imgDataUrl = textCanvas.toDataURL('image/png');

  // Position the rasterized image so its content aligns with the wrapper's
  // bounds (the wrapper is the layout box; the image is wrapper + pad on
  // each side so the offset is -pad).
  const origLeft = parseFloat(wrapper.style.left) || 0;
  const origTop = parseFloat(wrapper.style.top) || 0;
  const replacement = document.createElement('img');
  replacement.src = imgDataUrl;
  replacement.style.position = wrapper.style.position;
  replacement.style.left = `${origLeft - pad}px`;
  replacement.style.top = `${origTop - pad}px`;
  replacement.style.width = `${svgW}px`;
  replacement.style.height = `${svgH}px`;
  replacement.style.zIndex = wrapper.style.zIndex;
  if (wrapper.style.transform && wrapper.style.transform !== 'none') {
    replacement.style.transform = wrapper.style.transform;
  }
  wrapper.replaceWith(replacement);

  if (!replacement.complete) {
    await new Promise<void>(resolve => {
      replacement.onload = () => resolve();
      replacement.onerror = () => resolve();
    });
  }
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

  // Offset for positioning elements: in 'canvas' mode origin is (0,0)
  const ox = opts.mode === 'canvas' ? 0 : minX;
  const oy = opts.mode === 'canvas' ? 0 : minY;

  // Hidden offscreen container. Two layers: an outer wrapper that holds
  // the stylesheet copies and the arrow/pen SVG overlays, and an inner
  // mount point that is owned by the React root. createRoot wipes the
  // children of its container on first render, so React must NOT manage
  // the same node we append style/overlay nodes to.
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

  const reactMount = document.createElement('div');
  reactMount.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
  container.appendChild(reactMount);

  // Mount the live components into a fresh React root, scoped to the
  // board snapshot. ReactFlowProvider is wrapped in so the Resizer's
  // useReactFlow() call doesn't crash even though Resizer never renders
  // (selected=false in export mode).
  const root = createRoot(reactMount);

  try {
    // Inject ALL page stylesheets so the offscreen render uses the same CSS
    // as the live page (Tailwind, KaTeX, fonts, the .katex-override rule
    // that keeps math sized to its surrounding text, etc.). These go on the
    // outer container — putting them on `reactMount` would risk React
    // wiping them on first render.
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

    // Mount live components for image / plot / text / rectangle / group.
    // Arrows and pen strokes are handled separately as a unified SVG
    // overlay (html2canvas clips overflow:visible on per-node SVGs).
    const mountable = sorted.filter(e =>
      e.type === 'image' || e.type === 'plot' || e.type === 'text'
      || e.type === 'rectangle' || e.type === 'group'
    );

    const wrapperNodes: ReactNode[] = mountable.map(el =>
      createElement(ElementWrapper, { key: el.id, el, ox, oy })
    );
    const tree: ReactNode = createElement(
      ReactFlowProvider,
      { children: createElement(
        BoardSnapshotProvider,
        { board, children: wrapperNodes },
      ) } as any,
    );
    root.render(tree);

    // Wait for React to commit + browser to paint + layout to settle.
    // Two animation frames + a microtask is the canonical "post-mount" wait.
    await new Promise<void>(r => requestAnimationFrame(() => r()));
    await new Promise<void>(r => requestAnimationFrame(() => r()));

    // Now append the arrow + pen SVG overlays (after React has mounted, so
    // they sit at the end and html2canvas captures them on top).
    const arrows = sorted.filter(e => e.type === 'arrow');
    const arrowSvg = buildArrowOverlay(arrows, ox, oy, captureW, captureH);
    if (arrowSvg) container.appendChild(arrowSvg);

    const penStrokes = sorted.filter(e => e.type === 'pen');
    const penSvg = buildPenOverlay(penStrokes, ox, oy, captureW, captureH);
    if (penSvg) container.appendChild(penSvg);

    // Wait for fonts and any <img> elements (image nodes, plot output, the
    // image inside ImageNode's loading branch, etc.) to finish loading.
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
    // ImageNode flips its `loading` state on <img> onLoad, which schedules a
    // React re-render. Wait one more frame so any post-load re-renders
    // commit BEFORE we start manually rewriting the DOM in the foreignObject
    // step — otherwise React might reconcile our hand-built <img>
    // replacements away.
    await new Promise<void>(r => requestAnimationFrame(() => r()));

    // Pre-rasterize text via foreignObject. The DOM consumed here is what
    // the live TextNode rendered, which is exactly what we want.
    const textWrappers = Array.from(
      container.querySelectorAll<HTMLElement>('[data-export-text="true"]')
    );
    await Promise.all(textWrappers.map(waitForTextLayout));
    const usedFamilies = getUsedFontFamilies(textWrappers);
    const fontCSS = await embedUsedFonts(usedFamilies);
    for (const wrapper of textWrappers) {
      try {
        await rasterizeTextElement(wrapper, fontCSS, opts.scale);
      } catch (e) {
        console.warn('[export] text foreignObject rasterization failed:', e);
      }
    }

    // Final composite via html2canvas
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
    try { root.unmount(); } catch { /* already unmounted */ }
    document.body.removeChild(container);
  }
}
