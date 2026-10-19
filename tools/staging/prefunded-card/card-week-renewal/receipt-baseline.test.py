from pathlib import Path
import unittest


SQL = Path(__file__).with_name("receipt-baseline.sql").read_text()


class ReceiptBaselineSqlTests(unittest.TestCase):
    def test_query_is_pinned_read_only_and_reports_only_metadata(self):
        self.assertIn("BEGIN READ ONLY;", SQL)
        self.assertIn("ROLLBACK;", SQL)
        self.assertIn("7686901100561231906", SQL)
        self.assertIn("'present', routine.oid IS NOT NULL", SQL)
        self.assertIn("definitionSha256", SQL)
        self.assertNotIn("receipt_body", SQL)


if __name__ == "__main__":
    unittest.main()
