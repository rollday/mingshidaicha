"""One-request JSON stdin/stdout worker for the Python submodule."""

from __future__ import annotations

import json
import sys
from contextlib import redirect_stdout
from typing import Any

try:
    from .calculation import CalculationError, calculate
    from .loan_plan import calculate_loan
    from .pdf_tools import PdfError, parse_pdf
except ImportError:  # Support direct execution from the python directory.
    from calculation import CalculationError, calculate
    from loan_plan import calculate_loan
    from pdf_tools import PdfError, parse_pdf


def _dispatch(request: Any) -> dict[str, Any]:
    if not isinstance(request, dict):
        raise CalculationError("INVALID_REQUEST", "request must be a JSON object")
    operation = request.get("operation")
    payload = request.get("payload")
    if operation == "calculate":
        return calculate(payload)
    if operation == "calculate_loan":
        return calculate_loan(payload)
    if operation == "parse_pdf":
        return parse_pdf(payload)
    if operation == 'prepare_visual':
        from visual import prepare_visual
        return prepare_visual(payload)
    if operation == 'parse_official_html':
        from official_html import parse_official_html
        return parse_official_html(payload)
    raise CalculationError("UNKNOWN_OPERATION", "operation must be 'calculate', 'calculate_loan', or 'parse_pdf'")


def main() -> int:
    try:
        raw = sys.stdin.read()
        request = json.loads(raw, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
        # Third-party libraries must not contaminate the machine-readable stdout channel.
        with redirect_stdout(sys.stderr):
            result = _dispatch(request)
        envelope = {"ok": True, "result": result}
    except (CalculationError, PdfError) as exc:
        error: dict[str, Any] = {"code": exc.code, "message": exc.message}
        if exc.details is not None:
            error["details"] = exc.details
        envelope = {"ok": False, "error": error}
        print(f"{exc.code}: {exc.message}", file=sys.stderr)
    except (json.JSONDecodeError, ValueError) as exc:
        envelope = {"ok": False, "error": {"code": "INVALID_JSON", "message": "stdin must contain one valid JSON request"}}
        print(f"INVALID_JSON: {exc}", file=sys.stderr)
    except Exception as exc:  # Keep stdout protocol-safe even for unexpected runtime errors.
        envelope = {"ok": False, "error": {"code": "INTERNAL_ERROR", "message": "unexpected worker error"}}
        print(f"INTERNAL_ERROR: {type(exc).__name__}: {exc}", file=sys.stderr)
    sys.stdout.write(json.dumps(envelope, ensure_ascii=False, separators=(",", ":")) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
