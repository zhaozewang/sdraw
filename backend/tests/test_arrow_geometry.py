import unittest
import xml.etree.ElementTree as ET
from services.arrow_geometry import marker_inset, trim_arrow_path, rounded_junction_path
from services.export_renderer import _board_to_svg

class ArrowGeometryTests(unittest.TestCase):
    def test_rounded_junction_ports_and_radius(self):
        self.assertEqual(rounded_junction_path(40,24,6),
            'M 20,0 L 20,24 M 20,6 Q 20,12 14,12 L 0,12 M 20,6 Q 20,12 26,12 L 40,12')
        self.assertIn('M 20,24 L 20,0 M 20,18', rounded_junction_path(40,24,6,'up'))
        self.assertIn('M 0,12 L 40,12', rounded_junction_path(40,24,6,'right'))
        self.assertIn('M 40,12 L 0,12', rounded_junction_path(40,24,6,'left'))
        self.assertEqual(rounded_junction_path(40,24,999),rounded_junction_path(40,24,12))
        self.assertEqual(rounded_junction_path(40,24,-1),rounded_junction_path(40,24,0))

    def test_junction_export_and_format_roundtrip(self):
        import tempfile
        from pathlib import Path
        from services.board_format import read_board, write_board
        board={'schema_version':3,'id':'junction-fixture','canvas':{'width':100,'height':100},
               'elements':[{'id':'junction','type':'rectangle','x':10,'y':20,'width':40,'height':24,
                 'rotation':90,'z_index':0,'metadata':{'shape':'rounded-junction','junctionDirection':'up'},
                 'style':{'borderRadius':6,'strokeColor':'#987654','strokeWidth':2,'strokeStyle':'dashed'}}]}
        root=ET.fromstring(_board_to_svg(board,False,1))
        path=root.find('.//{http://www.w3.org/2000/svg}path')
        self.assertEqual(path.attrib['d'], rounded_junction_path(40,24,6,'up'))
        self.assertEqual(path.attrib['transform'],'translate(10 20) rotate(90 20.0 12.0)')
        self.assertEqual(path.attrib['stroke-dasharray'],'8,4')
        self.assertEqual(path.attrib['fill'],'none')
        with tempfile.TemporaryDirectory() as folder:
            for extension in ('html','json','sdraw'):
                target=Path(folder)/f'junction.{extension}'
                write_board(target,board)
                self.assertEqual(read_board(target),board)

    def test_unmarked_and_blunt_endpoints(self):
        for marker in ('none','bar','dot','diamond'):
            self.assertEqual(marker_inset(marker,3),0)
        self.assertEqual(trim_arrow_path('M 0,0 L 100,0',0,0),'M 0,0 L 100,0')

    def test_curve_and_short_segment(self):
        self.assertIn(' Q ',trim_arrow_path('M 0,0 Q 50,80 100,0',0,3))
        self.assertIn(' C ',trim_arrow_path('M 0,0 C 30,80 70,80 100,0',3,3))
        self.assertEqual(trim_arrow_path('M 0,0 L 98,0 L 100,0',0,4),'M 0.0,0.0 L 96.0,0.0')
        self.assertEqual(trim_arrow_path('M 0,0 L 0,0',4,4),'M 0,0 L 0,0')

    def test_export_tip_stays_at_endpoint_shaft_does_not(self):
        board={'canvas':{'width':120,'height':60},'elements':[{
            'id':'test','type':'arrow','x':0,'y':20,'width':100,'height':0,
            'points':[{'x':0,'y':0},{'x':100,'y':0}],
            'style':{'strokeWidth':2},'metadata':{'endMarker':'arrow'}}]}
        root=ET.fromstring(_board_to_svg(board,False,1))
        ns={'s':'http://www.w3.org/2000/svg'}
        path=root.find('.//s:path',ns)
        self.assertAlmostEqual(float(path.attrib['d'].split(' L ')[1].split(',')[0]),96.4)
        head=root.find('.//s:polygon',ns)
        self.assertIn('translate(100,20)',head.attrib['transform'])
        self.assertIn('-12',head.attrib['points'])

    def test_return_curve_is_continuous_and_points_up(self):
        from services.export_renderer import _build_path, _path_tangent_at_end, _path_tangent_at_start
        path = _build_path((975,0),(0,38),'return',[(487,71)])
        self.assertEqual(path.count('M '),1)
        self.assertEqual(path.count('Q '),2)
        self.assertTrue(path.endswith('L 0,38'))
        self.assertEqual(_path_tangent_at_end((975,0),(0,38),'return',[(487,71)]),(0,-1))
        self.assertEqual(_path_tangent_at_start((975,0),(0,38),'return',[(487,71)]),(0,1))
