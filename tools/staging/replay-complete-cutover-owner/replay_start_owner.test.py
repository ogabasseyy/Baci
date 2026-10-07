import copy
from datetime import timedelta
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import replay_start_owner as subject
import replay_start_readiness as readiness


HERE = Path(__file__).resolve().parent


def load(name, directory=HERE):
    specification = importlib.util.spec_from_file_location(name, directory/(name+'.py'))
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


class TransitionObservation:
    def __init__(self, callbacks, operator):
        self.callbacks, self.operator = callbacks, operator
        self.retained, self.candidate_id, self.allow_running = False, None, False
        self.stages = []

    def sample(self):
        if self.callbacks.locks_held() is not True:
            raise ValueError('lock lost')
        name = subject.runtime.RETAINED if self.retained else subject.runtime.CONTAINER
        if self.operator.find(name) != subject.runtime.NATIVE_ID or self.operator.running[subject.runtime.NATIVE_ID]:
            raise ValueError('native transition changed')
        if self.candidate_id is not None and (self.operator.find(subject.runtime.CONTAINER) != self.candidate_id
                or self.operator.running[self.candidate_id] and not self.allow_running):
            raise ValueError('candidate transition changed')
        self.stages.append((self.retained, self.candidate_id, self.allow_running))
        return dict(observedAt=self.callbacks.clock().isoformat().replace('+00:00', 'Z'),
            exclusive=True, unknownClaimants=[], containers={}, units={})


class StartupOwnerTests(unittest.TestCase):
    def setUp(self):
        fixture = load('replay_generation_probe_owner.test').ProbeOwnerTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.addCleanup(patch.stopall)
        self.fixture = fixture
        report = fixture.operate()
        self.assertEqual(report['status'], 'replay-generation-probes-passed')
        self.probe = dict(kind='authenticated-generation-invalid-bounds-probe', result=report)
        self.probe_raw = subject.encoded(self.probe)
        patch.object(subject, 'PROBE_SHA256', subject.sha(self.probe_raw)).start()
        self.operator = load('cutover_runtime.test').Operator()
        self.operator.running[subject.runtime.NATIVE_ID] = False
        self.operator.check = Mock()
        fixture.context.operator = self.operator
        preparation = load('prestart.test', HERE.parent/'replay-complete-upgrade-owner').PrestartTests()
        preparation.setUp()
        preparation.seal['receiptTokenSha256'] = fixture.proofs['new']['tokenSha256']
        self.context = fixture.context
        self.context.seal = preparation.seal
        self.context.contract = preparation.contract
        self.context.prestart = preparation.module
        focused_fixture = load('replay_start_readiness.test').ReadinessTests()
        focused_fixture.setUp()
        self.addCleanup(focused_fixture.doCleanups)
        production_pin = focused_fixture.seal['daemonArtifact']['productionTableSha256']
        self.context.seal['daemonArtifact']['productionTableSha256'] = production_pin
        patch.dict(self.context.contract.DAEMON_ARTIFACT, productionTableSha256=production_pin).start()
        self.config = dict(environment='staging', appSystemId=self.context.contract.APP_SYSTEM,
            receiptSystemId=self.context.contract.RECEIPT_SYSTEM, appToken='synthetic-app-token',
            receiptToken=fixture.tokens['new'], receiptKey='synthetic-receipt-key',
            prefundedReplay=dict(bundleSha256=self.context.seal['files']['code/prefunded-replay-bundle.mjs'],
                configurationSha256=self.context.seal['files']['config/prefunded.json']),
            paidInterestDatabase=dict(host=self.context.contract.HOST, port=5432, database='postgres',
                role='prefunded_treasury_operator', integrationId=self.context.contract.INTEGRATION,
                businessId=self.context.contract.BUSINESS, password='synthetic-password', ssl=dict(ca='synthetic-ca')))
        self.config_raw = subject.encoded(self.config)
        self.context.seal['files']['config/config.json'] = subject.sha(self.config_raw)
        self.context.owner = SimpleNamespace(read=Mock(side_effect=lambda *args, **kwargs: self.config_raw))
        self.context.competitor = Mock(return_value=dict(Id=subject.runtime.COMPETITOR_ID,
            Name='/baci-interest-replay', State=dict(Running=False)))
        self.context.journal = Mock()
        pin = preparation.contract.digest(preparation.seal)
        patch.object(subject.runtime, 'CANDIDATE_SEAL', pin).start()
        patch.object(readiness, 'CANDIDATE_SEAL', pin).start()
        patch.object(preparation.contract, 'instant', return_value=fixture.callbacks.clock()).start()
        self.callbacks = fixture.callbacks
        self.callbacks.protected_read = self.read
        self.callbacks.transport.application_snapshot = self.snapshot
        self.context_factory = patch.object(subject, 'Context', return_value=self.context).start()
        self.observer = patch.object(subject, 'StartupInventory', side_effect=TransitionObservation).start()
        self.persist = patch.object(subject, 'persist').start()
        self.focus_report = dict(focused_fixture.report, candidateSealSha256=pin,
            daemonSha256=self.context.seal['files']['code/replay-daemon.mjs'],
            sourceTableSha256=production_pin)
        self.full_raw = focused_fixture.full_raw
        patch.object(readiness, 'REPORT_SHA256', subject.sha(self.full_raw)).start()
        self.focus_raw = subject.encoded(self.focus_report)
        self.focused = dict(path='/root/focused/report.json', sha256=subject.sha(self.focus_raw))
        patch.object(readiness, 'FOCUSED', self.focused).start()
        patch.object(subject, 'FOCUSED', self.focused).start()

    def read(self, path, pin):
        if path == readiness.REPORT_PATH:
            self.assertEqual(pin, readiness.REPORT_SHA256)
            return self.full_raw
        if path == subject.PROBE_PATH:
            self.assertEqual(pin, subject.PROBE_SHA256)
            return self.probe_raw
        if path == Path(self.focused['path']):
            self.assertEqual(pin, self.focused['sha256'])
            return self.focus_raw
        return self.fixture.read(path, pin)

    def snapshot(self):
        return copy.deepcopy(self.fixture.measurement['applicationSnapshot'])

    def operate(self, start=False, focused=True):
        return subject.operate(self.callbacks, Path('/root/package/owner'), self.focused if focused else None, start=start)

    def test_check_runs_actual_operator_check_brackets_full_state_and_validates_prestart(self):
        result = self.operate()
        self.assertEqual(result['status'], 'replay-start-preflight-passed')
        self.operator.check.assert_called_once_with(subject.runtime.CANDIDATE_ROOT, subject.runtime.CANDIDATE_SEAL)
        self.context_factory.assert_called_once_with(external_lock_guard=self.callbacks.locks_held)
        self.assertEqual(result['before']['applicationSnapshot'], result['after']['applicationSnapshot'])
        self.assertTrue(result['prestartPassed'])
        self.assertFalse(result['liveReplayStarted'])
        self.assertEqual(self.operator.actions, [])
        self.persist.assert_not_called()
        self.callbacks.transport.execute.assert_not_called()

    def test_missing_focused_pin_refuses_start_before_rename_or_reservation(self):
        result = self.operate(start=True, focused=False)
        self.assertEqual(result['status'], 'replay-start-refused')
        self.assertTrue(result['checkPassed'])
        self.assertFalse(result['prestartPassed'])
        self.assertEqual(self.operator.actions, [])
        self.persist.assert_not_called()

    def test_start_uses_real_prestart_validator_retains_native_and_starts_only_candidate(self):
        result = self.operate(start=True)
        self.assertEqual(result['status'], 'replay-started', result['diagnostic'])
        self.assertFalse(self.operator.running[subject.runtime.NATIVE_ID])
        self.assertTrue(self.operator.running['a'*64])
        self.assertEqual(result['prestart']['financialProofObservedAt'],
            self.fixture.audit['result']['fence']['receipt']['financialProofObservedAt'])
        self.assertEqual(self.operator.names[subject.runtime.RETAINED], subject.runtime.NATIVE_ID)
        self.persist.assert_called_once()
        self.callbacks.transport.execute.assert_not_called()

    def test_failed_launch_stops_candidate_without_predecessor_restart(self):
        self.operator.fail_start = True
        result = self.operate(start=True)
        self.assertEqual(result['status'], 'replay-start-refused')
        self.assertFalse(self.operator.running['a'*64])
        self.assertFalse(self.operator.running[subject.runtime.NATIVE_ID])
        self.assertNotIn(['start', subject.runtime.NATIVE_ID], self.operator.actions)

    def test_failed_actual_check_never_creates_runtime_or_fabricates_readiness(self):
        self.operator.check.side_effect = ValueError('PRIVATE_TOKEN')
        result = self.operate(start=True)
        self.assertEqual(result['status'], 'replay-start-refused')
        self.assertFalse(result['readinessPassed'])
        self.assertEqual(self.operator.actions, [])
        self.assertNotIn('PRIVATE_TOKEN', subject.encoded(result).decode())

    def test_full_application_drift_during_check_refuses_even_with_same_receipt_hash(self):
        def drift(*args):
            self.fixture.measurement['applicationSnapshot']['functions']['outside-scope'] = dict(oid=777)

        self.operator.check.side_effect = drift
        result = self.operate(start=True)
        self.assertEqual(result['status'], 'replay-start-refused')
        self.assertFalse(result['checkPassed'])
        self.assertEqual(self.operator.actions, [])

    def test_current_application_is_not_compared_against_historical_probe_app(self):
        self.fixture.measurement['applicationSnapshot']['permanentMetadataSha256'] = 'f'*64
        self.assertEqual(self.operate()['status'], 'replay-start-preflight-passed')

    def test_current_receipt_drift_and_lost_lock_refuse_before_check(self):
        self.fixture.database.current['otherRoutinesSha256'] = 'f'*64
        self.assertEqual(self.operate()['status'], 'replay-start-refused')
        self.operator.check.assert_not_called()
        self.callbacks.locks_held.return_value = False
        self.assertEqual(self.operate()['status'], 'replay-start-refused')

    def test_bad_actual_probe_report_refuses_before_check(self):
        self.probe['result']['probeReport']['probes'][0]['postgresCode'] = '22023'
        self.probe_raw = subject.encoded(self.probe)
        with patch.object(subject, 'PROBE_SHA256', subject.sha(self.probe_raw)):
            self.assertEqual(self.operate()['status'], 'replay-start-refused')
        self.operator.check.assert_not_called()

    def test_failed_focused_runner_refuses_before_submission(self):
        self.focus_report['exitCode'] = 1
        self.focus_raw = subject.encoded(self.focus_report)
        self.focused['sha256'] = subject.sha(self.focus_raw)
        self.assertEqual(self.operate(start=True)['status'], 'replay-start-refused')
        self.assertEqual(self.operator.actions, [])
        self.persist.assert_not_called()

    def test_existing_submission_marker_refuses_before_rename(self):
        self.persist.side_effect = FileExistsError('private path')
        self.assertEqual(self.operate(start=True)['status'], 'replay-start-refused')
        self.assertEqual(self.operator.actions, [])

    def test_stale_actual_check_cannot_authorize_start(self):
        owner = subject.Startup(self.callbacks, self.context, self.focused)
        owner.bounded_check()
        owner.check_time -= timedelta(seconds=61)
        with self.assertRaises(ValueError):
            owner.start(Path('/root/package/owner'))
        self.assertEqual(self.operator.actions, [])

    def test_audit_write_failure_after_start_stops_candidate_under_same_locks(self):
        locks = Mock()
        locks.held.return_value = True
        locks.__enter__ = Mock(return_value=locks)
        locks.__exit__ = Mock(return_value=False)
        self.persist.side_effect = [None, OSError('private audit write failed')]
        reviewed = dict(subject.REVIEWED, focusedRunner=self.focused)
        with patch.object(subject, 'HeldLocks', return_value=locks), \
                patch.object(subject, 'Callbacks', return_value=self.callbacks):
            with self.assertRaisesRegex(ValueError, 'replay_start_audit_refused'):
                subject.invoke(Path('/root/package/owner'), reviewed, lambda: True, self.read, start=True)
        self.assertFalse(self.operator.running['a'*64])
        self.assertFalse(self.operator.running[subject.runtime.NATIVE_ID])

    def test_readonly_audit_is_exclusive_and_public_summary_contains_no_private_snapshot(self):
        locks = Mock()
        locks.held.return_value = True
        locks.__enter__ = Mock(return_value=locks)
        locks.__exit__ = Mock(return_value=False)
        stored = {}
        self.persist.side_effect = lambda path, raw: stored.update({path: raw})
        with patch.object(subject, 'HeldLocks', return_value=locks), \
                patch.object(subject, 'Callbacks', return_value=self.callbacks):
            result = subject.invoke(Path('/root/package/owner'), subject.REVIEWED, lambda: True,
                lambda path, pin: stored[path], start=False)
        self.assertEqual(result['status'], 'replay-start-preflight-passed')
        self.assertEqual(result['auditSha256'], subject.sha(next(iter(stored.values()))))
        self.assertNotIn('before', result)
        self.assertNotIn('diagnostic', result)
        self.assertTrue(result['focusedRunnerPassed'])
        self.assertFalse(result['startAttempted'])

    def test_stop_failure_is_not_reported_as_confirmed_candidate_stop(self):
        self.operator.fail_start = True
        original = self.operator.run

        def stop_failure(argv, timeout=30):
            if argv[2] == 'stop':
                raise ValueError('private stop failed')
            return original(argv, timeout)

        self.operator.run = stop_failure
        result = self.operate(start=True)
        self.assertEqual(result['status'], 'replay-start-refused')
        self.assertFalse(result['candidateStopConfirmed'])
        self.assertTrue(self.operator.running['a'*64])
        self.assertFalse(self.operator.running[subject.runtime.NATIVE_ID])

    def test_missing_dual_config_fallback_or_wrong_paid_scope_refuses_actual_check(self):
        variants = []
        for key in ('prefundedReplay', 'paidInterestDatabase'):
            value = copy.deepcopy(self.config)
            value.pop(key)
            variants.append(value)
        variants.append(dict(self.config, financialDatabase=self.config['paidInterestDatabase']))
        value = copy.deepcopy(self.config)
        value['paidInterestDatabase']['host'] = 'unreviewed-host'
        variants.append(value)
        for value in variants:
            self.config_raw = subject.encoded(value)
            self.context.seal['files']['config/config.json'] = subject.sha(self.config_raw)
            self.assertEqual(self.operate(start=True)['status'], 'replay-start-refused')
        self.operator.check.assert_not_called()

    def test_dual_config_drift_at_precreate_and_prelaunch_never_starts_candidate(self):
        for transition in ('rename', 'create'):
            self.setUp()
            original = self.operator.run if transition == 'rename' else self.operator.create
            def drift(*args, **kwargs):
                result = original(*args, **kwargs)
                self.config_raw = b'{}'
                return result
            setattr(self.operator, 'run' if transition == 'rename' else 'create', drift)
            self.assertEqual(self.operate(start=True)['status'], 'replay-start-refused')
            self.assertNotIn(['start', 'a'*64], self.operator.actions)
            self.assertFalse(self.operator.running[subject.runtime.NATIVE_ID])


if __name__ == '__main__':
    unittest.main()
