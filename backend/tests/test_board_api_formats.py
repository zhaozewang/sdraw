import copy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from routers.boards import router
from tests.test_board_format import fixture


class BoardApiTests(unittest.TestCase):
    def test_open_save_delta_summary_digest_all_formats(self):
        app = FastAPI()
        app.include_router(router)
        with tempfile.TemporaryDirectory() as root, patch('services.board_cache.CACHE_ROOT', Path(root) / 'cache'):
            client = TestClient(app)
            for extension in ('sdraw', 'json', 'html'):
                path = str(Path(root) / ('figure.' + extension))
                board = fixture()
                response = client.post('/api/boards/save', json={'path': path, 'board': board})
                self.assertEqual(response.status_code, 200, response.text)
                loaded = client.post('/api/boards/open', json={'path': path})
                self.assertEqual(loaded.status_code, 200, loaded.text)
                self.assertEqual(loaded.json()['board']['elements'], board['elements'])
                changed = copy.deepcopy(board['elements'][0])
                changed['text'] = 'saved from editor'
                response = client.post('/api/boards/save-delta', json={
                    'path': path, 'board_id': board['id'], 'updated_at': 'synthetic',
                    'dirty_elements': [changed]})
                self.assertEqual(response.status_code, 200, response.text)
                loaded = client.post('/api/boards/open', json={'path': path}).json()['board']
                self.assertEqual(loaded['elements'][0]['text'], 'saved from editor')
                for endpoint in ('summary', 'digest'):
                    response = client.post('/api/boards/' + endpoint, json={'path': path})
                    self.assertEqual(response.status_code, 200, response.text)

    def test_unrelated_html_is_not_overwritten_by_delta(self):
        app = FastAPI()
        app.include_router(router)
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'research.html'
            original = '<html><p>Research</p></html>'
            path.write_text(original)
            response = TestClient(app).post('/api/boards/save-delta', json={
                'path': str(path), 'board_id': 'unknown', 'updated_at': 'synthetic'})
            self.assertEqual(response.status_code, 400)
            self.assertEqual(path.read_text(), original)
