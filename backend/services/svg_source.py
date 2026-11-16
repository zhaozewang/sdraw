"""Link a published SVG to an adjacent editable board; never import SVG as code."""
import json
from pathlib import Path
import xml.etree.ElementTree as ET

SVG = 'http://www.w3.org/2000/svg'

def _tree(text):
    if '<!DOCTYPE' in text.upper() or '<!ENTITY' in text.upper():
        raise ValueError('SVG declarations/entities are not supported')
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise ValueError('Invalid SVG') from exc
    if root.tag != '{' + SVG + '}svg':
        raise ValueError('Not an SVG document')
    return root

def _adjacent(svg_path, name):
    if not isinstance(name, str) or Path(name).name != name or '\\' in name:
        raise ValueError('SVG source must name an adjacent board file')
    if Path(name).suffix.lower() not in ('.sdraw', '.json', '.html', '.htm'):
        raise ValueError('Unsupported SVG source board format')
    target = (svg_path.parent / name).resolve()
    if target.parent != svg_path.parent.resolve():
        raise ValueError('SVG source must remain beside the figure')
    return target

def resolve_svg_source(path):
    root = _tree(path.read_text())
    node = root.find("{" + SVG + "}metadata[@id='sdraw-source']")
    if node is None:
        raise ValueError('This SVG has no editable sDraw source; arbitrary SVG import is not supported')
    try:
        source = json.loads(node.text or '')
    except json.JSONDecodeError as exc:
        raise ValueError('Invalid sDraw source metadata') from exc
    if not isinstance(source, dict) or source.get('version') != 1 or not source.get('board_id'):
        raise ValueError('Unsupported sDraw source metadata')
    target = _adjacent(path, source.get('board'))
    if not target.is_file():
        raise ValueError('The editable source board is missing')
    return target, source['board_id']

def attach_svg_source(svg, output_path, board):
    """The export references the source board; it does not duplicate its state."""
    root = _tree(svg)
    name = board.get('autoExport', {}).get('sourceBoard', Path(output_path).with_suffix('.sdraw').name)
    _adjacent(Path(output_path), name)
    node = root.find("{" + SVG + "}metadata[@id='sdraw-source']")
    if node is None:
        node = ET.SubElement(root, '{' + SVG + '}metadata', {'id': 'sdraw-source'})
    node.text = json.dumps({'version': 1, 'board': name, 'board_id': board['id']})
    ET.register_namespace('', SVG)
    return ET.tostring(root, encoding='unicode')
