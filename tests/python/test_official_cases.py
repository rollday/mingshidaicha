"""公开自律规范附 1 的九个披露示例，验证当前 Python 计算结果。

来源：https://www.cnafc.org/cnafc/resources/front/upload/20260918162155_4937.pdf
例 8 只复算文中当前期供，不预测浮动利率未来路径；例 6/7 的或有费用不计入正常履约成本。
"""
import unittest
from decimal import Decimal

from python.loan_plan import calculate_loan


class OfficialCases(unittest.TestCase):
    def check_case(self, principal, payments, periods_per_year, expected, *, fees=None, method="nominal"):
        facts = {
            "loan": {"principal": principal, "disbursed": principal, "term_periods": len(payments),
                     "periods_per_year": periods_per_year, "repay_method": "schedule", "start_date": None},
            "repayments": [{"period": i, "amount": amount} for i, amount in enumerate(payments, 1)],
            "fees": fees or [], "disclosure": {"quoted_apr": expected, "quoted_method": method},
        }
        result = calculate_loan(facts)
        value = result["calculation"]["comparison"]["computed_apr"]
        self.assertIsNotNone(value)
        # Displayed monthly payments are rounded to cents; official rates are approximate.
        self.assertLess(abs(Decimal(value) - Decimal(expected)), Decimal("0.00005"))
        self.assertFalse(result["calculation"]["comparison"]["exceeds_tolerance"])
        return result

    def test_01_one_year_bullet(self):
        self.check_case("10000", ["10800"], 1, "0.08", method="simple")

    def test_02_monthly_interest_and_final_principal(self):
        self.check_case("10000", ["83.33"] * 11 + ["10083.33"], 12, "0.10")

    def test_03_equal_installments(self):
        self.check_case("10000", ["888.49"] * 12, 12, "0.12")

    def test_04_discounted_first_three_installments(self):
        self.check_case("10000", ["836.55", "839.23", "841.92"] + ["869.88"] * 9, 12, "0.063")

    def test_05_equal_installments_with_contingent_costs(self):
        penalties = [{"id": "late", "name": "逾期罚息", "contingent": True},
                     {"id": "early", "name": "提前还款违约金", "contingent": True}]
        self.check_case("10000", ["891.29"] * 12, 12, "0.126", fees=penalties)

    def test_06_installments_and_guarantee_fee(self):
        fees = [{"id": "guarantee", "name": "担保费", "amount": "47.56", "timing": "per_period",
                 "included_in_cashflows": False, "contingent": False},
                {"id": "late", "name": "逾期罚息", "contingent": True},
                {"id": "misuse", "name": "挪用罚息", "contingent": True}]
        result = self.check_case("10000", ["859.75"] * 12, 12, "0.16", fees=fees)
        self.assertEqual(Decimal(result["summary"]["total_additional_fees"]), Decimal("570.72"))

    def test_07_guarantee_fee_and_additional_contingent_cost(self):
        fees = [{"id": "guarantee", "name": "担保费", "amount": "47.56", "timing": "per_period",
                 "included_in_cashflows": False, "contingent": False},
                {"id": "late", "name": "逾期罚息", "contingent": True},
                {"id": "misuse", "name": "挪用罚息", "contingent": True},
                {"id": "penalty", "name": "逾期违约金", "contingent": True}]
        result = self.check_case("10000", ["859.75"] * 12, 12, "0.16", fees=fees)
        self.assertEqual(Decimal(result["summary"]["total_additional_fees"]), Decimal("570.72"))

    def test_08_housing_loan_at_current_floating_rate(self):
        self.check_case("3000000", ["12729.17"] * 360, 12, "0.0305")

    def test_09_three_month_consumer_installments(self):
        self.check_case("200", ["67.56"] * 3, 12, "0.0802")


if __name__ == "__main__":
    unittest.main()
