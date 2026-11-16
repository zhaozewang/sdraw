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
  | 'smooth'
  | 'return';

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

export function buildPath(
  p0: Pt,
  p1: Pt,
  lineType: LineType,
  ctrl: Pt[],
  opts?: { stepRadius?: number; returnDirection?: string },
): string {
  switch (lineType) {
    case 'return': return returnArrowPath(p0, p1, ctrl[0], opts?.returnDirection);
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
      const w = ARROW_LENGTH * s, mid = ARROW_HALF_WIDTH * s, h = 2 * mid;
      const points = isStart ? `${w} 0, 0 ${mid}, ${w} ${h}` : `0 0, ${w} ${mid}, 0 ${h}`;
      return {
        width: w, height: h, refX: isStart ? 0 : w, refY: mid,
        shape: { kind: 'polygon', points, fill: color },
      };
    }
    case 'arrow-open': {
      const w = ARROW_LENGTH * s, mid = ARROW_HALF_WIDTH * s, h = 2 * mid;
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

/** Shaft geometry only. Marker tips and selection endpoints stay unchanged. */
type Point = [number, number];
type Segment = Point[];
/** A single native return connector with a draggable outside rail. */
export function returnArrowPath(p0: {x:number;y:number}, p1: {x:number;y:number},
  control: {x:number;y:number} | undefined, direction = 'down'): string {
  const horizontal = direction === 'left' || direction === 'right';
  const sign = direction === 'left' || direction === 'up' ? -1 : 1;
  const local = (p: {x:number;y:number}): Point =>
    horizontal ? [p.y, sign*p.x] : [p.x, sign*p.y];
  const a = local(p0), b = local(p1);
  const rail = Math.max(control ? local(control)[1] : Math.max(a[1],b[1])+50, a[1],b[1]);
  const r = Math.min(16,Math.abs(b[0]-a[0])/2,rail-a[1],rail-b[1]);
  const order = b[0]>=a[0] ? 1 : -1;
  const point = (x:number,y:number) => horizontal ? `${sign*y},${x}` : `${x},${sign*y}`;
  return `M ${point(...a)} L ${point(a[0],rail-r)} `+
    `Q ${point(a[0],rail)} ${point(a[0]+order*r,rail)} `+
    `L ${point(b[0]-order*r,rail)} Q ${point(b[0],rail)} ${point(b[0],rail-r)} L ${point(...b)}`;
}
/** A connected splitter, not a line crossing. Branches leave the stem tangentially. */
export function roundedJunctionPath(width: number, height: number, radius: number, direction = 'down'): string {
  const horizontal = direction === 'left' || direction === 'right';
  const w = horizontal ? height : width, h = horizontal ? width : height;
  const cx = w / 2, cy = h / 2, r = Math.max(0, Math.min(radius, cx, cy));
  const point = (x: number, y: number) => {
    if (direction === 'up') return `${x},${height-y}`;
    if (direction === 'right') return `${y},${x}`;
    if (direction === 'left') return `${width-y},${x}`;
    return `${x},${y}`;
  };
  return `M ${point(cx,0)} L ${point(cx,h)} ` +
    [0,w].map(x => `M ${point(cx,cy-r)} Q ${point(cx,cy)} ${point(cx+(x===0?-r:r),cy)} L ${point(x,cy)}`).join(' ');
}

export const ARROW_LENGTH = 6;
export const ARROW_HALF_WIDTH = 2.5;
export function markerInset(marker: string, width: number, size = 1): number {
  // Filled head covers this join; open heads only cover a small central join.
  if (marker === 'arrow') return 1.8 * width * size;
  if (marker === 'arrow-open') return 0.6 * width * size;
  return 0; // none, bar, dot and diamond retain their original endpoint.
}
function split(points: Segment, t: number): [Segment, Segment] {
  const left = [points[0]], right = [points[points.length - 1]];
  let row = points;
  while (row.length > 1) {
    row = row.slice(1).map((p, i): Point => [
      row[i][0] * (1-t) + p[0] * t, row[i][1] * (1-t) + p[1] * t,
    ]);
    left.push(row[0]); right.unshift(row[row.length-1]);
  }
  return [left, right];
}
function samples(points: Segment): number[] {
  const lengths = [0]; let previous = points[0];
  for (let i=1; i<=64; i++) {
    const sample = split(points, i/64)[0];
    const p = sample[sample.length-1];
    lengths.push(lengths[i-1] + Math.hypot(p[0]-previous[0], p[1]-previous[1])); previous=p;
  }
  return lengths;
}
function trimStart(segments: Segment[], distance: number): Segment[] {
  const result = segments.slice();
  while (distance > 0 && result.length) {
    const lengths=samples(result[0]), total=lengths[64];
    if (distance >= total) { distance-=total; result.shift(); continue; }
    const i=lengths.findIndex(x => x>=distance);
    const t=(i-1+(distance-lengths[i-1])/(lengths[i]-lengths[i-1]))/64;
    result[0]=split(result[0],t)[1]; break;
  }
  return result;
}
/** Supports the absolute M/L/Q/C paths produced by sdraw's path builders. */
export function trimArrowPath(path: string, start: number, end: number): string {
  if (!start && !end) return path;
  const tokens=path.match(/[MLQC]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi) || [];
  let at=0, current: Point=[0,0]; const segments: Segment[]=[];
  while (at<tokens.length) {
    const command=tokens[at++], count=({M:1,L:1,Q:2,C:3} as Record<string,number>)[command];
    if (!count) return path;
    const points: Segment=[current];
    for (let j=0;j<count;j++) points.push([Number(tokens[at++]),Number(tokens[at++])]);
    current=points[points.length-1]; if(command!=='M') segments.push(points);
  }
  const length=segments.reduce((sum,s)=>sum+samples(s)[64],0);
  if (!length) return path;
  let result=trimStart(segments,Math.min(start,length*.45));
  result=trimStart(result.reverse().map(s=>s.slice().reverse()),Math.min(end,length*.45));
  result=result.reverse().map(s=>s.slice().reverse());
  if(!result.length) return path;
  return `M ${result[0][0].join(',')} `+result.map(s=>
    `${({2:'L',3:'Q',4:'C'} as Record<number,string>)[s.length]} ${s.slice(1).map(p=>p.join(',')).join(' ')}`
  ).join(' ');
}
