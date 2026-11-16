"""Marker-dependent shaft inset. Mirrors frontend utils/arrowGeometry.ts."""
import math
import re

ARROW_LENGTH = 6
ARROW_HALF_WIDTH = 2.5


def return_arrow_path(p0, p1, control=None, direction='down'):
    horizontal = direction in ('left', 'right')
    sign = -1 if direction in ('left', 'up') else 1
    def local(p):
        return (p[1], sign*p[0]) if horizontal else (p[0], sign*p[1])
    a, b = local(p0), local(p1)
    rail = max(local(control)[1] if control else max(a[1], b[1])+50, a[1], b[1])
    r = min(16, abs(b[0]-a[0])/2, rail-a[1], rail-b[1])
    order = 1 if b[0] >= a[0] else -1
    def point(x, y):
        return f'{sign*y},{x}' if horizontal else f'{x},{sign*y}'
    return (f'M {point(*a)} L {point(a[0],rail-r)} '
            f'Q {point(a[0],rail)} {point(a[0]+order*r,rail)} '
            f'L {point(b[0]-order*r,rail)} Q {point(b[0],rail)} '
            f'{point(b[0],rail-r)} L {point(*b)}')


def rounded_junction_path(width, height, radius, direction='down'):
    """Connected splitter with tangent branches; mirrors roundedJunctionPath."""
    w, h = (height, width) if direction in ('left', 'right') else (width, height)
    cx, cy = w / 2, h / 2
    r = max(0, min(radius, cx, cy))

    def point(x, y):
        if direction == 'up': x, y = x, height-y
        elif direction == 'right': x, y = y, x
        elif direction == 'left': x, y = width-y, x
        return f'{x:g},{y:g}'

    return f'M {point(cx,0)} L {point(cx,h)} ' + ' '.join(
        f'M {point(cx,cy-r)} Q {point(cx,cy)} {point(cx+(-r if x == 0 else r),cy)} L {point(x,cy)}'
        for x in (0,w))


def marker_inset(marker, width, size=1):
    return {'arrow': 1.8, 'arrow-open': .6}.get(marker, 0) * width * size


def _split(points, t):
    left, right = [points[0]], [points[-1]]
    row = points
    while len(row) > 1:
        row = [(a[0]*(1-t)+b[0]*t, a[1]*(1-t)+b[1]*t) for a,b in zip(row,row[1:])]
        left.append(row[0]); right.insert(0,row[-1])
    return left, right


def _samples(points):
    lengths, previous = [0], points[0]
    for i in range(1,65):
        p = _split(points,i/64)[0][-1]
        lengths.append(lengths[-1]+math.dist(previous,p)); previous=p
    return lengths


def _trim_start(segments, distance):
    result = segments[:]
    while distance > 0 and result:
        lengths = _samples(result[0])
        if distance >= lengths[-1]:
            distance -= lengths[-1]; result.pop(0); continue
        i = next(i for i,x in enumerate(lengths) if x >= distance)
        t = (i-1+(distance-lengths[i-1])/(lengths[i]-lengths[i-1]))/64
        result[0] = _split(result[0],t)[1]
        break
    return result


def trim_arrow_path(path, start, end):
    if not start and not end:
        return path
    tokens = re.findall(r'[MLQC]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?',path,re.I)
    at, current, segments = 0, (0,0), []
    while at < len(tokens):
        command=tokens[at]; at+=1
        count={'M':1,'L':1,'Q':2,'C':3}.get(command)
        if not count:
            return path
        points=[current]
        for _ in range(count):
            points.append((float(tokens[at]),float(tokens[at+1]))); at+=2
        current=points[-1]
        if command!='M': segments.append(points)
    length=sum(_samples(s)[-1] for s in segments)
    if not length: return path
    result=_trim_start(segments,min(start,length*.45))
    result=_trim_start([s[::-1] for s in result[::-1]],min(end,length*.45))
    result=[s[::-1] for s in result[::-1]]
    if not result: return path
    coord=lambda p: f'{p[0]},{p[1]}'
    return 'M '+coord(result[0][0])+' '+' '.join(
        {2:'L',3:'Q',4:'C'}[len(s)]+' '+' '.join(map(coord,s[1:])) for s in result)
