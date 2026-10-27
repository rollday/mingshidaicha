"""Bounded, standard-library parsing for official notice HTML fragments."""

from __future__ import annotations

from html.parser import HTMLParser
import re
from typing import Any


MAX_INPUT_BYTES = 2 * 1024 * 1024
MAX_TEXT_CHARS = 100_000
MAX_TABLES = 20
MAX_ROWS_PER_TABLE = 200
MAX_COLUMNS_PER_TABLE = 20
MAX_CELL_CHARS = 4_000

_DROP_CONTENT = {"head", "script", "style", "noscript", "template", "xml", "svg"}
_BLOCK_TAGS = {"address", "article", "blockquote", "br", "div", "li", "p", "section", "tr"}
_SPACE_TAGS = {"td", "th"}


def _clean_text(value: str) -> str:
    value = value.replace("\xa0", " ").replace("\u200b", "")
    value = re.sub(r"[\t\f\v ]+", " ", value)
    value = re.sub(r" *\n *", "\n", value)
    value = re.sub(r"\n{2,}", "\n", value)
    return value.strip()


class _Table:
    def __init__(self, order: int) -> None:
        self.order = order
        self.rows: list[list[str]] = []
        self.row: list[str | None] | None = None
        self.cell: list[str] | None = None
        self.cursor = 0
        self.colspan = 1
        self.rowspan = 1
        self.carry: dict[int, tuple[str, int]] = {}
        self.cell_size = 0

    def start_row(self) -> None:
        if self.row is not None:
            self.end_row()
        self.row = [None] * MAX_COLUMNS_PER_TABLE
        self.cursor = 0
        next_carry: dict[int, tuple[str, int]] = {}
        for column, (value, remaining) in self.carry.items():
            if column < MAX_COLUMNS_PER_TABLE:
                self.row[column] = value
                if remaining > 1:
                    next_carry[column] = (value, remaining - 1)
        self.carry = next_carry

    def start_cell(self, attrs: list[tuple[str, str | None]]) -> None:
        if self.row is None:
            self.start_row()
        if self.cell is not None:
            self.end_cell()
        values = {key.lower(): value for key, value in attrs}
        self.colspan = self._span(values.get("colspan"), "colspan")
        self.rowspan = self._span(values.get("rowspan"), "rowspan")
        self.cell = []
        self.cell_size = 0

    @staticmethod
    def _span(value: str | None, name: str) -> int:
        if value is None:
            return 1
        try:
            span = int(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"invalid table {name}") from exc
        if span < 1 or span > MAX_COLUMNS_PER_TABLE:
            raise ValueError(f"table exceeds supported column count ({name})")
        return span

    def add_cell_data(self, data: str) -> None:
        if self.cell is not None:
            self.cell.append(data)
            self.cell_size += len(data)
            if self.cell_size > MAX_CELL_CHARS:
                raise ValueError("table cell exceeds supported size")

    def end_cell(self) -> None:
        if self.cell is None:
            return
        value = _clean_text("".join(self.cell))
        assert self.row is not None
        column = self.cursor
        while column < MAX_COLUMNS_PER_TABLE:
            end = column + self.colspan
            if end > MAX_COLUMNS_PER_TABLE:
                raise ValueError("table exceeds supported column count")
            if all(self.row[index] is None for index in range(column, end)):
                break
            column += 1
        if column + self.colspan > MAX_COLUMNS_PER_TABLE:
            raise ValueError("table exceeds supported column count")
        for index in range(column, column + self.colspan):
            self.row[index] = value
            if self.rowspan > 1:
                self.carry[index] = (value, self.rowspan - 1)
        self.cursor = column + self.colspan
        self.cell = None

    def end_row(self) -> None:
        if self.row is None:
            return
        self.end_cell()
        if len(self.rows) >= MAX_ROWS_PER_TABLE:
            raise ValueError("table exceeds supported row count")
        row = [value if value is not None else "" for value in self.row]
        while row and not row[-1]:
            row.pop()
        self.rows.append(row)
        self.row = None


class _OfficialHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.text_parts: list[str] = []
        self.text_size = 0
        self.tables: list[_Table] = []
        self.completed_tables: list[tuple[int, dict[str, Any]]] = []
        self.table_count = 0
        self.drop_stack: list[str] = []

    def _append_text(self, value: str) -> None:
        if not value:
            return
        self.text_size += len(value)
        if self.text_size > MAX_TEXT_CHARS:
            raise ValueError("document text exceeds supported size")
        self.text_parts.append(value)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if self.drop_stack:
            if tag not in {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}:
                self.drop_stack.append(tag)
            return
        # Office's <xml> metadata block and script-like elements are discarded
        # wholesale. Namespaced Word/VML metadata is discarded as well.
        if tag in _DROP_CONTENT or tag.startswith(("w:", "v:")) or tag in {"meta", "link", "title"}:
            if tag not in {"meta", "link"}:
                self.drop_stack.append(tag)
            return
        if tag == "table":
            if self.table_count >= MAX_TABLES:
                raise ValueError("document exceeds supported table count")
            self.tables.append(_Table(self.table_count))
            self.table_count += 1
        elif self.tables:
            table = self.tables[-1]
            if tag == "tr":
                table.start_row()
            elif tag in {"td", "th"}:
                table.start_cell(attrs)
        if tag in _BLOCK_TAGS:
            self._append_text("\n")
            if self.tables:
                self.tables[-1].add_cell_data("\n")
        elif tag in _SPACE_TAGS:
            self._append_text(" ")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        was_dropping = bool(self.drop_stack)
        self.handle_starttag(tag, attrs)
        if was_dropping:
            return
        if self.drop_stack and self.drop_stack[-1] == tag.lower():
            self.drop_stack.pop()
        else:
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if self.drop_stack:
            if tag == self.drop_stack[-1]:
                self.drop_stack.pop()
            return
        if tag == "table":
            if self.tables:
                table = self.tables.pop()
                table.end_row()
                self.completed_tables.append((table.order, {"rows": table.rows}))
        elif self.tables:
            table = self.tables[-1]
            if tag in {"td", "th"}:
                table.end_cell()
            elif tag == "tr":
                table.end_row()
        if tag in _BLOCK_TAGS:
            self._append_text("\n")
            if self.tables:
                self.tables[-1].add_cell_data("\n")
        elif tag in _SPACE_TAGS:
            self._append_text(" ")

    def handle_data(self, data: str) -> None:
        if self.drop_stack:
            return
        self._append_text(data)
        if self.tables:
            self.tables[-1].add_cell_data(data)

    def handle_comment(self, data: str) -> None:
        return

    def close(self) -> None:
        super().close()
        while self.tables:
            table = self.tables.pop()
            table.end_row()
            self.completed_tables.append((table.order, {"rows": table.rows}))


def parse_official_html(payload: Any) -> dict[str, Any]:
    """Parse a ``{"html": ...}`` payload from an official document API.

    The parser never loads external resources or executes markup. It returns
    normalized visible text and bounded table grids, expanding merged cells.
    Invalid payloads, malformed spans, or exceeded resource limits raise
    ``ValueError``.
    """
    if not isinstance(payload, dict):
        raise ValueError("payload must be an object")
    html = payload.get("html")
    if not isinstance(html, str):
        raise ValueError("payload.html must be a string")
    try:
        input_size = len(html.encode("utf-8"))
    except UnicodeEncodeError as exc:
        raise ValueError("payload.html contains invalid Unicode") from exc
    if input_size > MAX_INPUT_BYTES:
        raise ValueError("HTML input exceeds supported size")

    parser = _OfficialHTMLParser()
    try:
        parser.feed(html)
        parser.close()
    except (AssertionError, RecursionError) as exc:
        raise ValueError("invalid HTML structure") from exc
    if sum(len(cell) for _, table in parser.completed_tables for row in table["rows"] for cell in row) > 120_000:
        raise ValueError("expanded table text exceeds supported size")
    return {
        "text": _clean_text("".join(parser.text_parts)),
        "tables": [table for _, table in sorted(parser.completed_tables)],
    }
