import copy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from routers.boards import router
from services.export_renderer import render_board
from services.svg_source import attach_svg_source, resolve_svg_source
from services.board_format import write_board
from tests.test_board_format import fixture

class SvgSourceTests(unittest.TestCase):
    def test_vector_export_opens_original_board_and_save_preserves_svg(self):
        app=FastAPI();app.include_router(router)
        with tempfile.TemporaryDirectory() as folder, patch('services.board_cache.CACHE_ROOT',Path(folder)/'cache'):
            p=Path(folder);board=fixture();board['autoExport']={'format':'svg','sizeMode':'canvas','sourceBoard':'figure.sdraw'}
            write_board(p/'figure.sdraw',board)
            with patch('cairosvg.svg2png',side_effect=AssertionError('SVG must not rasterize')):
                render_board(board,str(p/'figure.svg'))
            raw=(p/'figure.svg').read_text();self.assertIn('<svg',raw)
            client=TestClient(app);r=client.post('/api/boards/open',json={'path':str(p/'figure.svg')});self.assertEqual(r.status_code,200,r.text)
            loaded=r.json();self.assertEqual(loaded['path'],str(p/'figure.sdraw'));self.assertEqual(loaded['board']['elements'],board['elements'])
            loaded['board']['elements'][0]['text']='Changed in source canvas'
            self.assertEqual(client.post('/api/boards/save',json={'path':loaded['path'],'board':loaded['board']}).status_code,200)
            self.assertEqual((p/'figure.svg').read_text(),raw)
            render_board(loaded['board'],str(p/'figure.svg'))
            self.assertIn('Changed in source canvas',(p/'figure.svg').read_text())
    def test_missing_source_and_mismatched_id_are_explicit_errors(self):
        app=FastAPI();app.include_router(router);client=TestClient(app)
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder);s=p/'figure.svg';base='<svg xmlns="http://www.w3.org/2000/svg"/>'
            s.write_text(base);self.assertEqual(client.post('/api/boards/open',json={'path':str(s)}).status_code,400)
            board=fixture();s.write_text(attach_svg_source(base,s,board));self.assertEqual(client.post('/api/boards/open',json={'path':str(s)}).status_code,400)
            other=copy.deepcopy(board);other['id']='different';write_board(p/'figure.sdraw',other)
            self.assertEqual(client.post('/api/boards/open',json={'path':str(s)}).status_code,400)
    def test_source_must_be_adjacent_and_no_entities(self):
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)/'a.svg';board=fixture();board['autoExport']={'sourceBoard':'../other.sdraw'}
            with self.assertRaises(ValueError):attach_svg_source('<svg xmlns="http://www.w3.org/2000/svg"/>',p,board)
            p.write_text('<!DOCTYPE svg [<!ENTITY a "foo">]><svg xmlns="http://www.w3.org/2000/svg"/>')
            with self.assertRaises(ValueError):resolve_svg_source(p)
