import unittest
from services.arrow_geometry import return_arrow_path
from services.export_renderer import _build_path, _path_tangent_at_start, _path_tangent_at_end

class ReturnDirectionTests(unittest.TestCase):
    def test_right_rail(self):
        p0,p1,c=(600,170),(600,280),[(650,225)]
        path=_build_path(p0,p1,'return',c,'right')
        self.assertEqual(path,'M 600,170 L 634,170 Q 650,170 650,186 L 650,264 Q 650,280 634,280 L 600,280')
        self.assertEqual(_path_tangent_at_start(p0,p1,'return',c,'right'),(1,0))
        self.assertEqual(_path_tangent_at_end(p0,p1,'return',c,'right'),(-1,0))

    def test_left_and_up(self):
        self.assertIn('L 440,186',return_arrow_path((480,280),(480,170),(440,225),'left'))
        self.assertEqual(_path_tangent_at_end((0,0),(1,1),'return',[],'left'),(1,0))
        self.assertEqual(_path_tangent_at_end((0,0),(1,1),'return',[],'up'),(0,1))
        self.assertIn('L 16,-50',return_arrow_path((100,0),(0,0),(50,-50),'up'))
