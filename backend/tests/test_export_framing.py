"""The preview and full editor share the existing serialized export contract."""
import tempfile
import unittest
from pathlib import Path
from xml.etree import ElementTree as ET

from services.board_format import read_board, write_board
from services.export_renderer import _board_to_svg, render_board
from services.svg_source import resolve_svg_source
from tests.test_board_format import fixture


class ExportFramingTests(unittest.TestCase):
    def test_modes_use_content_or_canvas_without_moving_elements(self):
        board = fixture()
        element = dict(board['elements'][0])
        expected = {
            'fit': ([-10, 0, 240, 90], [240, 90]),
            'canvas': ([0, 0, 400, 300], [400, 300]),
            'fixed': ([-10, 0, 240, 90], [800, 600]),
        }
        for mode, (view_box, size) in expected.items():
            with self.subTest(mode=mode):
                board['autoExport'] = {'sizeMode': mode, 'fixedWidth': 800, 'fixedHeight': 600}
                root = ET.fromstring(_board_to_svg(board, False, 1))
                self.assertEqual(list(map(float, root.attrib['viewBox'].split())), view_box)
                self.assertEqual([float(root.attrib[k]) for k in ('width', 'height')], size)
                self.assertEqual(board['elements'][0], element)

    def test_fit_includes_content_outside_canvas_and_ignores_groups(self):
        board = fixture()
        board['elements'][0].update(x=450, y=-100)
        board['elements'].append({'type': 'group', 'x': -10000, 'y': -10000, 'width': 20000, 'height': 20000})
        board['autoExport'] = {'sizeMode': 'fit'}
        root = ET.fromstring(_board_to_svg(board, False, 1))
        self.assertEqual(list(map(float, root.attrib['viewBox'].split())), [430, -120, 240, 90])

    def test_modes_round_trip_and_svg_remains_editable(self):
        with tempfile.TemporaryDirectory() as folder:
            board = fixture()
            path = Path(folder) / 'figure.sdraw'
            svg = path.with_suffix('.svg')
            for mode in ('fit', 'canvas', 'fixed'):
                board['autoExport'] = {
                    'enabled': True, 'sizeMode': mode, 'format': 'svg', 'dpi': 1,
                    'fixedWidth': 800, 'fixedHeight': 600, 'outputPath': str(svg),
                    'sourceBoard': path.name,
                }
                write_board(path, board)
                saved = read_board(path)
                render_board(saved, str(svg))
                self.assertEqual(saved['autoExport'], board['autoExport'])
                self.assertEqual(resolve_svg_source(svg), (path, board['id']))
