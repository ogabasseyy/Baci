import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from runtime_owner_support import command, legacy_replay_directory, read_replay_inputs, readiness_failure, save_exact
from treasury_owner_contract import Refused


class RuntimeOwnerSupportTests(unittest.TestCase):
    def test_readiness_failure_survives_owner_wrapper_without_private_error_text(self):
        report = dict(status='refused', redacted=True, cardPaymentsEnabled=False,
                      diagnostic=dict(profile='worker', phase='connect', code='28P01'))
        result = SimpleNamespace(returncode=1, stdout=json.dumps(report), stderr='private-password-canary')
        with patch('runtime_owner_support.subprocess.run', return_value=result):
            with self.assertRaisesRegex(Refused, '^Runtime readiness refused: profile=worker phase=connect code=28P01$'):
                command(['/usr/bin/node', '/root/reviewed/runtime-readiness-cli.cjs', '--connect', '/etc/private.json'])
            with self.assertRaisesRegex(Refused, '^Runtime command refused$'):
                command(['/usr/bin/node', '/root/other.cjs', '--connect', '/etc/private.json'])

    def test_arbitrary_diagnostic_values_and_extra_fields_never_reach_owner_output(self):
        original = dict(status='refused', redacted=True, cardPaymentsEnabled=False,
                        diagnostic=dict(profile='worker', phase='connect', code='28P01'))
        for field in ('profile', 'phase', 'code', 'private-password-canary'):
            report = json.loads(json.dumps(original))
            report['diagnostic'][field] = 'private-password-canary'
            self.assertIsNone(readiness_failure(json.dumps(report)))
        for output in ('private-password-canary', '{}', '[]', 'null'):
            self.assertIsNone(readiness_failure(output))

    def test_legacy_readonly_container_directory_requires_private_parent_and_exact_755_child(self):
        with tempfile.TemporaryDirectory() as directory:
            child = Path(directory) / 'config'
            child.mkdir(mode=0o755)
            legacy_replay_directory(child, os.getuid())
            child.chmod(0o777)
            with self.assertRaises(Refused):
                legacy_replay_directory(child, os.getuid())
            child.chmod(0o755)
            Path(directory).chmod(0o755)
            with self.assertRaises(Refused):
                legacy_replay_directory(child, os.getuid())
    def test_saves_once_and_preserves_foreign_or_symlink_output(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'private.json'
            with patch('runtime_owner_support.read_file', side_effect=lambda path, *_: Path(path).read_bytes()):
                save_exact(target, {'safe': True})
                save_exact(target, {'safe': True})
                before = target.read_bytes()
                with self.assertRaises(Refused):
                    save_exact(target, {'safe': False})
                self.assertEqual(target.read_bytes(), before)
            link = Path(directory) / 'link.json'
            link.symlink_to(target)
            with self.assertRaises(Refused):
                save_exact(link, {'safe': True})

    def test_reads_only_expected_replay_key_sources(self):
        old = {'appToken': 'unprinted-token'}
        config = 'jwt-secret = "' + 'r' * 40 + '"\njwt-aud = "pvb-staging-receipts"\n'
        app = {'Config': {'Env': ['PGRST_JWT_SECRET=' + 'a' * 40],
                          'Labels': {'com.docker.compose.project': 'baci-isolated-savings'}},
               'State': {'Running': True}}
        with patch('runtime_owner_support.private_directory'), patch('runtime_owner_support.legacy_replay_directory'), patch('runtime_owner_support.read_file',
                side_effect=[json.dumps(old).encode(), config.encode()]), patch('runtime_owner_support.inspect', return_value=app):
            result = read_replay_inputs(1001)
        self.assertEqual(result, (old, {'receiptToken': 'r' * 40, 'appToken': 'a' * 40}))

    def test_rejects_ambiguous_receipt_config_or_wrong_project(self):
        for config, project in [('jwt-secret="x"\njwt-secret="y"\njwt-aud="pvb-staging-receipts"', 'baci-isolated-savings'),
                                ('jwt-secret="x"\njwt-aud="pvb-staging-receipts"', 'production')]:
            app = {'Config': {'Env': ['PGRST_JWT_SECRET=' + 'a' * 40],
                              'Labels': {'com.docker.compose.project': project}}, 'State': {'Running': True}}
            with patch('runtime_owner_support.private_directory'), patch('runtime_owner_support.legacy_replay_directory'), patch('runtime_owner_support.read_file',
                    side_effect=[b'{}', config.encode()]), patch('runtime_owner_support.inspect', return_value=app):
                with self.assertRaises(Refused):
                    read_replay_inputs(1001)


if __name__ == '__main__':
    unittest.main()
