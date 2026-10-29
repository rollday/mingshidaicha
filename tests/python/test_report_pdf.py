import copy
import json
import unittest
from pathlib import Path

import pymupdf as fitz

from python.pdf_tools import PdfError
from python.report_pdf import create_report_pdf


FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "report-pdf-sample.json"


def sample_payload():
    report = json.loads(FIXTURE.read_text(encoding="utf-8"))
    presentations = [
        {"rule_id": "R02", "label": "已命中", "natureLabel": "披露核查", "levelLabel": "披露需核对", "factLabel": "按当前确认信息可判定"},
        {"rule_id": "R04", "label": "信息不足", "natureLabel": "禁止性核查", "levelLabel": "待核实", "factLabel": "待补充必要信息"},
        {"rule_id": "R10", "label": "场景提示", "natureLabel": "阅读提示", "levelLabel": "阅读提示", "factLabel": "按当前确认信息可判定"},
        {"rule_id": "R19", "label": "未命中", "natureLabel": "披露核查", "levelLabel": "", "factLabel": "按当前确认信息可判定"},
    ]
    return {"report": report, "conclusion_label": "披露需核对", "rule_presentations": presentations}


class ReportPdfTests(unittest.TestCase):
    def test_pdf_embeds_uming_and_preserves_chinese_digits_separators_and_report_sections(self):
        pdf = create_report_pdf(sample_payload())
        self.assertTrue(pdf.startswith(b"%PDF-"))
        document = fitz.open(stream=pdf, filetype="pdf")
        text = "\n".join(page.get_text() for page in document)
        self.assertIn("贷款材料核查报告", text)
        self.assertIn("虚构示例金融机构", text)
        self.assertIn("10.60%", text)
        self.assertIn("总成本", text)
        self.assertIn("模拟披露口径核对", text)
        self.assertIn("虚构示例规则说明", text)
        self.assertIn("报告局限", text)
        self.assertIn("不构成法律意见或借贷建议", text)
        self.assertIn("非实际核查结果", text)
        self.assertIn("中文·项目符号•数字12345，百分比12.5%", text)
        self.assertNotIn("身份证号码", text)
        fonts = document[0].get_fonts(full=True)
        embedded = [document.extract_font(font[0]) for font in fonts if font[2] == "TrueType"]
        self.assertTrue(any("UMingCN" in font_name and font_data for font_name, _, _, font_data in embedded))
        document.close()

    def test_long_chinese_content_flows_across_pages_with_page_numbers(self):
        payload = sample_payload()
        report = copy.deepcopy(payload["report"])
        report["narrative"]["limitations"] = [
            f"模拟跨页限制第 {index} 项：本段说明当前材料、确认事实和公开来源存在的演示性限制；不能据此作出法律结论。"
            for index in range(1, 71)
        ] + ["模拟末尾局限标记：本句用于验证最后一页的内容没有被截断。"]
        payload["report"] = report
        pdf = create_report_pdf(payload)
        document = fitz.open(stream=pdf, filetype="pdf")
        self.assertGreater(document.page_count, 1)
        final_page = document[-1].get_text()
        self.assertIn("模拟末尾局限标记", final_page)
        self.assertIn(f"第 {document.page_count} 页", final_page)
        document.close()

    def test_invalid_report_data_is_rejected(self):
        with self.assertRaises(PdfError) as error:
            create_report_pdf({"report": {"title": ""}})
        self.assertEqual(error.exception.code, "INVALID_REPORT")

    def test_assumed_simple_basis_is_clearly_labeled(self):
        payload = sample_payload()
        payload["report"]["calculation"]["calculation"]["comparison"]["method_basis"] = "assumed_simple"
        payload["report"]["calculation"]["calculation"]["comparison"]["method_label"] = "按单利推定"
        document = fitz.open(stream=create_report_pdf(payload), filetype="pdf")
        text = "\n".join(page.get_text() for page in document)
        self.assertIn("按单利推定", text)
        self.assertIn("披露口径待确认", text)
        document.close()


if __name__ == "__main__":
    unittest.main()
