import unittest

from python.official_html import parse_official_html


class OfficialHTMLTests(unittest.TestCase):
    def test_extracts_visible_chinese_text_and_skips_non_document_markup(self):
        html = """<!doctype html><html><head><title>标题</title>
        <style>body { display: none }</style></head><body>
        <!-- ignored comment --><p>行政处罚决定书</p>
        <script>alert('不应执行或提取')</script>
        <xml><o:metadata>Office metadata</o:metadata></xml>
        <p>罚款金额：50&nbsp;万元。</p></body></html>"""

        result = parse_official_html({"html": html})

        self.assertEqual(result["text"], "行政处罚决定书\n罚款金额：50 万元。")
        self.assertEqual(result["tables"], [])

    def test_tables_expand_rowspan_and_colspan_for_multiple_entities(self):
        html = """<table>
        <tr><th rowspan="2">序号</th><th colspan="2">被处罚主体</th></tr>
        <tr><th>名称</th><th>罚款金额</th></tr>
        <tr><td rowspan="2">1</td><td>甲银行</td><td>50万元</td></tr>
        <tr><td>乙银行</td><td>30万元</td></tr>
        </table>"""

        table = parse_official_html({"html": html})["tables"][0]

        self.assertEqual(table["rows"], [
            ["序号", "被处罚主体", "被处罚主体"],
            ["序号", "名称", "罚款金额"],
            ["1", "甲银行", "50万元"],
            ["1", "乙银行", "30万元"],
        ])

    def test_malformed_html_is_recovered_and_nested_table_text_is_not_duplicated(self):
        result = parse_official_html({
            "html": "<p>决定内容<table><tr><td>外层<table><tr><td>内层金额</td></tr></table></td></tr>"
        })

        self.assertIn("决定内容", result["text"])
        self.assertEqual(result["text"].count("内层金额"), 1)
        self.assertEqual(len(result["tables"]), 2)
        self.assertEqual(result["tables"][0]["rows"], [["外层"]])
        self.assertEqual(result["tables"][1]["rows"], [["内层金额"]])

    def test_rejects_invalid_payloads_and_excessive_input_or_content(self):
        for payload in (None, [], {"html": None}):
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                parse_official_html(payload)
        with self.assertRaises(ValueError):
            parse_official_html({"html": "x" * (2 * 1024 * 1024 + 1)})
        with self.assertRaises(ValueError):
            parse_official_html({"html": "<p>" + "字" * 100_001 + "</p>"})

    def test_preserves_paragraph_boundaries_inside_cells_and_bounds_expanded_text(self):
        result = parse_official_html({"html": "<table><tr><td><p>违规事项甲</p><p>违规事项乙<br>50万元</p></td></tr></table>"})
        self.assertEqual(result["tables"][0]["rows"][0][0], "违规事项甲\n违规事项乙\n50万元")
        with self.assertRaisesRegex(ValueError, "expanded table text"):
            parse_official_html({"html": "<table>" + ("<tr><td colspan='20'>" + "字" * 3_100 + "</td></tr>") * 2 + "</table>"})

    def test_rejects_table_resource_limit_and_invalid_spans(self):
        with self.assertRaisesRegex(ValueError, "table count"):
            parse_official_html({"html": "<table></table>" * 21})
        with self.assertRaisesRegex(ValueError, "row count"):
            parse_official_html({"html": "<table>" + "<tr><td>x</td></tr>" * 201 + "</table>"})
        with self.assertRaisesRegex(ValueError, "column count"):
            parse_official_html({"html": "<table><tr><td colspan='21'>x</td></tr></table>"})
        with self.assertRaisesRegex(ValueError, "cell"):
            parse_official_html({"html": "<table><tr><td>" + "字" * 4_001 + "</td></tr></table>"})
        with self.assertRaisesRegex(ValueError, "invalid table rowspan"):
            parse_official_html({"html": "<table><tr><td rowspan='nope'>x</td></tr></table>"})


if __name__ == "__main__":
    unittest.main()
