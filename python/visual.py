"""Bounded rasterization for the configured vision API. No model calls here."""
import base64
import os
import pymupdf
try:
    from .pdf_tools import PdfError
except ImportError:
    from pdf_tools import PdfError


def prepare_visual(payload):
    path = payload.get('path') if isinstance(payload, dict) else None
    if not isinstance(path, str) or not os.path.isabs(path):
        raise PdfError('INVALID_PATH', 'An absolute internal document path is required')
    requested = payload.get('pages')
    limit = payload.get('max_pages', 4)
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 8:
        raise PdfError('INVALID_PAGE_LIMIT', 'Vision supports at most eight pages')
    try:
        doc = pymupdf.open(path)
    except Exception as exc:
        raise PdfError('VISUAL_OPEN_FAILED', 'The image or PDF could not be opened') from exc
    try:
        if doc.needs_pass:
            raise PdfError('PDF_ENCRYPTED', 'Encrypted PDFs are not supported')
        pages = requested if requested is not None else list(range(1, doc.page_count + 1))
        if not isinstance(pages, list) or not pages or len(pages) > limit:
            raise PdfError('VISION_PAGE_LIMIT', 'Too many image pages; split the material or use manual entry')
        images = []
        total_bytes = 0
        for page_number in pages:
            if not isinstance(page_number, int) or isinstance(page_number, bool) or not 1 <= page_number <= doc.page_count:
                raise PdfError('INVALID_PAGE', 'Invalid page number')
            page = doc.load_page(page_number - 1)
            longest = max(page.rect.width, page.rect.height)
            if longest <= 0:
                raise PdfError('INVALID_IMAGE', 'The page has invalid dimensions')
            scale = min(2, 1600 / longest)
            pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
            encoded = pixmap.tobytes('png')
            total_bytes += len(encoded)
            if total_bytes > 8 * 1024 * 1024:
                raise PdfError('VISION_TOO_LARGE', 'Rasterized material is too large')
            images.append({'page': page_number, 'data': base64.b64encode(encoded).decode('ascii')})
        return {'images': images}
    finally:
        doc.close()
