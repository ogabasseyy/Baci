import copy
from datetime import datetime, timezone
import json
import unittest
from unittest.mock import patch

import readiness_evidence_roles as roles

NOW = 1790913600


def baseline():
    return {'systemIdentifier': roles.SYSTEM, 'readOnly': True, 'sealSha256': 'a' * 64,
        'observedAt': datetime.fromtimestamp(NOW, timezone.utc).isoformat(),
        'immutableGuardVerified': True,
        'roles': {name: {'expiresAt': roles.OLD, 'unsafe': False,
            **{field: 'b' * 64 for field in roles.HASHES}} for name in roles.ROLES},
        'binding': {'identitySha256': 'c' * 64, 'expiresAt': roles.OLD}}


def renewed(source):
    result = copy.deepcopy(source)
    for value in result['roles'].values():
        value['expiresAt'] = roles.DEADLINE
    result['binding']['expiresAt'] = roles.DEADLINE
    return result


class RoleEvidenceTests(unittest.TestCase):
    def setUp(self):
        root = patch.object(roles.os, 'geteuid', return_value=0)
        root.start()
        self.addCleanup(root.stop)

    def test_nonroot_collection_refuses_before_database_contact(self):
        with patch.object(roles.os, 'geteuid', return_value=501), patch.object(roles, 'database') as query:
            with self.assertRaisesRegex(Exception, 'root_required'):
                roles.collect('a' * 64, query=query)
            query.assert_not_called()

    def test_collects_only_readonly_hash_metadata_never_passwords(self):
        value = baseline()
        def query(statement):
            self.assertIn('REPEATABLE READ READ ONLY', statement)
            self.assertIn("to_jsonb(role)-'rolvaliduntil'-'rolpassword'", statement)
            self.assertIn("rolpassword,''", statement)
            self.assertIn('has_function_privilege', statement)
            self.assertIn(roles.GUARD_MD5, statement)
            return json.dumps(value)
        result = roles.collect('a' * 64, query=query, now=lambda: NOW)
        self.assertEqual(set(result['roles']), set(roles.ROLES))

    def test_expiry_only_renewal_derives_owner_gate_fields_from_actual_equal_hashes(self):
        before = baseline()
        result = roles.compare(before, renewed(before), NOW)
        self.assertTrue(all(row['passwordUnchanged'] for row in result['roles'].values()))
        self.assertTrue(result['snapshotBinding']['immutableTriggerRestored'])

    def test_password_acl_membership_or_role_attributes_drift_refuses(self):
        before = baseline()
        for field in roles.HASHES:
            after = renewed(before)
            after['roles']['prefunded_snapshot_verifier'][field] = 'd' * 64
            with self.subTest(field=field), self.assertRaises(Exception):
                roles.compare(before, after, NOW)

    def test_expired_binding_disabled_guard_wrong_identity_stale_or_different_seal_refuses(self):
        before = baseline()
        changes = [('immutableGuardVerified', False), ('systemIdentifier', 'another'),
            ('sealSha256', 'd' * 64), ('observedAt', '2026-09-29T15:59:10Z')]
        for field, value in changes:
            after = renewed(before)
            after[field] = value
            with self.subTest(field=field), self.assertRaises(Exception):
                roles.compare(before, after, NOW)
        with self.assertRaises(Exception):
            roles.compare(before, before, NOW)


if __name__ == '__main__':
    unittest.main()
