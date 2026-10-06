from pathlib import Path
import unittest

import notification_collection as subject


HERE = Path(__file__).resolve().parent


class Tests(unittest.TestCase):
    def test_same_transaction_keeps_original_snapshot_and_role_guard(self):
        snapshot = (HERE.parents[1]/'replay-complete-cutover-owner/financial_snapshot.sql').read_bytes()
        query = subject.compose(snapshot, (HERE/'notification-scope-query.sql').read_bytes(),
            (HERE/'notification-role-guard.sql').read_bytes())
        self.assertEqual(query.count('BEGIN ISOLATION LEVEL'), 1)
        self.assertEqual(query.count('ROLLBACK;'), 1)
        self.assertIn('notification function-only role contract refused', query)
        self.assertIn(snapshot.decode().removesuffix('ROLLBACK;\n'), query)

    def test_unpinned_scope_or_guard_and_non_ro_snapshot_refuse(self):
        snapshot = (HERE.parents[1]/'replay-complete-cutover-owner/financial_snapshot.sql').read_bytes()
        scope = (HERE/'notification-scope-query.sql').read_bytes()
        guard = (HERE/'notification-role-guard.sql').read_bytes()
        for values in ((snapshot, scope+b' ', guard), (snapshot, scope, guard+b' '),
                (snapshot.replace(b'READ ONLY', b'READ WRITE'), scope, guard)):
            with self.assertRaises(ValueError):
                subject.compose(*values)

    def test_strict_two_frame_output_refuses_extra_duplicate_and_nonfinite_json(self):
        value = subject.decode_output('{}\n{"scope":{},"database":{}}\n')
        self.assertEqual(set(value), {'scope', 'database', 'protectedSnapshot'})
        for raw in ('{}\n{}\n{}', '{}\n{"scope":{},"scope":{},"database":{}}',
                '{}\n{"scope":NaN,"database":{}}'):
            with self.assertRaises(ValueError):
                subject.decode_output(raw)


if __name__ == '__main__':
    unittest.main()
