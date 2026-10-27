import tempfile
import unittest
from pathlib import Path
import pymupdf
from python.visual import prepare_visual
from python.pdf_tools import PdfError


class VisualTests(unittest.TestCase):
    def test_rasterizes_a_selected_pdf_page_with_original_page_number(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'test.pdf'
            document = pymupdf.open()
            document.new_page()
            document.new_page().insert_text((40, 40), 'Synthetic 1000')
            document.save(path)
            document.close()
            result = prepare_visual({'path': str(path), 'pages': [2], 'max_pages': 4})
            self.assertEqual(result['images'][0]['page'], 2)
            self.assertTrue(result['images'][0]['data'].startswith('iVBOR'))

    def test_vision_page_limit_is_enforced_before_rendering(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'test.pdf'
            document = pymupdf.open()
            for _ in range(5):
                document.new_page()
            document.save(path)
            document.close()
            with self.assertRaises(PdfError) as error:
                prepare_visual({'path': str(path), 'pages': [1, 2, 3, 4, 5], 'max_pages': 4})
            self.assertEqual(error.exception.code, 'VISION_PAGE_LIMIT')
