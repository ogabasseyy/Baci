import copy
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import Mock, patch

import replay_fence_commit_owner as subject


HERE = Path(__file__).resolve().parent
NOW = datetime(2026, 10, 4, 12, tzinfo=timezone.utc)


def load(name):
    specification = importlib.util.spec_from_file_location(name, HERE/(name+'.py'))
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


class PinTests(unittest.TestCase):
    def test_actual_audit_receipt_and_commit_pins_are_fixed(self):
        self.assertEqual(str(subject.AUDIT_PATH), '/root/baci-replay-rehearsal-r3.85HQ4psI/rehearsal-result-631a248b83894c95a579e2f229188999.json')
        self.assertEqual(subject.AUDIT_SHA256, '2220425c4f261719bedc49355974eeae36b150071f404bca9c722be153d74a7b')
        self.assertEqual(subject.RECEIPT_SHA256, 'c1c6376733c80550543184b91d32ac2aab8428091302be6bdd1c8ba28a282faa')
        self.assertEqual(subject.COMMIT_SQL_SHA256, 'ff36e1b56df2247f416398a176eea613216831f9b54a45fe7f36f4c67455ce1f')


class CommitOwnerTests(unittest.TestCase):
    def setUp(self):
        fixture = load('replay_fence_rehearsal.test').Tests()
        fixture.setUp()
        result = fixture.invoke()
        self.assertEqual(result['status'], 'replay-fence-rollback-verified')
        self.fixture, self.database = fixture, fixture.database
        self.audit = dict(kind='authenticated-rollback-only-rehearsal', result=result)
        self.audit_raw = subject.encoded(self.audit)
        self.addCleanup(patch.stopall)
        patch.object(subject, 'AUDIT_SHA256', subject.sha(self.audit_raw)).start()
        patch.object(subject, 'RECEIPT_SHA256', result['rehearsal']['receiptSha256']).start()
        patch.object(subject, 'REVIEWED', copy.deepcopy(fixture.reviewed)).start()
        patch.object(subject.database, '_now', return_value=NOW).start()
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.output = b'BEGIN\nSET\nDO\nCREATE FUNCTION\nDO\nCOMMIT\n'
        self.run_error, self.collect_count, self.collection_change = None, 0, None
        self.inputs = copy.deepcopy(fixture.inputs)
        self.measurement = copy.deepcopy(fixture.measurement)
        self.calls = []
        self.callbacks = SimpleNamespace(authenticate_inputs=self.authenticate, protected_read=self.read,
            clock=lambda: NOW, collect=self.collect, run=self.run_sql,
            inventory=SimpleNamespace(exclusive_inventory=Mock(return_value=copy.deepcopy(fixture.inventory))),
            transport=SimpleNamespace(query=self.database.query))

    def authenticate(self, reviewed):
        self.assertEqual(reviewed, subject.REVIEWED)
        return copy.deepcopy(self.inputs)

    def read(self, path, pin):
        self.assertEqual(path, subject.AUDIT_PATH)
        self.assertEqual(pin, subject.AUDIT_SHA256)
        return self.audit_raw

    def collect(self):
        self.collect_count += 1
        if self.collection_change:
            self.collection_change(self.collect_count, self.measurement)
        return copy.deepcopy(self.measurement)

    def run_sql(self, argv, *, input, timeout):
        self.assertEqual(argv, list(subject.RECEIPT_ARGV))
        self.assertEqual(timeout, 60)
        self.assertEqual(input, self.database.commit_sql.encode())
        marker = self.directory/'fence-commit-submission.json'
        self.assertTrue(marker.is_file())
        self.assertEqual(json.loads(marker.read_bytes())['commitSqlSha256'], subject.COMMIT_SQL_SHA256)
        self.calls.append(input)
        self.database.execute(input.decode())
        if self.run_error:
            raise self.run_error
        return self.output

    def operate(self, commit=True):
        return subject.operate(self.callbacks, self.directory, commit=commit)

    def repin_audit(self):
        self.audit_raw = subject.encoded(self.audit)
        subject.AUDIT_SHA256 = subject.sha(self.audit_raw)

    def test_check_is_readonly_and_does_not_reserve_or_submit(self):
        result = self.operate(commit=False)
        self.assertEqual(result['status'], 'replay-fence-commit-preflight-passed')
        self.assertFalse(result['transactionAttempted'])
        self.assertFalse(result['submissionReserved'])
        self.assertEqual(self.calls, [])
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_commits_only_exact_sql_with_original_receipt_financial_proof(self):
        with patch.object(subject.database, 'run_fence', wraps=subject.database.run_fence) as run_fence:
            result = self.operate()
        self.assertEqual(result['status'], 'fence-committed-keep-stopped')
        self.assertTrue(result['commitAcknowledged'])
        self.assertTrue(result['protectedApplicationUnchanged'])
        receipt = self.audit['result']['rehearsal']['receipt']
        supplied = run_fence.call_args.args[3]
        self.assertEqual(supplied['financialProofSha256'], receipt['financialProofSha256'])
        self.assertEqual(supplied['financialProofObservedAt'], receipt['financialProofObservedAt'])
        self.assertEqual(run_fence.call_args.kwargs['reviewed_rehearsal_sha256'], subject.RECEIPT_SHA256)
        self.assertEqual(self.calls, [self.database.commit_sql.encode()])
        self.assertFalse(result['newPaymentStarted'])
        self.assertFalse(result['liveReplayStarted'])
        self.assertFalse(result['launchAuthorized'])

    def test_legitimate_historical_application_drift_is_preserved_not_normalized(self):
        self.measurement['applicationSnapshot']['permanentMetadataSha256'] = 'f'*64
        original = copy.deepcopy(self.audit)
        result = self.operate()
        self.assertEqual(result['status'], 'fence-committed-keep-stopped')
        self.assertEqual(self.audit, original)
        self.assertEqual(result['beforeApplication']['permanentMetadataSha256'], 'f'*64)

    def test_fresh_application_drift_before_submission_refuses_without_marker(self):
        def mutate(count, measurement):
            if count == 2:
                measurement['applicationSnapshot']['permanentMetadataSha256'] = 'f'*64
        self.collection_change = mutate
        result = self.operate()
        self.assertEqual(result['status'], 'replay-fence-commit-refused')
        self.assertFalse(result['transactionAttempted'])
        self.assertEqual(self.calls, [])
        self.assertFalse((self.directory/'fence-commit-submission.json').exists())

    def test_post_commit_application_drift_preserves_ack_but_refuses_completion(self):
        def mutate(count, measurement):
            if count == 3:
                measurement['applicationSnapshot']['permanentMetadataSha256'] = 'f'*64
        self.collection_change = mutate
        result = self.operate()
        self.assertEqual(result['status'], 'replay-fence-commit-refused')
        self.assertTrue(result['commitAcknowledged'])
        self.assertFalse(result['protectedApplicationUnchanged'])
        self.assertEqual(len(self.calls), 1)

    def test_unknown_ack_or_timeout_keeps_marker_and_refuses_retry(self):
        self.output = b'BEGIN\nDO\nROLLBACK\n'
        first = self.operate()
        self.assertTrue(first['transactionAttempted'])
        self.assertFalse(first['commitAcknowledged'])
        self.database.current = copy.deepcopy(self.database.snapshot)
        self.database.current['observedAt'] = NOW.isoformat().replace('+00:00', 'Z')
        self.assertEqual(self.operate()['status'], 'replay-fence-commit-refused')
        self.assertEqual(len(self.calls), 1)

    def test_runner_exception_is_private_and_post_collection_is_attempted(self):
        self.run_error = TimeoutError('SECRET')
        result = self.operate()
        self.assertFalse(result['commitAcknowledged'])
        self.assertTrue(result['transactionAttempted'])
        self.assertEqual(self.collect_count, 3)
        self.assertNotIn('SECRET', json.dumps(result))

    def test_refusal_retains_only_safe_stage_diagnostic_in_private_result(self):
        self.inputs['rollbackSql'] += b'PRIVATE /root/secret-path'
        result = self.operate(commit=False)
        detail = result['diagnostic']
        self.assertEqual(set(detail), {'type', 'module', 'line'})
        self.assertEqual(detail['type'], 'ValueError')
        self.assertEqual(detail['module'], 'replay_fence_commit_owner')
        self.assertNotEqual(detail['line'], subject.require.__code__.co_firstlineno + 2)
        self.assertNotIn('PRIVATE', json.dumps(result))
        self.assertNotIn('secret-path', json.dumps(result))

    def test_nonterminal_duplicate_or_rollback_ack_refuses_completion(self):
        original = copy.deepcopy(self.database.current)
        for index, output in enumerate((b'BEGIN\nCOMMIT\nERROR\n', b'BEGIN\nCOMMIT\nCOMMIT\n',
                b'BEGIN\nROLLBACK\nCOMMIT\n', b'COMMIT\n', b'BEGIN\nCOMMIT \n', b'\xff')):
            self.database.current = copy.deepcopy(original)
            self.directory = Path(self.temporary.name)/str(index)
            self.directory.mkdir()
            self.output = output
            result = self.operate()
            self.assertEqual(result['status'], 'replay-fence-commit-refused')
            self.assertTrue(result['transactionAttempted'])
            self.assertFalse(result['commitAcknowledged'])
            self.assertTrue((self.directory/'fence-commit-submission.json').exists())

    def test_durability_failure_prevents_sql_even_when_marker_exists(self):
        original = subject.persist
        def failing(path, raw):
            original(path, raw)
            raise OSError('fsync completion unknown')
        with patch.object(subject, 'persist', side_effect=failing):
            result = self.operate()
        self.assertFalse(result['transactionAttempted'])
        self.assertEqual(self.calls, [])
        self.assertTrue((self.directory/'fence-commit-submission.json').exists())

    def test_missing_or_modified_audit_and_duplicate_keys_refuse(self):
        self.audit_raw += b'\n'
        self.assertEqual(self.operate()['status'], 'replay-fence-commit-refused')
        for raw in (b'{"kind":1,"kind":2}', b'{}'):
            self.audit_raw, subject.AUDIT_SHA256 = raw, subject.sha(raw)
            self.assertEqual(self.operate()['status'], 'replay-fence-commit-refused')
        self.assertEqual(self.calls, [])

    def test_full_audit_shape_flags_and_receipt_pin_are_required(self):
        original = copy.deepcopy(self.audit)
        mutations = [lambda value: value.update(extra=True),
            lambda value: value['result'].update(launchAuthorized=True),
            lambda value: value['result'].update(transactionAttempted=1),
            lambda value: value['result']['rehearsal'].update(receiptSha256='f'*64),
            lambda value: value['result']['rehearsal']['receipt'].update(financialProofObservedAt='2026-10-04T12:00:00Z')]
        for mutate in mutations:
            self.audit = copy.deepcopy(original)
            mutate(self.audit)
            self.repin_audit()
            self.assertEqual(self.operate()['status'], 'replay-fence-commit-refused')
        self.assertEqual(self.calls, [])

    def test_receipt_baseline_drift_unknown_claimants_and_stale_application_refuse(self):
        original = copy.deepcopy(self.database.current)
        self.database.current['receipts']['receipts']['count'] += 1
        self.assertEqual(self.operate()['status'], 'replay-fence-commit-refused')
        self.database.current = original
        self.callbacks.inventory.exclusive_inventory.return_value['unknownClaimants'] = ['foreign']
        self.assertEqual(self.operate()['status'], 'replay-fence-commit-refused')
        self.callbacks.inventory.exclusive_inventory.return_value['unknownClaimants'] = []
        self.measurement['applicationSnapshot']['capturedAt'] = '2026-10-03T12:00:00Z'
        self.assertEqual(self.operate()['status'], 'replay-fence-commit-refused')
        self.assertEqual(self.calls, [])

    def test_deadline_expiry_fails_without_submission(self):
        with patch.object(subject.database, '_now', side_effect=ValueError('fixed_deadline_expired')):
            self.assertEqual(self.operate()['status'], 'replay-fence-commit-refused')
        self.assertEqual(self.calls, [])

    def test_commit_transport_rejects_rollback_and_altered_sql_before_runner(self):
        review = subject.authenticate_review(self.callbacks)
        transport = subject.CommitTransport(self.callbacks, review, self.directory, self.measurement['applicationSnapshot'])
        for sql in (self.database.rollback_sql, self.database.commit_sql+'\n', 'COMMIT;', None):
            with self.assertRaises(ValueError):
                transport.execute(sql)
        self.assertEqual(self.calls, [])

    def test_invoke_retains_private_audit_under_locks_and_redacts_snapshots(self):
        held = Mock()
        held.__enter__ = Mock(return_value=held)
        held.__exit__ = Mock(return_value=False)
        held.held.return_value = True
        retained = {}
        def persist(path, raw):
            held.__exit__.assert_not_called()
            retained[path] = raw
        def read(path, pin):
            self.assertEqual(subject.sha(retained[path]), pin)
            return retained[path]
        with patch.object(subject, 'HeldLocks', return_value=held), \
                patch.object(subject, 'Callbacks', return_value=self.callbacks), patch.object(subject, 'persist', persist):
            result = subject.invoke(Path('/root/private-commit/owner'), subject.REVIEWED, lambda: True, read, commit=False)
        self.assertEqual(result['status'], 'replay-fence-commit-preflight-passed')
        self.assertNotIn('beforeApplication', result)
        self.assertNotIn('receiptSnapshot', result)
        self.assertIn('beforeApplication', json.loads(next(iter(retained.values())))['result'])
        held.__exit__.assert_called_once()

    def test_invalid_invoke_mode_is_rejected_before_callbacks(self):
        with patch.object(subject, 'Callbacks') as callbacks:
            with self.assertRaises(ValueError):
                subject.invoke(Path('/root/private-commit/owner'), subject.REVIEWED, lambda: True, Mock(), commit='commit')
            callbacks.assert_not_called()

    def test_body_selected_reviewed_audit_is_rejected_before_callbacks(self):
        with patch.object(subject, 'Callbacks') as callbacks:
            reviewed = dict(subject.REVIEWED, financialAuditPath='/root/unreviewed.json')
            with self.assertRaises(ValueError):
                subject.invoke(Path('/root/private-commit/owner'), reviewed, lambda: True, Mock(), commit=True)
            callbacks.assert_not_called()

    def test_marker_is_exclusive_and_both_file_and_directory_are_fsynced(self):
        path = self.directory/'submission.json'
        with patch.object(subject.os, 'fsync', wraps=subject.os.fsync) as fsync:
            subject.persist(path, b'private')
        self.assertEqual(fsync.call_count, 2)
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        with self.assertRaises(FileExistsError):
            subject.persist(path, b'retry')
        self.assertEqual(path.read_bytes(), b'private')


if __name__ == '__main__':
    unittest.main()
