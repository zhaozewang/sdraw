type Point = { x: number; y: number };

/** Closed, uniformly thick arrow outline. The endpoint remains the head tip. */
export function filledArrowPath(a: Point, b: Point, meta: Record<string, unknown> = {}): string {
  const number = (key: string, fallback: number) =>
    typeof meta[key] === 'number' && Number.isFinite(meta[key]) ? meta[key] as number : fallback;
  const bend = Math.max(.1, Math.min(.9, number('bendPosition', .5)));
  let points = [a, b];
  if (meta.lineType === 'step' && a.x !== b.x && a.y !== b.y) {
    if (meta.bendAxis === 'vertical') {
      const y = a.y + (b.y - a.y) * bend;
      points = [a, {x:a.x,y}, {x:b.x,y}, b];
    } else {
      const x = a.x + (b.x - a.x) * bend;
      points = [a, {x,y:a.y}, {x,y:b.y}, b];
    }
  }
  const lengths = points.slice(1).map((p,i) => Math.hypot(p.x-points[i].x,p.y-points[i].y));
  if (Math.min(...lengths) < 1e-6) return '';
  const half = Math.min(Math.max(.1, number('bodyWidth', 10))/2, Math.min(...lengths)*.4);
  const headLength = Math.min(Math.max(.1,number('blockHeadLength',14)), lengths[lengths.length-1]*.6);
  const headHalf = Math.max(half, number('blockHeadWidth',22)/2);
  const directions = points.slice(1).map((p,i) => ({x:(p.x-points[i].x)/lengths[i],y:(p.y-points[i].y)/lengths[i]}));
  const normals = directions.map(d => ({x:-d.y,y:d.x}));
  const last = directions[directions.length-1], n = normals[normals.length-1];
  const neck = {x:b.x-last.x*headLength,y:b.y-last.y*headLength};
  const sides = (sign: number) => {
    const side = [{x:a.x+sign*half*normals[0].x,y:a.y+sign*half*normals[0].y}];
    for (let i=1;i<points.length-1;i++) {
      const p=points[i], u=normals[i-1], v=normals[i];
      const denominator=1+u.x*v.x+u.y*v.y;
      side.push({x:p.x+sign*half*(u.x+v.x)/denominator,y:p.y+sign*half*(u.y+v.y)/denominator});
    }
    side.push({x:neck.x+sign*half*n.x,y:neck.y+sign*half*n.y});
    return side;
  };
  const outline = [...sides(1), {x:neck.x+headHalf*n.x,y:neck.y+headHalf*n.y}, b,
    {x:neck.x-headHalf*n.x,y:neck.y-headHalf*n.y}, ...sides(-1).reverse()];
  if (points.length === 4 && number('stepRadius',0) > 0) {
    // Concentric inner/outer arcs preserve shaft thickness around each bend.
    const radius = Math.min(Math.max(half,number('stepRadius',0)),lengths[0],lengths[1]/2,lengths[2]-headLength);
    const radii = outline.map(() => 0);
    for (let i=1;i<3;i++) {
      const u=directions[i-1],v=directions[i],turn=u.x*v.y-u.y*v.x;
      radii[i]=Math.max(0,radius-turn*half);
      radii[outline.length-1-i]=Math.max(0,radius+turn*half);
    }
    let path=`M ${outline[0].x},${outline[0].y}`;
    for (let i=1;i<outline.length;i++) {
      const p=outline[i],r=radii[i];
      if (r<1e-6) {path+=` L ${p.x},${p.y}`;continue;}
      const prev=outline[i-1],next=outline[(i+1)%outline.length];
      const before=Math.hypot(p.x-prev.x,p.y-prev.y),after=Math.hypot(next.x-p.x,next.y-p.y);
      const u={x:(p.x-prev.x)/before,y:(p.y-prev.y)/before};
      const v={x:(next.x-p.x)/after,y:(next.y-p.y)/after};
      const sweep=u.x*v.y-u.y*v.x>0 ? 1 : 0;
      path+=` L ${p.x-u.x*r},${p.y-u.y*r} A ${r},${r} 0 0 ${sweep} ${p.x+v.x*r},${p.y+v.y*r}`;
    }
    return path+' Z';
  }
  return outline.map((p,i) => `${i ? 'L' : 'M'} ${p.x},${p.y}`).join(' ')+' Z';
}
