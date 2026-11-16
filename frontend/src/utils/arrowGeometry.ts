/**
 * Pure geometry helpers shared between the live ArrowNode component and the
 * export pipeline (captureOffscreen.ts).
 *
 * Keeping the path, control-point, and marker math in one place is what
 * keeps live and exported arrows visually identical — every prior bug in
 * this area was the result of the two renderers drifting.
 */

export type LineType =
  | 'straight'
  | 'quadratic'
  | 'cubic'
  | 'arc'
  | 'step'
  | 'step-rounded'
  | 'smooth';

export type MarkerType = 'none' | 'arrow' | 'arrow-open' | 'dot' | 'diamond' | 'bar';

export interface Pt {
  x: number;
  y: number;
}

export function defaultControlPoints(p0: Pt, p1: Pt, lineType: LineType): Pt[] {
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

export function buildPath(
  p0: Pt,
  p1: Pt,
  lineType: LineType,
  ctrl: Pt[],
  opts?: { stepRadius?: number },
): string {
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
      const desiredR = opts?.stepRadius ?? 20;
      const maxR = Math.min(Math.abs(mx - p0.x), Math.abs(dy) / 2, desiredR);
      const r = Math.max(maxR, 0);
      if (r < 1) {
        return `M ${p0.x},${p0.y} L ${mx},${p0.y} L ${mx},${p1.y} L ${p1.x},${p1.y}`;
      }
      const sy = dy > 0 ? 1 : -1;
      return [
        `M ${p0.x},${p0.y}`,
        `L ${mx - r},${p0.y}`,
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

/**
 * Marker geometry as plain data — each renderer (React JSX or createElementNS)
 * turns this into actual elements without re-deriving the math.
 */
export type MarkerShape =
  | { kind: 'polygon'; points: string; fill: string }
  | { kind: 'polyline'; points: string; stroke: string; strokeWidth: number }
  | { kind: 'circle'; cx: number; cy: number; r: number; fill: string }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; strokeWidth: number };

export interface MarkerSpec {
  width: number;
  height: number;
  refX: number;
  refY: number;
  shape: MarkerShape;
}

export function markerSpec(
  type: MarkerType,
  isStart: boolean,
  color: string,
  headSize = 1,
): MarkerSpec | null {
  const s = headSize;
  switch (type) {
    case 'arrow': {
      const w = 10 * s, h = 8 * s, mid = 4 * s;
      const points = isStart ? `${w} 0, 0 ${mid}, ${w} ${h}` : `0 0, ${w} ${mid}, 0 ${h}`;
      return {
        width: w, height: h, refX: isStart ? 0 : w, refY: mid,
        shape: { kind: 'polygon', points, fill: color },
      };
    }
    case 'arrow-open': {
      const w = 10 * s, h = 8 * s, mid = 4 * s;
      const points = isStart ? `${w} 0, 0 ${mid}, ${w} ${h}` : `0 0, ${w} ${mid}, 0 ${h}`;
      return {
        width: w, height: h, refX: isStart ? 0 : w, refY: mid,
        shape: { kind: 'polyline', points, stroke: color, strokeWidth: 1.5 * s },
      };
    }
    case 'dot': {
      const d = 6 * s, c = 3 * s, r = 2.5 * s;
      return {
        width: d, height: d, refX: c, refY: c,
        shape: { kind: 'circle', cx: c, cy: c, r, fill: color },
      };
    }
    case 'diamond': {
      const d = 8 * s, mid = 4 * s;
      return {
        width: d, height: d, refX: mid, refY: mid,
        shape: { kind: 'polygon', points: `${mid} 0, ${d} ${mid}, ${mid} ${d}, 0 ${mid}`, fill: color },
      };
    }
    case 'bar': {
      const w = 2 * s, h = 8 * s, cx = 1 * s;
      return {
        width: w, height: h, refX: cx, refY: h / 2,
        shape: { kind: 'line', x1: cx, y1: 0, x2: cx, y2: h, stroke: color, strokeWidth: 2 * s },
      };
    }
    default:
      return null;
  }
}
