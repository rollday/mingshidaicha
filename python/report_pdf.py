"""Render the existing structured audit report as a Chinese PDF in memory."""

from __future__ import annotations

import base64
import io
import json
import re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.units import mm
from reportlab.platypus import HRFlowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

try:
    from .pdf_tools import PdfError
except ImportError:  # Support direct execution from the python directory.
    from pdf_tools import PdfError


_FONT_PATH = Path("/usr/share/fonts/truetype/arphic/uming.ttc")
_REGULAR = "Arphic-UMing"
_BOLD = _REGULAR
_FONTS_READY = False
_INK = colors.HexColor("#20334A")
_MUTED = colors.HexColor("#5D6B7C")
_LINE = colors.HexColor("#D9E1E9")
_PALE = colors.HexColor("#F3F6F9")
_BLUE = colors.HexColor("#285F91")

_METHODS = {
    "nominal": "名义年化",
    "effective": "复利年化",
    "simple": "到期单利年化",
    "xirr": "按实际日期年化",
    "unknown": "口径待确认",
}
_LENDER_TYPES = {
    "bank": "银行",
    "consumer_finance": "消费金融公司",
    "microloan": "小额贷款公司",
    "platform": "平台",
    "other": "其他",
    "unknown": "类型待确认",
}
_REPAY_METHODS = {
    "equal_installment": "等额本息",
    "equal_principal": "等额本金",
    "interest_only": "先息后本",
    "bullet": "到期一次还本付息",
    "schedule": "按还款计划",
    "unknown": "方式待确认",
}
_FEE_TIMING = {
    "upfront": "放款前/放款时",
    "per_period": "每期",
    "at_maturity": "到期时",
    "specific_period": "指定期次",
    "unknown": "时间待确认",
}
_PAYEE_TYPES = {
    "lender": "放贷方",
    "platform": "平台",
    "guarantor": "担保方",
    "other": "其他主体",
    "unknown": "主体待确认",
}
_RULE_NATURE = {"prohibited": "禁止性核查", "disclosure": "披露核查", "advisory": "阅读提示"}
_RULE_STATUS = {
    "triggered": "已命中",
    "not_triggered": "未命中",
    "insufficient_data": "信息不足",
    "not_applicable": "不适用",
}
_SOURCE_CATEGORIES = {
    "license": "许可与持牌名单线索",
    "registry": "企业登记公开页面",
    "penalty": "监管处罚公开页面",
}
_SOURCE_STATUS = {
    "sources_found": "检索到公开页面",
    "no_indexed_results": "未检索到相关索引页面",
    "unavailable": "本次检索未完成",
}


def _register_fonts() -> None:
    global _FONTS_READY
    if _FONTS_READY:
        return
    if not _FONT_PATH.is_file():
        raise PdfError("PDF_FONT_MISSING", "缺少简体中文 TrueType 字体，请安装 fonts-arphic-uming。")
    try:
        pdfmetrics.registerFont(TTFont(_REGULAR, str(_FONT_PATH)))
        pdfmetrics.registerFontFamily(_REGULAR, normal=_REGULAR, bold=_BOLD, italic=_REGULAR, boldItalic=_BOLD)
        _FONTS_READY = True
    except Exception as exc:
        raise PdfError("PDF_FONT_INVALID", "简体中文 TrueType 字体无法由 ReportLab 载入。") from exc


def _plain(value: Any, fallback: str = "待确认", maximum: int = 12000) -> str:
    if value is None:
        return fallback
    if isinstance(value, bool):
        text = "是" if value else "否"
    elif isinstance(value, (dict, list)):
        text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    else:
        text = str(value)
    text = "".join(character for character in text if character in "\n\t" or ord(character) >= 32)
    if len(text) > maximum:
        return text[:maximum] + "……（内容已截断）"
    return text or fallback


def _paragraph(value: Any, style: ParagraphStyle, fallback: str = "待确认", maximum: int = 12000) -> Paragraph:
    safe = escape(_plain(value, fallback=fallback, maximum=maximum)).replace("\n", "<br/>")
    return Paragraph(safe, style)


def _number(value: Any) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    text = _plain(value, fallback="", maximum=100).strip()
    if not re.fullmatch(r"-?\d+(?:\.\d+)?", text):
        return None
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def _formatted_number(value: Any, places: int = 2, shift: int = 0) -> str:
    number = _number(value)
    if number is None:
        return "待确认"
    quantum = Decimal(1).scaleb(-places)
    try:
        rounded = (number * (Decimal(10) ** shift)).quantize(quantum, rounding=ROUND_HALF_UP)
        return f"{rounded:,.{places}f}"
    except (InvalidOperation, OverflowError):
        return "待确认"


def _money(value: Any) -> str:
    return "待确认" if value is None else _formatted_number(value) + " 元"


def _percent(value: Any) -> str:
    return "待确认" if value is None else _formatted_number(value, shift=2) + "%"


def _points(value: Any) -> str:
    return "待确认" if value is None else _formatted_number(value) + " 个百分点"


def _tri(value: Any) -> str:
    return "是" if value is True else "否" if value is False else "待确认"


def _styles() -> dict[str, ParagraphStyle]:
    return {
        "title": ParagraphStyle("ReportTitle", fontName=_BOLD, fontSize=21, leading=28, textColor=_INK, spaceAfter=5, wordWrap="CJK"),
        "subtitle": ParagraphStyle("ReportSubtitle", fontName=_REGULAR, fontSize=8.5, leading=12, textColor=_MUTED, spaceAfter=9, wordWrap="CJK"),
        "section": ParagraphStyle("ReportSection", fontName=_BOLD, fontSize=12.5, leading=17, textColor=_INK, spaceBefore=8, spaceAfter=5, keepWithNext=1, wordWrap="CJK"),
        "subsection": ParagraphStyle("ReportSubsection", fontName=_BOLD, fontSize=10.2, leading=14, textColor=_INK, spaceBefore=5, spaceAfter=3, keepWithNext=1, wordWrap="CJK"),
        "body": ParagraphStyle("ReportBody", fontName=_REGULAR, fontSize=9, leading=13.5, textColor=_INK, spaceAfter=4, wordWrap="CJK", splitLongWords=1),
        "small": ParagraphStyle("ReportSmall", fontName=_REGULAR, fontSize=7.8, leading=11, textColor=_MUTED, spaceAfter=3, wordWrap="CJK", splitLongWords=1),
        "label": ParagraphStyle("ReportLabel", fontName=_BOLD, fontSize=8.5, leading=12, textColor=_MUTED, wordWrap="CJK"),
        "value": ParagraphStyle("ReportValue", fontName=_REGULAR, fontSize=8.5, leading=12, textColor=_INK, wordWrap="CJK", splitLongWords=1),
        "table_header": ParagraphStyle("ReportTableHeader", fontName=_BOLD, fontSize=7.6, leading=10, textColor=colors.white, wordWrap="CJK"),
        "callout": ParagraphStyle("ReportCallout", fontName=_REGULAR, fontSize=9, leading=14, textColor=_INK, spaceAfter=2, wordWrap="CJK", splitLongWords=1),
    }


def _section(story: list[Any], title: str, styles: dict[str, ParagraphStyle]) -> None:
    story.extend([
        Spacer(1, 4),
        _paragraph(title, styles["section"]),
        HRFlowable(width="100%", thickness=0.7, color=_LINE, spaceBefore=0, spaceAfter=7),
    ])


def _label_table(rows: list[tuple[str, str]], styles: dict[str, ParagraphStyle], width: float) -> Table:
    cells = [[_paragraph(label, styles["label"]), _paragraph(value, styles["value"])] for label, value in rows]
    table = Table(cells, colWidths=[31 * mm, width - 31 * mm], hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), _PALE),
        ("GRID", (0, 0), (-1, -1), 0.35, _LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return table


def _data_table(headers: list[str], rows: list[list[Any]], widths: list[float], styles: dict[str, ParagraphStyle], *, repeat: bool = True) -> Table:
    matrix = [[_paragraph(header, styles["table_header"]) for header in headers]]
    for row in rows:
        matrix.append([cell if isinstance(cell, Paragraph) else _paragraph(cell, styles["value"]) for cell in row])
    table = Table(matrix, colWidths=widths, repeatRows=1 if repeat else 0, hAlign="LEFT", splitByRow=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), _BLUE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, _PALE]),
        ("GRID", (0, 0), (-1, -1), 0.35, _LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return table


def _method(value: Any) -> str:
    key = _plain(value, fallback="unknown", maximum=40)
    return _METHODS.get(key, "口径待确认")


def _append_facts(story: list[Any], report: dict[str, Any], styles: dict[str, ParagraphStyle], width: float) -> None:
    facts = report.get("facts") if isinstance(report.get("facts"), dict) else {}
    borrower = facts.get("borrower") if isinstance(facts.get("borrower"), dict) else {}
    lender = facts.get("lender") if isinstance(facts.get("lender"), dict) else {}
    loan = facts.get("loan") if isinstance(facts.get("loan"), dict) else {}
    disclosure = facts.get("disclosure") if isinstance(facts.get("disclosure"), dict) else {}
    purpose = _plain(borrower.get("purpose"), maximum=300)
    if purpose == "unknown":
        purpose = "待确认"
    term = loan.get("term_periods")
    term_text = "待确认" if term is None else f"{_plain(term)} 期"
    periods = loan.get("periods_per_year")
    if periods is not None:
        term_text += f"；每年 {_plain(periods)} 期"
    lender_name = _plain(lender.get("name"), maximum=300)
    lender_type = _LENDER_TYPES.get(_plain(lender.get("type"), fallback="unknown", maximum=50), "类型待确认")
    quoted_method = _method(disclosure.get("quoted_method"))
    rows = [
        ("借款用途", purpose),
        ("是否在校学生", _tri(borrower.get("is_student"))),
        ("放贷方", f"{lender_name}（{lender_type}）"),
        ("用户确认的主体信息", f"牌照：{_tri(lender.get('licensed'))}；互联网消费贷款：{_tri(lender.get('internet_consumer_loan'))}；互联网助贷：{_tri(lender.get('internet_assisted'))}"),
        ("借款本金 / 实际到账", f"{_money(loan.get('principal'))} / {_money(loan.get('disbursed'))}"),
        ("还款方式 / 期数", f"{_REPAY_METHODS.get(_plain(loan.get('repay_method'), fallback='unknown', maximum=50), '方式待确认')}；{term_text}"),
        ("单期约定还款", _money(loan.get("period_payment"))),
        ("约定开始日期", _plain(loan.get("start_date"))),
        ("披露年化", f"{_percent(disclosure.get('quoted_apr'))}（{quoted_method}）"),
        ("披露信息状态", f"明示表：{_tri(disclosure.get('present'))}；项目齐全：{_tri(disclosure.get('items_complete'))}；或有费用披露：{_tri(disclosure.get('contingent_disclosed'))}"),
        ("资金流向", {"borrower": "借款人", "training_provider": "培训机构", "third_party": "第三方", "unknown": "待确认"}.get(_plain(facts.get("funds_to"), fallback="unknown", maximum=50), "待确认")),
    ]
    _section(story, "关键事实", styles)
    story.append(_label_table(rows, styles, width))


def _append_calculation(story: list[Any], report: dict[str, Any], styles: dict[str, ParagraphStyle], width: float) -> None:
    _section(story, "年化与成本计算", styles)
    calculation = report.get("calculation")
    if not isinstance(calculation, dict):
        error = report.get("calculation_error") if isinstance(report.get("calculation_error"), dict) else {}
        message = _plain(error.get("message"), fallback="本次材料不足或输入不完整，未生成计算结果。")
        story.append(_paragraph(message, styles["body"], maximum=1600))
        story.append(_paragraph("因此，本报告只列出已确认的事实和规则核查结果。", styles["small"]))
        return

    results = calculation.get("calculation") if isinstance(calculation.get("calculation"), dict) else {}
    rates = [
        ["名义年化", _percent(results.get("nominal_apr"))],
        ["复利年化", _percent(results.get("effective_apr"))],
        ["到期单利年化", _percent(results.get("simple_apr"))],
        ["按实际日期年化", _percent(results.get("xirr_apr"))],
    ]
    story.append(_data_table(["计算口径", "结果"], rates, [width * 0.42, width * 0.58], styles))

    comparison = results.get("comparison") if isinstance(results.get("comparison"), dict) else {}
    method = _plain(comparison.get("method_label"), fallback=_method(comparison.get("method")), maximum=100)
    method_basis = comparison.get("method_basis")
    if method_basis == "assumed_simple":
        if "按单利推定" not in method:
            method += "（按单利推定）"
        if "披露口径待确认" not in method:
            method += "，披露口径待确认"
    tolerance = None
    raw_input = calculation.get("input")
    if isinstance(raw_input, dict):
        tolerance = raw_input.get("comparison_tolerance_pp")
    tolerance_text = _points(tolerance)
    exceeded = comparison.get("exceeds_tolerance")
    result_text = "超过比较容差" if exceeded is True else "未超过比较容差" if exceeded is False else "是否超过容差待确认"
    comparison_rows = [
        ("比较口径", method),
        ("披露年化", _percent(comparison.get("quoted_apr"))),
        ("按材料重算", _percent(comparison.get("computed_apr"))),
        ("两者差额", _points(comparison.get("gap_pp"))),
        ("比较容差 / 结果", f"{tolerance_text} / {result_text}" if tolerance is not None else result_text),
    ]
    story.append(Spacer(1, 5))
    story.append(_label_table(comparison_rows, styles, width))

    summary = calculation.get("summary") if isinstance(calculation.get("summary"), dict) else {}
    totals = [
        ["借款本金", _money(summary.get("principal"))],
        ["实际到账", _money(summary.get("disbursed"))],
        ["还款总额", _money(summary.get("total_repayment"))],
        ["独立支付费用合计", _money(summary.get("total_additional_fees"))],
        ["总成本", _money(summary.get("total_cost"))],
    ]
    story.append(Spacer(1, 7))
    story.append(_data_table(["成本项目", "金额"], totals, [width * 0.52, width * 0.48], styles))
    story.append(Spacer(1, 5))
    story.append(_paragraph("计算沿用报告中的到账、还款和费用现金流口径；已包含在到账或还款金额中的费用不会重复计入。具体费用纳入状态见费用明细。", styles["small"]))


def _append_fees(story: list[Any], report: dict[str, Any], styles: dict[str, ParagraphStyle], width: float) -> None:
    _section(story, "费用明细", styles)
    facts = report.get("facts") if isinstance(report.get("facts"), dict) else {}
    fees = facts.get("fees") if isinstance(facts.get("fees"), list) else []
    if not fees:
        story.append(_paragraph("没有已确认的费用项目。", styles["body"]))
        return
    calculation = report.get("calculation") if isinstance(report.get("calculation"), dict) else {}
    fee_totals = calculation.get("fee_totals") if isinstance(calculation.get("fee_totals"), list) else []
    totals_by_id = {str(item.get("id")): item for item in fee_totals if isinstance(item, dict) and item.get("id") is not None}
    rows: list[list[Any]] = []
    for fee in fees[:100]:
        if not isinstance(fee, dict):
            continue
        fee_id = str(fee.get("id", ""))
        contingent = fee.get("contingent")
        total = totals_by_id.get(fee_id, {}).get("total")
        total_text = _money(total) if contingent is False and total is not None else "或有费用" if contingent is True else "条件待确认"
        payee_type = _PAYEE_TYPES.get(_plain(fee.get("payee_type"), fallback="unknown", maximum=50), "主体待确认")
        timing = _FEE_TIMING.get(_plain(fee.get("timing"), fallback="unknown", maximum=50), "时间待确认")
        details = f"收取主体：{_plain(fee.get('payee'))}（{payee_type}）；发生时间：{timing}；是否或有：{_tri(contingent)}；明示表：{_tri(fee.get('in_disclosure'))}；已计入现金流：{_tri(fee.get('included_in_cashflows'))}；已计入明示成本：{_tri(fee.get('included_in_disclosed_cost'))}"
        rows.append([
            _paragraph(fee.get("name"), styles["value"], maximum=300),
            _paragraph(_money(fee.get("amount")), styles["value"]),
            _paragraph(total_text, styles["value"]),
            _paragraph(details, styles["small"], maximum=1000),
        ])
    if rows:
        story.append(_data_table(["费用项目", "单次金额", "核算合计", "主体、发生条件与披露状态"], rows,
                                 [width * 0.17, width * 0.14, width * 0.16, width * 0.53], styles))
    story.append(Spacer(1, 5))
    story.append(_paragraph("或有费用单独列示，不自动计入常规成本合计；是否属于借款成本应结合合同约定、实际支付和适用规则核对。", styles["small"]))


def _append_lender_sources(story: list[Any], report: dict[str, Any], styles: dict[str, ParagraphStyle]) -> None:
    result = report.get("public_source_search")
    if not isinstance(result, dict):
        return
    _section(story, "公开来源检索线索", styles)
    story.append(_paragraph(f"检索名称：{_plain(result.get('name'))}；检索时间：{_plain(result.get('queried_at'))}", styles["small"]))
    categories = result.get("categories") if isinstance(result.get("categories"), list) else []
    official_docs = result.get("official_documents") if isinstance(result.get("official_documents"), dict) else {}
    for category in categories[:20]:
        if not isinstance(category, dict):
            continue
        kind = _plain(category.get("kind"), fallback="", maximum=40)
        label = _SOURCE_CATEGORIES.get(kind, "公开来源")
        status = _SOURCE_STATUS.get(_plain(category.get("status"), fallback="", maximum=50), "状态待确认")
        story.append(_paragraph(f"{label}：{status}", styles["subsection"]))
        for source in (category.get("sources") if isinstance(category.get("sources"), list) else [])[:10]:
            if not isinstance(source, dict):
                continue
            story.append(_paragraph(_plain(source.get("title"), maximum=300), styles["body"]))
            if source.get("url"):
                story.append(_paragraph(f"来源：{_plain(source.get('url'), maximum=2048)}", styles["small"], maximum=2200))
            if source.get("snippet"):
                story.append(_paragraph(_plain(source.get("snippet"), maximum=1800), styles["small"], maximum=2000))
            document = official_docs.get(source.get("url"))
            if isinstance(document, dict):
                story.append(_paragraph(f"官方详情：{_plain(document.get('status'))}；匹配状态：{_plain(document.get('name_match'))}；读取时间：{_plain(document.get('retrieved_at'))}", styles["small"], maximum=500))
    for limitation in (result.get("limitations") if isinstance(result.get("limitations"), list) else [])[:20]:
        story.append(_paragraph(f"检索限制：{_plain(limitation, maximum=1000)}", styles["small"]))
    story.append(_paragraph("公开索引结果仅为核实线索，不构成许可状态判断；未检索到结果不代表没有相关资质或记录。", styles["small"]))


def _append_rules(story: list[Any], report: dict[str, Any], payload: dict[str, Any], styles: dict[str, ParagraphStyle]) -> None:
    _section(story, "规则检查", styles)
    rules = report.get("rules") if isinstance(report.get("rules"), list) else []
    if not rules:
        story.append(_paragraph("报告中没有规则检查结果。", styles["body"]))
        return
    presentations = payload.get("rule_presentations") if isinstance(payload.get("rule_presentations"), list) else []
    presentation_by_id = {str(item.get("rule_id")): item for item in presentations if isinstance(item, dict) and item.get("rule_id") is not None}
    evidence = report.get("evidence") if isinstance(report.get("evidence"), list) else []
    evidence_by_id = {str(item.get("id")): item for item in evidence if isinstance(item, dict) and item.get("id") is not None}
    for rule in rules[:300]:
        if not isinstance(rule, dict):
            continue
        rule_id = _plain(rule.get("rule_id"), maximum=100)
        presentation = presentation_by_id.get(rule_id, {})
        status = _plain(presentation.get("label"), fallback=_RULE_STATUS.get(_plain(rule.get("status"), fallback="", maximum=40), "状态待确认"), maximum=80)
        nature = _plain(presentation.get("natureLabel"), fallback=_RULE_NATURE.get(_plain(rule.get("nature"), fallback="", maximum=40), "核查项目"), maximum=80)
        title = _plain(rule.get("title"), maximum=500)
        story.append(_paragraph(f"{status}；{nature}；{rule_id} {title}", styles["subsection"]))
        level = _plain(presentation.get("levelLabel"), fallback="", maximum=80)
        fact_state = _plain(presentation.get("factLabel"), fallback="", maximum=100)
        metadata = "；".join(value for value in (level, fact_state) if value)
        if metadata:
            story.append(_paragraph(metadata, styles["small"]))
        if rule.get("reason"):
            story.append(_paragraph(rule.get("reason"), styles["body"], maximum=2400))
        if rule.get("action"):
            story.append(_paragraph(f"可以核实：{_plain(rule.get('action'), maximum=1600)}", styles["body"], maximum=1800))
        citation = rule.get("citation")
        if isinstance(citation, dict):
            source_name = _plain(citation.get("document"), maximum=500)
            article = _plain(citation.get("article"), fallback="", maximum=300)
            if source_name or article:
                story.append(_paragraph("依据：" + source_name + (f"；{article}" if article else ""), styles["body"], maximum=900))
            if citation.get("quote"):
                story.append(_paragraph(f"引文：{_plain(citation.get('quote'), maximum=2400)}", styles["small"], maximum=2600))
            verification = "来源已作官方核对" if citation.get("verification") == "official_checked" else "依据为本地材料，未作官方核对"
            detail = f"{verification}；生效日期：{_plain(citation.get('effective_date'))}"
            if citation.get("url"):
                detail += f"；来源：{_plain(citation.get('url'), maximum=2048)}"
            story.append(_paragraph(detail, styles["small"], maximum=2600))
        else:
            story.append(_paragraph("此项没有附带条款出处。", styles["small"]))
        linked: list[dict[str, Any]] = []
        for evidence_id in rule.get("evidence_ids", []) if isinstance(rule.get("evidence_ids"), list) else []:
            item = evidence_by_id.get(str(evidence_id))
            if item and item not in linked:
                linked.append(item)
        for item in linked[:20]:
            page = item.get("page")
            page_text = "" if page is None else f"，第 {_plain(page)} 页"
            transcript = "，图像转录，待核对" if item.get("source_type") == "vision_transcript" else ""
            story.append(_paragraph(f"材料摘录{page_text}{transcript}：{_plain(item.get('quote'), maximum=2400)}", styles["small"], maximum=2600))


def _correction_value(field: str, value: Any) -> str:
    if value is None:
        return "待确认"
    if isinstance(value, bool):
        return "是" if value else "否"
    if isinstance(value, (dict, list)):
        return _plain(value, maximum=1000)
    text = _plain(value, fallback="空", maximum=1000)
    if re.fullmatch(r"-?\d+(?:\.\d+)?", text) and re.search(r"amount|principal|disbursed|payment", field, re.IGNORECASE):
        return _money(text)
    if re.fullmatch(r"-?\d+(?:\.\d+)?", text) and re.search(r"apr|rate|年化|利率", field, re.IGNORECASE):
        return _percent(text)
    return text


def _append_actions_and_limits(story: list[Any], report: dict[str, Any], styles: dict[str, ParagraphStyle], width: float) -> None:
    narrative = report.get("narrative") if isinstance(report.get("narrative"), dict) else {}
    _section(story, "签字前可以做的事", styles)
    actions = narrative.get("actions") if isinstance(narrative.get("actions"), list) else []
    if actions:
        for index, action in enumerate(actions[:100], 1):
            if not isinstance(action, dict):
                continue
            reference = action.get("rule_id")
            suffix = f"（对应规则：{_plain(reference, maximum=100)}）" if reference else ""
            story.append(_paragraph(f"{index}. {_plain(action.get('text'), maximum=1600)}{suffix}", styles["body"], maximum=1800))
    else:
        story.append(_paragraph("报告没有列出额外核实动作。", styles["body"]))

    corrections = report.get("corrections") if isinstance(report.get("corrections"), list) else []
    _section(story, "修正记录与报告局限", styles)
    if corrections:
        correction_rows = []
        for correction in corrections[:200]:
            if not isinstance(correction, dict):
                continue
            field = _plain(correction.get("field"), maximum=300)
            correction_rows.append([field, _correction_value(field, correction.get("before")), _correction_value(field, correction.get("after"))])
        if correction_rows:
            story.append(_data_table(["字段", "原识别", "确认后"], correction_rows,
                                     [width * 0.34, width * 0.33, width * 0.33], styles))
    else:
        story.append(_paragraph("没有记录到字段修正。", styles["body"]))

    limitations = narrative.get("limitations") if isinstance(narrative.get("limitations"), list) else []
    if limitations:
        for index, item in enumerate(limitations[:100], 1):
            story.append(_paragraph(f"{index}. {_plain(item, maximum=1200)}", styles["body"], maximum=1400))
    else:
        story.append(_paragraph("未提供单独的报告局限说明。", styles["body"]))
    generation = report.get("generation") if isinstance(report.get("generation"), dict) else {}
    if generation.get("mode") == "template":
        story.append(_paragraph(f"本报告由确定性模板生成。错误代码：{_plain(generation.get('error_code'))}。", styles["small"]))
    story.append(Spacer(1, 4))
    story.append(_paragraph(report.get("disclaimer"), styles["small"], fallback="本报告基于提供材料进行事实比对，不构成法律意见或借贷建议。", maximum=1000))


def _draw_page(canvas: Any, document: Any) -> None:
    canvas.saveState()
    page_width, page_height = A4
    left, right = 17 * mm, page_width - 17 * mm
    canvas.setStrokeColor(_LINE)
    canvas.setLineWidth(0.6)
    canvas.line(left, page_height - 14 * mm, right, page_height - 14 * mm)
    canvas.setFont(_REGULAR, 7.5)
    canvas.setFillColor(_MUTED)
    canvas.drawString(left, page_height - 11 * mm, "明示贷查，贷款材料核查报告")
    canvas.line(left, 14 * mm, right, 14 * mm)
    canvas.drawString(left, 9 * mm, "基于提供材料与用户确认事实生成")
    canvas.drawRightString(right, 9 * mm, f"第 {document.page} 页")
    canvas.restoreState()


def _validate(payload: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    if not isinstance(payload, dict) or not isinstance(payload.get("report"), dict):
        raise PdfError("INVALID_REPORT", "报告数据格式不正确。")
    report = payload["report"]
    if not isinstance(report.get("title"), str) or not report["title"].strip() or len(report["title"]) > 300:
        raise PdfError("INVALID_REPORT", "报告标题缺失或过长。")
    if not isinstance(report.get("generated_at"), str) or len(report["generated_at"]) > 100:
        raise PdfError("INVALID_REPORT", "报告生成时间格式不正确。")
    for key, maximum in (("rules", 300), ("evidence", 2000), ("corrections", 200), ("fees", 100)):
        values = report.get(key, [])
        if key == "fees":
            facts = report.get("facts") if isinstance(report.get("facts"), dict) else {}
            values = facts.get("fees", [])
        if not isinstance(values, list) or len(values) > maximum:
            raise PdfError("INVALID_REPORT", f"报告中的 {key} 数据格式不正确。")
    if not isinstance(report.get("facts"), dict) or not isinstance(report.get("conclusion"), dict):
        raise PdfError("INVALID_REPORT", "报告缺少事实或结论部分。")
    if not isinstance(report.get("narrative"), dict):
        raise PdfError("INVALID_REPORT", "报告缺少摘要和局限说明。")
    return report, payload


def create_report_pdf(payload: Any) -> bytes:
    """Return a searchable, font-embedded PDF without writing report data to disk."""
    report, export_data = _validate(payload)
    _register_fonts()
    styles = _styles()
    buffer = io.BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=17 * mm,
        rightMargin=17 * mm,
        topMargin=20 * mm,
        bottomMargin=19 * mm,
        title=_plain(report.get("title"), maximum=300),
        author="明示贷查",
        subject="基于材料生成的贷款核查报告",
    )
    width = document.width
    generation = report.get("generation") if isinstance(report.get("generation"), dict) else {}
    mode_label = "确定性模板" if generation.get("mode") == "template" else "报告撰写"
    story: list[Any] = [
        _paragraph(report.get("title"), styles["title"], maximum=300),
        _paragraph(f"生成时间：{_plain(report.get('generated_at'))}；生成方式：{mode_label}", styles["subtitle"]),
    ]
    if report.get("synthetic_sample") is True:
        story.append(_paragraph("模拟数据样例；不含真实个人信息；非实际核查结果", styles["small"]))

    conclusion = report.get("conclusion") if isinstance(report.get("conclusion"), dict) else {}
    conclusion_label = _plain(export_data.get("conclusion_label"), fallback="核查结论", maximum=100)
    summary = _plain(conclusion.get("summary"), maximum=4000)
    callout = Table([[ _paragraph(conclusion_label, styles["label"], maximum=100), _paragraph(summary, styles["callout"], maximum=4200) ]], colWidths=[30 * mm, width - 30 * mm], hAlign="LEFT")
    callout.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), _PALE),
        ("BOX", (0, 0), (-1, -1), 0.6, _LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(callout)
    counts = conclusion.get("counts") if isinstance(conclusion.get("counts"), dict) else {}
    story.append(Spacer(1, 5))
    story.append(_paragraph(
        f"确认问题：{_plain(counts.get('confirmed_issues'), fallback='0')}；待核实：{_plain(counts.get('pending_checks'), fallback='0')}；阅读提示：{_plain(counts.get('advisory_hints'), fallback='0')}",
        styles["small"],
    ))

    _append_facts(story, report, styles, width)
    _append_calculation(story, report, styles, width)
    _append_fees(story, report, styles, width)
    _append_lender_sources(story, report, styles)
    _append_rules(story, report, export_data, styles)
    _append_actions_and_limits(story, report, styles, width)
    document.build(story, onFirstPage=_draw_page, onLaterPages=_draw_page)
    return buffer.getvalue()


def generate_report_pdf(payload: Any) -> dict[str, str]:
    """Worker entry point: base64 is used only for the existing JSON worker protocol."""
    pdf_bytes = create_report_pdf(payload)
    return {"pdf_base64": base64.b64encode(pdf_bytes).decode("ascii")}
