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
    import projection_owner as module
except ModuleNotFoundError:
    module = None


HERE = Path(__file__).resolve().parent


class ProjectionOwnerTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(module, 'sealed projection-only owner is missing')
        self.blobs = {name: name.encode() for name in module.FILES}
        self.pins = {name: hashlib.sha256(value).hexdigest() for name, value in self.blobs.items()}
        self.release = dict(kind=module.KIND, files=self.pins)
        self.result = dict(summary=dict(status='existing-payment-financially-completed',
            financialCompleted=True, newPaymentStarted=False), privateProof={'retained': True})
        self.context = SimpleNamespace(lock=10, journal=Mock())
        self.context_type = Mock(return_value=self.context)
        self.executor = SimpleNamespace(__file__=str(HERE/'projection_pass.py'),
            FILES=module.FILES-{'projection_owner.py'}, run_projection_pass=Mock(return_value=self.result))
        self.dependencies = {name: SimpleNamespace(__file__=str(HERE/(name+'.py')))
            for name in module.MODULES}
        self.dependencies['projection_pass'] = self.executor

    def execute(self, broken=None, failure=None):
        release = copy.deepcopy(self.release)
        if broken == 'extra':
            release['files']['foreign.py'] = 'a'*64
        if broken == 'missing':
            release['files'].pop('projection_preflight.py')
        if broken == 'kind':
            release['kind'] = 'financial-reconcile-existing-transfer-only'
        raw = json.dumps(release, sort_keys=True, separators=(',', ':')).encode()
        seal = hashlib.sha256(raw).hexdigest()
        reads = 0
        def read(path, pin):
            nonlocal reads
            if Path(path).name == 'release.json':
                reads += 1
                return raw
            source = self.blobs[Path(path).name]
            if broken == 'drift' or (broken == 'late-drift' and reads == 3):
                source += b'drift'
            return source
        if failure:
            self.executor.run_projection_pass.side_effect = failure
        with (patch.object(module.os, 'geteuid', return_value=0),
            patch.object(readiness, '_protected_read', side_effect=read),
            patch.object(readiness, '_canonical'),
            patch.object(readiness, '_load_modules', return_value={'cutover_context': SimpleNamespace(Context=self.context_type)}),
            patch.object(module.importlib, 'import_module', side_effect=lambda name: self.dependencies[name]),
            patch.object(module.tempfile, 'mkdtemp', return_value='/root/private-projection-audit'),
            patch.object(module.os, 'chmod'), patch.object(module.os, 'close') as close,
            patch('sys.stdout', new_callable=io.StringIO) as output):
            status = module.main([seal])
        return status, json.loads(output.getvalue()), close

    def test_sealed_projection_owner_records_private_proof_before_printing_completion(self):
        status, report, close = self.execute()
        self.assertEqual(status, 0)
        self.assertTrue(report['financialCompleted'])
        self.assertFalse(report['newPaymentStarted'])
        self.context.journal.assert_called_once_with(Path('/root/private-projection-audit'), 'projection-pass', self.result)
        self.executor.run_projection_pass.assert_called_once()
        self.assertNotIn('privateProof', report)
        close.assert_called_once_with(10)

    def test_unreviewed_kind_files_or_bytes_never_reach_root_context(self):
        for broken in ('extra', 'missing', 'kind', 'drift'):
            with self.subTest(broken=broken):
                self.setUp()
                status, report, close = self.execute(broken=broken)
                self.assertEqual(status, 1)
                self.assertFalse(report['financialActionAttempted'])
                self.context_type.assert_not_called()
                self.executor.run_projection_pass.assert_not_called()
                close.assert_not_called()

    def test_false_reconciliation_only_result_is_never_accepted_as_projection_completion(self):
        self.result['summary'].update(status='financial-reconciliation-only', financialCompleted=False)
        status, report, close = self.execute()
        self.assertEqual(status, 1)
        self.assertNotIn('financialCompleted', report)
        close.assert_called_once_with(10)

    def test_returned_false_completion_is_journaled_before_summary_refusal(self):
        self.result['summary'].update(status='financial-reconciliation-only', financialCompleted=False)
        status, report, close = self.execute()
        self.assertEqual(status, 1)
        self.assertTrue(report['privateAuditRecorded'])
        self.context.journal.assert_called_once_with(Path('/root/private-projection-audit'),
            'projection-pass', self.result)
        self.assertNotIn('privateProof', report)
        self.executor.run_projection_pass.assert_called_once()
        close.assert_called_once_with(10)

    def test_returned_missing_summary_retains_private_evidence_without_completion(self):
        self.result.pop('summary')
        status, report, close = self.execute()
        self.assertEqual(status, 1)
        self.assertTrue(report['privateAuditRecorded'])
        self.context.journal.assert_called_once_with(Path('/root/private-projection-audit'),
            'projection-pass', self.result)
        self.assertNotIn('privateProof', report)
        close.assert_called_once_with(10)

    def test_post_execution_source_drift_preserves_audit_without_claiming_completion(self):
        status, report, close = self.execute(broken='late-drift')
        self.assertEqual(status, 1)
        self.assertTrue(report['privateAuditRecorded'])
        self.assertIsNone(report['financialActionAttempted'])
        self.context.journal.assert_called_once_with(Path('/root/private-projection-audit'),
            'projection-pass', self.result)
        close.assert_called_once_with(10)

    def test_partial_failure_is_private_and_never_retried(self):
        failure = ValueError('PRIVATE_TOKEN')
        failure.private_evidence = dict(firstPost={'retained': True}, workerFailed=True)
        status, report, close = self.execute(failure=failure)
        self.assertEqual(status, 1)
        self.assertTrue(report['privateAuditRecorded'])
        self.assertNotIn('PRIVATE_TOKEN', str(report))
        self.assertNotIn('firstPost', report)
        self.executor.run_projection_pass.assert_called_once()
        close.assert_called_once_with(10)

    def test_foreign_import_origin_refuses_before_context(self):
        self.dependencies['projection_preflight'].__file__ = '/tmp/foreign.py'
        status, report, close = self.execute()
        self.assertEqual(status, 1)
        self.context_type.assert_not_called()
        close.assert_not_called()


if __name__ == '__main__':
    unittest.main()
