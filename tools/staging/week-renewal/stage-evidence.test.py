import hashlib
from pathlib import Path
import re
import subprocess
import tempfile
import unittest


SOURCE = Path(__file__).with_name('stage-evidence.sh')


class EvidenceLauncherTests(unittest.TestCase):
    def fixture(self, root):
        text = SOURCE.read_text()
        records = []
        names = re.search(r"^names='([^']+)'$", text, re.MULTILINE)[1].split()
        for name in names:
            if name == 'ACTIVATION_SHA256SUMS':
                continue
            content = ('fixture-' + name).encode()
            directory = root.parent / 'prefunded-card' if name in (
                'renewal_inventory.py', 'renewal-inventory.sql', 'renewal-receipt-inventory.sql') else root
            directory.mkdir(exist_ok=True)
            (directory / name).write_bytes(content)
            records.append(hashlib.sha256(content).hexdigest() + '  ' + name)
        manifest = ('\n'.join(records) + '\n').encode()
        (root / 'ACTIVATION_SHA256SUMS').write_bytes(manifest)
        text = re.sub(r'^manifest_sha=.*$', 'manifest_sha=' + hashlib.sha256(manifest).hexdigest(), text, flags=re.MULTILINE)
        log = root / 'ssh.log'
        mock = root / 'ssh'
        mock.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "' + str(log) + '"\n')
        mock.chmod(0o700)
        text = text.replace('/usr/bin/ssh', str(mock)).replace('/usr/bin/scp', str(mock))
        launcher = root / 'launcher.sh'
        launcher.write_text(text)
        return launcher, log

    def run_action(self, action, corrupt=False, remote_failure=False):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'week-renewal'
            root.mkdir()
            launcher, log = self.fixture(root)
            if corrupt:
                (root / 'activation_owner.py').write_text('never-print-secret')
            if remote_failure:
                (root / 'ssh').write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "' + str(log) + '"\nexit 1\n')
            result = subprocess.run(['/bin/sh', str(launcher), action], capture_output=True, text=True, timeout=10)
            return result, log.read_text() if log.exists() else ''

    def test_sealed_manifest_covers_full_flat_remote_closure_and_local_external_sources(self):
        records = SOURCE.with_name('ACTIVATION_SHA256SUMS').read_text().splitlines()
        self.assertEqual(len(records), 13)
        for record in records:
            expected, name = record.split('  ', 1)
            directory = SOURCE.parent.parent / 'prefunded-card' if name in (
                'renewal_inventory.py', 'renewal-inventory.sql', 'renewal-receipt-inventory.sql') else SOURCE.parent
            self.assertEqual(hashlib.sha256((directory / name).read_bytes()).hexdigest(), expected)
        result = subprocess.run(['/bin/sh', str(SOURCE), '--print-owner-command'], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('activation_owner.py --bundle-sha256', result.stdout)

    def test_collect_verifies_remote_before_owner_copy_without_live_actions(self):
        result, log = self.run_action('--collect')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertLess(log.index('BatchMode=yes'), log.index('-t -o ServerAliveInterval'))
        self.assertIn('sudo /usr/bin/env -i', log)
        self.assertIn('activation_owner.py --bundle-sha256', log)
        for command in ('systemctl start', 'systemctl restart', 'ALTER ROLE', 'docker start', 'rm -rf'):
            self.assertNotIn(command, log)

    def test_stage_and_print_never_execute_sudo(self):
        result, log = self.run_action('--stage')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('sudo ', log)
        result, log = self.run_action('--print-owner-command')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(log, '')

    def test_local_drift_or_failed_remote_verification_prevents_owner_execution(self):
        result, log = self.run_action('--collect', corrupt=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(log, '')
        self.assertNotIn('never-print-secret', result.stdout + result.stderr)
        result, log = self.run_action('--collect', remote_failure=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('sudo ', log)

    def test_activation_is_not_an_accepted_action(self):
        result, log = self.run_action('--activate')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('read-only evidence actions only', result.stderr)
        self.assertEqual(log, '')


if __name__ == '__main__':
    unittest.main()
