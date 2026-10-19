import copy
import unittest

import protected_snapshot as snapshot


def protected_state():
    return {'systemIdentifier': '7685292944002592802', 'readOnly': True,
        'protectedFinancialSha256': 'a' * 64,
        'tables': {name: {'count': 1, 'sha256': 'b' * 64} for name in snapshot.TABLES}}


class ProtectedSnapshotTests(unittest.TestCase):
    def test_accepts_identical_full_protected_snapshot(self):
        before = protected_state()
        snapshot.prove_unchanged(before, copy.deepcopy(before))

    def test_refuses_same_balances_when_complete_history_digest_changed(self):
        before = protected_state()
        after = copy.deepcopy(before)
        after['tables']['piggyvest_savings_ledger.postings']['sha256'] = 'c' * 64
        with self.assertRaisesRegex(ValueError, 'independent_full_protected_snapshot_changed'):
            snapshot.prove_unchanged(before, after)

    def test_refuses_missing_table_even_when_both_snapshots_match(self):
        before = protected_state()
        before['tables'].pop('prefunded_card.checkout_retirements')
        with self.assertRaisesRegex(ValueError, 'independent_protected_snapshot_incomplete'):
            snapshot.prove_unchanged(before, before)

    def test_query_hashes_full_rows_in_one_readonly_snapshot_without_provider_output(self):
        sql = snapshot.snapshot_sql().decode()
        self.assertIn('REPEATABLE READ READ ONLY', sql)
        self.assertIn('to_jsonb(protected_row)::text', sql)
        self.assertNotIn('COMMIT;', sql)
        self.assertNotIn('SELECT *', sql)
        for table in snapshot.TABLES:
            self.assertIn('FROM ' + table + ' protected_row', sql)


if __name__ == '__main__':
    unittest.main()
