import re
import unittest
from services.filled_arrow import filled_arrow_path
from services.export_renderer import render_board
from pathlib import Path
from tempfile import TemporaryDirectory


class FilledArrowTest(unittest.TestCase):
    def test_rounded_bends(self):
        path=filled_arrow_path((274,0),(0,100),dict(lineType='step',stepRadius=16))
        self.assertEqual(path.count(' A '),4)
        self.assertIn('A 11.0,11.0',path)
        self.assertIn('A 21.0,21.0',path)
        self.assertIn('L 0,100',path)
        for axis in ['horizontal','vertical']:
            for x in [-200,.01,200]:
                for y in [-100,.01,100]:
                    self.assertNotRegex(filled_arrow_path((0,0),(x,y),dict(lineType='step',stepRadius=200,bendAxis=axis)),r'nan|inf')

    def test_closed_bent_outline(self):
        path = filled_arrow_path((274,0),(0,40),{'lineType':'step'})
        self.assertIn('L 0,40', path)
        self.assertEqual(path.count('M'), 1)
        self.assertTrue(path.endswith(' Z'))
        numbers = list(map(float,re.findall(r'-?\d+(?:\.\d+)?',path)))
        self.assertEqual(numbers[:6], [274,-5,132,-5,132,35])

    def test_degenerate_and_directions(self):
        self.assertEqual(filled_arrow_path((4,4),(4,4)), '')
        for x in [-200,0,.01,200]:
            for y in [-100,0,.01,100]:
                for axis in ['horizontal','vertical']:
                    path=filled_arrow_path((0,0),(x,y),dict(lineType='step',bendAxis=axis))
                    self.assertNotRegex(path, r'nan|inf')

    def test_export_is_one_filled_path(self):
        board={'id':'filled-arrow-test','autoExport':{'format':'svg'},'canvas':{'width':400,'height':200,'background':'white'},'elements':[
            dict(id='filled',type='arrow',x=20,y=20,width=274,height=40,
                 points=[dict(x=274,y=0),dict(x=0,y=40)],
                 style=dict(fill='#dce9ef',strokeColor='#7895a4',strokeWidth=1),
                 metadata=dict(lineType='step',arrowBody='filled'))]}
        with TemporaryDirectory() as tmp:
            target=Path(tmp)/'arrow.svg'
            render_board(board,str(target))
            text=target.read_text()
            self.assertEqual(text.count('fill="#dce9ef"'),1)
            self.assertIn(' Z"',text)


if __name__ == '__main__':
    unittest.main()
