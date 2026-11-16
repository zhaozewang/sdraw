import base64
import unittest
import xml.etree.ElementTree as ET
from services.export_renderer import _math_svg


class EditableMathExportTests(unittest.TestCase):
    def test_math_is_vector_and_changes_with_source(self):
        first = _math_svg('$q_t$', 18, '#334455')
        second = _math_svg('$q_{t+1}$', 18, '#334455')
        self.assertNotEqual(first[2], second[2])
        root = ET.fromstring(base64.b64decode(first[2]))
        self.assertTrue(any(node.tag.endswith('path') for node in root.iter()))
        self.assertFalse(any(node.get('id') == 'patch_1' for node in root.iter()))
        self.assertGreater(first[0], 0)
        self.assertGreater(first[1], 0)

    def test_plain_text_uses_normal_renderer(self):
        self.assertIsNone(_math_svg('Transformer', 18, '#334455'))

    def test_preview_and_export_share_positions_glyphs_and_alignment(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from routers.export import router
        from services.export_renderer import _text_svg
        app = FastAPI()
        app.include_router(router)
        element = dict(type='text', x=25, y=40, width=160, height=90, rotation=30,
                       text='$q_{t+1}$', style=dict(fontSize=23, padding=7,
                       textAlign='right', verticalAlign='center', opacity=.6))
        response = TestClient(app).post('/api/export/text-layout', json=element)
        self.assertEqual(response.status_code, 200)
        preview = response.json()['formula']
        root = ET.fromstring(_text_svg(element))
        exported = root.find('image')
        for field in ('x', 'y', 'width', 'height'):
            self.assertEqual(float(exported.get(field)), preview[field])
        self.assertEqual(exported.get('href'), preview['href'])
        self.assertEqual(preview['x'] + preview['width'], 153)
        self.assertEqual(preview['y'] * 2 + preview['height'], 90)
        self.assertIn('rotate(30 80.0 45.0)', root.get('transform'))
        self.assertEqual(root.get('opacity'), '0.6')

    def test_plain_text_line_spacing_escaping_and_bottom_alignment(self):
        from services.export_renderer import text_layout, _text_svg
        el = dict(x=0, y=0, width=200, height=100, text='A < B\nNext & last',
                  style=dict(fontSize=20, lineHeight=1.6, verticalAlign='bottom',
                             textAlign='center', padding=5, italic=True))
        layout = text_layout(el)
        self.assertEqual(layout['lines'][1]['y'] - layout['lines'][0]['y'], 32)
        self.assertEqual(layout['lines'][0]['y'], 48)
        root = ET.fromstring(_text_svg(el))
        self.assertEqual(root.find('text').get('font-style'), 'italic')
        self.assertEqual(root.find('text').find('tspan').text, 'A < B')

    def test_concurrent_formula_previews_keep_math_glyphs(self):
        from concurrent.futures import ThreadPoolExecutor
        from services.export_renderer import text_layout
        _math_svg.cache_clear()
        expressions = [r'$q_t$', r'$a_t$', r'$g$', r'$\tau$', r'$z_{\tau+\Delta\tau}$']
        def render(index):
            return text_layout(dict(width=100, height=40, text=expressions[index % 5],
                                    style=dict(fontSize=14 + index)))
        with ThreadPoolExecutor(max_workers=12) as executor:
            results = list(executor.map(render, range(30)))
        self.assertTrue(all('formula' in result for result in results))

    def test_wrapping_uses_box_width_padding_and_preserves_source(self):
        from services.export_renderer import text_layout, _text_font, _text_svg
        text = 'Latent autoregressive transformer predicts the next action'
        el = dict(x=0, y=0, width=140, height=150, text=text,
                  style=dict(fontFamily='Arial', fontSize=18, padding=8))
        narrow = text_layout(el)
        lines = [line['text'] for line in narrow['lines']]
        self.assertGreater(len(lines), 1)
        self.assertEqual(' '.join(lines), text)
        self.assertEqual(el['text'], text)
        font = _text_font('Arial', '400', False)
        self.assertTrue(all(font.getlength(line) * 18 / 256 <= 124 for line in lines))
        exported = ET.fromstring(_text_svg(el)).find('text')
        self.assertEqual([span.text for span in exported], lines)
        wider = text_layout(dict(el, width=800))
        self.assertEqual(len(wider['lines']), 1)

    def test_wrapping_long_words_cjk_and_explicit_blank_lines(self):
        from services.export_renderer import text_layout
        for text in ('abcdefghijklmnopqrstuv', '机器人动作状态反馈'):
            el = dict(width=40, height=300, text=text, style=dict(fontSize=18))
            lines = [line['text'] for line in text_layout(el)['lines']]
            self.assertGreater(len(lines), 1)
            self.assertEqual(''.join(lines), text)
        el = dict(width=200, height=200, text='first\n\nlast', style={})
        self.assertEqual([line['text'] for line in text_layout(el)['lines']], ['first', '', 'last'])

    def test_standalone_math_remains_one_formula(self):
        from services.export_renderer import text_layout
        layout = text_layout(dict(width=20, height=40, text=r'$\hat a_{t+1}$', style={}))
        self.assertIn('formula', layout)
        self.assertEqual(layout['lines'], [])
