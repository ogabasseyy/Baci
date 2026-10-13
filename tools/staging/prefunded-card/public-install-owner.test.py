from contextlib import nullcontext, redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch


SPEC = importlib.util.spec_from_file_location('public_owner', Path(__file__).with_name('public-install-owner.py'))
owner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(owner)
ARGS = ['--archive', '/root/bundle/app.tar.gz', '--archive-sha256', 'a' * 64,
        '--manifest', '/root/bundle/manifest.json', '--manifest-sha256', 'b' * 64]


class OwnerTests(unittest.TestCase):
    def test_nginx_preflight_refusal_reports_only_the_literal_reason_before_any_probe_or_install(self):
        installer, nginx = Mock(), Mock()
        nginx.preflight.side_effect = owner.Refused('Nginx observed predecessor size changed')
        with patch.object(owner, 'PublicNginxInstaller', return_value=nginx), \
                patch.object(owner, 'baseline') as baseline:
            status, output = self.run_owner(installer, ['--start', '--activate-nginx'])

        self.assertEqual(status, 1)
        self.assertEqual(json.loads(output.splitlines()[-1]), {
            'status': 'refused', 'stage': 'nginx-preflight', 'redacted': True,
            'reasonCode': 'NGINX_PREDECESSOR_SIZE_CHANGED', 'exceptionClass': 'Refused',
        })
        baseline.assert_not_called()
        self.assertEqual(installer.mock_calls, [])
        nginx.rollback.assert_not_called()

    def test_http_baseline_refusal_is_distinct_from_nginx_preflight_and_does_not_install(self):
        installer, nginx = Mock(), Mock()
        nginx.preflight.return_value = 'c' * 64
        with patch.object(owner, 'PublicNginxInstaller', return_value=nginx), \
                patch.object(owner, 'baseline', side_effect=owner.Refused('Public HTTP status differs')):
            status, output = self.run_owner(installer, ['--start', '--activate-nginx'])

        self.assertEqual(status, 1)
        report = json.loads(output.splitlines()[-1])
        self.assertEqual(report['stage'], 'http-baseline')
        self.assertEqual(report.get('reasonCode'), 'HTTP_STATUS_MISMATCH')
        self.assertEqual(report.get('exceptionClass'), 'Refused')
        self.assertEqual(installer.mock_calls, [])
        nginx.install.assert_not_called()
        nginx.rollback.assert_not_called()

    def test_preflight_and_network_messages_never_enter_refusal_output(self):
        secret = 'synthetic-password-token-never-output'
        cases = (
            (owner.Refused(secret), 'UNCLASSIFIED_REFUSAL', 'Refused'),
            (owner.Refused('Nginx token shape refused: ' + secret), 'UNCLASSIFIED_REFUSAL', 'Refused'),
            (TimeoutError('https://user:' + secret + '@private.invalid/network'), 'UNEXPECTED_EXCEPTION', 'TimeoutError'),
            (RuntimeError('Nginx token shape refused'), 'UNEXPECTED_EXCEPTION', 'RuntimeError'),
        )
        for error, reason, category in cases:
            with self.subTest(category=category):
                installer, nginx = Mock(), Mock()
                nginx.preflight.return_value = 'c' * 64
                with patch.object(owner, 'PublicNginxInstaller', return_value=nginx), \
                        patch.object(owner, 'baseline', side_effect=error):
                    status, output = self.run_owner(installer, ['--start', '--activate-nginx'])

                self.assertEqual(status, 1)
                self.assertEqual(json.loads(output.splitlines()[-1]), {
                    'status': 'refused', 'stage': 'http-baseline', 'redacted': True,
                    'reasonCode': reason, 'exceptionClass': category,
                })
                self.assertNotIn(secret, output)
                self.assertNotIn('private.invalid', output)
                self.assertNotIn('Nginx token shape refused', output)
                self.assertEqual(installer.mock_calls, [])

    def test_cleanup_failure_preserves_the_original_safe_reason_and_redaction(self):
        installer = Mock(start_attempted=True)
        installer.start.side_effect = owner.Refused('Input file metadata refused')
        installer.withdraw.side_effect = RuntimeError('synthetic-cleanup-secret')

        status, output = self.run_owner(installer, ['--start'])

        self.assertEqual(status, 1)
        report = json.loads(output.splitlines()[-1])
        self.assertEqual(report['stage'], 'loopback-http-start')
        self.assertEqual(report.get('reasonCode'), 'INPUT_FILE_METADATA_REFUSED')
        self.assertEqual(report.get('exceptionClass'), 'Refused')
        self.assertFalse(report['publicWithdrawalConfirmed'])
        self.assertNotIn('synthetic-cleanup-secret', output)
        installer.withdraw.assert_called_once()

    def test_combined_activation_checks_nginx_before_installing_and_restores_on_failure(self):
        installer, nginx = Mock(), Mock()
        nginx.preflight.return_value = 'c' * 64
        nginx.install.side_effect = RuntimeError('private probe cause')
        with patch.object(owner, 'PublicNginxInstaller', return_value=nginx), \
                patch.object(owner, 'baseline', return_value=True):
            status, output = self.run_owner(installer, ['--start', '--activate-nginx'])
        self.assertEqual(status, 1)
        nginx.preflight.assert_called_once()
        nginx.rollback.assert_called_once()
        installer.withdraw.assert_called_once()
        self.assertNotIn('private probe cause', output)

    def run_owner(self, installer, extra=()):
        output = io.StringIO()
        with patch.object(owner, 'verify_bundle'), patch.object(owner, 'locked_parent', return_value=nullcontext()), \
                patch.object(owner, 'PublicInstaller', return_value=installer), redirect_stdout(output):
            result = owner.main([*ARGS, *extra])
        return result, output.getvalue()

    def test_prepare_only_proves_private_configuration_without_http(self):
        installer = Mock()
        status, output = self.run_owner(installer)
        self.assertEqual(status, 0)
        self.assertEqual([call[0] for call in installer.mock_calls], ['prepare', 'private_proof'])
        report = json.loads(output.splitlines()[-1])
        self.assertFalse(report['firstCardHttpStarted'])
        self.assertFalse(report['publicRoutingChanged'])
        self.assertFalse(report['savedCardsEnabled'])
        self.assertFalse(report['authenticatedCustomerVerified'])

    def test_explicit_start_runs_only_after_private_proof(self):
        installer = Mock()
        status, output = self.run_owner(installer, ['--start'])
        self.assertEqual(status, 0)
        self.assertEqual([call[0] for call in installer.mock_calls], ['prepare', 'private_proof', 'start'])
        self.assertTrue(json.loads(output.splitlines()[-1])['firstCardHttpStarted'])

    def test_private_failure_never_starts_and_all_exceptions_are_redacted(self):
        installer = Mock(start_attempted=False)
        installer.private_proof.side_effect = RuntimeError('synthetic-password-token-private-cause')
        status, output = self.run_owner(installer, ['--start'])
        self.assertEqual(status, 1)
        self.assertNotIn('synthetic-password', output)
        installer.start.assert_not_called()
        installer.withdraw.assert_called_once()
        self.assertEqual(json.loads(output.splitlines()[-1])['stage'], 'private-tls-proof')

    def test_unknown_start_failure_withdraws_only_via_bounded_installer(self):
        installer = Mock(start_attempted=True)
        installer.start.side_effect = RuntimeError('sensitive cause')
        status, output = self.run_owner(installer, ['--start'])
        self.assertEqual(status, 1)
        installer.withdraw.assert_called_once()
        self.assertTrue(json.loads(output.splitlines()[-1])['publicWithdrawalConfirmed'])
        installer.withdraw.side_effect = RuntimeError('cleanup-sensitive')
        status, output = self.run_owner(installer, ['--start'])
        self.assertEqual(status, 1)
        self.assertFalse(json.loads(output.splitlines()[-1])['publicWithdrawalConfirmed'])
        self.assertNotIn('sensitive', output)

    def test_no_root_bundle_authority_means_no_installer(self):
        output = io.StringIO()
        with patch.object(owner, 'verify_bundle', side_effect=RuntimeError('unsafe')), \
                patch.object(owner, 'PublicInstaller') as installer, redirect_stdout(output):
            self.assertEqual(owner.main(ARGS), 1)
        installer.assert_not_called()
        self.assertNotIn('unsafe', output.getvalue())


if __name__ == '__main__':
    unittest.main()
