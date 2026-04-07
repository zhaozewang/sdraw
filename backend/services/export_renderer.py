"""Server-side board rendering for auto-export.

Uses SVG serialisation + cairosvg rasterisation (the tldraw approach):
each element is converted to its SVG equivalent, assembled into a single
SVG document, and rasterised by cairosvg.  This mirrors the browser's
native SVG renderer and produces pixel-perfect output for arrows (markers,
orient="auto"), shapes, and text.
"""

import base64
import hashlib
import html as html_mod
import io
import logging
import math
from pathlib import Path
from typing import Optional

from PIL import Image

logger = logging.getLogger(__name__)


# -----------------------------------------------------------------------
#  Path building — mirrors frontend ArrowNode.tsx exactly
# -----------------------------------------------------------------------

def _default_ctrl(p0, p1, lt):
    mx = (p0[0] + p1[0]) / 2
    my = (p0[1] + p1[1]) / 2
    dx = p1[0] - p0[0]
    dy = p1[1] - p0[1]
    ln = math.sqrt(dx * dx + dy * dy) or 1
    ox = (-dy / ln) * ln * 0.3
    oy = (dx / ln) * ln * 0.3
    if lt in ('quadratic', 'arc'):
        return [(mx + ox, my + oy)]
    if lt == 'smooth':
        return [(mx + ox * 0.4, my + oy * 0.4)]
    if lt == 'cubic':
        return [
            (p0[0] + dx * 0.25 + ox, p0[1] + dy * 0.25 + oy),
            (p0[0] + dx * 0.75 - ox, p0[1] + dy * 0.75 - oy),
        ]
    return []


def _build_path(p0, p1, lt, ctrl):
    if lt in ('quadratic', 'arc'):
        c = ctrl[0] if ctrl else ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
        return f"M {p0[0]},{p0[1]} Q {c[0]},{c[1]} {p1[0]},{p1[1]}"
    if lt == 'smooth':
        if ctrl:
            c = ctrl[0]
            return f"M {p0[0]},{p0[1]} Q {c[0]},{c[1]} {p1[0]},{p1[1]}"
        dx = p1[0] - p0[0]
        dy = p1[1] - p0[1]
        t = min(abs(dx), abs(dy)) * 0.5 + abs(dx) * 0.25
        return f"M {p0[0]},{p0[1]} C {p0[0] + t},{p0[1]} {p1[0] - t},{p1[1]} {p1[0]},{p1[1]}"
    if lt == 'cubic':
        c1 = ctrl[0] if ctrl else (p0[0] + (p1[0] - p0[0]) * 0.25, p0[1])
        c2 = ctrl[1] if len(ctrl) > 1 else (p0[0] + (p1[0] - p0[0]) * 0.75, p1[1])
        return f"M {p0[0]},{p0[1]} C {c1[0]},{c1[1]} {c2[0]},{c2[1]} {p1[0]},{p1[1]}"
    if lt == 'step':
        mx = (p0[0] + p1[0]) / 2
        return f"M {p0[0]},{p0[1]} L {mx},{p0[1]} L {mx},{p1[1]} L {p1[0]},{p1[1]}"
    if lt == 'step-rounded':
        mx = (p0[0] + p1[0]) / 2
        dy = p1[1] - p0[1]
        max_r = min(abs(mx - p0[0]), abs(dy) / 2, 20)
        r = max(max_r, 0)
        if r < 1:
            return f"M {p0[0]},{p0[1]} L {mx},{p0[1]} L {mx},{p1[1]} L {p1[0]},{p1[1]}"
        sy = 1 if dy > 0 else -1
        return ' '.join([
            f"M {p0[0]},{p0[1]}", f"L {mx - r},{p0[1]}",
            f"Q {mx},{p0[1]} {mx},{p0[1] + r * sy}",
            f"L {mx},{p1[1] - r * sy}",
            f"Q {mx},{p1[1]} {mx + r * (1 if p1[0] > p0[0] else -1)},{p1[1]}",
            f"L {p1[0]},{p1[1]}",
        ])
    return f"M {p0[0]},{p0[1]} L {p1[0]},{p1[1]}"


# -----------------------------------------------------------------------
#  Arrowhead drawing — cairosvg does NOT implement orient="auto" on
#  markers, so we draw arrowheads as manually rotated polygons.
# -----------------------------------------------------------------------

def _path_tangent_at_end(p0, p1, lt, ctrl):
    """Return (dx, dy) tangent direction at the END of the path (p1)."""
    if lt in ('quadratic', 'arc', 'smooth') and ctrl:
        # Tangent at end of Q curve = direction from control point to p1
        return (p1[0] - ctrl[0][0], p1[1] - ctrl[0][1])
    if lt == 'cubic' and len(ctrl) >= 2:
        return (p1[0] - ctrl[1][0], p1[1] - ctrl[1][1])
    if lt == 'cubic' and len(ctrl) == 1:
        return (p1[0] - ctrl[0][0], p1[1] - ctrl[0][1])
    # straight / step: tangent is last segment direction
    return (p1[0] - p0[0], p1[1] - p0[1])


def _path_tangent_at_start(p0, p1, lt, ctrl):
    """Return (dx, dy) tangent direction at the START of the path (p0).
    Direction points INTO the path (away from p0)."""
    if lt in ('quadratic', 'arc', 'smooth') and ctrl:
        return (ctrl[0][0] - p0[0], ctrl[0][1] - p0[1])
    if lt == 'cubic' and len(ctrl) >= 1:
        return (ctrl[0][0] - p0[0], ctrl[0][1] - p0[1])
    return (p1[0] - p0[0], p1[1] - p0[1])


def _arrowhead_svg(tip, tangent_dx, tangent_dy, mtype, color, stroke_width, head_size, is_start):
    """Draw an arrowhead at `tip` pointing in the direction of (tangent_dx, tangent_dy).
    For start markers, the arrowhead points AWAY from the path (opposite direction)."""
    angle = math.degrees(math.atan2(tangent_dy, tangent_dx))
    if is_start:
        angle += 180  # start marker points backward
    s = head_size
    # Size proportional to stroke width (matches markerUnits="strokeWidth")
    sw = stroke_width
    tx, ty = tip

    if mtype in ('arrow', 'arrow-open'):
        # Triangle: tip at (0,0), base at (-length, ±half_width)
        # In the browser, markerUnits="strokeWidth" scales the marker viewport
        # but the visual polygon size is markerWidth in viewport coordinates.
        # The effective pixel size is roughly markerWidth * strokeWidth^0.5.
        length = 10 * s * max(sw * 0.5, 1)
        half_w = 4 * s * max(sw * 0.5, 1)
        if mtype == 'arrow':
            return (f'<polygon points="0,0 {-length},{-half_w} {-length},{half_w}" '
                    f'fill="{color}" '
                    f'transform="translate({tx},{ty}) rotate({angle})"/>')
        else:
            return (f'<polyline points="{-length},{-half_w} 0,0 {-length},{half_w}" '
                    f'fill="none" stroke="{color}" stroke-width="{1.5 * s}" '
                    f'transform="translate({tx},{ty}) rotate({angle})"/>')
    if mtype == 'dot':
        r = 2.5 * s * sw
        return f'<circle cx="{tx}" cy="{ty}" r="{r}" fill="{color}"/>'
    if mtype == 'diamond':
        d = 4 * s * sw
        return (f'<polygon points="{d},0 0,{-d} {-d},0 0,{d}" fill="{color}" '
                f'transform="translate({tx},{ty}) rotate({angle})"/>')
    if mtype == 'bar':
        h = 4 * s * sw
        return (f'<line x1="0" y1="{-h}" x2="0" y2="{h}" '
                f'stroke="{color}" stroke-width="{2 * s}" '
                f'transform="translate({tx},{ty}) rotate({angle})"/>')
    return ''


# -----------------------------------------------------------------------
#  Board → SVG document
# -----------------------------------------------------------------------

def _board_to_svg(board_data: dict, transparent: bool, dpi: int) -> str:
    """Convert board data to a self-contained SVG string."""
    elements = [e for e in board_data.get('elements', []) if e.get('visible', True)]
    if not elements:
        return ''

    elements.sort(key=lambda e: e.get('z_index', 0))
    renderable = [e for e in elements if e.get('type', '') != 'group']
    if not renderable:
        return ''

    pad = 20
    min_x = min(e['x'] for e in renderable) - pad
    min_y = min(e['y'] for e in renderable) - pad
    max_x = max(e['x'] + e.get('width', 0) for e in renderable) + pad
    max_y = max(e['y'] + e.get('height', 0) for e in renderable) + pad
    cw = max_x - min_x
    ch = max_y - min_y

    auto_export = board_data.get('autoExport', {})
    size_mode = auto_export.get('sizeMode', 'fit')

    if size_mode == 'canvas':
        vb_x, vb_y = 0, 0
        vb_w = board_data.get('canvas', {}).get('width', 2400)
        vb_h = board_data.get('canvas', {}).get('height', 1600)
    elif size_mode == 'fixed':
        vb_x, vb_y = min_x, min_y
        vb_w, vb_h = cw, ch
    else:  # fit
        vb_x, vb_y = min_x, min_y
        vb_w, vb_h = cw, ch

    if size_mode == 'fixed':
        svg_w = (auto_export.get('fixedWidth', 1920)) * dpi
        svg_h = (auto_export.get('fixedHeight', 1080)) * dpi
    else:
        svg_w = vb_w * dpi
        svg_h = vb_h * dpi

    defs_parts: list[str] = []
    body_parts: list[str] = []
    used_markers: set[str] = set()

    for el in elements:
        el_type = el.get('type', '')
        style = el.get('style', {})
        meta = el.get('metadata', {})
        opacity = style.get('opacity', 1)

        if el_type == 'rectangle':
            shape = meta.get('shape', 'rect')
            fill = style.get('fill', 'transparent')
            stroke = style.get('strokeColor', 'transparent')
            sw = style.get('strokeWidth', 0)
            br = style.get('borderRadius', 0)
            x, y, w, h = el['x'], el['y'], el['width'], el['height']

            if shape == 'triangle':
                pts = f"{x + w / 2},{y} {x + w},{y + h} {x},{y + h}"
                body_parts.append(
                    f'<polygon points="{pts}" fill="{fill}" stroke="{stroke}" '
                    f'stroke-width="{sw}" opacity="{opacity}"/>')
            elif shape == 'diamond':
                pts = f"{x + w / 2},{y} {x + w},{y + h / 2} {x + w / 2},{y + h} {x},{y + h / 2}"
                body_parts.append(
                    f'<polygon points="{pts}" fill="{fill}" stroke="{stroke}" '
                    f'stroke-width="{sw}" opacity="{opacity}"/>')
            else:
                r = min(br, w / 2, h / 2)
                body_parts.append(
                    f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" '
                    f'fill="{fill}" stroke="{stroke}" stroke-width="{sw}" opacity="{opacity}"/>')

        elif el_type == 'arrow':
            pts = el.get('points', [])
            if len(pts) < 2:
                continue
            lt = meta.get('lineType', 'straight')
            ctrl_raw = meta.get('controlPoints', [])
            hs = meta.get('arrowHeadSize', 1)
            sm = meta.get('startMarker', 'none')
            em = meta.get('endMarker', 'arrow') if meta.get('arrowHead') is not False else 'none'
            if 'endMarker' in meta:
                em = meta['endMarker']

            p0 = (el['x'] + pts[0]['x'], el['y'] + pts[0]['y'])
            p1 = (el['x'] + pts[1]['x'], el['y'] + pts[1]['y'])
            has_curve = lt in ('quadratic', 'cubic', 'arc', 'smooth')
            if has_curve and not ctrl_raw:
                ectrl = [
                    (el['x'] + c[0], el['y'] + c[1])
                    for c in _default_ctrl(
                        (pts[0]['x'], pts[0]['y']),
                        (pts[1]['x'], pts[1]['y']), lt)
                ]
            else:
                ectrl = [(el['x'] + c['x'], el['y'] + c['y']) for c in ctrl_raw]

            path_d = _build_path(p0, p1, lt, ectrl)
            sc = style.get('strokeColor', '#333333')
            sw = style.get('strokeWidth', 2)
            da = 'stroke-dasharray="8,4" ' if style.get('strokeStyle') == 'dashed' else (
                 'stroke-dasharray="2,4" ' if style.get('strokeStyle') == 'dotted' else '')

            # Draw the path (no markers — cairosvg breaks orient="auto")
            body_parts.append(
                f'<path d="{path_d}" fill="none" stroke="{sc}" stroke-width="{sw}" '
                f'{da}opacity="{opacity}"/>')

            # Draw arrowheads as manually rotated polygons
            if sm != 'none':
                tdx, tdy = _path_tangent_at_start(p0, p1, lt, ectrl)
                body_parts.append(
                    _arrowhead_svg(p0, tdx, tdy, sm, sc, sw, hs, True))
            if em != 'none':
                tdx, tdy = _path_tangent_at_end(p0, p1, lt, ectrl)
                body_parts.append(
                    _arrowhead_svg(p1, tdx, tdy, em, sc, sw, hs, False))

        elif el_type == 'text':
            txt = el.get('text', '')
            if not txt:
                continue
            fs = style.get('fontSize', 14)
            color = style.get('color', '#111111')
            bg = style.get('background', 'transparent')
            padding = style.get('padding', 4)
            ta = style.get('textAlign', 'left')
            anchor = 'middle' if ta == 'center' else 'end' if ta == 'right' else 'start'
            tx = (el['x'] + el['width'] / 2 if ta == 'center'
                  else el['x'] + el['width'] - padding if ta == 'right'
                  else el['x'] + padding)

            if bg and bg != 'transparent':
                body_parts.append(
                    f'<rect x="{el["x"]}" y="{el["y"]}" width="{el["width"]}" '
                    f'height="{el["height"]}" fill="{bg}"/>')

            lines = txt.split('\n')
            tspans = ''.join(
                f'<tspan x="{tx}" dy="{0 if i == 0 else "1.2em"}">'
                f'{html_mod.escape(l)}</tspan>'
                for i, l in enumerate(lines)
            )
            body_parts.append(
                f'<text x="{tx}" y="{el["y"] + padding + fs * 0.85}" '
                f'font-family="system-ui,-apple-system,sans-serif" font-size="{fs}" '
                f'fill="{color}" text-anchor="{anchor}" opacity="{opacity}">'
                f'{tspans}</text>')

        elif el_type == 'image':
            source = el.get('source', {})
            path = source.get('path', '')
            if not path:
                continue
            p = Path(path)
            if not p.exists():
                continue
            raw = p.read_bytes()
            suffix = p.suffix.lower()
            mime = {'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
                    'gif': 'image/gif', 'webp': 'image/webp', 'svg': 'image/svg+xml'
                    }.get(suffix.lstrip('.'), 'image/png')
            b64 = base64.b64encode(raw).decode()
            body_parts.append(
                f'<image x="{el["x"]}" y="{el["y"]}" width="{el["width"]}" '
                f'height="{el["height"]}" href="data:{mime};base64,{b64}" '
                f'preserveAspectRatio="none" opacity="{opacity}"/>')

        elif el_type == 'plot':
            last_output = meta.get('lastOutput')
            if not last_output:
                continue
            body_parts.append(
                f'<image x="{el["x"]}" y="{el["y"]}" width="{el["width"]}" '
                f'height="{el["height"]}" href="data:image/png;base64,{last_output}" '
                f'preserveAspectRatio="none" opacity="{opacity}"/>')

    bg_color = board_data.get('canvas', {}).get('background', '#ffffff')
    bg_rect = '' if transparent else (
        f'<rect x="{vb_x}" y="{vb_y}" width="{vb_w}" height="{vb_h}" fill="{bg_color}"/>')

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'width="{svg_w}" height="{svg_h}" viewBox="{vb_x} {vb_y} {vb_w} {vb_h}">\n'
        f'<defs>{"".join(defs_parts)}</defs>\n'
        f'{bg_rect}\n'
        f'{"".join(body_parts)}\n'
        f'</svg>'
    )


# -----------------------------------------------------------------------
#  Public API
# -----------------------------------------------------------------------

def render_board(board_data: dict, output_path: str) -> dict:
    """Render a board to an image file using SVG serialisation + cairosvg.

    Returns dict with path, size, content_hash.
    """
    import cairosvg

    board_id = board_data.get('id', 'unknown')
    board_name = board_data.get('name', 'unknown')
    auto_export = board_data.get('autoExport', {})
    fmt = auto_export.get('format', 'png')
    dpi = auto_export.get('dpi', 2)
    transparent = auto_export.get('transparent', False) and fmt == 'png'

    logger.info("render_board: board=%s (%s), output=%s", board_name, board_id, output_path)

    svg_str = _board_to_svg(board_data, transparent, dpi)
    if not svg_str:
        return {"path": output_path, "size": 0, "content_hash": "", "skipped": True}

    # Rasterise SVG → PNG via cairosvg
    png_bytes = cairosvg.svg2png(bytestring=svg_str.encode('utf-8'))

    # Convert format if needed
    if fmt == 'jpg':
        img = Image.open(io.BytesIO(png_bytes)).convert('RGB')
        buf = io.BytesIO()
        img.save(buf, 'JPEG', quality=95)
        raw = buf.getvalue()
    elif fmt == 'pdf':
        raw = cairosvg.svg2pdf(bytestring=svg_str.encode('utf-8'))
    else:
        raw = png_bytes

    p = Path(output_path).resolve()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(raw)

    content_hash = hashlib.sha256(raw).hexdigest()
    logger.info("Rendered export: %s (%d bytes, hash=%s)", p, len(raw), content_hash[:12])
    return {"path": str(p), "size": len(raw), "content_hash": content_hash}
