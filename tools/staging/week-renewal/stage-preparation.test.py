import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SOURCE = Path(__file__).with_name('stage-preparation.sh')


class LauncherTests(unittest.TestCase):
    def test_reviewed_manifest_includes_diagnostic_and_matches_launcher_pin(self):
        records = SOURCE.with_name('SHA256SUMS').read_text().splitlines()
        filenames = [record.split('  ', 1)[1] for record in records]
        self.assertIn('renewal_diagnostic.py', filenames)
        for record in records:
            expected, filename = record.split('  ', 1)
            self.assertEqual(hashlib.sha256(SOURCE.with_name(filename).read_bytes()).hexdigest(), expected)
        result = subprocess.run(['/bin/sh', str(SOURCE), '--print-owner-command'],
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('renewal_owner.py --prepare --bundle-sha256', result.stdout)

    def fixture(self, root):
        text = SOURCE.read_text()
        source_names = ('renewal_contract.py', 'renewal_io.py', 'renewal_owner.py', 'renewal_diagnostic.py', 'README.md')
        records = []
        for name in source_names:
            content = SOURCE.with_name(name).read_bytes()
            (root / name).write_bytes(content)
            records.append(hashlib.sha256(content).hexdigest() + '  ' + name)
        manifest = ('\n'.join(records) + '\n').encode()
        (root / 'SHA256SUMS').write_bytes(manifest)
        expected = hashlib.sha256(manifest).hexdigest()
        for line in text.splitlines():
            if line.startswith('manifest_sha='):
                text = text.replace(line, 'manifest_sha=' + expected)
        log = root / 'ssh.log'
        mock = root / 'ssh'
        mock.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "' + str(log) + '"\ncase "$*" in *"--property"*) exit 1;; esac\n')
        mock.chmod(0o700)
        text = text.replace('/usr/bin/ssh', str(mock))
        text = text.replace('/usr/bin/scp', str(mock))
        launcher = root / 'launcher.sh'
        launcher.write_text(text)
        return launcher, log

    def run_launcher(self, root, action):
        launcher, log = self.fixture(root)
        result = subprocess.run(['/bin/sh', str(launcher), action], capture_output=True, text=True,
                                env={'PATH': '/usr/bin:/bin', 'HOME': str(root)}, timeout=10)
        return result, log.read_text() if log.exists() else ''

    def test_print_command_does_not_contact_host_or_execute_sudo(self):
        with tempfile.TemporaryDirectory() as temporary:
            result, log = self.run_launcher(Path(temporary), '--print-owner-command')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(log, '')
        self.assertIn('sudo /usr/bin/env -i', result.stdout)
        self.assertIn('renewal_owner.py --prepare --bundle-sha256', result.stdout)
        self.assertNotIn('systemctl start', result.stdout)
        self.assertNotIn('systemctl restart', result.stdout)

    def test_prepare_verifies_remote_before_interactive_owner_command(self):
        with tempfile.TemporaryDirectory() as temporary:
            result, log = self.run_launcher(Path(temporary), '--prepare')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(result.stdout.startswith('Preparation only; does not renew or restart staging\n'))
        self.assertLess(log.index('BatchMode=yes'), log.index('-t -o ServerAliveInterval'))
        self.assertIn('sudo /usr/bin/env -i', log)
        self.assertNotIn('systemctl start', log)
        self.assertNotIn('docker exec', log)

    def test_diagnose_verifies_sources_and_never_selects_prepare_or_activation(self):
        with tempfile.TemporaryDirectory() as temporary:
            result, log = self.run_launcher(Path(temporary), '--diagnose')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(result.stdout.startswith('Read-only checks; no renewal, service restart, database write or payment\n'))
        self.assertIn('renewal_owner.py --diagnose --bundle-sha256', log)
        self.assertNotIn('renewal_owner.py --prepare', log)
        self.assertNotIn('systemctl restart', log)
        self.assertNotIn('docker exec', log)

    def test_unprivileged_stage_contains_no_owner_command(self):
        with tempfile.TemporaryDirectory() as temporary:
            result, log = self.run_launcher(Path(temporary), '--stage')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('source staged only', result.stdout)
        self.assertNotIn('sudo ', log)
        self.assertNotIn('renewal_owner.py --prepare', log)

    def test_local_pin_drift_refuses_before_any_ssh(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            launcher, log = self.fixture(root)
            (root / 'renewal_owner.py').write_text('unreviewed-secret')
            result = subprocess.run(['/bin/sh', str(launcher), '--prepare'], capture_output=True, text=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(log.exists())
            self.assertNotIn('unreviewed-secret', result.stdout + result.stderr)

    def test_remote_verification_failure_blocks_interactive_owner_execution(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            launcher, log = self.fixture(root)
            mock = root / 'ssh'
            mock.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "' + str(log) + '"\nexit 1\n')
            result = subprocess.run(['/bin/sh', str(launcher), '--prepare'], capture_output=True, text=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn('sudo ', log.read_text())


if __name__ == '__main__':
    unittest.main()
