import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pymupdf as fitz

from python.pdf_tools import PdfError
from python.report_pdf import _find_font, _register_fonts, create_report_pdf


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
    def test_font_selection_prefers_system_then_user_and_reports_missing(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            system = home / "system" / "uming.ttc"
            user = home / ".local/share/fonts/arphic/uming.ttc"
            self.assertIsNone(_find_font(system, home))
            user.parent.mkdir(parents=True)
            user.touch()
            self.assertEqual(_find_font(system, home), user)
            system.parent.mkdir()
            system.touch()
            self.assertEqual(_find_font(system, home), system)

    def test_missing_and_invalid_font_errors_are_preserved(self):
        with patch("python.report_pdf._FONTS_READY", False), patch("python.report_pdf._find_font", return_value=None):
            with self.assertRaises(PdfError) as error:
                _register_fonts()
            self.assertEqual(error.exception.code, "PDF_FONT_MISSING")
            self.assertIn("scripts/setup-pdf-font.sh", str(error.exception))
        with tempfile.TemporaryDirectory() as directory:
            invalid_font = Path(directory) / "uming.ttc"
            invalid_font.write_bytes(b"not a font")
            with patch("python.report_pdf._FONTS_READY", False), patch("python.report_pdf._find_font", return_value=invalid_font):
                with self.assertRaises(PdfError) as error:
                    _register_fonts()
                self.assertEqual(error.exception.code, "PDF_FONT_INVALID")

    def test_pdf_embeds_uming_and_preserves_chinese_digits_separators_and_report_sections(self):
        pdf = create_report_pdf(sample_payload())
        self.assertTrue(pdf.startswith(b"%PDF-"))
        document = fitz.open(stream=pdf, filetype="pdf")
        text = "\n".join(page.get_text() for page in document)
        self.assertIn("贷款材料核查报告", text)
        self.assertIn("生成时间：2026-10-29 09:00", text)
        self.assertNotIn("2026-10-29T09:00", text)
        self.assertIn("核查概要", text)
        self.assertIn("用于测试生成的虚构报告", text)
        self.assertIn("虚构示例金融机构", text)
        self.assertIn("10.60%", text)
        self.assertIn("借款成本", text)
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

    def test_fee_prefills_preserve_initial_reason_evidence_and_current_changes(self):
        payload = sample_payload()
        report = payload["report"]
        fee = report["facts"]["fees"][0]
        fee.update({"included_in_cashflows": False, "contingent": False})
        report["fee_prefills"] = [{
            "fee_id": fee["id"], "field": "fees[0].included_in_cashflows", "value": True,
            "treatment": "in_period_payment", "rule_id": "fee-included-explicit",
            "reason": "管理费明确包含在每期还款总额中。", "evidence_ids": ["prefill-original"],
        }, {
            "fee_id": "deleted-fee", "field": "fees[1].included_in_cashflows", "value": False,
            "treatment": "separate_charge", "rule_id": "separate-explicit",
            "reason": "该费用需要另行支付。", "evidence_ids": [],
        }]
        report["evidence"].append({"id": "prefill-original", "document_id": "contract", "page": 3,
                                   "quote": "每期还款金额含管理费。<script>原文标签</script>"})
        report["corrections"].append({"field": "fees[0].included_in_cashflows", "fee_id": fee["id"],
                                      "fee_name": fee["name"], "before": True, "after": False})
        document = fitz.open(stream=create_report_pdf(payload), filetype="pdf")
        text = "\n".join(page.get_text() for page in document)
        self.assertIn("初始预填依据", text)
        self.assertIn("管理费明确包含在每期还款总额中", text)
        self.assertIn("每期还款金额含管理费", text)
        self.assertIn("<script>原文标签</script>", text)
        self.assertIn("预填后已修改", text)
        self.assertIn("预填后费用已删除", text)
        self.assertIn("当前计入方式：另计入现金流", text)
        self.assertNotIn("已计入现金流：", text)
        self.assertIn("是 → 否", text)
        document.close()

    def test_unchanged_fee_prefill_displays_initial_disbursement_treatment(self):
        payload = sample_payload()
        fee = payload["report"]["facts"]["fees"][0]
        fee.update({"included_in_cashflows": True, "contingent": False, "timing": "upfront"})
        payload["report"]["fee_prefills"] = [{
            "fee_id": fee["id"], "field": "fees[9].included_in_cashflows", "value": True,
            "treatment": "deducted_from_disbursement", "rule_id": "net-disbursement",
            "reason": "原始到账净额已扣除服务费。", "evidence_ids": [],
        }]
        document = fitz.open(stream=create_report_pdf(payload), filetype="pdf")
        text = "\n".join(page.get_text() for page in document)
        self.assertIn("按原文预填", text)
        self.assertIn("已在到账净额中扣除（不重复扣款）", text)
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

    def test_ai_success_is_labeled_as_ai_summary(self):
        payload = sample_payload()
        payload["report"]["generation"] = {"mode": "ai", "error_code": None}
        document = fitz.open(stream=create_report_pdf(payload), filetype="pdf")
        first_page = document[0].get_text()
        self.assertIn("AI 概要", first_page)
        self.assertIn("生成方式：AI 撰写", first_page)
        document.close()

    def test_first_page_highlights_comparison_cost_and_actions_without_conflating_fees(self):
        document = fitz.open(stream=create_report_pdf(sample_payload()), filetype="pdf")
        first_page = document[0].get_text()
        self.assertIn("10.60%", first_page)
        self.assertIn("核心数字", first_page)
        self.assertIn("预计实际支付", first_page)
        self.assertIn("还款计划合计", first_page)
        self.assertIn("另付费用单列", first_page)
        self.assertIn("预计实际支付", first_page)
        self.assertIn("10,880.00", first_page)
        self.assertIn("先做什么", first_page)
        self.assertIn("核对模拟披露方式与还款计划", first_page)
        full_text = "\n".join(page.get_text() for page in document)
        self.assertIn("信息不足不等于已发现问题", full_text)
        self.assertIn("另有未命中 1 项、不适用 0 项，未逐项展开", full_text)
        self.assertNotIn("模拟未命中项目", full_text)
        self.assertIn("表格栏目齐全", full_text)
        self.assertNotIn("错误代码", full_text)
        document.close()

    def test_short_actions_keep_their_rule_reference_on_the_same_page(self):
        payload = sample_payload()
        payload["report"]["narrative"]["actions"] = [
            {"rule_id": "R02", "text": f"模拟核实动作编号{index:02d}。"}
            for index in range(1, 26)
        ]
        document = fitz.open(stream=create_report_pdf(payload), filetype="pdf")
        page_texts = [page.get_text() for page in document]
        for index in range(1, 26):
            marker = f"模拟核实动作编号{index:02d}。"
            page = next(text for text in page_texts if marker in text)
            self.assertIn("对应依据：R02", page.split(marker, 1)[1])
        document.close()


if __name__ == "__main__":
    unittest.main()
