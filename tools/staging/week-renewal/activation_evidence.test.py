import copy
import json
from pathlib import Path
import unittest

from activation_evidence import financial_fences, funding_role, container_identity
from renewal_contract import SYSTEM, TARGET_EPOCH, Refused


INTENT = 'd8bcf921-61b3-4647-90e2-5648e4d6967d'


def database():
    return {'systemIdentifier': SYSTEM, 'readOnly': True, 'principalKobo': 10000,
            'treasury': {'id': 'ffffcb16-2e95-5cff-a591-e9cc81cf5f57', 'enabled': True,
                         'verifiedAvailableKobo': 10000, 'reservedKobo': 0, 'consumedKobo': 0},
            'intents': [{'id': INTENT, 'phase': 'retired_unconfirmed', 'amountKobo': 10000}],
            'operations': [{'id': INTENT, 'retired': True, 'transfer': 'not_started',
                            'collection': 'pending', 'projection': 'unapplied'}],
            'retirementAuditRows': 1}


def role():
    return {'systemIdentifier': SYSTEM, 'readOnly': True,
            'role': {'name': 'piggyvest_staging_provisioner', 'present': True, 'login': True,
                     'superuser': False, 'bypassRls': False, 'createRole': False,
                     'createDb': False, 'replication': False, 'inherits': False,
                     'expiresAtEpoch': TARGET_EPOCH + 100, 'unsafeMembership': False,
                     'memberships': []}, 'functions': []}


class ActivationEvidenceTests(unittest.TestCase):
    def test_financial_fences_include_operation_retirement_not_just_intent_phase(self):
        result = financial_fences(database())
        self.assertTrue(result['oldIntentRetained'])
        self.assertEqual(result['principalKobo'], 10000)
        self.assertEqual(result['treasuryApprovedKobo'], 10000)
        for category, field, value in (('operations', 'retired', False), ('operations', 'transfer', 'succeeded'),
                                       ('operations', 'projection', 'applied'), ('intents', 'phase', 'pending')):
            changed = database()
            changed[category][0][field] = value
            with self.subTest(field=field), self.assertRaises(Refused):
                financial_fences(changed)

    def test_financial_and_physical_drift_refuses(self):
        for field, value in (('principalKobo', 10001), ('systemIdentifier', 'other'),
                             ('readOnly', False), ('retirementAuditRows', 0)):
            with self.subTest(field=field), self.assertRaises(Refused):
                financial_fences({**database(), field: value})
        for field in ('reservedKobo', 'consumedKobo', 'verifiedAvailableKobo'):
            changed = database()
            changed['treasury'][field] += 1
            with self.assertRaises(Refused):
                financial_fences(changed)

    def test_expired_or_unbounded_funding_login_is_reported_not_renewed(self):
        for expiry in (None, 1790697550):
            value = role()
            value['role']['expiresAtEpoch'] = expiry
            result = funding_role(value)
            self.assertFalse(result['coversRequestedDeadline'])
            self.assertFalse(result['credentialsChanged'])
        self.assertTrue(funding_role(role())['coversRequestedDeadline'])

    def test_unsafe_role_attributes_or_memberships_cannot_pass(self):
        for name in ('superuser', 'bypassRls', 'createRole', 'createDb', 'replication', 'unsafeMembership'):
            value = role()
            value['role'][name] = True
            with self.subTest(name=name), self.assertRaises(Refused):
                funding_role(value)

    def test_container_requires_exact_ids_network_endpoint_and_compose_identity(self):
        identity = {'containers': {'rest': {'id': 'a' * 64, 'ip': '172.23.0.4', 'endpointId': 'b' * 64}},
                    'networks': {'database': {'id': 'c' * 64}}}
        value = {'Id': 'a' * 64, 'State': {'Running': True, 'Restarting': False},
                 'Config': {'Labels': {'com.docker.compose.project': 'baci-isolated-savings',
                                       'com.docker.compose.service': 'rest'}},
                 'NetworkSettings': {'Networks': {'database': {'NetworkID': 'c' * 64,
                                      'IPAddress': '172.23.0.4', 'EndpointID': 'b' * 64}}}}
        self.assertEqual(container_identity(value, identity, 'rest')['ip'], '172.23.0.4')
        changed = copy.deepcopy(value)
        changed['NetworkSettings']['Networks']['database']['EndpointID'] = 'd' * 64
        with self.assertRaises(Refused):
            container_identity(changed, identity, 'rest')

    def test_database_metadata_source_is_readonly_and_never_exposes_password(self):
        content = Path(__file__).with_name('activation-funding-role.sql').read_text()
        self.assertTrue(content.startswith('BEGIN READ ONLY;'))
        self.assertTrue(content.rstrip().endswith('ROLLBACK;'))
        for forbidden in ('rolpassword', 'ALTER ROLE', 'GRANT ', 'INSERT ', 'UPDATE ', 'DELETE '):
            self.assertNotIn(forbidden, content)
        self.assertIn(SYSTEM, content)
        self.assertNotIn('password', json.dumps(funding_role(role())))


if __name__ == '__main__':
    unittest.main()
