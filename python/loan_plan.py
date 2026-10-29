"""Build deterministic loan schedules from confirmed case facts."""

from __future__ import annotations

import calendar
import re
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, localcontext
from typing import Any

try:
    from .calculation import CalculationError, calculate
except ImportError:  # worker.py is also launched directly from the python directory
    from calculation import CalculationError, calculate


_DECIMAL_RE = re.compile(r"^\d+(?:\.\d+)?$")
_CENT = Decimal("0.01")
_ZERO = Decimal(0)
_ONE = Decimal(1)


def _missing(fields: list[str]) -> None:
    raise CalculationError("MISSING_FIELDS", "Required confirmed loan fields are missing", {"fields": fields})


def _number(value: Any, field: str, *, positive: bool = False, nonnegative: bool = False) -> Decimal:
    if not isinstance(value, str) or len(value) > 80 or not _DECIMAL_RE.fullmatch(value):
        raise CalculationError("INVALID_NUMBER", f"{field} must be a decimal string")
    try:
        number = Decimal(value)
    except InvalidOperation as exc:
        raise CalculationError("INVALID_NUMBER", f"{field} is invalid") from exc
    if not number.is_finite() or (positive and number <= 0) or (nonnegative and number < 0):
        raise CalculationError("INVALID_NUMBER", f"{field} is outside the allowed range")
    return number


def _money(value: Decimal) -> Decimal:
    return value.quantize(_CENT, rounding=ROUND_HALF_UP)


def _fmt(value: Decimal) -> str:
    value = value.normalize()
    if value == _ZERO:
        return "0"
    return format(value, "f")


def _date(value: Any, field: str) -> date:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise CalculationError("INVALID_DATE", f"{field} must use YYYY-MM-DD")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise CalculationError("INVALID_DATE", f"{field} is not a valid calendar date") from exc


def _monthly_date(start: date, period: int, yearly: bool = False) -> date:
    if yearly:
        year = start.year + period
        day = min(start.day, calendar.monthrange(year, start.month)[1])
        return date(year, start.month, day)
    absolute_month = start.year * 12 + start.month - 1 + period
    year, month0 = divmod(absolute_month, 12)
    month = month0 + 1
    day = min(start.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _schedule_dates(start: date, term: int, periods_per_year: int) -> list[date] | None:
    if periods_per_year == 12:
        return [_monthly_date(start, period) for period in range(1, term + 1)]
    if periods_per_year == 1:
        return [_monthly_date(start, period, yearly=True) for period in range(1, term + 1)]
    return None


def _payment_rows(values: list[Decimal], *, timing: str, dates: list[date] | None) -> list[dict[str, Any]]:
    if timing == "dated":
        assert dates is not None
        return [{"amount": _fmt(amount), "date": at.isoformat()} for amount, at in zip(values, dates)]
    return [{"amount": _fmt(amount), "period": period} for period, amount in enumerate(values, 1)]


def _gen_standard(method: str, principal: Decimal, term: int, periods_per_year: int,
                  apr: Decimal, fixed_payment: Decimal | None) -> list[Decimal]:
    periodic_rate = apr / Decimal(periods_per_year)
    balance = principal
    payments: list[Decimal] = []
    if method == "equal_installment":
        generated = fixed_payment is None
        if fixed_payment is None:
            if periodic_rate == 0:
                fixed_payment = _money(principal / term)
            else:
                factor = (_ONE + periodic_rate) ** term
                fixed_payment = _money(principal * periodic_rate * factor / (factor - _ONE))
        for period in range(1, term + 1):
            interest = _money(balance * periodic_rate)
            payment = fixed_payment
            if period == term and generated:
                payment = _money(balance + interest)
            principal_paid = payment - interest
            balance -= principal_paid
            payments.append(payment)
        # Fixed contractual installments remain untouched; generated installments absorb cents of tail drift.
        if generated and payments:
            # Recompute the last installment against the remaining balance to absorb prior cent rounding.
            payments[-1] = _money(payments[-1] + balance)
        return payments

    if method == "equal_principal":
        base_principal = _money(principal / term)
        for period in range(1, term + 1):
            principal_paid = balance if period == term else min(balance, base_principal)
            interest = _money(balance * periodic_rate)
            payments.append(_money(principal_paid + interest))
            balance -= principal_paid
        return payments

    if method == "interest_only":
        for period in range(1, term + 1):
            interest = fixed_payment if fixed_payment is not None else _money(principal * periodic_rate)
            payments.append(_money(interest + (principal if period == term else _ZERO)))
        return payments

    if method == "bullet":
        if fixed_payment is not None:
            return [_ZERO] * (term - 1) + [fixed_payment]
        total_interest = _money(principal * periodic_rate * term)
        return [_ZERO] * (term - 1) + [_money(principal + total_interest)]

    raise CalculationError("INVALID_REPAY_METHOD", "A repayment schedule is required for this method")


def _build_fees(fees: Any, term: int, timing: str, dates: list[date] | None,
                start: date | None) -> tuple[list[dict[str, Any]], list[dict[str, Any]], Decimal]:
    if not isinstance(fees, list):
        raise CalculationError("INVALID_INPUT", "fees must be an array")
    if len(fees) > 50:
        raise CalculationError("INVALID_INPUT", "At most 50 fees are supported")
    calculation_fees: list[dict[str, Any]] = []
    fee_totals: list[dict[str, Any]] = []
    additional = _ZERO
    missing: list[str] = []
    for index, fee in enumerate(fees):
        path = f"fees[{index}]"
        if not isinstance(fee, dict):
            raise CalculationError("INVALID_INPUT", f"{path} must be an object")
        for key in ("id", "name"):
            if not isinstance(fee.get(key), str) or not fee[key].strip():
                missing.append(f"{path}.{key}")
        contingent = fee.get("contingent")
        if contingent is None:
            missing.append(f"{path}.contingent")
        if contingent is True:
            if any(not isinstance(fee.get(key), str) or not fee[key].strip() for key in ("id", "name")):
                continue
            fee_totals.append({"id": fee["id"], "name": fee["name"], "total": "0", "contingent": True})
            continue
        if contingent is not False:
            continue
        amount_value = fee.get("amount")
        if amount_value is None:
            missing.append(f"{path}.amount")
            continue
        amount = _money(_number(amount_value, f"{path}.amount", nonnegative=True))
        fee_timing = fee.get("timing")
        if fee_timing not in ("upfront", "per_period", "at_maturity", "specific_period"):
            missing.append(f"{path}.timing")
            continue
        included = fee.get("included_in_cashflows")
        if not isinstance(included, bool):
            missing.append(f"{path}.included_in_cashflows")
            continue
        period = fee.get("period")
        if fee_timing == "upfront":
            at_period = 0
            total = amount
        elif fee_timing == "at_maturity":
            at_period = term
            total = amount
        elif fee_timing == "specific_period":
            if isinstance(period, bool) or not isinstance(period, int):
                missing.append(f"{path}.period")
                continue
            if not 0 <= period <= term:
                raise CalculationError("INVALID_PERIOD", f"{path}.period must be between 0 and term_periods")
            at_period = period
            total = amount
        else:
            at_period = -1
            total = _money(amount * term)
        fee_totals.append({"id": fee["id"], "name": fee["name"], "total": _fmt(total), "contingent": False})
        if included:
            continue
        additional += total
        targets = range(1, term + 1) if fee_timing == "per_period" else (at_period,)
        for at in targets:
            row: dict[str, Any] = {"name": fee["name"], "amount": _fmt(amount), "included_in_cashflows": False}
            if timing == "dated":
                if at == 0:
                    assert start is not None
                    row["date"] = start.isoformat()
                else:
                    assert dates is not None
                    row["date"] = dates[at - 1].isoformat()
            else:
                row["period"] = at
            calculation_fees.append(row)
    if missing:
        _missing(sorted(set(missing)))
    return calculation_fees, fee_totals, additional


def calculate_loan(payload: Any) -> dict[str, Any]:
    """Create the CalculationInput and LoanResult for confirmed CaseFacts."""
    if not isinstance(payload, dict):
        raise CalculationError("INVALID_INPUT", "payload must be a CaseFacts object")
    loan = payload.get("loan")
    if not isinstance(loan, dict):
        _missing(["loan"])
    missing: list[str] = []
    for field in ("principal", "disbursed", "term_periods", "periods_per_year", "repay_method"):
        if loan.get(field) is None:
            missing.append(f"loan.{field}")
    principal_value = loan.get("principal")
    disbursed_value = loan.get("disbursed")
    term_value = loan.get("term_periods")
    ppy_value = loan.get("periods_per_year")
    method = loan.get("repay_method")
    explicit = payload.get("repayments", [])
    if explicit is None:
        explicit = []
    if not isinstance(explicit, list):
        raise CalculationError("INVALID_INPUT", "repayments must be an array")
    if not explicit and method == "schedule":
        missing.append("repayments")
    if not explicit and method == "unknown":
        raise CalculationError("INVALID_REPAY_METHOD", "repay_method is unknown and no explicit repayment schedule was supplied")
    if missing:
        _missing(missing)
    if isinstance(term_value, bool) or not isinstance(term_value, int) or not 1 <= term_value <= 600:
        raise CalculationError("INVALID_PERIOD", "loan.term_periods must be an integer from 1 to 600")
    term = term_value
    if isinstance(ppy_value, bool) or not isinstance(ppy_value, int) or ppy_value < 1 or ppy_value > 366:
        raise CalculationError("INVALID_PERIOD", "loan.periods_per_year must be an integer from 1 to 366")
    periods_per_year = ppy_value
    if method not in ("equal_installment", "equal_principal", "interest_only", "bullet", "schedule", "unknown"):
        raise CalculationError("INVALID_REPAY_METHOD", "repay_method is not supported")
    if len(explicit) != 0 and len(explicit) != term:
        raise CalculationError("INVALID_SCHEDULE", "term_periods does not match repayments length")

    with localcontext() as ctx:
        ctx.prec = 80
        principal = _money(_number(principal_value, "loan.principal", positive=True))
        disbursed = _money(_number(disbursed_value, "loan.disbursed", positive=True))
        start_value = loan.get("start_date")
        start = _date(start_value, "loan.start_date") if start_value is not None else None
        apr_value = loan.get("nominal_apr")
        apr = _number(apr_value, "loan.nominal_apr", nonnegative=True) if apr_value is not None else None
        payment_value = loan.get("period_payment")
        fixed_payment = _money(_number(payment_value, "loan.period_payment", positive=True)) if payment_value is not None else None
        if explicit:
            if len(explicit) > 600:
                raise CalculationError("INVALID_SCHEDULE", "At most 600 repayments are supported")
            if any(not isinstance(row, dict) for row in explicit):
                raise CalculationError("INVALID_INPUT", "Each repayment must be an object")
            row_missing = [f"repayments[{i}].amount" for i, row in enumerate(explicit)
                           if row.get("amount") is None]
            has_date = [isinstance(row, dict) and "date" in row for row in explicit]
            has_period = [isinstance(row, dict) and "period" in row for row in explicit]
            if any(has_date):
                row_missing.extend(f"repayments[{i}].date" for i, row in enumerate(explicit)
                                   if row.get("date") is None)
            elif any(has_period):
                row_missing.extend(f"repayments[{i}].period" for i, row in enumerate(explicit)
                                   if row.get("period") is None)
            else:
                row_missing.extend(f"repayments[{i}].period_or_date" for i in range(len(explicit)))
            if row_missing:
                _missing(row_missing)
            if any(has_date) and not all(has_date) or any(has_period) and not all(has_period) or any(has_date) and any(has_period):
                raise CalculationError("INVALID_SCHEDULE", "Repayments must use either dates or periods consistently")
            if any(has_date):
                if start is None:
                    _missing(["loan.start_date"])
                timing = "dated"
                dates = [_date(row.get("date"), f"repayments[{i}].date") for i, row in enumerate(explicit)]
                if any(at <= start for at in dates):
                    raise CalculationError("INVALID_DATE", "Repayment dates must be after loan.start_date")
                if any(dates[i] >= dates[i + 1] for i in range(len(dates) - 1)):
                    raise CalculationError("INVALID_DATE", "Repayment dates must be strictly increasing")
                payment_amounts = [_money(_number(row.get("amount"), f"repayments[{i}].amount", nonnegative=True))
                                   for i, row in enumerate(explicit)]
                payment_rows = _payment_rows(payment_amounts, timing=timing, dates=dates)
            elif any(has_period):
                periods = [row.get("period") for row in explicit]
                if periods != list(range(1, term + 1)):
                    raise CalculationError("INVALID_SCHEDULE", "Explicit repayment periods must be 1 through term_periods")
                timing = "periodic"
                dates = None
                payment_amounts = [_money(_number(row.get("amount"), f"repayments[{i}].amount", nonnegative=True))
                                   for i, row in enumerate(explicit)]
                payment_rows = _payment_rows(payment_amounts, timing=timing, dates=None)
            else:
                raise CalculationError("INVALID_SCHEDULE", "Explicit repayments require a period or date")
        else:
            if apr is None and not (method in ("equal_installment", "interest_only", "bullet") and fixed_payment is not None):
                _missing(["loan.nominal_apr"])
            payment_amounts = _gen_standard(method, principal, term, periods_per_year,
                                            apr if apr is not None else _ZERO, fixed_payment)
            timing = "periodic"
            dates = _schedule_dates(start, term, periods_per_year) if start is not None else None
            # Contractual equal periods retain nominal/effective conventions even when a start date exists.
            payment_rows = _payment_rows(payment_amounts, timing=timing, dates=None)

        fee_rows, fee_totals, total_additional_fees = _build_fees(
            payload.get("fees", []), term, timing, dates, start
        )
        disbursement = {"amount": _fmt(disbursed)}
        if timing == "dated":
            if start is None:
                _missing(["loan.start_date"])
            disbursement["date"] = start.isoformat()
        else:
            disbursement["period"] = 0
        calculation_input: dict[str, Any] = {
            "timing": timing,
            "periods_per_year": periods_per_year,
            "disbursements": [disbursement],
            "repayments": payment_rows,
            "fees": fee_rows,
            # Preserve the disclosure verbatim; calculate() reports any simple fallback separately.
            "quoted_method": payload.get("disclosure", {}).get("quoted_method", "unknown")
            if isinstance(payload.get("disclosure", {}), dict) else "unknown",
            "comparison_tolerance_pp": "0.5",
        }
        disclosure = payload.get("disclosure", {})
        quoted = disclosure.get("quoted_apr") if isinstance(disclosure, dict) else None
        if quoted is not None:
            _number(quoted, "disclosure.quoted_apr", nonnegative=True)
            calculation_input["quoted_apr"] = quoted
        calculation_result = calculate(calculation_input)
        calendar_rows = None
        if timing == 'periodic' and dates is not None and start is not None:
            calendar_rows = _payment_rows(payment_amounts, timing='dated', dates=dates)
            dated_input = dict(calculation_input, timing='dated',
                               disbursements=[{'amount': _fmt(disbursed), 'date': start.isoformat()}],
                               repayments=calendar_rows,
                               fees=[dict(name=f['name'], amount=f['amount'], included_in_cashflows=f['included_in_cashflows'],
                                          date=(start if f['period'] == 0 else dates[f['period'] - 1]).isoformat()) for f in fee_rows],
                               quoted_method='xirr' if calculation_input['quoted_method'] == 'xirr' else 'unknown')
            dated_result = calculate(dated_input)
            calculation_result['xirr_apr'] = dated_result['xirr_apr']
            if calculation_input['quoted_method'] == 'xirr':
                calculation_result['comparison'] = dated_result['comparison']
        total_repayment = sum(payment_amounts, _ZERO)
        return {
            "input": calculation_input,
            "calculation": calculation_result,
            "summary": {
                "principal": _fmt(principal),
                "disbursed": _fmt(disbursed),
                "total_repayment": _fmt(total_repayment),
                "total_additional_fees": _fmt(total_additional_fees),
                "total_cost": _fmt(total_repayment + total_additional_fees - disbursed),
            },
            "fee_totals": fee_totals,
            "calendar_schedule": calendar_rows,
        }
