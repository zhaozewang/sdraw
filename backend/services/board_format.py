"""Editable HTML boards and legacy JSON share one in-memory board model.

HTML v1 uses positioned articles for geometry, text nodes for text, and JSON
metadata for editor-only properties. Arbitrary web pages are rejected, never
silently rewritten. Scripts in imported documents are never executed.
"""
import base64
import copy
import mimetypes
import html
from html.parser import HTMLParser
import json
import math
from pathlib import Path
import re
import tempfile
import os


TEXT_STYLE = {'color': 'color', 'font-family': 'fontFamily', 'font-weight': 'fontWeight',
              'text-align': 'textAlign', 'background': 'background', 'line-height': 'lineHeight'}


GEOMETRY = {'left': 'x', 'top': 'y', 'width': 'width', 'height': 'height'}


def json_script(value):
    return json.dumps(value, ensure_ascii=False, indent=2).replace('<', '\\u003c')


def pixel(value):
    number = float(str(value).removesuffix('px'))
    if not math.isfinite(number):
        raise ValueError('Board geometry must be finite')
    return number


def image_html(element, directory):
    source = element.get('source') or {}
    data = source.get('embeddedData', '')
    mime = source.get('embeddedMime', 'image/png')
    if data and not data.startswith('data:'):
        data = f'data:{mime};base64,{data}'
    if not data and source.get('path'):
        path = Path(source['path'])
        if not path.is_absolute() and directory is not None:
            path = directory / path
        if path.is_file():
            mime = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
            data = f'data:{mime};base64,' + base64.b64encode(path.read_bytes()).decode()
    if not data:
        return '<span>Image unavailable</span>'
    safe = html.escape(data, quote=True)
    return f'<img alt="" src="{safe}" style="width:100%;height:100%;object-fit:contain">'


def element_html(element, directory=None):
    from services.export_renderer import _board_to_svg

    state = copy.deepcopy(element)
    geometry = ';'.join(f'{css}:{pixel(state.get(key, 0))}px' for css, key in GEOMETRY.items())
    rotation = pixel(state.get('rotation', 0))
    style = f'position:absolute;{geometry};transform:rotate({rotation}deg)'
    style += f';z-index:{int(state.get("z_index", 0))}'
    if not state.get('visible', True) or state.get('hidden', False):
        style += ';display:none'
    if state.get('type') == 'text':
        text_style = state.get('style', {})
        style += f';white-space:pre-wrap;font-size:{pixel(text_style.get("fontSize", 14))}px'
        for css, field in TEXT_STYLE.items():
            if field in text_style:
                style += f';{css}:{text_style[field]}'
        content = '<span data-sdraw-text>' + html.escape(state.get('text', '')) + '</span>'
    elif state.get('type') == 'image':
        content = image_html(state, directory)
    else:
        # SVG is a preview; the element metadata retains editable shape semantics.
        preview = copy.deepcopy(state)
        preview.update(x=0, y=0, rotation=0, visible=True)
        canvas = {'width': max(1, state.get('width', 200)), 'height': max(1, state.get('height', 200))}
        content = _board_to_svg({'elements': [preview], 'canvas': canvas,
                                 'autoExport': {'sizeMode': 'canvas'}}, True, 1)
    attrs = html.escape(json.dumps(state, ensure_ascii=False), quote=True)
    return f'<article data-sdraw-element="{attrs}" style="{html.escape(style, quote=True)}">{content}</article>'


def dumps_html(board, directory=None):
    header = copy.deepcopy(board)
    elements = header.pop('elements', [])
    canvas = header.get('canvas', {})
    width = pixel(canvas.get('width', 2400))
    height = pixel(canvas.get('height', 1600))
    background = html.escape(str(canvas.get('background', '#ffffff')), quote=True)
    articles = '\n'.join(element_html(element, directory) for element in elements)
    return (
        '<!doctype html>\n<html><head><meta charset="utf-8">'
        '<meta name="sdraw-format" content="1"><title>sdraw board</title></head>\n'
        '<body style="margin:0">\n'
        f'<script id="sdraw-board" type="application/json">{json_script(header)}</script>\n'
        f'<main style="position:relative;width:{width}px;height:{height}px;background:{background}">\n'
        f'{articles}\n</main></body></html>\n'
    )


class BoardParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.header = []
        self.elements = []
        self.in_header = False
        self.in_text = False
        self.current = None
        self.text = []
        self.version = None

    def handle_starttag(self, tag, pairs):
        attrs = dict(pairs)
        if tag == 'meta' and attrs.get('name') == 'sdraw-format':
            self.version = attrs.get('content')
        if tag == 'script' and attrs.get('id') == 'sdraw-board':
            if self.header:
                raise ValueError('Duplicate board metadata')
            self.in_header = True
        if tag == 'article' and 'data-sdraw-element' in attrs:
            self.current = json.loads(attrs['data-sdraw-element'])
            self.apply_style(attrs.get('style', ''))
            self.elements.append(self.current)
        if tag == 'span' and 'data-sdraw-text' in attrs:
            self.in_text = True
            self.text = []

    def apply_style(self, source):
        styles = dict(part.split(':', 1) for part in source.split(';') if ':' in part)
        styles = {key.strip(): value.strip() for key, value in styles.items()}
        for css, field in GEOMETRY.items():
            if css in styles:
                self.current[field] = pixel(styles[css])
        rotation = re.fullmatch(r'rotate\(([-+.\d]+)deg\)', styles.get('transform', ''))
        if rotation:
            self.current['rotation'] = pixel(rotation[1])
        if 'z-index' in styles:
            self.current['z_index'] = int(styles['z-index'])
        if self.current.get('type') == 'text' and 'font-size' in styles:
            self.current.setdefault('style', {})['fontSize'] = pixel(styles['font-size'])
        if self.current.get('type') == 'text':
            for css, field in TEXT_STYLE.items():
                if css in styles:
                    value = styles[css]
                    if isinstance(self.current.get('style', {}).get(field), (int, float)):
                        value = pixel(value)
                    self.current.setdefault('style', {})[field] = value

    def handle_data(self, data):
        if self.in_header:
            self.header.append(data)
        if self.in_text:
            self.text.append(data)

    def handle_endtag(self, tag):
        if tag == 'script':
            self.in_header = False
        if tag == 'span' and self.in_text:
            if self.current is None:
                raise ValueError('Text outside a board element')
            self.current['text'] = ''.join(self.text)
            self.in_text = False
        if tag == 'article':
            self.current = None


def loads_html(source):
    parser = BoardParser()
    parser.feed(source)
    if parser.version != '1' or not parser.header:
        raise ValueError('Expected sdraw HTML v1; arbitrary HTML pages are not supported')
    board = json.loads(''.join(parser.header))
    board['elements'] = parser.elements
    ids = [element.get('id') for element in parser.elements]
    if None in ids or len(ids) != len(set(ids)):
        raise ValueError('Every element needs a unique stable id')
    return board


def read_board(path):
    path = Path(path)
    source = path.read_text(encoding='utf-8')
    board = loads_html(source) if path.suffix.lower() in {'.html', '.htm'} else json.loads(source)
    if not isinstance(board, dict) or not isinstance(board.get('elements'), list):
        raise ValueError('Expected a board object with an elements list')
    return board


def write_board(path, board):
    path = Path(path)
    if path.suffix.lower() in {'.html', '.htm'}:
        payload = dumps_html(board, path.parent)
    else:
        payload = json.dumps(board, ensure_ascii=False, indent=2)
    # Readers never see half a document during autosave.
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(payload)
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return len(payload.encode('utf-8'))
