"""Filled straight/orthogonal arrow geometry, mirrored in frontend filledArrow.ts."""
import math


def filled_arrow_path(a, b, meta=None):
    meta = meta or {}

    def number(key, fallback):
        value = meta.get(key)
        return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else fallback

    bend = max(.1, min(.9, number('bendPosition', .5)))
    points = [a, b]
    if meta.get('lineType') == 'step' and a[0] != b[0] and a[1] != b[1]:
        if meta.get('bendAxis') == 'vertical':
            y = a[1] + (b[1]-a[1])*bend
            points = [a, (a[0], y), (b[0], y), b]
        else:
            x = a[0] + (b[0]-a[0])*bend
            points = [a, (x, a[1]), (x, b[1]), b]
    lengths = [math.hypot(q[0]-p[0], q[1]-p[1]) for p, q in zip(points, points[1:])]
    if min(lengths) < 1e-6:
        return ''
    half = min(max(.1, number('bodyWidth', 10))/2, min(lengths)*.4)
    head_length = min(max(.1, number('blockHeadLength', 14)), lengths[-1]*.6)
    head_half = max(half, number('blockHeadWidth', 22)/2)
    directions = [((q[0]-p[0])/length, (q[1]-p[1])/length)
                  for p, q, length in zip(points, points[1:], lengths)]
    normals = [(-d[1], d[0]) for d in directions]
    last, n = directions[-1], normals[-1]
    neck = (b[0]-last[0]*head_length, b[1]-last[1]*head_length)

    def sides(sign):
        side = [(a[0]+sign*half*normals[0][0], a[1]+sign*half*normals[0][1])]
        for i in range(1, len(points)-1):
            p, u, v = points[i], normals[i-1], normals[i]
            denominator = 1+u[0]*v[0]+u[1]*v[1]
            side.append((p[0]+sign*half*(u[0]+v[0])/denominator,
                         p[1]+sign*half*(u[1]+v[1])/denominator))
        side.append((neck[0]+sign*half*n[0], neck[1]+sign*half*n[1]))
        return side

    outline = sides(1)+[(neck[0]+head_half*n[0], neck[1]+head_half*n[1]), b,
                       (neck[0]-head_half*n[0], neck[1]-head_half*n[1])]+list(reversed(sides(-1)))
    if len(points) == 4 and number('stepRadius', 0) > 0:
        # Concentric inner/outer arcs preserve shaft thickness around each bend.
        radius = min(max(half, number('stepRadius', 0)), lengths[0], lengths[1]/2, lengths[2]-head_length)
        radii = [0]*len(outline)
        for i in range(1, 3):
            u, v = directions[i-1], directions[i]
            turn = u[0]*v[1]-u[1]*v[0]
            radii[i] = max(0, radius-turn*half)
            radii[len(outline)-1-i] = max(0, radius+turn*half)
        path = f'M {outline[0][0]},{outline[0][1]}'
        for i in range(1, len(outline)):
            p, r = outline[i], radii[i]
            if r < 1e-6:
                path += f' L {p[0]},{p[1]}'
                continue
            prev, nex = outline[i-1], outline[(i+1) % len(outline)]
            before, after = math.dist(p, prev), math.dist(nex, p)
            u, v = ((p[0]-prev[0])/before, (p[1]-prev[1])/before), ((nex[0]-p[0])/after, (nex[1]-p[1])/after)
            sweep = int(u[0]*v[1]-u[1]*v[0] > 0)
            path += f' L {p[0]-u[0]*r},{p[1]-u[1]*r} A {r},{r} 0 0 {sweep} {p[0]+v[0]*r},{p[1]+v[1]*r}'
        return path+' Z'
    return ' '.join(f'{"L" if i else "M"} {p[0]},{p[1]}' for i, p in enumerate(outline))+' Z'
