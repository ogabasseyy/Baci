from pathlib import Path
import unittest

import database_sql as renewal
from source_functions import APP_SYSTEM, SEALED


class DatabaseRenewalFencesTests(unittest.TestCase):
    def render(self):
        routines = {name: {'present': True, 'oid': str(46000 + index),
            'bodyMd5': pin['oldBodyMd5'], **{key: pin[key] for key in
                ('owner', 'language', 'securityDefiner', 'configuration', 'acl')}}
            for index, (name, pin) in enumerate(SEALED['functions'].items())}
        baseline = {'database': {'systemIdentifier': APP_SYSTEM, 'routines': routines,
            'expiryConstraint': {'oid': '46050', 'definitionSha256': 'a' * 64},
            'checkout': {'intentBeforeSha256': 'b' * 64, 'operationBeforeSha256': 'c' * 64}}}
        return renewal.render_database_sql(baseline, Path(__file__).resolve().parents[4]).decode()

    def test_refuses_expired_approval_at_both_transaction_boundaries(self):
        sql = self.render()
        deadline_check = "clock_timestamp() >= '2026-10-06T15:59:10Z'::timestamptz"
        self.assertIn(deadline_check, sql.split('END $week_baseline$;')[0])
        self.assertIn(deadline_check, sql.split('DO $week_postflight$')[1])
        self.assertIn("SET LOCAL TIME ZONE 'UTC';", sql)

    def test_preserves_password_role_attributes_and_membership_under_catalog_lock(self):
        sql = self.render()
        self.assertIn('LOCK TABLE pg_catalog.pg_auth_members IN SHARE MODE;', sql)
        self.assertIn("to_jsonb(role_row)-'rolvaliduntil'", sql)
        self.assertIn('baci.week_renewal.roles_before', sql)
        self.assertIn('week renewal executor passwords changed', sql)

    def test_only_expired_financial_roles_are_renewed_and_retired_old_expiry_is_retained(self):
        sql = self.render()
        self.assertIn("AND rolvaliduntil='2026-09-29T15:59:10Z'::timestamptz LOOP", sql)
        self.assertNotIn('prefunded_snapshot_verifier', sql)
        self.assertIn("(phase = 'retired_unconfirmed' AND expires_at = '2026-09-29T15:59:10Z'", sql)
        self.assertIn('week renewal protected financial state changed', sql)


if __name__ == '__main__':
    unittest.main()
