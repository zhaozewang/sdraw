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
