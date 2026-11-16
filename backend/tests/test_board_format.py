import copy
from pathlib import Path
import tempfile
import unittest

from services.board_format import dumps_html, loads_html, read_board, write_board


def fixture():
    return {'schema_version': 3, 'id': 'synthetic-board', 'canvas': {'width': 400, 'height': 300},
            'setup': {'code': 'label = "</script><script>alert(1)</script>"'},
            'plotCodes': {'code-1': {'code': 'print("synthetic")'}},
            'elements': [{'id': 'text-1', 'type': 'text', 'x': 10, 'y': 20,
                          'width': 200, 'height': 50, 'rotation': 0, 'z_index': 1,
                          'text': 'A < B & C', 'style': {'fontSize': 14},
                          'metadata': {'future': 'preserved'}}]}


class BoardFormatTests(unittest.TestCase):
    def test_round_trip_and_escape(self):
        board = fixture()
        source = dumps_html(board)
        self.assertNotIn('<script>alert(1)', source)
        self.assertEqual(loads_html(source), board)

    def test_actual_html_edits_are_authoritative(self):
        source = dumps_html(fixture()).replace('left:10.0px', 'left:75px')
        source = source.replace('A &lt; B &amp; C</span>', 'Edited &amp; visible</span>')
        element = loads_html(source)['elements'][0]
        self.assertEqual(element['x'], 75)
        self.assertEqual(element['text'], 'Edited & visible')
        self.assertEqual(element['metadata'], {'future': 'preserved'})

    def test_all_formats_preserve_source(self):
        board = fixture()
        with tempfile.TemporaryDirectory() as root:
            for extension in ('sdraw', 'json', 'html', 'htm'):
                path = Path(root) / f'figure.{extension}'
                write_board(path, board)
                self.assertEqual(read_board(path), board)

    def test_reject_unmarked_page(self):
        with self.assertRaisesRegex(ValueError, 'arbitrary HTML'):
            loads_html('<html><body>Existing research document</body></html>')

    def test_duplicate_ids_rejected(self):
        board = fixture()
        board['elements'].append(copy.deepcopy(board['elements'][0]))
        with self.assertRaisesRegex(ValueError, 'unique'):
            loads_html(dumps_html(board))

    def test_legacy_plot_and_unknown_fields_preserved(self):
        board = fixture()
        board['elements'].append({'id': 'plot-1', 'type': 'plot', 'x': 0, 'y': 0,
                                  'width': 50, 'height': 50, 'rotation': 0, 'z_index': 0,
                                  'metadata': {'plotCodeId': 'code-1', 'figureIndex': 0},
                                  'futureField': {'key': 'value'}})
        self.assertEqual(loads_html(dumps_html(board)), board)


if __name__ == '__main__':
    unittest.main()
