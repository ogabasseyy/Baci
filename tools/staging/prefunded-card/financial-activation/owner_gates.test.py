import copy
from datetime import datetime, timezone
import unittest

import owner_gates as gates
from protected_snapshot import TABLES

NOW = datetime(2026, 10, 2, 6, tzinfo=timezone.utc).timestamp()
SEAL = 'a' * 64


def evidence():
    protected = {'systemIdentifier': '7685292944002592802', 'readOnly': True,
        'protectedFinancialSha256': 'c' * 64,
        'tables': {name: {'count': 1, 'sha256': 'd' * 64} for name in TABLES}}
    return {'sealSha256': SEAL, 'observedAt': datetime.fromtimestamp(NOW, timezone.utc).isoformat(),
        'public': {'archiveSha256': '882f0fd9d436a8117a48df1ae45bb4dba95d43da2c28b3a7f1d7c7e379cea1b2',
            'manifestSha256': '42b5f4e5f457ccea7fa1b61192251b60e0b8f01b05858fc2220b1944b5de62d8',
            'getStatus': 200, 'enabled': False, 'maximumAmountKobo': 0,
            'postStatus': 503, 'patchStatus': 503, 'mutationsEnabled': False},
        'financialContainersStopped': True, 'financialSchedulesStopped': True,
        'replayConfigurationChecked': True, 'jwtSignaturesVerified': True,
        'jwtExpiresAt': gates.DEADLINE, 'prefundedReplayPresent': True, 'financialDatabaseAbsent': True,
        'tlsReadiness': {'status': 'restricted-tls-ready', 'profiles': ['worker','authorizer','evidence'],
            'readOnly': True, 'cardPaymentsEnabled': False},
        'replayReadiness': {'status': 'replay-runtime-ready', 'readOnly': True},
        'snapshotTlsIdentityVerified': True,
        'roles': {name: {'expiresAt': gates.DEADLINE, 'passwordUnchanged': True,
            'privilegesUnchanged': True, 'membershipUnchanged': True, 'unsafe': False} for name in gates.ROLES},
        'snapshotBinding': {'expiresAt': gates.DEADLINE, 'identityUnchanged': True, 'immutableTriggerRestored': True},
        'timers': {name: {'active': True, 'effectiveDeadline': gates.DEADLINE, 'dropIns': [],
            'needDaemonReload': False, 'stopTargetsVerified': True} for name in gates.TIMERS},
        'isolationContractsVerified': True, 'separateSnapshotCredential': True,
        'sourceAndInstalledArtifactPinsVerified': True, 'guardedRenewalCommitted': True,
        'rollbackRehearsalBoundToSql': True, 'constraintsAndHistoryPreserved': True,
        'protectedBefore': protected, 'protectedAfter': copy.deepcopy(protected)}


class Adapter:
    def __init__(self):
        self.events = []
        self.failure = None

    def __getattr__(self, name):
        def operation(*args):
            self.events.append(name)
            if name == self.failure:
                return False
            return True
        return operation

    def prestart_evidence(self):
        return evidence()

    def preschedule_evidence(self):
        value = evidence()
        value.update(financialContainersStopped=False, freshReplayCompletedPass=True)
        return value


class OwnerGateTests(unittest.TestCase):
    def test_complete_prestart_chain_still_keeps_public_mutations_disabled(self):
        report = gates.validate_prestart(evidence(), SEAL, NOW)
        self.assertFalse(report['mutationsEnabled'])
        self.assertFalse(report['financialStarted'])

    def test_expired_snapshot_binding_refuses_before_any_financial_start(self):
        value = evidence()
        value['snapshotBinding']['expiresAt'] = '2026-09-29T15:59:10Z'
        with self.assertRaisesRegex(ValueError, 'financial_snapshot_binding_expired_or_unproved'):
            gates.validate_prestart(value, SEAL, NOW)

    def test_missing_jwt_signature_tls_or_effective_deadline_is_not_a_pass(self):
        for key in ('jwtSignaturesVerified', 'snapshotTlsIdentityVerified', 'timers',
                    'separateSnapshotCredential', 'guardedRenewalCommitted', 'protectedAfter'):
            value = evidence()
            value.pop(key)
            with self.subTest(key=key), self.assertRaises(ValueError):
                gates.validate_prestart(value, SEAL, NOW)

    def test_stale_or_different_seal_refuses(self):
        with self.assertRaises(ValueError):
            gates.validate_prestart(evidence(), 'b' * 64, NOW)
        with self.assertRaises(ValueError):
            gates.validate_prestart(evidence(), SEAL, NOW + 61)

    def test_owner_sequence_proves_passes_before_scheduling_and_never_enables_mutations(self):
        adapter = Adapter()
        report = gates.activate_financial(adapter, SEAL, now=lambda: NOW)
        self.assertEqual(adapter.events, ['verify_seal', 'start_replay', 'replay_completed_pass_is_fresh',
            'run_independent_snapshot', 'snapshot_pass_verified', 'run_background_once',
            'background_pass_verified', 'protected_payment_state_unchanged', 'schedule_workers',
            'schedules_and_deadlines_verified', 'public_mutations_disabled'])
        self.assertFalse(report['mutationsEnabled'])

    def test_any_unproved_runtime_pass_withdraws_financial_only_and_never_schedules(self):
        for failed in ('replay_completed_pass_is_fresh', 'snapshot_pass_verified', 'background_pass_verified'):
            adapter = Adapter()
            adapter.failure = failed
            with self.subTest(failed=failed), self.assertRaises(ValueError):
                gates.activate_financial(adapter, SEAL, now=lambda: NOW)
            self.assertEqual(adapter.events[-1], 'withdraw_financial_only')
            self.assertNotIn('schedule_workers', adapter.events)

    def test_false_seal_verification_refuses_before_readiness_or_start(self):
        adapter = Adapter()
        adapter.failure = 'verify_seal'
        with self.assertRaisesRegex(ValueError, 'financial_preparation_seal_unproved'):
            gates.activate_financial(adapter, SEAL, now=lambda: NOW)
        self.assertEqual(adapter.events, ['verify_seal'])

    def test_crossing_cutoff_between_steps_withdraws_without_next_action(self):
        for clock_call, blocked in ((3, 'run_independent_snapshot'),
                                   (4, 'run_background_once'), (6, 'schedule_workers')):
            adapter = Adapter()
            calls = 0

            def clock():
                nonlocal calls
                calls += 1
                return gates.DEADLINE_EPOCH - 600 if calls == clock_call else NOW

            with self.subTest(blocked=blocked), self.assertRaisesRegex(
                    ValueError, 'financial_activation_window_expired'):
                gates.activate_financial(adapter, SEAL, now=clock)
            self.assertNotIn(blocked, adapter.events)
            self.assertEqual(adapter.events[-1], 'withdraw_financial_only')

    def test_false_withdrawal_refusal_preserves_original_activation_error(self):
        adapter = Adapter()
        adapter.failure = 'snapshot_pass_verified'
        adapter.withdraw_financial_only = lambda: False
        with self.assertRaisesRegex(gates.Refused, 'financial_withdrawal_unconfirmed') as caught:
            gates.activate_financial(adapter, SEAL, now=lambda: NOW)
        self.assertEqual(str(caught.exception.__cause__), 'financial_snapshot_pass_unproved')

    def test_throwing_withdrawal_preserves_both_failure_causes(self):
        adapter = Adapter()
        adapter.failure = 'snapshot_pass_verified'
        withdrawal_error = RuntimeError('fixture withdrawal error')

        def withdraw():
            raise withdrawal_error

        adapter.withdraw_financial_only = withdraw
        with self.assertRaisesRegex(gates.Refused, 'financial_withdrawal_unconfirmed') as caught:
            gates.activate_financial(adapter, SEAL, now=lambda: NOW)
        self.assertIs(caught.exception.__cause__, withdrawal_error)
        self.assertEqual(str(withdrawal_error.__context__), 'financial_snapshot_pass_unproved')


if __name__ == '__main__':
    unittest.main()
