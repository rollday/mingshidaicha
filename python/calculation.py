"""Precision cash-flow calculations for conventional lending schedules."""

from __future__ import annotations

import re
from datetime import date
from decimal import Decimal, InvalidOperation, localcontext
from typing import Any


class CalculationError(Exception):
    def __init__(self, code: str, message: str, details: Any = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details


_DECIMAL_RE = re.compile(r"^\d+(?:\.\d+)?$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ZERO = Decimal(0)
ONE = Decimal(1)


def _decimal(value: Any, field: str, *, nonnegative: bool = False) -> Decimal:
    if not isinstance(value, str) or len(value) > 80 or not _DECIMAL_RE.fullmatch(value):
        raise CalculationError("INVALID_NUMBER", f"{field} must be a decimal string")
    try:
        number = Decimal(value.strip())
    except InvalidOperation as exc:
        raise CalculationError("INVALID_NUMBER", f"{field} is not a valid decimal") from exc
    if not number.is_finite():
        raise CalculationError("INVALID_NUMBER", f"{field} must be finite")
    if nonnegative and number < ZERO:
        raise CalculationError("INVALID_NUMBER", f"{field} must be non-negative")
    return number


def _int(value: Any, field: str, *, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise CalculationError("INVALID_PERIOD", f"{field} must be an integer >= {minimum}")
    return value


def _iso_date(value: Any, field: str) -> date:
    if not isinstance(value, str) or not _DATE_RE.fullmatch(value):
        raise CalculationError("INVALID_DATE", f"{field} must use YYYY-MM-DD")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise CalculationError("INVALID_DATE", f"{field} is not a valid calendar date") from exc


def _fmt(value: Decimal) -> str:
    if value == ZERO:
        return "0"
    rendered = format(value, "f")
    if "." in rendered:
        rendered = rendered.rstrip("0").rstrip(".")
    return rendered


def _root(cashflows: list[tuple[int | date, Decimal]], timing: str, periods_per_year: int) -> Decimal:
    first_at, first_amount = cashflows[0]
    if first_amount <= ZERO or len(cashflows) < 2:
        raise CalculationError("NO_IRR_ROOT", "Cash flows must begin with a positive receipt and include an outflow")
    if timing == "periodic":
        offsets = [(int(at) - int(first_at), amount) for at, amount in cashflows]
    else:
        offsets = [((at - first_at).days, amount) for at, amount in cashflows]  # type: ignore[operator]

    with localcontext() as ctx:
        ctx.prec = 60

        def npv(rate: Decimal) -> Decimal:
            total = ZERO
            for offset, amount in offsets:
                exponent = (Decimal(offset) / Decimal(365) if timing == "dated"
                            else Decimal(offset))
                try:
                    total += amount / ((ONE + rate) ** exponent)
                except (InvalidOperation, OverflowError, ZeroDivisionError):
                    raise CalculationError("NO_IRR_ROOT", "Could not evaluate the cash-flow equation")
            return total

        low = Decimal("-0.999999999999999999999999999999999999")
        high = ONE
        f_low = npv(low)
        f_high = npv(high)
        while f_high < ZERO and high < Decimal("1e100"):
            high = high * 2 + ONE
            f_high = npv(high)
        if f_low == ZERO:
            return low
        if f_high == ZERO:
            return high
        if (f_low > ZERO) == (f_high > ZERO):
            raise CalculationError("NO_IRR_ROOT", "No IRR root was found in the supported rate range")
        for _ in range(500):
            mid = (low + high) / 2
            f_mid = npv(mid)
            if f_mid == ZERO:
                return mid
            if (f_mid > ZERO) == (f_low > ZERO):
                low, f_low = mid, f_mid
            else:
                high = mid
            if high - low < Decimal("1e-45") * max(ONE, abs(mid)):
                break
        return (low + high) / 2


def _build_cashflows(payload: dict[str, Any], timing: str, periods_per_year: int) -> list[tuple[int | date, Decimal]]:
    if timing not in ("periodic", "dated"):
        raise CalculationError("INVALID_TIMING", "timing must be 'periodic' or 'dated'")
    buckets: dict[int | date, Decimal] = {}

    def add(items: Any, field: str, sign: int, *, fee: bool = False) -> None:
        if not isinstance(items, list):
            raise CalculationError("INVALID_INPUT", f"{field} must be an array")
        for index, item in enumerate(items):
            label = f"{field}[{index}]"
            if not isinstance(item, dict):
                raise CalculationError("INVALID_INPUT", f"{label} must be an object")
            amount = _decimal(item.get("amount"), f"{label}.amount", nonnegative=True)
            if fee:
                if not isinstance(item.get("name"), str) or not item["name"].strip():
                    raise CalculationError("INVALID_INPUT", f"{label}.name must be a non-empty string")
                included = item.get("included_in_cashflows")
                if not isinstance(included, bool):
                    raise CalculationError("INVALID_INPUT", f"{label}.included_in_cashflows must be boolean")
            if timing == "periodic":
                if "period" not in item:
                    raise CalculationError("INVALID_PERIOD", f"{label}.period is required for periodic timing")
                at: int | date = _int(item["period"], f"{label}.period")
            else:
                if "date" not in item:
                    raise CalculationError("INVALID_DATE", f"{label}.date is required for dated timing")
                at = _iso_date(item["date"], f"{label}.date")
            if fee and included:
                continue
            buckets[at] = buckets.get(at, ZERO) + amount * sign

    add(payload.get("disbursements"), "disbursements", 1)
    add(payload.get("repayments"), "repayments", -1)
    if "fees" in payload:
        add(payload["fees"], "fees", -1, fee=True)
    cashflows = sorted(((at, amount) for at, amount in buckets.items() if amount != ZERO), key=lambda x: x[0])
    if len(cashflows) < 2:
        raise CalculationError("NO_IRR_ROOT", "At least two non-zero net cash-flow times are required")
    if cashflows[0][1] <= ZERO:
        raise CalculationError("UNSUPPORTED_CASHFLOW", "The earliest net cash flow must be a positive disbursement")
    if any(amount > ZERO for _, amount in cashflows[1:]):
        raise CalculationError("UNSUPPORTED_CASHFLOW", "Future positive disbursements create a potentially multi-root IRR")
    if timing == "periodic" and any(int(cashflows[i][0]) >= int(cashflows[i + 1][0]) for i in range(len(cashflows) - 1)):
        raise CalculationError("INVALID_PERIOD", "Cash-flow periods must be strictly increasing after combining equal times")
    if timing == "dated" and any(cashflows[i][0] >= cashflows[i + 1][0] for i in range(len(cashflows) - 1)):
        raise CalculationError("INVALID_DATE", "Cash-flow dates must be strictly increasing after combining equal times")
    return cashflows


def _calculate(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise CalculationError("INVALID_INPUT", "payload must be an object")
    timing = payload.get("timing")
    if timing not in ("periodic", "dated"):
        raise CalculationError("INVALID_TIMING", "timing must be 'periodic' or 'dated'")
    periods_per_year = _int(payload.get("periods_per_year", 12), "periods_per_year", minimum=1)
    if timing == "dated" and "periods_per_year" in payload:
        # It is irrelevant for dated schedules, but malformed supplied values remain an input error.
        pass
    cashflows = _build_cashflows(payload, timing, periods_per_year)
    rate = _root(cashflows, timing, periods_per_year)

    result: dict[str, Any] = {"cashflows": []}
    for at, amount in cashflows:
        row = {"period": at, "amount": _fmt(amount)} if timing == "periodic" else {"date": at.isoformat(), "amount": _fmt(amount)}  # type: ignore[union-attr]
        result["cashflows"].append(row)

    if timing == "periodic":
        nominal = rate * periods_per_year
        with localcontext() as ctx:
            ctx.prec = 60
            effective = (ONE + rate) ** periods_per_year - ONE
        simple = None
        if len(cashflows) == 2:
            period_span = int(cashflows[1][0]) - int(cashflows[0][0])
            years = Decimal(period_span) / Decimal(periods_per_year)
            simple = ((-cashflows[1][1] - cashflows[0][1]) / cashflows[0][1]) / years
        result.update(period_rate=_fmt(rate), nominal_apr=_fmt(nominal), effective_apr=_fmt(effective),
                      simple_apr=_fmt(simple) if simple is not None else None, xirr_apr=None)
    else:
        result.update(period_rate=None, nominal_apr=None, effective_apr=None, simple_apr=None, xirr_apr=_fmt(rate))

    disclosed_method = payload.get("quoted_method", "unknown")
    if disclosed_method not in ("nominal", "effective", "simple", "xirr", "unknown"):
        raise CalculationError("INVALID_METHOD", "quoted_method must be nominal, effective, simple, xirr, or unknown")
    quoted_raw = payload.get("quoted_apr")
    quoted = _decimal(quoted_raw, "quoted_apr") if quoted_raw is not None else None
    tolerance_raw = payload.get("comparison_tolerance_pp", "0.5")
    tolerance = _decimal(tolerance_raw, "comparison_tolerance_pp", nonnegative=True)
    candidates = {
        "nominal": result["nominal_apr"],
        "effective": result["effective_apr"],
        "simple": result["simple_apr"],
        "xirr": result["xirr_apr"],
    }
    method = "simple" if disclosed_method == "unknown" else disclosed_method
    if disclosed_method == "unknown":
        method_basis = "assumed_simple" if candidates["simple"] is not None else "unavailable"
    else:
        method_basis = "explicit"
    computed = candidates.get(method) if method_basis != "unavailable" else None
    computed_decimal = Decimal(computed) if computed is not None else None
    gap = (computed_decimal - quoted) * 100 if computed_decimal is not None and quoted is not None else None
    comparison = {
        "method": method,
        "method_basis": method_basis,
        "disclosed_method": disclosed_method,
        "quoted_apr": quoted_raw,
        "computed_apr": computed,
        "gap_pp": _fmt(gap) if gap is not None else None,
        # Account only for solver convergence uncertainty, not display rounding.
        "exceeds_tolerance": abs(gap) > tolerance + Decimal("1e-38") if gap is not None else None,
    }
    if disclosed_method == "unknown":
        comparison["method_label"] = "按单利推定" if method_basis == "assumed_simple" else "待确认"
    result["comparison"] = comparison
    return result


def calculate(payload: Any) -> dict[str, Any]:
    # Include aggregation, annualization and threshold comparison in the precision scope.
    with localcontext() as ctx:
        ctx.prec = 80
        return _calculate(payload)
