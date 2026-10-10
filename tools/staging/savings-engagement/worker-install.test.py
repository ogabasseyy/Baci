import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from unittest import mock


SCRIPT = Path(__file__).with_name('worker-install.py')
SPEC = importlib.util.spec_from_file_location('worker_install', SCRIPT)
installer = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = installer
SPEC.loader.exec_module(installer)


class WorkerInstallTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.owner = os.getuid()
        self.root.chmod(0o700)
        for name in ('opt', 'etc', 'etc/baci', 'etc/baci/piggyvest-staging', 'etc/systemd', 'etc/systemd/system'):
            path = self.root / name
            path.mkdir(mode=0o755)
        ca = self.root / installer.CA_PATH.lstrip('/')
        ca.write_bytes(b'local test CA')
        ca.chmod(0o444)
        self.paths = installer.Paths(self.root)

    def tearDown(self):
        self.temporary.cleanup()

    def test_expiry_fails_before_any_database_or_filesystem_provisioning(self):
        def fail_if_called(*args, **kwargs):
            self.fail('expired installer attempted work')

        with self.assertRaisesRegex(installer.InstallError, 'expiry'):
            installer.install(b'worker', hashlib.sha256(b'worker').hexdigest(), self.paths,
                               runner=fail_if_called, owner=self.owner,
                               now=datetime(2026, 9, 29, 15, 59, 10, tzinfo=timezone.utc))

    def test_nonmatching_existing_unit_is_refused_before_database_calls(self):
        service = self.root / 'etc/systemd/system' / installer.SERVICE
        service.write_bytes(b'ExecStart=/bin/false\n')
        service.chmod(0o444)

        def fail_if_called(*args, **kwargs):
            self.fail('database runner called for conflicting unit')

        worker = b'worker bundle'
        with self.assertRaisesRegex(installer.InstallError, 'Nonmatching systemd unit'):
            installer.install(worker, hashlib.sha256(worker).hexdigest(), self.paths,
                               runner=fail_if_called, owner=self.owner)
        self.assertEqual(service.read_bytes(), b'ExecStart=/bin/false\n')

    def test_unexpected_existing_worker_artifact_is_refused(self):
        code = self.root / 'opt/baci-savings-notifications'
        code.mkdir(mode=0o755)
        (code / 'unexpected.txt').write_text('preserve me')

        def fail_if_called(*args, **kwargs):
            self.fail('database runner called for unexpected artifact')

        worker = b'worker bundle'
        with self.assertRaisesRegex(installer.InstallError, 'worker directory'):
            installer.install(worker, hashlib.sha256(worker).hexdigest(), self.paths,
                               runner=fail_if_called, owner=self.owner)
        self.assertEqual((code / 'unexpected.txt').read_text(), 'preserve me')

    def test_nonmatching_worker_ca_is_refused_without_overwrite(self):
        code = self.root / 'opt/baci-savings-notifications'
        code.mkdir(mode=0o755)
        worker_ca = code / 'postgres-ca.pem'
        worker_ca.write_bytes(b'different CA')
        worker_ca.chmod(0o444)

        def fail_if_called(*args, **kwargs):
            self.fail('database runner called for nonmatching CA')

        worker = b'worker bundle'
        with self.assertRaisesRegex(installer.InstallError, 'does not match pinned source CA'):
            installer.install(worker, hashlib.sha256(worker).hexdigest(), self.paths,
                               runner=fail_if_called, owner=self.owner)
        self.assertEqual(worker_ca.read_bytes(), b'different CA')

    def test_local_install_keeps_password_on_stdin_and_never_enables_units(self):
        worker = b'worker bundle for staging'
        password = "Test'password 7"
        captured = []

        def runner(command, **options):
            captured.append((command, options))
            if command[1:3] == ['context', 'show']:
                return subprocess.CompletedProcess(command, 0, 'local\n', '')
            if command[1:3] == ['context', 'inspect']:
                return subprocess.CompletedProcess(command, 0, json.dumps({'Host': 'unix:///var/run/docker.sock'}), '')
            if 'psql' in command:
                marker = 'BACI_WORKER_ROLE_PROVISIONED\n' if 'ALTER ROLE' in options['input'] else 'BACI_WORKER_ROLE=NOLOGIN\n'
                return subprocess.CompletedProcess(command, 0, marker, '')
            return subprocess.CompletedProcess(command, 0, '', '')

        with mock.patch.object(installer, '_validate_or_create_account') as account_check, \
             mock.patch.object(installer.secrets, 'token_urlsafe', return_value=password):
            receipt = installer.install(worker, hashlib.sha256(worker).hexdigest(), self.paths,
                                        runner=runner, owner=self.owner)
        account_check.assert_called_once()
        secret = self.root / installer.SECRET_PATH.lstrip('/')
        secret_text = secret.read_text()
        self.assertIn('postgresql://baci_savings_notifications_worker:', secret_text)
        self.assertIn('Test%27password%207', secret_text)
        self.assertIn("PASSWORD 'Test''password 7'", next(options['input'] for command, options in captured
                                                            if 'psql' in command and 'ALTER ROLE' in options['input']))
        provision_sql = next(options['input'] for command, options in captured if 'psql' in command and 'ALTER ROLE' in options['input'])
        self.assertNotRegex(provision_sql, r'\bGRANT\b')
        for command, options in captured:
            self.assertNotIn(password, ' '.join(command))
            self.assertNotIn(secret_text.strip(), ' '.join(command))
            self.assertNotIn(password, options.get('stdout', ''))
        reload_index = next(index for index, (command, _) in enumerate(captured) if command[-1] == 'daemon-reload')
        provision_index = next(index for index, (command, options) in enumerate(captured)
                               if 'psql' in command and 'ALTER ROLE' in options['input'])
        self.assertGreater(provision_index, reload_index)
        self.assertEqual(receipt['status'], 'installed-disabled')
        self.assertEqual(receipt['timer'], installer.TIMER)
        self.assertEqual(receipt['deadlineTimer'], installer.DEADLINE_TIMER)
        self.assertEqual(receipt['checkService'], installer.CHECK_SERVICE)
        self.assertEqual(receipt['healthProofNext'], f"systemctl start {installer.CHECK_SERVICE}; verify successful read-only DB identity and role check")
        systemctl_commands = [command[-1] for command, _ in captured if command[0].endswith('/systemctl')]
        self.assertEqual(systemctl_commands, ['daemon-reload'])
        self.assertEqual((self.root / installer.WORKER_PATH.lstrip('/')).read_bytes(), worker)
        worker_ca = self.root / installer.CA_CREDENTIAL.lstrip('/')
        self.assertEqual(worker_ca.read_bytes(), b'local test CA')
        self.assertEqual(worker_ca.stat().st_mode & 0o777, 0o444)

    def test_database_password_never_enters_command_arguments(self):
        captured = {}

        def runner(command, **options):
            captured.update(command=command, options=options)
            return subprocess.CompletedProcess(command, 0, 'safe marker\n', '')

        secret_sql = "ALTER ROLE baci_savings_notifications_worker PASSWORD 'do-not-log'"
        self.assertEqual(installer._docker_sql(runner, secret_sql), 'safe marker\n')
        self.assertNotIn('do-not-log', ' '.join(captured['command']))
        self.assertEqual(captured['options']['input'], secret_sql)
        self.assertNotIn('stdin', captured['options'])


if __name__ == '__main__':
    unittest.main()
