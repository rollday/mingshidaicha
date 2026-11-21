import unittest

from scripts.grade_round2 import grade, score_comparison


class RoundTwoGradingTest(unittest.TestCase):
    def test_expected_discrepancy_above_half_a_point_is_a_valid_comparison(self):
        expected = {"status": "complete", "method": "nominal", "disclosed_method": "nominal",
                    "quoted_apr": "0.12", "computed_apr": "0.13", "gap_pp": "1", "exceeds_tolerance": True}
        actual = dict(expected, method_basis="explicit")
        self.assertEqual(score_comparison(actual, expected), [])
        self.assertIn("comparison.exceeds_tolerance", score_comparison(dict(actual, exceeds_tolerance=False), expected))
        self.assertIn("comparison.computed_apr", score_comparison(dict(actual, computed_apr="0.1302", gap_pp="1.02"), expected))
        self.assertIn("comparison.incomplete", score_comparison(dict(actual, gap_pp=None), expected))
        self.assertIn("comparison.method", score_comparison(dict(actual, method="effective"), expected))

    def test_missing_reference_is_unscorable_with_all_slots_accounted_for(self):
        samples, rounds, details, history = grade({}, {})
        self.assertEqual(len(samples), 22)
        self.assertEqual(len(rounds), 66)
        self.assertTrue(all(x["verdict"] == "UNSCORABLE" for x in samples))
        self.assertTrue(all(x["first_outcome"] == "not_run" for x in rounds))
        self.assertEqual(details, [])
        self.assertEqual(history, [])
