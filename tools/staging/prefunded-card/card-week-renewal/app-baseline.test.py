from pathlib import Path
import unittest


SQL = Path(__file__).with_name("app-baseline.sql").read_text()


class AppBaselineSqlTests(unittest.TestCase):
    def test_query_is_pinned_read_only_and_returns_predecessor_metadata(self):
        self.assertIn("BEGIN READ ONLY;", SQL)
        self.assertIn("SET LOCAL TIME ZONE 'UTC';", SQL)
        self.assertIn("ROLLBACK;", SQL)
        self.assertIn("7685292944002592802", SQL)
        self.assertIn("'present', routine.oid IS NOT NULL", SQL)
        self.assertNotIn("pg_get_function_identity_arguments", SQL)
        for signature in (
            "prefunded_card.checkout_validate_scope(jsonb,boolean)",
            "prefunded_card.checkout_intent_json(prefunded_card.checkout_intents)",
            "prefunded_card.checkout_reserve(jsonb,jsonb)",
            "prefunded_card.checkout_claim_initialization(jsonb,jsonb)",
            "prefunded_card.checkout_recovery_candidates(jsonb,jsonb,integer)",
        ):
            self.assertIn(signature, SQL)
        self.assertIn("intent_before_sha256", SQL)
        self.assertIn("'constraints'", SQL)
        self.assertIn("pg_get_constraintdef", SQL)


if __name__ == "__main__":
    unittest.main()
