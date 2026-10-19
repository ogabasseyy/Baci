import copy
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import public_resume_bootstrap as subject


class Tests(unittest.TestCase):
    def fixtures(self):
        root = Mock()
        root.audit = Path('/root/private-public-audit')
        callbacks = Mock()
        callbacks.resume.return_value = dict(status='public-service-resumed', protectedStateUnchanged=True)
        callbacks.exclusive.return_value = True
        callbacks.deadline.return_value = dict(epoch=1791302350)
        callbacks.clock.return_value = 0
        resume = SimpleNamespace(_inputs=Mock(return_value={'unit': b'unit'}), _container=Mock(), _unit=Mock(),
            _completion=Mock(), _history=Mock(return_value=[]), UNIT='unit', DEADLINE=1)
        modules = {'continuation_root': SimpleNamespace(prepare_root=Mock(return_value=root)),
            'public_resume_adapter': SimpleNamespace(PublicCallbacks=Mock(return_value=callbacks), AUDIT_PINS={'actual': 'pins'}),
            'public_resume': resume, 'continuation_runner': Mock()}
        return root, callbacks, modules, dict(reviewed={'container': {}}, reviewedSha256='a' * 64)

    def test_apply_calls_only_public_resume_preserves_result_before_close(self):
        root, callbacks, modules, manifest = self.fixtures()
        result = subject.invoke(modules, {'source': b'original'}, manifest, Mock(return_value=True), True)
        self.assertEqual(result['status'], 'public-service-resumed')
        callbacks.resume.assert_called_once_with(manifest['reviewed'], manifest['reviewedSha256'])
        root.prepare.assert_not_called()
        root.reconcile.assert_not_called()
        modules['continuation_runner'].run_continuation.assert_not_called()
        payload = json.loads(root.context.owner.write.call_args.args[1])
        self.assertEqual(payload['result'], result)
        self.assertIs(payload['financialActionAttempted'], False)
        root.close.assert_called_once()

    def test_default_preflight_never_calls_start_resume_or_financial_runner(self):
        root, callbacks, modules, manifest = self.fixtures()
        result = subject.invoke(modules, {}, manifest, Mock(return_value=True))
        self.assertEqual(result['status'], 'public-resume-preflight-only')
        self.assertFalse(result['publicStartAttempted'])
        callbacks.resume.assert_not_called()
        callbacks.run.assert_not_called()
        modules['continuation_runner'].run_continuation.assert_not_called()
        modules['public_resume']._completion.assert_called_once()
        root.close.assert_called_once()

    def test_poststart_private_audit_failure_preserves_redacted_actual_outcome_no_retry(self):
        root, callbacks, modules, manifest = self.fixtures()
        root.context.owner.write.side_effect = OSError('private secret')
        result = subject.invoke(modules, {}, manifest, Mock(return_value=True), True)
        self.assertEqual(result['status'], 'public-resume-audit-unconfirmed')
        self.assertEqual(result['publicResult']['status'], 'public-service-resumed')
        self.assertNotIn('private secret', json.dumps(result))
        self.assertEqual(callbacks.resume.call_count, 1)
        root.close.assert_called_once()

    def test_cleanup_failure_does_not_replace_or_invent_successful_outcome(self):
        root, _, modules, manifest = self.fixtures()
        root.close.side_effect = OSError('private secret')
        result = subject.invoke(modules, {}, manifest, Mock(return_value=True), True)
        self.assertEqual(result['status'], 'public-resume-cleanup-unconfirmed')
        self.assertEqual(result['publicResult']['status'], 'public-service-resumed')
        self.assertEqual(json.loads(root.context.owner.write.call_args.args[1])['result']['status'], 'public-service-resumed')

    def test_exact_private_manifest_builder_never_infers_customer_acceptance(self):
        reviewed = dict(configPins=subject.CONFIGS, manifestPath=subject.MANIFEST, sources={}, container={})
        captured = {name: b'bytes' for name in subject.FILES}
        with patch.object(subject, 'RELEASE_PIN', hashlib.sha256(b'bytes').hexdigest()):
            manifest = subject.make_manifest(reviewed, captured)
            self.assertEqual(set(manifest['files']), subject.FILES)
            self.assertEqual(manifest['reviewed'], reviewed)
            self.assertNotIn('authenticatedCustomerVerified', manifest)
            wrong = copy.deepcopy(reviewed)
            wrong['configPins'] = {}
            with self.assertRaises(ValueError):
                subject.make_manifest(wrong, captured)

    def test_public_release_rejects_extra_sources_before_loading(self):
        reviewed = dict(configPins=subject.CONFIGS, manifestPath=subject.MANIFEST)
        manifest = dict(kind='sealed-postcredit-public-only-resume', reviewed=reviewed,
            reviewedSha256=hashlib.sha256(json.dumps(reviewed, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
            files={name: 'a' * 64 for name in subject.FILES})
        manifest['files']['continuation_release.py'] = subject.RELEASE_PIN
        manifest['files']['foreign.py'] = 'a' * 64
        with patch.object(subject, 'protected', return_value=json.dumps(manifest).encode()):
            with self.assertRaises(ValueError):
                subject.capture('a' * 64)

    def test_bootstrap_or_r2_drift_before_root_construction_never_calls_resume(self):
        for source in ('bootstrap', 'r2'):
            with self.subTest(source=source):
                root, callbacks, modules, manifest = self.fixtures()
                with self.assertRaises(ValueError):
                    subject.invoke(modules, {}, manifest, Mock(side_effect=ValueError(source)), True)
                callbacks.resume.assert_not_called()
                modules['continuation_root'].prepare_root.assert_not_called()

    def test_final_seal_drift_after_submission_preserves_owned_cleanup_and_no_retry(self):
        root, callbacks, modules, manifest = self.fixtures()
        import public_resume
        modules['public_resume'] = public_resume
        callbacks.attempted, callbacks.submitted = True, public_resume.DEADLINE
        callbacks.inspect.return_value = dict(Id=public_resume.CID, Name='/' + public_resume.NAME,
            Image=public_resume.IMAGE, State=dict(Running=False))
        with patch.object(public_resume, '_terminal', return_value=True):
            result = subject.invoke(modules, {}, manifest, Mock(side_effect=[True, ValueError('source drift')]), True)
        self.assertEqual(result['status'], 'public-resume-refused')
        self.assertTrue(result['ownedContainerStopped'])
        self.assertEqual(result['priorPublicResult']['status'], 'public-service-resumed')
        self.assertEqual(callbacks.resume.call_count, 1)
        callbacks.run.assert_called_once_with([*public_resume.DOCKER, 'stop', '--time', '5', public_resume.CID], timeout=15)
        self.assertEqual(json.loads(root.context.owner.write.call_args.args[1])['result'], result)


if __name__ == '__main__':
    unittest.main()
