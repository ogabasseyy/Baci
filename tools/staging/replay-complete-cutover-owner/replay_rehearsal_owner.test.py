import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
from datetime import datetime, timezone
import tempfile
from unittest.mock import patch, Mock


HERE = Path(__file__).resolve().parent


class Tests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('rehearsal_owner_test', HERE/'replay_rehearsal_owner.py')
        self.subject = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.subject)

    def test_rejects_source_drift_before_any_command(self):
        with patch.object(self.subject, 'command') as run:
            with self.assertRaises(ValueError):
                self.subject.Callbacks(lambda: False, lambda *unused: b'', object())
            run.assert_not_called()

    def test_authenticates_exact_retained_protected_inputs(self):
        captured = []
        def read(path, digest):
            captured.append((str(path), digest))
            return b'private'
        callbacks = self.subject.Callbacks(lambda: True, read, object())
        result = callbacks.authenticate_inputs(dict(self.subject.REVIEWED))
        self.assertEqual(set(result), {'financialAudit', 'originalDefinition', 'rollbackSql'})
        self.assertEqual(captured[0][1], self.subject.REVIEWED['financialAuditSha256'])
        self.assertEqual(captured[-1][1], self.subject.rehearsal.ROLLBACK_SQL_SHA256)

    def test_rejects_body_selected_audit_path(self):
        callbacks = self.subject.Callbacks(lambda: True, lambda *unused: b'', object())
        with self.assertRaises(ValueError):
            callbacks.authenticate_inputs(dict(self.subject.REVIEWED, financialAuditPath='/tmp/other'))

    def test_redacts_full_financial_snapshots_from_public_summary(self):
        result = dict(status='replay-fence-rollback-verified', beforeApplication={'SECRET': 'customer'},
            afterApplication={'SECRET': 'customer'}, rehearsal={'receipt': {'internal': True}},
            protectedApplicationUnchanged=True, transactionAttempted=True, rollbackAcknowledged=True)
        summary = self.subject.public_summary(result, 'a'*64)
        self.assertNotIn('SECRET', json.dumps(summary))
        self.assertFalse(summary['liveReplayStarted'])
        self.assertFalse(summary['newPaymentStarted'])

    def test_persistent_submission_marker_refuses_retry_without_overwriting(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            now = datetime(2026, 10, 4, tzinfo=timezone.utc)
            self.subject.reserve_submission(directory, now)
            original = (directory/'transaction-submission.json').read_bytes()
            with self.assertRaises(FileExistsError):
                self.subject.reserve_submission(directory, now)
            self.assertEqual((directory/'transaction-submission.json').read_bytes(), original)

    def test_preflight_never_submits_a_transaction(self):
        callbacks = Mock()
        raw = b'authenticated audit fixture'
        reviewed = dict(self.subject.REVIEWED, financialAuditSha256=hashlib.sha256(raw).hexdigest())
        callbacks.authenticate_inputs.return_value = dict(financialAudit=raw)
        callbacks.inventory.exclusive_inventory.return_value = dict(exclusive=True, unknownClaimants=[])
        callbacks.collect.return_value = dict(before={}, after={}, receipt={}, applicationSnapshot={'readOnly': True})
        snapshot = dict(routine=dict(bodySha256=self.subject.rehearsal.cutover_database.BODY,
            definitionSha256=self.subject.rehearsal.ORIGINAL_DEFINITION_SHA256))
        with patch.object(self.subject.rehearsal, '_audit'), \
                patch.object(self.subject.rehearsal.replay_quiescence, 'verify_replay_quiescence'), \
                patch.object(self.subject.rehearsal.financial_delta, '_snapshot'), \
                patch.object(self.subject.rehearsal.cutover_database, 'capture_snapshot', return_value=snapshot):
            result = self.subject.preflight(callbacks, reviewed)
        self.assertEqual(result['status'], 'replay-rehearsal-preflight-passed')
        self.assertFalse(result['transactionAttempted'])
        callbacks.transport.execute.assert_not_called()


if __name__ == '__main__':
    unittest.main()
