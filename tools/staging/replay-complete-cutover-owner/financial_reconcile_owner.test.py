import copy
import hashlib
import io
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import financial_readiness_owner as readiness

try:
    import financial_reconcile_owner as module
except ModuleNotFoundError:
    module = None


HERE = Path(__file__).resolve().parent


class FinancialReconcileOwnerTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(module, 'sealed financial owner entrypoint not implemented')
        self.blobs = {name: b'reviewed-source' for name in module.FILES}
        self.pins = {name: hashlib.sha256(raw).hexdigest() for name, raw in self.blobs.items()}
        self.release = dict(kind=module.KIND, files=self.pins)
        self.context = SimpleNamespace(lock=20, journal=Mock())
        self.context_type = Mock(return_value=self.context)
        self.result = dict(summary=dict(status='financial-reconciliation-only',
            financialCompleted=False, newPaymentStarted=False), privateProof={'preserved': True})
        self.executor = SimpleNamespace(__file__=str(HERE/'financial_reconcile_pass.py'),
            run_financial_reconcile_pass=Mock(return_value=self.result))
        self.adapter = SimpleNamespace(__file__=str(HERE/'worker_adapter.py'))
        self.modules = dict(cutover_context=SimpleNamespace(Context=self.context_type))

    def execute(self, *, broken=None, executor_error=False):
        release = copy.deepcopy(self.release)
        if broken == 'extra': release['files']['foreign.py'] = 'a'*64
        elif broken == 'missing': release['files'].pop('worker_adapter.py')
        elif broken == 'missing_completion': release['files'].pop('completion_snapshot.py', None)
        elif broken == 'kind': release['kind'] = 'activate-everything'
        raw = json.dumps(release, sort_keys=True, separators=(',', ':')).encode()
        pin = hashlib.sha256(raw).hexdigest()
        release_reads = 0
        def read(path, expected):
            nonlocal release_reads
            if Path(path).name == 'release.json':
                release_reads += 1
                return raw
            blob = self.blobs[Path(path).name]
            changed = broken == 'drift' or (broken == 'late_drift' and release_reads == 3)
            return blob+b'drift' if ((changed and Path(path).name == 'worker_adapter.py')
                or (broken == 'completion_drift' and Path(path).name == 'completion_snapshot.py')) else blob
        if executor_error:
            failure = ValueError('PRIVATE_TOKEN')
            if executor_error == 'partial':
                failure.private_evidence = dict(workerFailed=True, firstPost={'preserved': True})
            self.executor.run_financial_reconcile_pass.side_effect = failure
        imports = dict(financial_reconcile_pass=self.executor, worker_adapter=self.adapter)
        with (patch.object(module.os, 'geteuid', return_value=0),
              patch.object(readiness, '_protected_read', side_effect=read),
              patch.object(readiness, '_canonical'),
              patch.object(readiness, '_load_modules', return_value=self.modules),
              patch.object(module, '_origin'),
              patch.object(module.tempfile, 'mkdtemp', return_value='/root/private-financial-audit'),
              patch.object(module.os, 'chmod'), patch.object(module.os, 'close') as close,
              patch('sys.stdout', new_callable=io.StringIO) as output,
              patch.object(module.importlib, 'import_module', side_effect=lambda name: imports[name])):
            status = module.main([pin])
        return status, json.loads(output.getvalue()), close

    def test_closed_owner_entrypoint_pins_all_sources_before_context_and_uses_literal_catalog(self):
        status, response, close = self.execute()
        self.assertEqual(status, 0)
        self.assertEqual(response, self.result['summary'])
        self.assertEqual(self.executor.run_financial_reconcile_pass.call_args.kwargs,
            {'reviewed_catalog_sha256': 'a1443b22b5fb2573608c854baa4d02a8b2036a631c1b4163b940b1b1f7562b7d'})
        self.context.journal.assert_called_once_with(Path('/root/private-financial-audit'), 'finite-pass', self.result)
        close.assert_called_once_with(20)
        self.assertNotIn('privateProof', response)

    def test_extra_missing_drift_or_wrong_kind_refuses_before_context_or_executor(self):
        for broken in ('extra', 'missing', 'drift', 'kind', 'missing_completion', 'completion_drift'):
            self.setUp()
            with self.subTest(broken=broken):
                status, response, close = self.execute(broken=broken)
                self.assertEqual(status, 1)
                self.assertEqual(response['stage'], 'sealed-inputs')
                self.assertIs(response['financialActionAttempted'], False)
                self.context_type.assert_not_called()
                self.executor.run_financial_reconcile_pass.assert_not_called()
                close.assert_not_called()

    def test_attempt_failure_is_unknown_not_falsely_unchanged_and_never_retries(self):
        status, response, close = self.execute(executor_error=True)
        self.assertEqual(status, 1)
        self.assertEqual(response['stage'], 'finite-pass')
        self.assertIsNone(response['financialActionAttempted'])
        self.assertTrue(response['redacted'])
        self.assertNotIn('PRIVATE_TOKEN', json.dumps(response))
        self.executor.run_financial_reconcile_pass.assert_called_once()
        close.assert_called_once_with(20)

    def test_owner_package_never_adds_provider_or_replay_actions(self):
        self.assertEqual(module.FILES-readiness.FILES,
            {'financial_reconcile_owner.py', 'financial_reconcile_pass.py', 'worker_adapter.py',
                'financial_snapshot.sql', 'completion_snapshot.py'})
        self.assertLess(len((HERE/'financial_reconcile_owner.py').read_text().splitlines()), 300)

    def test_completed_pass_private_audit_survives_postflight_source_drift(self):
        status, response, close = self.execute(broken='late_drift')
        self.assertEqual(status, 1)
        self.assertEqual(response['stage'], 'finite-pass')
        self.assertIsNone(response['financialActionAttempted'])
        self.context.journal.assert_called_once_with(
            Path('/root/private-financial-audit'), 'finite-pass', self.result)
        self.assertNotIn('privateProof', response)
        self.executor.run_financial_reconcile_pass.assert_called_once()
        close.assert_called_once_with(20)

    def test_post_worker_refusal_journals_partial_evidence_only_to_private_audit(self):
        status, response, close = self.execute(executor_error='partial')
        self.assertEqual(status, 1)
        self.assertTrue(response.get('privateAuditRecorded', False))
        self.context.journal.assert_called_once_with(Path('/root/private-financial-audit'),
            'refused-partial-pass', dict(workerFailed=True, firstPost={'preserved': True}))
        self.assertNotIn('firstPost', response)
        self.assertNotIn('PRIVATE_TOKEN', str(response))
        self.executor.run_financial_reconcile_pass.assert_called_once()
        close.assert_called_once_with(20)

    def test_unwritable_partial_audit_still_refuses_without_claiming_it_was_recorded(self):
        self.context.journal.side_effect = OSError('PRIVATE_PATH')
        status, response, close = self.execute(executor_error='partial')
        self.assertEqual(status, 1)
        self.assertIs(response.get('privateAuditRecorded'), False)
        self.assertIsNone(response['financialActionAttempted'])
        self.assertNotIn('PRIVATE_PATH', str(response))
        self.assertNotIn('PRIVATE_TOKEN', str(response))
        self.executor.run_financial_reconcile_pass.assert_called_once()
        close.assert_called_once_with(20)

    def test_import_origin_rejects_foreign_path_even_when_module_has_requested_name(self):
        with self.assertRaisesRegex(ValueError, '^financial_reconcile_owner_refused$'):
            module._origin(SimpleNamespace(__file__='/tmp/foreign.py'), HERE, 'worker_adapter')


if __name__ == '__main__':
    unittest.main()
