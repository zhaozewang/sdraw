"""Server-side board rendering for auto-export.

Renders a board to an image purely from its data model, independent of
any browser viewport state. This ensures exports are deterministic and
consistent regardless of zoom/pan/selection.
"""

import base64
import hashlib
import io
import logging
import math
from pathlib import Path
from typing import Optional

from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)


def _hex_to_rgba(color: str, opacity: float = 1.0) -> tuple[int, int, int, int]:
    """Convert CSS hex color to RGBA tuple."""
    if not color or color == 'transparent':
        return (0, 0, 0, 0)
    color = color.strip().lstrip('#')
    if len(color) == 3:
        color = ''.join(c * 2 for c in color)
    if len(color) == 6:
        r, g, b = int(color[0:2], 16), int(color[2:4], 16), int(color[4:6], 16)
        return (r, g, b, int(opacity * 255))
    return (0, 0, 0, int(opacity * 255))


def _load_image_from_path(path: str) -> Optional[Image.Image]:
    """Load an image from a filesystem path."""
    try:
        p = Path(path)
        if p.exists() and p.is_file():
            img = Image.open(p)
            img.load()
            return img.convert('RGBA')
    except Exception as e:
        logger.warning("Failed to load image %s: %s", path, e)
    return None


def _load_image_from_base64(data: str) -> Optional[Image.Image]:
    """Load an image from a base64 string."""
    try:
        raw = base64.b64decode(data)
        img = Image.open(io.BytesIO(raw))
        img.load()
        return img.convert('RGBA')
    except Exception as e:
        logger.warning("Failed to decode base64 image: %s", e)
    return None


def _draw_arrow_svg(element: dict, scale: float) -> Optional[Image.Image]:
    """Render an arrow element to an image using cairosvg."""
    try:
        import svgwrite
        import cairosvg

        style = element.get('style', {})
        metadata = element.get('metadata', {})
        points = element.get('points', [])
        w = element.get('width', 1)
        h = element.get('height', 1)

        if len(points) < 2:
            return None

        stroke_color = style.get('strokeColor', '#333333')
        stroke_width = style.get('strokeWidth', 2)
        stroke_style = style.get('strokeStyle', 'solid')
        opacity = style.get('opacity', 1)
        line_type = metadata.get('lineType', 'straight')
        ctrl = metadata.get('controlPoints', [])
        head_size = metadata.get('arrowHeadSize', 1)
        start_marker = metadata.get('startMarker', 'none')
        end_marker = metadata.get('endMarker', 'arrow') if metadata.get('arrowHead') is not False else 'none'
        if 'endMarker' in metadata:
            end_marker = metadata['endMarker']

        # Add padding for markers and stroke
        pad = max(stroke_width * 5 * head_size, 15)
        svg_w = w + pad * 2
        svg_h = h + pad * 2

        p0 = points[0]
        p1 = points[1]

        # Build path
        sx, sy = p0['x'] + pad, p0['y'] + pad
        ex, ey = p1['x'] + pad, p1['y'] + pad

        if line_type == 'straight':
            path_d = f"M {sx},{sy} L {ex},{ey}"
        elif line_type in ('quadratic', 'arc', 'smooth'):
            if ctrl:
                cx, cy = ctrl[0]['x'] + pad, ctrl[0]['y'] + pad
                path_d = f"M {sx},{sy} Q {cx},{cy} {ex},{ey}"
            else:
                mx, my = (sx + ex) / 2, (sy + ey) / 2
                dx, dy = ex - sx, ey - sy
                length = math.sqrt(dx * dx + dy * dy) or 1
                off_x = (-dy / length) * length * 0.3
                off_y = (dx / length) * length * 0.3
                if line_type == 'smooth':
                    off_x *= 0.4
                    off_y *= 0.4
                cx, cy = mx + off_x, my + off_y
                path_d = f"M {sx},{sy} Q {cx},{cy} {ex},{ey}"
        elif line_type == 'cubic':
            if len(ctrl) >= 2:
                c1x, c1y = ctrl[0]['x'] + pad, ctrl[0]['y'] + pad
                c2x, c2y = ctrl[1]['x'] + pad, ctrl[1]['y'] + pad
                path_d = f"M {sx},{sy} C {c1x},{c1y} {c2x},{c2y} {ex},{ey}"
            else:
                dx, dy = ex - sx, ey - sy
                length = math.sqrt(dx * dx + dy * dy) or 1
                off_x = (-dy / length) * length * 0.3
                off_y = (dx / length) * length * 0.3
                c1x, c1y = sx + dx * 0.25 + off_x, sy + dy * 0.25 + off_y
                c2x, c2y = sx + dx * 0.75 - off_x, sy + dy * 0.75 - off_y
                path_d = f"M {sx},{sy} C {c1x},{c1y} {c2x},{c2y} {ex},{ey}"
        elif line_type == 'step':
            mx = (sx + ex) / 2
            path_d = f"M {sx},{sy} L {mx},{sy} L {mx},{ey} L {ex},{ey}"
        elif line_type == 'step-rounded':
            mx = (sx + ex) / 2
            dy_val = ey - sy
            desired_r = metadata.get('stepRadius', 20)
            max_r = min(abs(mx - sx), abs(dy_val) / 2, desired_r)
            r = max(max_r, 0)
            if r < 1:
                path_d = f"M {sx},{sy} L {mx},{sy} L {mx},{ey} L {ex},{ey}"
            else:
                s_y = 1 if dy_val > 0 else -1
                path_d = (
                    f"M {sx},{sy} L {mx - r},{sy} "
                    f"Q {mx},{sy} {mx},{sy + r * s_y} "
                    f"L {mx},{ey - r * s_y} "
                    f"Q {mx},{ey} {mx + r * (1 if ex > sx else -1)},{ey} "
                    f"L {ex},{ey}"
                )
        else:
            path_d = f"M {sx},{sy} L {ex},{ey}"

        # Build SVG
        dwg = svgwrite.Drawing(size=(f"{svg_w}px", f"{svg_h}px"))
        dwg.viewbox(0, 0, svg_w, svg_h)

        # Define markers
        marker_w = 10 * head_size
        marker_h = 8 * head_size
        marker_mid = 4 * head_size

        def add_arrow_marker(marker_id: str, is_start: bool):
            marker = dwg.marker(
                id=marker_id,
                insert=(0 if is_start else marker_w, marker_mid),
                size=(marker_w, marker_h),
                orient='auto',
                markerUnits='strokeWidth',
            )
            if is_start:
                marker.add(dwg.polygon(points=[(marker_w, 0), (0, marker_mid), (marker_w, marker_h)], fill=stroke_color))
            else:
                marker.add(dwg.polygon(points=[(0, 0), (marker_w, marker_mid), (0, marker_h)], fill=stroke_color))
            dwg.defs.add(marker)
            return marker

        def add_dot_marker(marker_id: str):
            d = 6 * head_size
            c = 3 * head_size
            marker = dwg.marker(id=marker_id, insert=(c, c), size=(d, d), orient='auto', markerUnits='strokeWidth')
            marker.add(dwg.circle(center=(c, c), r=2.5 * head_size, fill=stroke_color))
            dwg.defs.add(marker)
            return marker

        def add_diamond_marker(marker_id: str):
            d = 8 * head_size
            mid = 4 * head_size
            marker = dwg.marker(id=marker_id, insert=(mid, mid), size=(d, d), orient='auto', markerUnits='strokeWidth')
            marker.add(dwg.polygon(points=[(mid, 0), (d, mid), (mid, d), (0, mid)], fill=stroke_color))
            dwg.defs.add(marker)
            return marker

        def add_bar_marker(marker_id: str):
            bw = 2 * head_size
            bh = 8 * head_size
            marker = dwg.marker(id=marker_id, insert=(head_size, bh / 2), size=(bw, bh), orient='auto', markerUnits='strokeWidth')
            marker.add(dwg.line(start=(head_size, 0), end=(head_size, bh), stroke=stroke_color, stroke_width=2 * head_size))
            dwg.defs.add(marker)
            return marker

        marker_start_url = None
        marker_end_url = None

        for mtype, suffix, is_start in [(start_marker, 'start', True), (end_marker, 'end', False)]:
            if mtype == 'none':
                continue
            mid = f"m-{suffix}"
            if mtype == 'arrow':
                add_arrow_marker(mid, is_start)
            elif mtype == 'arrow-open':
                add_arrow_marker(mid, is_start)  # simplified
            elif mtype == 'dot':
                add_dot_marker(mid)
            elif mtype == 'diamond':
                add_diamond_marker(mid)
            elif mtype == 'bar':
                add_bar_marker(mid)
            else:
                continue
            url = f"url(#{mid})"
            if is_start:
                marker_start_url = url
            else:
                marker_end_url = url

        # Stroke dash
        dasharray = None
        if stroke_style == 'dashed':
            dasharray = "8,4"
        elif stroke_style == 'dotted':
            dasharray = "2,4"

        path_kwargs = {
            'd': path_d,
            'fill': 'none',
            'stroke': stroke_color,
            'stroke_width': stroke_width,
            'opacity': opacity,
        }
        if dasharray:
            path_kwargs['stroke_dasharray'] = dasharray
        path_el = dwg.path(**path_kwargs)
        if marker_start_url:
            path_el['marker-start'] = marker_start_url
        if marker_end_url:
            path_el['marker-end'] = marker_end_url
        dwg.add(path_el)

        # Render SVG to PNG
        svg_bytes = dwg.tostring().encode('utf-8')
        png_bytes = cairosvg.svg2png(
            bytestring=svg_bytes,
            output_width=int(svg_w * scale),
            output_height=int(svg_h * scale),
        )
        img = Image.open(io.BytesIO(png_bytes)).convert('RGBA')
        return img

    except Exception as e:
        logger.warning("Failed to render arrow SVG: %s", e)
        return None


def render_board(board_data: dict, output_path: str) -> dict:
    """Render a board to an image file.

    Returns dict with path, size, content_hash.
    """
    canvas = board_data.get('canvas', {})
    elements = board_data.get('elements', [])
    auto_export = board_data.get('autoExport', {})

    fmt = auto_export.get('format', 'png')
    dpi = auto_export.get('dpi', 2)
    transparent = auto_export.get('transparent', False) and fmt == 'png'
    size_mode = auto_export.get('sizeMode', 'fit')
    fixed_w = auto_export.get('fixedWidth', 1920)
    fixed_h = auto_export.get('fixedHeight', 1080)

    visible_elements = [e for e in elements if e.get('visible', True)]
    if not visible_elements:
        return {"path": output_path, "size": 0, "content_hash": "", "skipped": True}

    # Sort by z_index
    visible_elements.sort(key=lambda e: e.get('z_index', 0))

    # Compute content bounds
    pad = 20
    min_x = min(e['x'] for e in visible_elements) - pad
    min_y = min(e['y'] for e in visible_elements) - pad
    max_x = max(e['x'] + e.get('width', 0) for e in visible_elements) + pad
    max_y = max(e['y'] + e.get('height', 0) for e in visible_elements) + pad

    content_w = max_x - min_x
    content_h = max_y - min_y

    # Determine output size
    if size_mode == 'fixed':
        out_w, out_h = fixed_w, fixed_h
    elif size_mode == 'canvas':
        out_w = canvas.get('width', 2400)
        out_h = canvas.get('height', 1600)
    else:  # fit
        out_w = content_w
        out_h = content_h

    # Scale to DPI
    render_w = int(out_w * dpi)
    render_h = int(out_h * dpi)

    # Create output image
    bg_color = (0, 0, 0, 0) if transparent else _hex_to_rgba(canvas.get('background', '#ffffff'))
    output = Image.new('RGBA', (render_w, render_h), bg_color)

    # Compute offset: map content coords to output coords
    if size_mode == 'fit':
        off_x = -min_x
        off_y = -min_y
        render_scale = dpi
    elif size_mode == 'canvas':
        off_x = 0
        off_y = 0
        render_scale = dpi
    else:  # fixed
        # Center content in fixed size
        scale_x = out_w / content_w if content_w > 0 else 1
        scale_y = out_h / content_h if content_h > 0 else 1
        fit_scale = min(scale_x, scale_y, 1)  # don't upscale
        off_x = -min_x + (out_w - content_w * fit_scale) / (2 * fit_scale)
        off_y = -min_y + (out_h - content_h * fit_scale) / (2 * fit_scale)
        render_scale = dpi * fit_scale

    # Render each element
    for el in visible_elements:
        el_type = el.get('type', '')
        style = el.get('style', {})
        opacity = style.get('opacity', 1)
        ex = int((el['x'] + off_x) * render_scale)
        ey = int((el['y'] + off_y) * render_scale)
        ew = max(1, int(el.get('width', 0) * render_scale))
        eh = max(1, int(el.get('height', 0) * render_scale))

        if el_type == 'image':
            source = el.get('source', {})
            path = source.get('path', '')
            if not path:
                continue
            img = _load_image_from_path(path)
            if not img:
                continue
            img = img.resize((ew, eh), Image.Resampling.LANCZOS)
            if opacity < 1:
                alpha = img.split()[3]
                alpha = alpha.point(lambda a: int(a * opacity))
                img.putalpha(alpha)
            output.paste(img, (ex, ey), img)

        elif el_type == 'plot':
            last_output = el.get('metadata', {}).get('lastOutput')
            if not last_output:
                continue
            img = _load_image_from_base64(last_output)
            if not img:
                continue
            img = img.resize((ew, eh), Image.Resampling.LANCZOS)
            if opacity < 1:
                alpha = img.split()[3]
                alpha = alpha.point(lambda a: int(a * opacity))
                img.putalpha(alpha)
            output.paste(img, (ex, ey), img)

        elif el_type == 'rectangle':
            metadata = el.get('metadata', {})
            shape = metadata.get('shape')
            fill = style.get('fill', 'transparent')
            stroke_color = style.get('strokeColor', '#333333')
            stroke_width = int((style.get('strokeWidth', 2)) * render_scale / dpi)
            border_radius = int((style.get('borderRadius', 0)) * render_scale / dpi)

            layer = Image.new('RGBA', (ew, eh), (0, 0, 0, 0))
            draw = ImageDraw.Draw(layer)

            fill_rgba = _hex_to_rgba(fill, opacity)
            stroke_rgba = _hex_to_rgba(stroke_color, opacity)

            if shape == 'triangle':
                pts = [(ew // 2, 0), (ew, eh), (0, eh)]
                if fill_rgba[3] > 0:
                    draw.polygon(pts, fill=fill_rgba)
                if stroke_width > 0:
                    draw.polygon(pts, outline=stroke_rgba, width=stroke_width)
            elif shape == 'diamond':
                pts = [(ew // 2, 0), (ew, eh // 2), (ew // 2, eh), (0, eh // 2)]
                if fill_rgba[3] > 0:
                    draw.polygon(pts, fill=fill_rgba)
                if stroke_width > 0:
                    draw.polygon(pts, outline=stroke_rgba, width=stroke_width)
            else:
                if border_radius > 0:
                    if fill_rgba[3] > 0:
                        draw.rounded_rectangle([0, 0, ew - 1, eh - 1], radius=border_radius, fill=fill_rgba)
                    if stroke_width > 0:
                        draw.rounded_rectangle([0, 0, ew - 1, eh - 1], radius=border_radius, outline=stroke_rgba, width=stroke_width)
                else:
                    if fill_rgba[3] > 0:
                        draw.rectangle([0, 0, ew - 1, eh - 1], fill=fill_rgba)
                    if stroke_width > 0:
                        draw.rectangle([0, 0, ew - 1, eh - 1], outline=stroke_rgba, width=stroke_width)

            output.paste(layer, (ex, ey), layer)

        elif el_type == 'arrow':
            arrow_img = _draw_arrow_svg(el, render_scale / dpi)
            if arrow_img:
                # The arrow image has padding built in
                metadata = el.get('metadata', {})
                head_size = metadata.get('arrowHeadSize', 1)
                arrow_pad = max(int(style.get('strokeWidth', 2) * 5 * head_size * render_scale / dpi), int(15 * render_scale / dpi))
                paste_x = ex - arrow_pad
                paste_y = ey - arrow_pad
                if opacity < 1:
                    alpha = arrow_img.split()[3]
                    alpha = alpha.point(lambda a: int(a * opacity))
                    arrow_img.putalpha(alpha)
                output.paste(arrow_img, (paste_x, paste_y), arrow_img)

        elif el_type == 'text':
            text = el.get('text', '')
            if not text:
                continue
            font_size = int((style.get('fontSize', 14)) * render_scale / dpi)
            font_color = _hex_to_rgba(style.get('color', '#111111'), opacity)
            bg = style.get('background', 'transparent')
            padding = int((style.get('padding', 4)) * render_scale / dpi)

            layer = Image.new('RGBA', (ew, eh), (0, 0, 0, 0))

            if bg and bg != 'transparent':
                bg_draw = ImageDraw.Draw(layer)
                bg_draw.rectangle([0, 0, ew - 1, eh - 1], fill=_hex_to_rgba(bg, opacity))

            draw = ImageDraw.Draw(layer)
            try:
                font = ImageFont.truetype("DejaVuSans.ttf", font_size)
            except (OSError, IOError):
                try:
                    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", font_size)
                except (OSError, IOError):
                    font = ImageFont.load_default()

            text_align = style.get('textAlign', 'left')
            draw.multiline_text(
                (padding, padding),
                text,
                fill=font_color,
                font=font,
                align=text_align,
            )
            output.paste(layer, (ex, ey), layer)

        # group type has no visual rendering in export

    # Convert for output format
    p = Path(output_path).resolve()
    p.parent.mkdir(parents=True, exist_ok=True)

    buf = io.BytesIO()
    if fmt == 'jpg':
        rgb = Image.new('RGB', output.size, (255, 255, 255))
        rgb.paste(output, mask=output.split()[3] if output.mode == 'RGBA' else None)
        rgb.save(buf, 'JPEG', quality=95)
    elif fmt == 'pdf':
        rgb = Image.new('RGB', output.size, (255, 255, 255))
        rgb.paste(output, mask=output.split()[3] if output.mode == 'RGBA' else None)
        rgb.save(buf, 'PDF')
    else:  # png
        output.save(buf, 'PNG')

    raw = buf.getvalue()
    content_hash = hashlib.sha256(raw).hexdigest()
    p.write_bytes(raw)

    logger.info("Rendered export: %s (%d bytes, hash=%s)", p, len(raw), content_hash[:12])
    return {"path": str(p), "size": len(raw), "content_hash": content_hash}
