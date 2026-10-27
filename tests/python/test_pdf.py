import tempfile
import unittest
from pathlib import Path

import pymupdf as fitz

from python.pdf_tools import PdfError, parse_pdf


class PdfTests(unittest.TestCase):
    def test_text_and_coordinates_are_extracted(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "loan.pdf"
            doc = fitz.open()
            doc.new_page().insert_text((72, 72), "Principal: 1000; payment: 1100")
            doc.save(path)
            doc.close()
            result = parse_pdf({"path": str(path)})
            self.assertEqual(result["page_count"], 1)
            self.assertFalse(result["needs_vision"])
            self.assertIn("1000", result["pages"][0]["text"])
            self.assertEqual(len(result["pages"][0]["blocks"][0]["bbox"]), 4)

    def test_image_only_page_requires_vision(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "empty.pdf"
            doc = fitz.open()
            doc.new_page()
            doc.save(path)
            doc.close()
            self.assertTrue(parse_pdf({"path": str(path)})["needs_vision"])

    def test_page_limit_and_encryption_are_explicit_errors(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pages.pdf"
            doc = fitz.open()
            doc.new_page()
            doc.new_page()
            doc.save(path)
            with self.assertRaises(PdfError) as error:
                parse_pdf({"path": str(path), "max_pages": 1})
            self.assertEqual(error.exception.code, "PDF_PAGE_LIMIT_EXCEEDED")
            locked = Path(directory) / "encrypted.pdf"
            doc.save(locked, encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw="owner", user_pw="user")
            doc.close()
            with self.assertRaises(PdfError) as error:
                parse_pdf({"path": str(locked)})
            self.assertEqual(error.exception.code, "PDF_ENCRYPTED")

    def test_corrupt_pdf_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.pdf"
            path.write_bytes(b"not a PDF")
            with self.assertRaises(PdfError) as error:
                parse_pdf({"path": str(path)})
            self.assertEqual(error.exception.code, "PDF_OPEN_FAILED")

    def test_rotated_word_boxes_use_the_rendered_page_space(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'rotated.pdf'
            doc = fitz.open()
            page = doc.new_page(width=300, height=200)
            page.insert_text((30,50), 'Principal 10000 yuan')
            page.set_rotation(90)
            doc.save(path); doc.close()
            page = parse_pdf({'path': str(path)})['pages'][0]
            self.assertEqual((page['width'],page['height']), (200,300))
            self.assertEqual(page['rotation'],90)
            word = next(w for w in page['words'] if w['text'] == '10000')
            x0,y0,x1,y1 = word['display_bbox']
            self.assertTrue(0 <= x0 < x1 <= page['width'])
            self.assertTrue(0 <= y0 < y1 <= page['height'])
            self.assertNotEqual(word['bbox'],word['display_bbox'])
