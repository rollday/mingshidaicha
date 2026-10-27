"""Local PDF text and layout extraction using PyMuPDF, without OCR or rendering."""

from __future__ import annotations

import os
from typing import Any


class PdfError(Exception):
    def __init__(self, code: str, message: str, details: Any = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details


def parse_pdf(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise PdfError("INVALID_INPUT", "payload must be an object")
    path = payload.get("path")
    if not isinstance(path, str) or not os.path.isabs(path):
        raise PdfError("INVALID_PATH", "path must be an absolute local file path")
    max_pages = payload.get("max_pages", 30)
    if isinstance(max_pages, bool) or not isinstance(max_pages, int) or max_pages < 1:
        raise PdfError("INVALID_PAGE_LIMIT", "max_pages must be a positive integer")
    try:
        import pymupdf as fitz  # type: ignore[import-not-found]
    except ImportError as exc:
        raise PdfError("PDF_DEPENDENCY_MISSING", "PyMuPDF is required for PDF parsing") from exc
    try:
        document = fitz.open(path)
    except Exception as exc:
        raise PdfError("PDF_OPEN_FAILED", "PDF is damaged or could not be opened") from exc
    try:
        if document.needs_pass:
            raise PdfError("PDF_ENCRYPTED", "Encrypted PDFs are not supported")
        page_count = document.page_count
        if page_count > max_pages:
            raise PdfError("PDF_PAGE_LIMIT_EXCEEDED", "PDF exceeds max_pages",
                           {"page_count": page_count, "max_pages": max_pages})
        pages: list[dict[str, Any]] = []
        for page_index in range(page_count):
            page = document.load_page(page_index)
            rect = page.rect
            rotation = page.rotation_matrix
            def display_box(box):
                return [float(v) for v in fitz.Rect(*box) * rotation]
            blocks = []
            for block in page.get_text("blocks"):
                if len(block) < 5:
                    continue
                text = str(block[4]).strip()
                if not text:
                    continue
                blocks.append({"bbox": [float(v) for v in block[:4]], "display_bbox": display_box(block[:4]), "text": text})
            words = [{"bbox": [float(v) for v in word[:4]], "display_bbox": display_box(word[:4]), "text": str(word[4])}
                     for word in page.get_text("words", sort=True)]
            pages.append({"page": page_index + 1, "width": float(rect.width), "height": float(rect.height),
                          "rotation": page.rotation, "text": page.get_text("text"), "blocks": blocks, "words": words})
        return {"page_count": page_count, "pages": pages,
                "needs_vision": any(not p["text"].strip() for p in pages)}
    finally:
        document.close()
