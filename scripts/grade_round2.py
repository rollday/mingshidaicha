"""Score recorded round-two attempts against a frozen, independent expected_values.csv."""

import argparse
import csv
import hashlib
import json
import re
import subprocess
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP, getcontext
from pathlib import Path

getcontext().prec = 90
MONEY_LIMIT = Decimal("0.01")
RATE_LIMIT_PP = Decimal("0.01")
DISCLOSURE_LIMIT_PP = Decimal("0.5")
SAMPLES = [f"T{n:02}" for n in range(1, 23)]
GATE = SAMPLES[-4:]
RULES = {f"R{n:02}" for n in range(1, 11)}
INFRA_ERRORS = {"MODEL_UNAVAILABLE", "MODEL_RATE_LIMIT", "WS_CONNECTION_ERROR", "WS_CLOSED",
                "WS_OPEN_TIMEOUT", "WS_SEND_ERROR", "WS_TASK_TIMEOUT", "HTTP_502", "HTTP_503",
                "HTTP_522", "HTTP_524", "SERVER_BUSY", "fetch failed"}


def dec(value):
    if not isinstance(value, str) or not re.fullmatch(r"-?\d+(?:\.\d+)?", value):
        return None
    return Decimal(value)


def json_file(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rate_error(actual, expected):
    a, b = dec(actual), dec(expected)
    return None if a is None or b is None else abs(a - b) * 100


def flows_by_time(rows):
    flows = {}
    for row in rows:
        key = str(row["period"] if "period" in row else row["date"])
        amount = dec(row.get("amount"))
        if key in flows or amount is None:
            raise ValueError("Duplicate period/date or invalid decimal in cash flows")
        flows[key] = amount
    return flows


def score_comparison(observed, expected):
    if not expected:
        return ["comparison_gold_missing"]
    errors = []
    for field in ("status", "disclosed_method", "quoted_apr", "unavailable_reason"):
        if field not in expected:
            continue
        actual, wanted = observed.get(field), expected[field]
        if field == "quoted_apr" and wanted is not None:
            error = rate_error(actual, wanted)
            matches = error is not None and error <= RATE_LIMIT_PP
        else:
            matches = actual == wanted
        if not matches:
            errors.append(f"comparison.{field}")
    if expected["status"] == "complete":
        q, c, g = (dec(observed.get(key)) for key in ("quoted_apr", "computed_apr", "gap_pp"))
        if observed.get("method_basis") != "explicit" or observed.get("method") != expected.get("method"):
            errors.append("comparison.method")
        if any(value is None for value in (q, c, g)) or type(observed.get("exceeds_tolerance")) is not bool:
            return errors + ["comparison.incomplete"]
        error = rate_error(observed["computed_apr"], expected.get("computed_apr"))
        target_gap = dec(expected.get("gap_pp"))
        if error is None or error > RATE_LIMIT_PP:
            errors.append("comparison.computed_apr")
        if target_gap is None or abs(g - target_gap) > RATE_LIMIT_PP or abs(g - (c - q) * 100) > Decimal("1e-32"):
            errors.append("comparison.gap_pp")
        exceeds = abs(g) > DISCLOSURE_LIMIT_PP + Decimal("1e-38")
        if observed["exceeds_tolerance"] is not exceeds or exceeds is not expected.get("exceeds_tolerance"):
            errors.append("comparison.exceeds_tolerance")
    elif observed.get("gap_pp") is not None or observed.get("exceeds_tolerance") is not None:
        errors.append("comparison.claims_unavailable_gap")
    return errors


def score_pdf(path, result, calc):
    if not path.is_file() or result.get("pdf_sha256") != sha(path):
        return ["final.pdf_missing_or_hash_mismatch"]
    try:
        pdf = subprocess.run(["pdftotext", "-layout", str(path), "-"], check=True, capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.SubprocessError):
        return ["final.pdf_unreadable"]
    text = re.sub(r"\s+", "", pdf.stdout)
    cmp = calc.get("comparison") or {}
    available = cmp.get("status") in ("complete", "provisional")
    rate = cmp.get("computed_apr") if available else calc.get("nominal_apr") or calc.get("xirr_apr")
    if dec(rate) is None or "按材料重算" not in text:
        return ["final.pdf_missing_recomputed_rate"]
    displayed = f"{(dec(rate) * 100).quantize(Decimal('.01'), rounding=ROUND_HALF_UP):.2f}%"
    if displayed.replace("-0.00%", "0.00%") not in text:
        return ["final.pdf_rate_mismatch"]
    if available:
        expected_label = {"nominal": "名义年化", "simple": "单利年化", "effective": "复利年化", "xirr": "按实际日期年化"}
        if "比较差额" not in text or expected_label.get(cmp.get("method"), "口径未核实") not in text:
            return ["final.pdf_comparison_missing"]
    else:
        reasons = {"missing_disclosed_apr": "材料未提供可比较的综合融资成本年化",
                   "unconfirmed_disclosed_method": "披露年化的计算口径待确认",
                   "unsupported_cashflow_for_method": "当前现金流未能按披露口径重算"}
        if "未完成同口径比较" not in text or reasons.get(cmp.get("unavailable_reason"), "缺少完整比较结果") not in text:
            return ["final.pdf_reason_missing"]
    return []


def score_attempt(path, gold, result, sample_hash):
    expected = gold.get("cashflows", [])
    checked = json_file(path / "checked.json")
    report = json_file(path / "report.json").get("report") or {}
    calculated = checked.get("calculation") or {}
    calc = calculated.get("calculation") or {}
    accepted = report.get("calculation") or {}
    errors = []
    status = result.get("status")
    if status != "completed" or result.get("cleanup") != "deleted":
        errors.append("execution." + (result.get("error") or "incomplete_or_cleanup_failed"))
    if sample_hash != gold.get("final_sha256"):
        errors.append("input.hash_mismatch")
    if not calc:
        errors.append("final.no_calculation")
        return errors, [], {}, {}
    expected_flows = flows_by_time(expected)
    try:
        actual_flows = flows_by_time(calc.get("cashflows", []))
    except (ValueError, KeyError, TypeError):
        actual_flows = {}
        errors.append("cashflow.invalid_output")
    lines = []
    for point in sorted(expected_flows.keys() | actual_flows.keys(), key=lambda v: (not v.isdigit(), int(v) if v.isdigit() else v)):
        g, a = expected_flows.get(point, Decimal(0)), actual_flows.get(point, Decimal(0))
        difference = a - g
        passed = abs(difference) <= MONEY_LIMIT and not (point not in actual_flows and g != 0)
        if not passed and "cashflow.amount" not in errors:
            errors.append("cashflow.amount")
        lines.append({"time": point, "gold": str(g), "model": str(a), "diff_yuan": str(difference), "pass": passed})
    if not expected_flows:
        errors.append("cashflow.gold_missing")
    for field, value in (gold.get("facts") or {}).items():
        if field == "term_periods":
            matches = (report.get("facts") or {}).get("loan", {}).get(field) == value
        else:
            a, g = dec(calculated.get("summary", {}).get(field)), dec(value)
            matches = a is not None and g is not None and abs(a - g) <= MONEY_LIMIT
        if not matches:
            errors.append("facts." + field)
    rates = {}
    for field, value in (gold.get("rates") or {}).items():
        error = rate_error(calc.get(field), value)
        rates[field] = {"gold": value, "model": calc.get(field), "diff_pp": None if error is None else str(error)}
        if error is None or error > RATE_LIMIT_PP:
            errors.append("rate." + field)
    comparison = calc.get("comparison") or {}
    errors.extend(score_comparison(comparison, gold.get("comparison")))
    rules = {r["rule_id"]: r for r in report.get("rules") or []}
    for rid, target in (gold.get("rules") or {}).items():
        if any(rules.get(rid, {}).get(field) != value for field, value in target.items()):
            errors.append("rule." + rid)
    if not report or not accepted or report.get("conclusion", {}).get("partial") is not False or accepted != calculated:
        errors.append("final.calculation_mismatch")
    if checked.get("rules") != report.get("rules") or set(rules) != RULES or len(report.get("rules") or []) != len(RULES):
        errors.append("final.rules_mismatch")
    if report.get("grading_policy") != gold.get("grading_policy"):
        errors.append("final.policy_mismatch")
    errors.extend(score_pdf(path / "report.pdf", result, calc))
    return errors, lines, rates, comparison


def load_gold(path):
    gold = {}
    with path.open(encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            sid = row.pop("sample_id")
            if sid not in SAMPLES or sid in gold:
                raise ValueError(f"Unexpected or duplicate gold sample {sid}")
            for name in ("facts", "cashflows", "rates", "comparison", "rules"):
                row[name] = json.loads(row.pop(name + "_json") or "null")
            gold[sid] = row
    return gold


def load_attempts(dirs, revision):
    attempts = defaultdict(list)
    seen = set()
    for directory in dirs:
        run = json_file(directory / "run.json")
        if run.get("target_revision_declared") != revision or not run.get("export_pdf"):
            raise ValueError(f"Run {directory.name} has the wrong target revision or omitted PDF export")
        for sample in run["samples"]:
            sample_id, round_no, attempt_no = re.fullmatch(r"(T\d{2})-r([1-3])-a([1-9]\d*)", sample["id"]).groups()
            key = sample_id, int(round_no), int(attempt_no)
            if key in seen or sample_id not in SAMPLES:
                raise ValueError(f"Unexpected or duplicate attempt {sample['id']}")
            seen.add(key)
            folder = directory / sample["id"]
            result = json_file(folder / "result.json")
            if result:
                documents = sample["documents"]
                sample_hash = documents[0]["sha256"] if len(documents) == 1 else None
                attempts[key[:2]].append((key[2], folder, result, sample_hash))
    return attempts


def write_csv(path, fields, rows):
    with path.open("x", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fields)
        writer.writeheader()
        writer.writerows(rows)


def grade(gold, attempts):
    by_sample, rounds, details, history = [], [], [], []
    for sid in SAMPLES:
        g = gold.get(sid) or {"gold_status": "missing"}
        verified = (g.get("gold_status") == "verified" and g.get("source_status") == "verified" and
                    bool(g.get("cashflows") and g.get("rates") and g.get("comparison")) and set(g.get("rules") or {}) == RULES)
        sample_rounds = []
        for round_no in range(1, 4):
            records = sorted(attempts.get((sid, round_no), []))
            row = {"sample_id": sid, "round": round_no, "attempts": len(records), "first_outcome": "not_run",
                   "reference_outcome": "NOT_RUN", "issues": "", "rates": {}, "comparison": {}, "max_cash_diff_yuan": None}
            first_errors = []
            for number, path, result, sample_hash in records:
                errors, lines, rates, comparison = score_attempt(path, g, result, sample_hash)
                code = result.get("error")
                outcome = "PASS" if not errors else "FAIL"
                cause = "infrastructure" if code in INFRA_ERRORS else "product_or_evidence" if errors else ""
                history.append({"sample_id": sid, "round": round_no, "attempt": number, "started_at": result.get("started_at"),
                                "finished_at": result.get("finished_at"), "elapsed_ms": result.get("elapsed_ms"),
                                "status": result.get("status"), "kind": cause, "error": code, "cleanup": result.get("cleanup"),
                                "reference_outcome": outcome, "issues": " | ".join(errors),
                                "sample_sha256": sample_hash, "pdf_sha256": result.get("pdf_sha256")})
                details.extend({"sample_id": sid, "round": round_no, "attempt": number, **line} for line in lines)
                if number == 1:
                    first_errors = errors
                    row.update(first_outcome=code or outcome, reference_outcome=outcome, issues=" | ".join(errors),
                               rates=rates, comparison=comparison,
                               max_cash_diff_yuan=str(max(abs(Decimal(x["diff_yuan"])) for x in lines)) if lines else None)
            row["verdict"] = ("UNSCORABLE" if not verified or row["first_outcome"] == "not_run"
                              else "FAIL" if first_errors else "PASS")
            sample_rounds.append(row)
        spread = {}
        for name in (g.get("rates") or {}):
            values = [dec(row["rates"].get(name, {}).get("model")) for row in sample_rounds]
            if all(value is not None for value in values):
                spread[name] = (max(values) - min(values)) * 100
        consistency_ok = bool(spread) and len(spread) == len(g.get("rates") or {}) and all(gap <= RATE_LIMIT_PP for gap in spread.values())
        statuses = {row["verdict"] for row in sample_rounds}
        verdict = ("FAIL" if "FAIL" in statuses or ("UNSCORABLE" not in statuses and not consistency_ok)
                   else "UNSCORABLE" if "UNSCORABLE" in statuses else "PASS")
        values = [Decimal(row["max_cash_diff_yuan"]) for row in sample_rounds if row["max_cash_diff_yuan"] is not None]
        by_sample.append({
            "sample_id": sid, "gold_status": g["gold_status"], "source_status": g.get("source_status", "missing"),
            "gold_rates": json.dumps(g.get("rates") or {}, ensure_ascii=False),
            "model_and_rate_error_pp": json.dumps([row["rates"] for row in sample_rounds], ensure_ascii=False),
            "max_cash_diff_yuan": str(max(values)) if values else "",
            "expected_method": (g.get("comparison") or {}).get("disclosed_method"),
            "actual_methods": "/".join(row["comparison"].get("disclosed_method", "—") for row in sample_rounds),
            "comparison_and_output": json.dumps([{"comparison": row["comparison"], "issues": row["issues"]} for row in sample_rounds], ensure_ascii=False),
            "rate_spread_pp": json.dumps({name: str(gap) for name, gap in spread.items()}),
            "rounds": sum(bool(row["attempts"]) for row in sample_rounds), "attempts": sum(row["attempts"] for row in sample_rounds),
            "first_outcomes": "/".join(row["first_outcome"] for row in sample_rounds),
            "reference_outcomes": "/".join(row["reference_outcome"] for row in sample_rounds),
            "verdict": verdict,
        })
        rounds.extend(sample_rounds)
    return by_sample, rounds, details, history


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gold", type=Path, required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--runs", type=Path, nargs="+", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    gold = load_gold(args.gold)
    attempt_map = load_attempts(args.runs, args.revision)
    samples, rounds, details, attempts = grade(gold, attempt_map)
    args.output.mkdir()
    write_csv(args.output / "score_22.csv", list(samples[0]), samples)
    write_csv(args.output / "rounds_66.csv", list(rounds[0]), rounds)
    write_csv(args.output / "cashflow_details.csv", ["sample_id", "round", "attempt", "time", "gold", "model", "diff_yuan", "pass"], details)
    write_csv(args.output / "attempts.csv", ["sample_id", "round", "attempt", "started_at", "finished_at", "elapsed_ms", "status", "kind", "error",
                                            "cleanup", "reference_outcome", "issues", "sample_sha256", "pdf_sha256"], attempts)
    verdicts = {row["sample_id"]: row["verdict"] for row in samples}
    overall = "FAIL" if "FAIL" in verdicts.values() else "UNSCORABLE" if "UNSCORABLE" in verdicts.values() else "PASS"
    gate = {sid: verdicts[sid] for sid in GATE}
    meta = {"revision": args.revision, "gold_sha256": sha(args.gold), "scorer_sha256": sha(Path(__file__)),
            "planned_rounds": 66, "attempted_rounds": sum(bool(row["attempts"]) for row in rounds),
            "attempts": len(attempts), "gate": gate, "gate_pass": all(status == "PASS" for status in gate.values()), "verdict": overall}
    (args.output / "summary.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(meta))
    return 0 if overall == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
