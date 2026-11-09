import unittest
from decimal import Decimal
from unittest.mock import patch

from python.calculation import CalculationError
from python.loan_plan import calculate_loan
from python.worker import _dispatch


def facts(**loan_overrides):
    loan = {
        "principal": "10000", "disbursed": "10000", "term_periods": 12,
        "periods_per_year": 12, "repay_method": "equal_installment",
        "period_payment": "888.49", "nominal_apr": "0.12", "start_date": None,
    }
    loan.update(loan_overrides)
    return {"loan": loan, "repayments": [], "fees": [],
            "disclosure": {"quoted_apr": None, "quoted_method": "unknown"}}


def fee_case(disbursed="20000", payment="913.69", included=()):
    case = facts(principal="20000", disbursed=disbursed, term_periods=24,
                 period_payment=payment, nominal_apr=None)
    case["fees"] = [
        {"id": name, "name": name, "amount": amount, "timing": timing,
         "included_in_cashflows": name in included, "contingent": False}
        for name, amount, timing in (
            ("upfront_a", "600", "upfront"),
            ("upfront_b", "499", "upfront"),
            ("upfront_c", "30", "upfront"),
            ("guarantee", "120", "per_period"),
            ("platform", "88", "per_period"),
        )
    ]
    return case


class LoanPlanTests(unittest.TestCase):
    def test_ledger_reconciles_mixed_and_contingent_fees(self):
        case = fee_case(disbursed="19400", payment="1033.69", included=("upfront_a", "guarantee"))
        case["fees"].append({"id": "late", "name": "Late", "contingent": True})
        result = calculate_loan(case)
        self.assertEqual([entry["category"] for entry in result["fee_ledger"]],
                         ["deducted_from_disbursement", "additional_payment", "additional_payment",
                          "included_in_repayment", "additional_payment", "contingent"])
        reconciliation = result["reconciliation"]
        self.assertEqual(Decimal(reconciliation["total_payment"]), Decimal("27449.56"))
        self.assertEqual(Decimal(reconciliation["net_cashflow_total"]), Decimal("-8049.56"))
        self.assertEqual(reconciliation["periods"][0]["additional_fees"], "529")
        self.assertEqual(reconciliation["periods"][1]["included_fees"], "120")
        self.assertEqual(reconciliation["periods"][1]["net_cashflow"], "-1121.69")

    def test_dated_specific_fees_reconcile_by_occurrence(self):
        case = facts(principal="1000", disbursed="950", term_periods=2, repay_method="schedule",
                     period_payment=None, nominal_apr=None, start_date="2025-01-01")
        case["repayments"] = [{"amount": "500", "date": "2025-02-15"},
                              {"amount": "600", "date": "2025-05-20"}]
        case["fees"] = [
            {"id": "a", "name": "A", "amount": "20", "timing": "specific_period", "period": 0,
             "included_in_cashflows": True, "contingent": False},
            {"id": "b", "name": "B", "amount": "30", "timing": "specific_period", "period": 2,
             "included_in_cashflows": False, "contingent": False},
        ]
        result = calculate_loan(case)
        self.assertEqual(result["fee_ledger"][1]["occurrences"],
                         [{"period": 2, "date": "2025-05-20", "amount": "30"}])
        self.assertEqual(result["reconciliation"]["periods"][2]["net_cashflow"], "-630")
        self.assertEqual(result["reconciliation"]["total_payment"], "1130")

    def test_contradictory_included_fees_are_rejected(self):
        case = fee_case(included=("upfront_a",))
        with self.assertRaises(CalculationError) as caught:
            calculate_loan(case)
        self.assertEqual(caught.exception.code, "CALCULATION_INCONSISTENT")
        case = fee_case(payment="100", included=("guarantee",))
        with self.assertRaises(CalculationError) as caught:
            calculate_loan(case)
        self.assertEqual(caught.exception.code, "CALCULATION_INCONSISTENT")
        case = fee_case(payment="913.69", included=("guarantee", "platform"))
        case["loan"]["nominal_apr"] = "0.08"
        with self.assertRaises(CalculationError) as caught:
            calculate_loan(case)
        self.assertEqual(caught.exception.code, "CALCULATION_INCONSISTENT")

    def test_included_fee_above_standard_annuity_and_rounding_tolerance(self):
        case = facts(period_payment="938.49")
        case["fees"] = [{"id": "a", "name": "A", "amount": "50", "timing": "per_period",
                         "included_in_cashflows": True, "contingent": False}]
        result = calculate_loan(case)
        self.assertEqual(result["reconciliation"]["periods"][1]["included_fees"], "50")
        self.assertEqual(result["summary"]["total_additional_fees"], "0")

    def test_cashflow_disagreement_is_rejected(self):
        from python.loan_plan import calculate as real_calculate

        def corrupt(payload):
            result = real_calculate(payload)
            result["cashflows"][1]["amount"] = "-1"
            return result

        with patch("python.loan_plan.calculate", side_effect=corrupt):
            with self.assertRaises(CalculationError) as caught:
                calculate_loan(fee_case())
        self.assertEqual(caught.exception.code, "CALCULATION_INCONSISTENT")

    def test_separate_fees_enter_cashflows_and_rate(self):
        result = calculate_loan(fee_case())
        cashflows = result["calculation"]["cashflows"]
        self.assertEqual([Decimal(row["amount"]) for row in cashflows],
                         [Decimal("18871")] + [Decimal("-1121.69")] * 24)
        self.assertEqual(Decimal(result["summary"]["total_cost"]), Decimal("8049.56"))
        nominal = Decimal(result["calculation"]["nominal_apr"])
        self.assertLess(abs(nominal - Decimal("0.36739117")), Decimal("0.00000001"))
        monthly = nominal / Decimal(12)
        npv = Decimal("18871") - sum(
            (Decimal("1121.69") / (Decimal(1) + monthly) ** period
             for period in range(1, 25)), Decimal(0))
        self.assertLess(abs(npv), Decimal("0.000001"))

    def test_included_and_mixed_fees_match_separate_fee_cashflows(self):
        reference = calculate_loan(fee_case())
        cases = [
            fee_case(disbursed="18871", included=("upfront_a", "upfront_b", "upfront_c")),
            fee_case(payment="1121.69", included=("guarantee", "platform")),
            fee_case(disbursed="19400", payment="1033.69", included=("upfront_a", "guarantee")),
        ]
        for case in cases:
            with self.subTest(disbursed=case["loan"]["disbursed"], payment=case["loan"]["period_payment"]):
                result = calculate_loan(case)
                self.assertEqual(result["calculation"]["cashflows"], reference["calculation"]["cashflows"])
                self.assertEqual(Decimal(result["calculation"]["nominal_apr"]),
                                 Decimal(reference["calculation"]["nominal_apr"]))
                self.assertEqual(Decimal(result["summary"]["total_cost"]), Decimal("8049.56"))

    def test_unknown_inclusion_of_each_fee_blocks_calculation(self):
        for index in range(5):
            with self.subTest(fee=index):
                case = fee_case()
                case["fees"][index]["included_in_cashflows"] = None
                with self.assertRaises(CalculationError) as caught:
                    calculate_loan(case)
                self.assertEqual(caught.exception.code, "MISSING_FIELDS")
                self.assertIn(f"fees[{index}].included_in_cashflows", caught.exception.details["fields"])

    def test_worker_calculate_loan_expands_fixed_payment_and_reports_summary(self):
        result = _dispatch({"operation": "calculate_loan", "payload": facts()})
        self.assertEqual(len(result["input"]["repayments"]), 12)
        self.assertTrue(all(row["amount"] == "888.49" for row in result["input"]["repayments"]))
        self.assertEqual(result["input"]["disbursements"][0], {"amount": "10000", "period": 0})
        self.assertEqual(result["summary"]["principal"], "10000")
        self.assertEqual(result["summary"]["disbursed"], "10000")
        self.assertEqual(result["summary"]["total_repayment"], "10661.88")
        self.assertEqual(result["summary"]["total_payment"], "10661.88")
        self.assertEqual(result["input"]["quoted_method"], "unknown")
        self.assertEqual(result["calculation"]["comparison"]["method"], "simple")
        self.assertEqual(result["calculation"]["comparison"]["method_basis"], "unavailable")
        self.assertEqual(result["calculation"]["comparison"]["disclosed_method"], "unknown")
        self.assertEqual(result["calculation"]["comparison"]["method_label"], "待确认")
        self.assertIsNone(result["calculation"]["comparison"]["computed_apr"])
        self.assertIsNone(result["calculation"]["comparison"]["gap_pp"])

    def test_unknown_method_is_presumed_simple_for_single_lump_payment(self):
        case = facts(principal="1000", disbursed="1000", term_periods=1,
                     periods_per_year=1, repay_method="schedule", period_payment=None,
                     nominal_apr=None)
        case["repayments"] = [{"amount": "1080", "period": 1}]
        case["disclosure"] = {"quoted_apr": "0.08", "quoted_method": "unknown"}
        result = calculate_loan(case)
        comparison = result["calculation"]["comparison"]
        self.assertEqual(result["input"]["quoted_method"], "unknown")
        self.assertEqual(comparison["method"], "simple")
        self.assertEqual(comparison["method_basis"], "assumed_simple")
        self.assertEqual(comparison["disclosed_method"], "unknown")
        self.assertEqual(comparison["method_label"], "按单利推定")
        self.assertEqual(comparison["computed_apr"], "0.08")
        self.assertEqual(comparison["gap_pp"], "0")

    def test_per_period_fee_is_added_once_per_period_and_increases_rate(self):
        case = facts()
        case["fees"] = [{"id": "service", "name": "Service fee", "amount": "50",
                         "timing": "per_period", "period": None,
                         "included_in_cashflows": False, "contingent": False}]
        result = calculate_loan(case)
        self.assertEqual(result["fee_totals"][0]["total"], "600")
        self.assertEqual(result["summary"]["total_additional_fees"], "600")
        self.assertEqual(result["summary"]["total_payment"], "11261.88")
        self.assertEqual(len(result["input"]["fees"]), 12)
        self.assertGreater(Decimal(result["calculation"]["nominal_apr"]), Decimal("0.12"))

    def test_included_fee_is_reported_but_not_added_again(self):
        case = facts(disbursed="9900")
        case["fees"] = [{"id": "origination", "name": "Origination", "amount": "100",
                         "timing": "upfront", "period": 0,
                         "included_in_cashflows": True, "contingent": False}]
        result = calculate_loan(case)
        self.assertEqual(result["fee_totals"][0]["total"], "100")
        self.assertEqual(result["input"]["fees"], [])
        self.assertEqual(result["summary"]["total_additional_fees"], "0")
        self.assertEqual(result["calculation"]["cashflows"][0]["amount"], "9900")

    def test_standard_repayment_methods_zero_rate_and_tail_rounding(self):
        cases = [
            ("equal_installment", {"principal": "100", "disbursed": "100", "term_periods": 3,
                                   "period_payment": None, "nominal_apr": "0"}, ["33.33", "33.33", "33.34"]),
            ("equal_principal", {"principal": "100", "disbursed": "100", "term_periods": 3,
                                  "period_payment": None, "nominal_apr": "0"}, ["33.33", "33.33", "33.34"]),
            ("interest_only", {"principal": "120", "disbursed": "120", "term_periods": 3,
                               "period_payment": None, "nominal_apr": "0.12"}, ["1.2", "1.2", "121.2"]),
            ("bullet", {"principal": "100", "disbursed": "100", "term_periods": 3,
                        "period_payment": None, "nominal_apr": "0.12"}, ["0", "0", "103"]),
        ]
        for method, overrides, expected in cases:
            with self.subTest(method=method):
                result = calculate_loan(facts(repay_method=method, **overrides))
                self.assertEqual([row["amount"] for row in result["input"]["repayments"]], expected)

    def test_equal_principal_uses_declining_balance_interest(self):
        result = calculate_loan(facts(principal="100", disbursed="100", term_periods=2,
                                      repay_method="equal_principal", period_payment=None,
                                      nominal_apr="0.12"))
        self.assertEqual([row["amount"] for row in result["input"]["repayments"]], ["51", "50.5"])

    def test_missing_fields_and_unknown_fee_classification_are_explicit(self):
        case = facts(disbursed=None)
        with self.assertRaises(CalculationError) as caught:
            calculate_loan(case)
        self.assertEqual(caught.exception.code, "MISSING_FIELDS")
        self.assertIn("loan.disbursed", caught.exception.details["fields"])

        case = facts()
        case["fees"] = [{"id": "x", "name": "Unknown", "amount": "2", "timing": "upfront",
                         "included_in_cashflows": False, "contingent": None}]
        with self.assertRaises(CalculationError) as caught:
            calculate_loan(case)
        self.assertEqual(caught.exception.code, "MISSING_FIELDS")
        self.assertIn("fees[0].contingent", caught.exception.details["fields"])

        case["fees"][0]["contingent"] = False
        case["fees"][0]["included_in_cashflows"] = None
        with self.assertRaises(CalculationError) as caught:
            calculate_loan(case)
        self.assertIn("fees[0].included_in_cashflows", caught.exception.details["fields"])

    def test_contingent_fee_is_retained_but_excluded_from_cost(self):
        case = facts()
        case["fees"] = [{"id": "late", "name": "Late charge", "amount": None,
                         "timing": "unknown", "included_in_cashflows": None,
                         "contingent": True}]
        result = calculate_loan(case)
        self.assertEqual(result["fee_totals"], [{"id": "late", "name": "Late charge",
                                                  "total": "0", "contingent": True}])
        self.assertEqual(result["summary"]["total_additional_fees"], "0")

    def test_generated_month_end_dates_clamp_to_calendar_end(self):
        result = calculate_loan(facts(principal="120", disbursed="120", term_periods=3,
                                      period_payment=None, nominal_apr="0", start_date="2024-01-31"))
        self.assertEqual(result["input"]["timing"], "periodic")
        self.assertEqual([row["date"] for row in result["calendar_schedule"]],
                         ["2024-02-29", "2024-03-31", "2024-04-30"])
        self.assertIsNotNone(result['calculation']['nominal_apr'])
        self.assertIsNotNone(result['calculation']['xirr_apr'])

    def test_explicit_irregular_dates_use_xirr_cashflow_path(self):
        case = facts(principal="1000", disbursed="1000", term_periods=2,
                     repay_method="schedule", period_payment=None, nominal_apr=None,
                     start_date="2025-01-01")
        case["repayments"] = [{"amount": "500", "date": "2025-02-15"},
                              {"amount": "600", "date": "2025-05-20"}]
        case["disclosure"] = {"quoted_apr": "0.12", "quoted_method": "xirr"}
        result = calculate_loan(case)
        self.assertEqual(result["input"]["timing"], "dated")
        self.assertEqual(result["input"]["repayments"][0]["date"], "2025-02-15")
        self.assertIsNotNone(result["calculation"]["xirr_apr"])
        self.assertEqual(result["calculation"]["comparison"]["method"], "xirr")
        self.assertEqual(result["calculation"]["comparison"]["method_basis"], "explicit")
        self.assertEqual(result["calculation"]["comparison"]["disclosed_method"], "xirr")

    def test_nine_public_calculation_examples_keep_expected_core_rates(self):
        cases = [
            ("10000", ["83.33"] * 11 + ["10083.33"], 12, "nominal_apr", Decimal("0.10")),
            ("10000", ["888.49"] * 12, 12, "nominal_apr", Decimal("0.12")),
            ("10000", ["836.55", "839.23", "841.92"] + ["869.88"] * 9, 12, "nominal_apr", Decimal("0.063")),
            ("10000", ["891.29"] * 12, 12, "nominal_apr", Decimal("0.126")),
            ("10000", ["907.31"] * 12, 12, "nominal_apr", Decimal("0.16")),
            ("1000", ["1080"], 1, "simple_apr", Decimal("0.08")),
            ("100000", ["0"] * 23 + ["110000"], 12, "effective_apr", Decimal("0.0488")),
            ("1000000", ["6599.6"] * 240, 12, "effective_apr", Decimal("0.0512")),
            ("99000", ["8833.3"] * 12, 12, "effective_apr", Decimal("0.1358")),
        ]
        for principal, repayments, ppy, rate_field, expected in cases:
            with self.subTest(rate=expected):
                term = len(repayments)
                case = facts(principal=principal, disbursed=principal, term_periods=term,
                             periods_per_year=ppy, repay_method="schedule", period_payment=None,
                             nominal_apr=None)
                case["repayments"] = [{"amount": amount, "period": i}
                                      for i, amount in enumerate(repayments, 1)]
                calculated = calculate_loan(case)["calculation"]
                self.assertAlmostEqual(float(Decimal(calculated[rate_field])), float(expected), places=3)

    def test_invalid_schedule_dates_and_amounts_are_rejected(self):
        case = facts()
        case["repayments"] = [{"amount": "1", "period": 1}]
        with self.assertRaises(CalculationError) as caught:
            calculate_loan(case)
        self.assertEqual(caught.exception.code, "INVALID_SCHEDULE")

        case = facts(principal="0")
        with self.assertRaises(CalculationError) as caught:
            calculate_loan(case)
        self.assertEqual(caught.exception.code, "INVALID_NUMBER")

        case = facts(start_date="2025-01-01")
        case["repayments"] = [{"amount": "500", "date": "2024-12-31"} for _ in range(12)]
        with self.assertRaises(CalculationError) as caught:
            calculate_loan(case)
        self.assertEqual(caught.exception.code, "INVALID_DATE")

    def test_fixed_contract_payment_is_never_adjusted_at_maturity(self):
        result = calculate_loan(facts(principal="100", disbursed="100", term_periods=3,
                                      period_payment="34", nominal_apr=None))
        self.assertEqual([row["amount"] for row in result["input"]["repayments"]], ["34", "34", "34"])


if __name__ == "__main__":
    unittest.main()
