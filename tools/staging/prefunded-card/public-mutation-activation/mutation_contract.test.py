import copy
from datetime import datetime, timezone
import unittest

import mutation_contract as contract
from protected_snapshot import TABLES

NOW = datetime(2026, 10, 2, tzinfo=timezone.utc).timestamp()
SEAL = contract.FINANCIAL_SEAL


def snapshot():
    return {'systemIdentifier': '7685292944002592802', 'readOnly': True,
        'protectedFinancialSha256': 'b' * 64,
        'tables': {name: {'count': 1, 'sha256': 'c' * 64} for name in TABLES}}


def evidence():
    return {'sealSha256': SEAL, 'observedAt': datetime.fromtimestamp(NOW, timezone.utc).isoformat(),
        'financialReport': {'status': 'financial-workers-ready-public-readonly',
            'deadline': contract.DEADLINE, 'mutationsEnabled': False, 'newPaymentStarted': False},
        'public': {'archiveSha256': contract.ARCHIVE, 'manifestSha256': contract.MANIFEST,
            'getStatus': 200, 'enabled': False, 'maximumAmountKobo': 0,
            'postStatus': 503, 'patchStatus': 503, 'mutationsEnabled': False},
        'runtime': {'status': 'activated-runtime-current', 'deadline': contract.DEADLINE,
            'replay': 'fresh-completed-pass', 'snapshot': 'fresh-completed-pass',
            'background': 'fresh-completed-pass', 'schedules': ['snapshot', 'background']},
        'restricted': {'tlsReadiness': {'status': 'restricted-tls-ready',
            'profiles': ['worker', 'authorizer', 'evidence'], 'readOnly': True,
            'cardPaymentsEnabled': False}, 'replayReadiness': {
                'status': 'replay-runtime-ready', 'readOnly': True},
            'replayConfigurationChecked': True, 'snapshotTlsIdentityVerified': True},
        'publicPrivate': {'status': 'public-private-ready', 'customerTlsVerified': True,
            'verifierTlsVerified': True, 'httpStarted': False},
        'chainSha256': 'd' * 64, 'approvedChainSha256': 'd' * 64,
        'protectedBefore': snapshot(), 'protectedAfter': snapshot()}


class ContractTests(unittest.TestCase):
    def test_complete_bound_evidence_validates_without_changing_it(self):
        value = evidence()
        before = copy.deepcopy(value)
        contract.validate(value, SEAL, snapshot(), NOW)
        self.assertEqual(value, before)

    def test_missing_actual_financial_report_or_boolean_readiness_is_refused(self):
        for name in ('financialReport', 'runtime', 'restricted', 'publicPrivate'):
            value = evidence()
            value[name] = True
            with self.subTest(name=name), self.assertRaises(ValueError):
                contract.validate(value, SEAL, snapshot(), NOW)

    def test_stale_future_naive_or_nonfinite_clock_is_refused(self):
        for clock in (NOW + 61, NOW - 1, float('nan'), float('inf'), contract.EPOCH - 600):
            with self.subTest(clock=clock), self.assertRaises(ValueError):
                contract.validate(evidence(), SEAL, snapshot(), clock)
        value = evidence()
        value['observedAt'] = '2026-10-02T00:00:00'
        with self.assertRaises(ValueError):
            contract.validate(value, SEAL, snapshot(), NOW)

    def test_wrong_seal_budget_cap_or_protected_row_is_refused(self):
        for mutate in (
            lambda value: value.update(sealSha256='e' * 64),
            lambda value: value['public'].update(maximumAmountKobo=10000),
            lambda value: value.update(chainSha256='e' * 64),
            lambda value: value['protectedAfter']['tables'][TABLES[0]].update(count=2),
        ):
            value = evidence()
            mutate(value)
            with self.assertRaises(ValueError):
                contract.validate(value, SEAL, snapshot(), NOW)

    def test_prior_release_is_refused_even_when_all_evidence_matches_its_seal(self):
        value = evidence()
        prior = 'a' * 64
        value['sealSha256'] = prior
        with self.assertRaisesRegex(ValueError, 'r8_financial_seal_required'):
            contract.validate(value, prior, snapshot(), NOW)

    def test_only_exact_enabled_goal_and_bounded_capability_are_accepted(self):
        body = {'goalId': contract.GOAL, 'enabled': True, 'maximumAmountKobo': 10000, 'currency': 'NGN'}
        contract.enabled_capability((200, body))
        for changes in ({'goalId': 'other'}, {'maximumAmountKobo': 10001}, {'enabled': False}):
            with self.assertRaises(ValueError):
                contract.enabled_capability((200, {**body, **changes}))


if __name__ == '__main__':
    unittest.main()
