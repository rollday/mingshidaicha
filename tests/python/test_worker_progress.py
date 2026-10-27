import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import pymupdf as fitz

from python.pdf_tools import parse_pdf


ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "python" / "worker.py"


class WorkerProgressTests(unittest.TestCase):
    def make_pdf(self, directory: str, page_count: int = 3) -> Path:
        path = Path(directory) / "multi-page.pdf"
        document = fitz.open()
        for page_number in range(1, page_count + 1):
            document.new_page().insert_text((72, 72), f"Page {page_number} content")
        document.save(path)
        document.close()
        return path

    def run_worker(self, request: dict) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(WORKER)],
            input=json.dumps(request),
            text=True,
            capture_output=True,
            cwd=ROOT,
            check=False,
        )

    def test_parse_pdf_reports_each_completed_page_and_preserves_layout(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.make_pdf(directory)
            events = []
            result_with_progress = parse_pdf({"path": str(path)}, progress=events.append)
            result_without_progress = parse_pdf({"path": str(path)})

        self.assertEqual(events, [
            {"stage": "parse_pdf", "page": 1, "total_pages": 3},
            {"stage": "parse_pdf", "page": 2, "total_pages": 3},
            {"stage": "parse_pdf", "page": 3, "total_pages": 3},
        ])
        self.assertEqual(result_with_progress, result_without_progress)
        self.assertEqual(result_with_progress["page_count"], 3)
        self.assertEqual([page["page"] for page in result_with_progress["pages"]], [1, 2, 3])
        self.assertTrue(all("blocks" in page and "words" in page for page in result_with_progress["pages"]))

    def test_worker_streams_progress_then_unchanged_final_envelope(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.make_pdf(directory)
            completed = self.run_worker({
                "operation": "parse_pdf",
                "payload": {"path": str(path)},
                "stream_progress": True,
            })

        self.assertEqual(completed.returncode, 0)
        lines = completed.stdout.splitlines()
        decoded = [json.loads(line) for line in lines]
        self.assertEqual([item["progress"] for item in decoded[:-1]], [
            {"stage": "parse_pdf", "page": 1, "total_pages": 3},
            {"stage": "parse_pdf", "page": 2, "total_pages": 3},
            {"stage": "parse_pdf", "page": 3, "total_pages": 3},
        ])
        self.assertEqual(set(decoded[-1]), {"ok", "result"})
        self.assertTrue(decoded[-1]["ok"])
        self.assertEqual(decoded[-1]["result"]["page_count"], 3)
        self.assertEqual([page["page"] for page in decoded[-1]["result"]["pages"]], [1, 2, 3])

    def test_worker_without_stream_flag_writes_only_final_envelope(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.make_pdf(directory)
            completed = self.run_worker({"operation": "parse_pdf", "payload": {"path": str(path)}})

        self.assertEqual(completed.returncode, 0)
        self.assertEqual(len(completed.stdout.splitlines()), 1)
        envelope = json.loads(completed.stdout)
        self.assertEqual(set(envelope), {"ok", "result"})
        self.assertTrue(envelope["ok"])
        self.assertEqual(envelope["result"]["page_count"], 3)

    def test_worker_keeps_error_envelope_without_progress(self):
        completed = self.run_worker({
            "operation": "parse_pdf",
            "payload": {"path": "relative.pdf"},
            "stream_progress": True,
        })

        self.assertEqual(completed.returncode, 0)
        self.assertEqual(len(completed.stdout.splitlines()), 1)
        envelope = json.loads(completed.stdout)
        self.assertEqual(envelope, {
            "ok": False,
            "error": {"code": "INVALID_PATH", "message": "path must be an absolute local file path"},
        })


if __name__ == "__main__":
    unittest.main()
