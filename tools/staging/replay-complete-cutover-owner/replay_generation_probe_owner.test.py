import copy
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import replay_generation_probe_owner as subject


HERE = Path(__file__).resolve().parent
NOW = datetime(2026, 10, 4, 12, tzinfo=timezone.utc)


def load(name):
    specification = importlib.util.spec_from_file_location(name, HERE/(name+'.py'))
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


class FixedPinTests(unittest.TestCase):
    def test_actual_commit_audit_receipt_and_probe_source_are_pinned(self):
        self.assertEqual(subject.AUDIT_SHA256, '2b960715c86bdad3b5bf708a21d8bfdb54dca7a67235bc6a77ca5db53c280928')
        self.assertEqual(subject.RECEIPT_SHA256, 'c87f7c6f8c54f7e63220de4f43bf6604fbe36b90a11bba52fc50985584190f4a')
        self.assertEqual(subject.SCRIPT_SHA256, subject.sha((HERE/'claim_probe.cjs').read_bytes()))
        self.assertEqual(subject.REVIEWED['scriptSha256'], subject.SCRIPT_SHA256)
        self.assertEqual(subject.REVIEWED['committedAuditPath'], str(subject.AUDIT_PATH))


class ProbeOwnerTests(unittest.TestCase):
    def setUp(self):
        fixture = load('replay_fence_commit_owner.test').CommitOwnerTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.addCleanup(patch.stopall)
        result = fixture.operate()
        self.assertEqual(result['status'], 'fence-committed-keep-stopped')
        self.fixture, self.database = fixture, fixture.database
        self.audit = dict(kind='authenticated-fence-commit', result=result)
        self.audit_raw = subject.encoded(self.audit)
        self.script = (HERE/'claim_probe.cjs').read_bytes()
        patch.object(subject, 'AUDIT_SHA256', subject.sha(self.audit_raw)).start()
        patch.object(subject, 'RECEIPT_SHA256', result['fence']['receiptSha256']).start()
        patch.object(subject, 'REHEARSAL_RECEIPT_SHA256', result['fence']['receipt']['rehearsalReceiptSha256']).start()
        patch.object(subject.database, '_now', return_value=NOW).start()
        self.measurement = copy.deepcopy(fixture.measurement)
        self.collections, self.change = 0, None
        self.callbacks = SimpleNamespace(protected_read=self.read, clock=lambda: NOW, collect=self.collect,
            locks_held=Mock(return_value=True), inventory=SimpleNamespace(exclusive_inventory=Mock(
                return_value=copy.deepcopy(fixture.fixture.inventory))),
            transport=SimpleNamespace(query=self.database.query, execute=Mock()))
        credentials = load('cutover_probes.test').CutoverProbeTests()
        credentials.setUp()
        self.tokens, self.proofs = credentials.tokens, credentials.proofs
        self.context = SimpleNamespace(credentials=Mock(side_effect=self.credentials),
            deadline=Mock(), verify_files=Mock(return_value=True), contract=SimpleNamespace(serialize=subject.encoded))
        self.context_factory = patch.object(subject, 'Context', return_value=self.context).start()
        self.http = patch('probe_transport.collect_http', side_effect=self.http_batch).start()

    def read(self, path, pin):
        if path == subject.AUDIT_PATH:
            self.assertEqual(pin, subject.AUDIT_SHA256)
            return self.audit_raw
        self.assertEqual(path, HERE/'claim_probe.cjs')
        self.assertEqual(pin, subject.SCRIPT_SHA256)
        return self.script

    def credentials(self):
        return copy.deepcopy(self.tokens), copy.deepcopy(self.proofs)

    def collect(self):
        self.collections += 1
        if self.change:
            self.change(self.collections, self.measurement)
        return copy.deepcopy(self.measurement)

    def http_batch(self, context, tokens, script_sha):
        self.assertIs(context, self.context)
        self.assertEqual(tokens, self.tokens)
        self.assertEqual(script_sha, subject.SCRIPT_SHA256)
        return {name: dict(identity=subject.database.SYSTEM, status=400 if name == 'new' else 403,
            body=json.dumps(dict(code='22023' if name == 'new' else '42501',
                message='Invalid claim bounds' if name == 'new' else 'Replay claimant refused',
                details=None, hint=None))) for name in ('oldNative', 'oldInterest', 'new')}

    def operate(self, probe=True):
        return subject.operate(self.callbacks, probe=probe)

    def test_check_authenticates_credentials_and_uses_external_lock_without_probe(self):
        result = self.operate(probe=False)
        self.assertEqual(result['status'], 'replay-generation-probe-preflight-passed')
        self.context_factory.assert_called_once_with(external_lock_guard=self.callbacks.locks_held)
        self.assertGreater(self.context.credentials.call_count, 0)
        self.http.assert_not_called()
        self.callbacks.transport.execute.assert_not_called()
        self.assertFalse(result['probeAttempted'])
        self.assertEqual(subject.database._state(result['before']['receiptSnapshot']),
            subject.database._state(result['after']['receiptSnapshot']))

    def test_probe_uses_original_invalid_bounds_transport_and_retains_complete_snapshots(self):
        result = self.operate()
        self.assertEqual(result['status'], 'replay-generation-probes-passed')
        self.assertTrue(result['probeAttempted'])
        self.assertTrue(result['protectedApplicationUnchanged'])
        self.assertTrue(result['protectedReceiptUnchanged'])
        self.assertEqual(self.collections, 4)
        self.assertEqual(result['probeReport']['probes'], [dict(credential=name, httpStatus=400 if name == 'new' else 403,
            postgresCode='22023' if name == 'new' else '42501') for name in ('oldNative', 'oldInterest', 'new')])
        self.assertEqual(result['before']['applicationSnapshot'], self.measurement['applicationSnapshot'])
        self.assertEqual(result['after']['receiptSnapshot'], self.database.current)
        self.assertNotIn(self.tokens['new'], json.dumps(result))
        self.callbacks.transport.execute.assert_not_called()

    def test_legitimate_application_drift_since_commit_is_not_normalized(self):
        original = copy.deepcopy(self.audit)
        self.measurement['applicationSnapshot']['permanentMetadataSha256'] = 'f'*64
        result = self.operate()
        self.assertEqual(result['status'], 'replay-generation-probes-passed')
        self.assertEqual(self.audit, original)
        self.assertEqual(result['before']['applicationSnapshot']['permanentMetadataSha256'], 'f'*64)

    def test_complete_application_drift_after_http_refuses_even_if_five_hashes_are_spoofed(self):
        def change(context, tokens, pin):
            self.measurement['applicationSnapshot']['functions']['unrelated-routine'] = {'oid': 987}
            return self.http_batch(context, tokens, pin)
        self.http.side_effect = change
        with patch.object(subject, 'compact', return_value={name: '1'*64 for name in (
                'receiptStateSha256', 'quarantineStateSha256', 'signatureStateSha256',
                'financialStateSha256', 'principalStateSha256')}):
            result = self.operate()
        self.assertEqual(result['status'], 'replay-generation-probe-refused')
        self.assertTrue(result['probeAttempted'])
        self.assertNotEqual(result['before']['applicationSnapshot'], result['after']['applicationSnapshot'])

    def test_immutable_committed_receipt_drift_refuses_before_http(self):
        self.database.current['otherRoutinesSha256'] = 'f'*64
        result = self.operate()
        self.assertEqual(result['status'], 'replay-generation-probe-refused')
        self.assertFalse(result['probeAttempted'])
        self.http.assert_not_called()

    def test_receipt_drift_after_http_refuses_and_attempts_post_capture(self):
        def change(*args):
            self.database.current['receipts']['receipts']['count'] += 1
            return self.http_batch(*args)
        self.http.side_effect = change
        result = self.operate()
        self.assertEqual(result['status'], 'replay-generation-probe-refused')
        self.assertTrue(result['probeAttempted'])
        self.assertEqual(self.collections, 4)
        self.callbacks.transport.execute.assert_not_called()

    def test_unverified_signature_or_wrong_generation_refuses_before_http(self):
        self.proofs['new']['signatureVerified'] = False
        self.assertEqual(self.operate()['status'], 'replay-generation-probe-refused')
        self.proofs['new']['signatureVerified'] = True
        self.proofs['new']['claims']['replay_claimant_generation'] = 'unreviewed-generation'
        self.assertEqual(self.operate()['status'], 'replay-generation-probe-refused')
        self.http.assert_not_called()

    def test_token_drift_before_probe_refuses_without_launch(self):
        count = 0
        def changed():
            nonlocal count
            count += 1
            tokens, proofs = self.credentials()
            if count > 1:
                tokens['new'] = 'new-unreviewed-token'
                proofs['new']['tokenSha256'] = subject.sha(tokens['new'].encode())
            return tokens, proofs
        self.context.credentials.side_effect = changed
        result = self.operate()
        self.assertEqual(result['status'], 'replay-generation-probe-refused')
        self.assertFalse(result['probeAttempted'])
        self.http.assert_not_called()

    def test_audit_script_flags_and_inner_receipt_changes_refuse(self):
        original = self.audit_raw
        self.audit_raw += b'\n'
        self.assertEqual(self.operate()['status'], 'replay-generation-probe-refused')
        self.audit_raw = original
        self.script += b'\n'
        self.assertEqual(self.operate()['status'], 'replay-generation-probe-refused')
        self.script = (HERE/'claim_probe.cjs').read_bytes()
        for key, value in (('commitAcknowledged', False), ('transactionAttempted', 1), ('launchAuthorized', True)):
            changed = copy.deepcopy(self.audit)
            changed['result'][key] = value
            self.audit_raw = subject.encoded(changed)
            subject.AUDIT_SHA256 = subject.sha(self.audit_raw)
            self.assertEqual(self.operate()['status'], 'replay-generation-probe-refused')
        changed = copy.deepcopy(self.audit)
        changed['result']['fence']['receiptSha256'] = 'f'*64
        self.audit_raw = subject.encoded(changed)
        subject.AUDIT_SHA256 = subject.sha(self.audit_raw)
        self.assertEqual(self.operate()['status'], 'replay-generation-probe-refused')
        self.http.assert_not_called()

    def test_unknown_claimants_or_stale_app_refuse_without_probe(self):
        self.callbacks.inventory.exclusive_inventory.return_value['unknownClaimants'] = ['foreign']
        self.assertEqual(self.operate()['status'], 'replay-generation-probe-refused')
        self.callbacks.inventory.exclusive_inventory.return_value['unknownClaimants'] = []
        self.measurement['applicationSnapshot']['capturedAt'] = '2026-10-03T12:00:00Z'
        self.assertEqual(self.operate()['status'], 'replay-generation-probe-refused')
        self.http.assert_not_called()

    def test_http_failure_keeps_raw_response_and_tokens_out_of_diagnostic(self):
        self.http.side_effect = RuntimeError('PRIVATE /root/path '+self.tokens['new'])
        result = self.operate()
        self.assertEqual(result['status'], 'replay-generation-probe-refused')
        self.assertEqual(set(result['diagnostic']), {'type', 'module', 'line'})
        self.assertNotIn('PRIVATE', json.dumps(result))
        self.assertNotIn(self.tokens['new'], json.dumps(result))
        self.assertEqual(self.collections, 3)

    def test_invoke_retains_exclusive_private_audit_under_locks_and_redacts_public_output(self):
        held = Mock()
        held.__enter__ = Mock(return_value=held)
        held.__exit__ = Mock(return_value=False)
        held.held.return_value = True
        retained = {}
        def persist(path, raw):
            held.__exit__.assert_not_called()
            self.assertTrue(path.name.startswith('generation-probe-result-'))
            retained[path] = raw
        def read(path, pin):
            self.assertEqual(subject.sha(retained[path]), pin)
            return retained[path]
        with patch.object(subject, 'HeldLocks', return_value=held), \
                patch.object(subject, 'Callbacks', return_value=self.callbacks), patch.object(subject, 'persist', persist):
            result = subject.invoke(Path('/root/probe-candidate/owner'), subject.REVIEWED, lambda: True, read, probe=False)
        self.assertEqual(result['status'], 'replay-generation-probe-preflight-passed')
        self.assertNotIn('before', result)
        self.assertNotIn('probeReport', result)
        self.assertNotIn('diagnostic', result)
        self.assertIn('applicationSnapshot', json.loads(next(iter(retained.values())))['result']['before'])
        held.__exit__.assert_called_once()

    def test_unreviewed_scope_or_nonboolean_mode_refuses_before_context(self):
        for reviewed, probe in ((dict(subject.REVIEWED, scriptSha256='f'*64), True), (subject.REVIEWED, 'probe')):
            with self.assertRaises(ValueError):
                subject.invoke(Path('/root/probe-candidate/owner'), reviewed, lambda: True, Mock(), probe=probe)
        self.context_factory.assert_not_called()


if __name__ == '__main__':
    unittest.main()
