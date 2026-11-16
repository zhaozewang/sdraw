import type { BoardElement } from '@/types/board';

/** Snap threshold in canvas pixels */
export const SNAP_DISTANCE = 15;

interface Point { x: number; y: number }

/** Result of a snap computation */
export interface SnapResult {
  /** The snapped point on the shape boundary */
  point: Point;
  /** ID of the element snapped to */
  elementId: string;
  /** Distance from the original point to the snap point */
  distance: number;
}

/* ------------------------------------------------------------------ */
/*  Nearest point on shape boundary                                    */
/* ------------------------------------------------------------------ */

/** Nearest point on a line segment from A to B */
function nearestOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return a;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/** Nearest point on a polygon (closed) boundary */
function nearestOnPolygon(p: Point, verts: Point[]): Point {
  let best: Point = verts[0];
  let bestDist = Infinity;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i], b = verts[(i + 1) % verts.length];
    const np = nearestOnSegment(p, a, b);
    const d = dist(p, np);
    if (d < bestDist) { bestDist = d; best = np; }
  }
  return best;
}

/** Nearest point on an axis-aligned rectangle boundary */
function nearestOnRect(p: Point, x: number, y: number, w: number, h: number): Point {
  return nearestOnPolygon(p, [
    { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
  ]);
}

/** Nearest point on an ellipse boundary (center cx,cy radii rx,ry) */
function nearestOnEllipse(p: Point, cx: number, cy: number, rx: number, ry: number): Point {
  // Normalize to unit circle, find angle, map back
  const dx = p.x - cx, dy = p.y - cy;
  const angle = Math.atan2(dy / ry, dx / rx);
  return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
}

/** Nearest point on a rounded rectangle boundary */
function nearestOnRoundedRect(
  p: Point, x: number, y: number, w: number, h: number, r: number,
): Point {
  const cr = Math.min(r, w / 2, h / 2);
  if (cr < 1) return nearestOnRect(p, x, y, w, h);

  // Check the 4 corner circles and 4 edge segments
  const corners = [
    { cx: x + cr, cy: y + cr },         // top-left
    { cx: x + w - cr, cy: y + cr },      // top-right
    { cx: x + w - cr, cy: y + h - cr },  // bottom-right
    { cx: x + cr, cy: y + h - cr },      // bottom-left
  ];
  const edges: [Point, Point][] = [
    [{ x: x + cr, y }, { x: x + w - cr, y }],                 // top
    [{ x: x + w, y: y + cr }, { x: x + w, y: y + h - cr }],   // right
    [{ x: x + w - cr, y: y + h }, { x: x + cr, y: y + h }],   // bottom
    [{ x, y: y + h - cr }, { x, y: y + cr }],                  // left
  ];

  let best: Point = { x, y };
  let bestDist = Infinity;

  // Edge segments
  for (const [a, b] of edges) {
    const np = nearestOnSegment(p, a, b);
    const d = dist(p, np);
    if (d < bestDist) { bestDist = d; best = np; }
  }

  // Corner arcs (quarter circles)
  for (const c of corners) {
    const np = nearestOnEllipse(p, c.cx, c.cy, cr, cr);
    // Check the point is actually in the corner's quadrant
    const inQuadrant =
      (np.x <= x + cr || np.x >= x + w - cr) &&
      (np.y <= y + cr || np.y >= y + h - cr);
    if (inQuadrant) {
      const d = dist(p, np);
      if (d < bestDist) { bestDist = d; best = np; }
    }
  }

  return best;
}

function dist(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/* ------------------------------------------------------------------ */
/*  Main: nearest boundary point for any element type                  */
/* ------------------------------------------------------------------ */

/** Get the nearest point on an element's visual boundary */
export function nearestBoundaryPoint(p: Point, el: BoardElement): Point {
  const { x, y, width: w, height: h, style, metadata } = el;

  if (el.type === 'rectangle' || el.type === 'group') {
    const shape = metadata?.shape as string | undefined;

    if (shape === 'rounded-junction') {
      const ports = [{x:x+w/2,y}, {x:x+w/2,y:y+h}, {x,y:y+h/2}, {x:x+w,y:y+h/2}];
      return ports.reduce((best, port) => dist(p, port) < dist(p, best) ? port : best);
    }
    if (shape === 'diamond') {
      return nearestOnPolygon(p, [
        { x: x + w / 2, y },
        { x: x + w, y: y + h / 2 },
        { x: x + w / 2, y: y + h },
        { x, y: y + h / 2 },
      ]);
    }
    if (shape === 'triangle') {
      return nearestOnPolygon(p, [
        { x: x + w / 2, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ]);
    }

    const br = style.borderRadius ?? 0;
    if (br >= Math.min(w, h) / 2) {
      // Circle / ellipse
      return nearestOnEllipse(p, x + w / 2, y + h / 2, w / 2, h / 2);
    }
    if (br > 0) {
      return nearestOnRoundedRect(p, x, y, w, h, br);
    }
    return nearestOnRect(p, x, y, w, h);
  }

  if (el.type === 'image' || el.type === 'text') {
    const br = style.borderRadius ?? 0;
    if (br > 0) {
      return nearestOnRoundedRect(p, x, y, w, h, br);
    }
    return nearestOnRect(p, x, y, w, h);
  }

  // Fallback: rectangle
  return nearestOnRect(p, x, y, w, h);
}

/* ------------------------------------------------------------------ */
/*  Find the best snap target among all elements                       */
/* ------------------------------------------------------------------ */

/**
 * Given a cursor position and the other endpoint of the line,
 * find the nearest shape boundary to snap to.
 * Excludes the arrow element itself.
 */
export function findSnapTarget(
  cursor: Point,
  elements: BoardElement[],
  excludeIds: Set<string>,
): SnapResult | null {
  let best: SnapResult | null = null;

  for (const el of elements) {
    if (excludeIds.has(el.id)) continue;
    if (el.type === 'arrow') continue; // don't snap to other lines
    if (!el.visible) continue;

    const bp = nearestBoundaryPoint(cursor, el);
    const d = dist(cursor, bp);

    if (d < SNAP_DISTANCE && (!best || d < best.distance)) {
      best = { point: bp, elementId: el.id, distance: d };
    }
  }

  return best;
}

/**
 * Convert an absolute snap point to a relative anchor (fraction of element size).
 */
export function toRelativeAnchor(
  point: Point,
  el: BoardElement,
): { rx: number; ry: number } {
  return {
    rx: el.width > 0 ? (point.x - el.x) / el.width : 0.5,
    ry: el.height > 0 ? (point.y - el.y) / el.height : 0.5,
  };
}

/**
 * Convert a relative anchor back to an absolute point on the element.
 */
export function fromRelativeAnchor(
  anchor: { rx: number; ry: number },
  el: BoardElement,
): Point {
  return {
    x: el.x + anchor.rx * el.width,
    y: el.y + anchor.ry * el.height,
  };
}

/**
 * Given a connected element and an optional pinned anchor,
 * compute where the connected endpoint should be.
 * If anchor is provided, uses the pinned position.
 * Otherwise falls back to nearest boundary from otherEndpoint.
 */
export function computeConnectionPoint(
  connectedElement: BoardElement,
  otherEndpoint: Point,
  anchor?: { rx: number; ry: number },
): Point {
  if (anchor) {
    return fromRelativeAnchor(anchor, connectedElement);
  }
  return nearestBoundaryPoint(otherEndpoint, connectedElement);
}
