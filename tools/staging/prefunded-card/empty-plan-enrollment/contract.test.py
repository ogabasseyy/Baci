import copy
import unittest
from datetime import datetime, timezone

from contract import DEADLINE, GOAL, IDENTITY_SHA, ROOT_SCOPE, digest, validate


NOW = datetime(2026, 10, 2, 12, tzinfo=timezone.utc)


def evidence_fixture():
    evidence = {'scope': dict(ROOT_SCOPE), 'goalId': GOAL, 'expiresAt': DEADLINE,
        'parentCommit': {'kind': 'empty_interest_goal_commit',
            'status': 'exact_empty_goal_bound_policy_pending', 'goalId': GOAL,
            'changesMade': True, 'rolledBack': False, 'identitySha256': IDENTITY_SHA,
            'interestPolicyEnabled': False, 'interestPolicyPresent': False,
            'providerIdMappingApproved': False, 'principalKobo': 0, 'newPrefundingKobo': 0,
            'oldGoalPrincipalKobo': 10000, 'approvalSha256': 'a'*64,
            'snapshotSha256': 'b'*64, 'sourceManifestSha256': 'c'*64,
            'schemaMd5': 'e'*32, 'stateMd5': 'b'*32},
        'providerWallet': {'scope': dict(ROOT_SCOPE), 'retrievedAt': '2026-10-02T12:00:00Z',
            'responseSha256': 'd'*64, 'interestEnabled': True, 'balanceKobo': 0, 'withdrawalCount': 0},
        'database': {'systemIdentifier': ROOT_SCOPE['systemIdentifier'], 'databaseName': 'postgres',
            'sessionUser': 'postgres', 'currentUser': 'postgres', 'localSocket': True,
            'observedAt': '2026-10-02T12:00:00Z',
            'metadata': {'schemaMd5': 'e'*32, 'securitySha256': 'f'*64, 'protectedSha256': 'a'*64}}}
    return evidence


def pins(evidence):
    return {field: digest(evidence[field]) for field in ('parentCommit','providerWallet','database')}


class ContractTests(unittest.TestCase):
    def test_accepts_independently_pinned_empty_goal_without_payout_assumption(self):
        evidence = evidence_fixture()
        self.assertEqual(validate(evidence, pins(evidence), NOW), evidence)

    def test_refuses_tampering_even_when_shape_and_values_still_look_valid(self):
        evidence = evidence_fixture()
        reviewed = pins(evidence)
        evidence['parentCommit']['approvalSha256'] = 'f'*64
        with self.assertRaisesRegex(ValueError, 'parentCommit_pin'):
            validate(evidence, reviewed, NOW)

    def test_refuses_exact_regressions_even_with_new_reviewed_hash(self):
        cases = [('goalId', ROOT_SCOPE['oldGoalId']), ('expiresAt', '2026-10-07T15:59:10Z')]
        for field, value in cases:
            with self.subTest(field=field):
                evidence = evidence_fixture()
                evidence[field] = value
                with self.assertRaises(ValueError):
                    validate(evidence, pins(evidence), NOW)
        cases = [('balanceKobo', 1), ('balanceKobo', False), ('interestEnabled', False),
                 ('retrievedAt', '2026-10-02T11:58:29Z'), ('retrievedAt','2026-10-02T12:00:01Z')]
        for field, value in cases:
            with self.subTest(field=field,value=value):
                evidence = evidence_fixture()
                evidence['providerWallet'][field] = value
                with self.assertRaises(ValueError):
                    validate(evidence, pins(evidence), NOW)

    def test_refuses_aliased_provider_wallet_and_database_role_or_system_drift(self):
        for container, field, value in [('scope','publicWalletId', ROOT_SCOPE['faasWalletId']),
                ('database','systemIdentifier','1'), ('database','currentUser','supabase_admin'),
                ('database','localSocket',False), ('database','observedAt','2026-10-02T11:54:59Z')]:
            with self.subTest(field=field):
                evidence = copy.deepcopy(evidence_fixture())
                evidence[container][field] = value
                with self.assertRaises(ValueError):
                    validate(evidence, pins(evidence), NOW)

    def test_refuses_unconfirmed_parent_commit_and_deadline(self):
        for field, value in [('changesMade',None),('rolledBack',True),('interestPolicyPresent',True),
                             ('principalKobo',False),('newPrefundingKobo',1)]:
            evidence = evidence_fixture()
            evidence['parentCommit'][field] = value
            with self.assertRaises(ValueError):
                validate(evidence, pins(evidence), NOW)
        with self.assertRaisesRegex(ValueError, 'expired'):
            evidence = evidence_fixture()
            validate(evidence, pins(evidence), datetime(2026,10,6,15,59,10,tzinfo=timezone.utc))

    def test_refuses_new_schema_even_when_its_projection_is_independently_pinned(self):
        evidence = evidence_fixture()
        evidence['database']['metadata']['schemaMd5'] = 'f'*32
        with self.assertRaisesRegex(ValueError, 'parent_schema_drift'):
            validate(evidence, pins(evidence), NOW)


if __name__ == '__main__':
    unittest.main()
