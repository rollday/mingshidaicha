import unittest
from decimal import Decimal

from python.calculation import CalculationError, calculate


def periodic(disbursement, repayments, periods_per_year=12, **extra):
    return {
        "timing": "periodic",
        "periods_per_year": periods_per_year,
        "disbursements": [{"amount": str(disbursement), "period": 0}],
        "repayments": [
            {"amount": str(amount), "period": period}
            for period, amount in enumerate(repayments, 1)
        ],
        **extra,
    }


class CalculationTests(unittest.TestCase):
    def assertRate(self, actual, expected, places=2):
        self.assertIsNotNone(actual)
        self.assertAlmostEqual(float(Decimal(actual) * 100), expected, places=places)

    def test_cba_public_examples(self):
        cases = [
            (periodic("10000", ["83.33"] * 11 + ["10083.33"]), "nominal_apr", 10.00),
            (periodic("10000", ["888.49"] * 12), "nominal_apr", 12.00),
            (periodic("10000", ["836.55", "839.23", "841.92"] + ["869.88"] * 9), "nominal_apr", 6.30),
            (periodic("10000", ["891.29"] * 12), "nominal_apr", 12.60),
            (periodic("10000", ["907.31"] * 12), "nominal_apr", 16.00),
        ]
        for request, field, expected in cases:
            with self.subTest(expected=expected):
                self.assertRate(calculate(request)[field], expected)

    def test_cba_simple_one_year_example(self):
        result = calculate(periodic("10000", ["10800"], periods_per_year=1))
        self.assertRate(result["simple_apr"], 8.0)
        self.assertRate(result["nominal_apr"], 8.0)

    def test_pbc_public_examples(self):
        cases = [
            (periodic("100000", ["110000"] + ["0"] * 23), "effective_apr", 4.88),
            (periodic("1000000", ["6599.6"] * 240), "effective_apr", 5.12),
            (periodic("99000", ["8833.3"] * 12), "effective_apr", 13.58),
        ]
        for request, field, expected in cases:
            with self.subTest(expected=expected):
                # Zeros disappear when equal-time flows are combined; represent PBC1 at period 24.
                if expected == 4.88:
                    request["repayments"] = [{"amount": "110000", "period": 24}]
                self.assertRate(calculate(request)[field], expected, places=1)

    def test_amounts_must_be_decimal_strings(self):
        request = periodic("1000", ["1100"])
        request["disbursements"][0]["amount"] = 1000.0
        with self.assertRaisesRegex(CalculationError, "decimal string"):
            calculate(request)

    def test_included_fee_is_not_deducted_twice(self):
        request = periodic("1000", ["1100"], fees=[{
            "name": "origination", "amount": "100", "period": 0,
            "included_in_cashflows": True,
        }], periods_per_year=1)
        result = calculate(request)
        self.assertEqual(result["cashflows"][0]["amount"], "1000")
        self.assertRate(result["nominal_apr"], 10.0)

    def test_unknown_quoted_method_does_not_compare(self):
        result = calculate(periodic("1000", ["1100"], quoted_apr="0.10"))
        self.assertEqual(result["comparison"]["quoted_apr"], "0.10")
        self.assertIsNone(result["comparison"]["computed_apr"])
        self.assertIsNone(result["comparison"]["gap_pp"])
        self.assertIsNone(result["comparison"]["exceeds_tolerance"])

    def test_comparison_uses_unrounded_values_and_strict_tolerance(self):
        result = calculate(periodic(
            "1000", ["1100"], periods_per_year=1,
            quoted_apr="0.095", quoted_method="simple", comparison_tolerance_pp="0.5",
        ))
        self.assertEqual(Decimal(result["comparison"]["gap_pp"]), Decimal("0.5"))
        self.assertFalse(result["comparison"]["exceeds_tolerance"])

    def test_dated_xirr_uses_act_365(self):
        request = {
            "timing": "dated",
            "disbursements": [{"amount": "1000", "date": "2024-01-01"}],
            "repayments": [{"amount": "1080", "date": "2024-12-31"}],
            "quoted_method": "xirr",
        }
        result = calculate(request)
        self.assertRate(result["xirr_apr"], 8.0, places=5)
        self.assertIsNone(result["nominal_apr"])
        self.assertEqual(result["comparison"]["computed_apr"], result["xirr_apr"])

    def test_future_positive_disbursement_is_rejected(self):
        request = periodic("1000", ["500", "500"])
        request["repayments"] = [
            {"amount": "500", "period": 2}, {"amount": "500", "period": 3}
        ]
        request["disbursements"].append({"amount": "100", "period": 1})
        with self.assertRaisesRegex(CalculationError, "multi-root"):
            calculate(request)

    def test_missing_timing_coordinate_and_invalid_date_are_rejected(self):
        request = periodic("1000", ["1100"])
        del request["repayments"][0]["period"]
        with self.assertRaises(CalculationError) as caught:
            calculate(request)
        self.assertEqual(caught.exception.code, "INVALID_PERIOD")
        dated = {
            "timing": "dated", "disbursements": [{"amount": "1000", "date": "2024-02-30"}],
            "repayments": [{"amount": "1100", "date": "2025-01-01"}],
        }
        with self.assertRaises(CalculationError) as caught:
            calculate(dated)
        self.assertEqual(caught.exception.code, "INVALID_DATE")

    def test_no_root_for_non_outflow_schedule(self):
        request = periodic("1000", ["0"])
        with self.assertRaises(CalculationError) as caught:
            calculate(request)
        self.assertEqual(caught.exception.code, "NO_IRR_ROOT")

    def test_high_rate_expands_the_root_bracket(self):
        result = calculate(periodic("100", ["400"], periods_per_year=1))
        self.assertEqual(Decimal(result["nominal_apr"]), Decimal("3"))

    def test_periodic_data_does_not_claim_xirr(self):
        result = calculate(periodic("100", ["110"], quoted_method="xirr", quoted_apr="0.1"))
        self.assertIsNone(result["comparison"]["computed_apr"])

    def test_nominal_threshold_ignores_only_solver_uncertainty(self):
        for payment in ["1100", "1130", "2000"]:
            with self.subTest(payment=payment):
                quoted = str((Decimal(payment) / Decimal("1000") - 1) - Decimal("0.005"))
                result = calculate(periodic("1000", [payment], periods_per_year=1,
                                            quoted_method="nominal", quoted_apr=quoted))
                self.assertFalse(result["comparison"]["exceeds_tolerance"])

    def test_large_amounts_keep_small_fees_in_cashflows(self):
        amount = "12345678901234567890123456789012345678901234567890.12"
        request = periodic(amount, [amount], periods_per_year=1, fees=[{
            "name": "fee", "amount": "0.01", "period": 0, "included_in_cashflows": False,
        }])
        result = calculate(request)
        self.assertEqual(result["cashflows"][0]["amount"], "12345678901234567890123456789012345678901234567890.11")


if __name__ == "__main__":
    unittest.main()
