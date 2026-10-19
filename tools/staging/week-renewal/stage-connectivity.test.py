import hashlib
from pathlib import Path
import re
import subprocess
import tempfile
import unittest


SOURCE = Path(__file__).with_name('stage-connectivity.sh')


class ConnectivityLauncherTests(unittest.TestCase):
    def test_real_manifest_covers_each_closed_owner_source_and_embedded_pin(self):
        source = SOURCE.read_text()
        manifest = SOURCE.with_name('CONNECTIVITY_SHA256SUMS').read_bytes()
        self.assertIn('manifest_sha=' + hashlib.sha256(manifest).hexdigest(), source)
        names = re.search(r"^names='([^']+)'$", source, re.MULTILINE)[1].split()
        records = [line.split('  ', 1) for line in manifest.decode().splitlines()]
        self.assertEqual(set(names), {name for _, name in records} | {'CONNECTIVITY_SHA256SUMS'})
        self.assertEqual(len(names), 25)
        for expected, name in records:
            directory = SOURCE.parent.parent / 'prefunded-card' if name in (
                'renewal_inventory.py', 'renewal-inventory.sql', 'renewal-receipt-inventory.sql') else SOURCE.parent
            self.assertEqual(hashlib.sha256((directory / name).read_bytes()).hexdigest(), expected)

    def run_fixture(self, action, corrupt=False, remote_failure=False):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / 'week-renewal'
            directory.mkdir()
            source = SOURCE.read_text()
            names = re.search(r"^names='([^']+)'$", source, re.MULTILINE)[1].split()
            records = []
            for name in names:
                if name == 'CONNECTIVITY_SHA256SUMS':
                    continue
                parent = directory.parent / 'prefunded-card' if name in (
                    'renewal_inventory.py', 'renewal-inventory.sql', 'renewal-receipt-inventory.sql') else directory
                parent.mkdir(exist_ok=True)
                content = ('fixture-' + name).encode()
                (parent / name).write_bytes(content)
                records.append(hashlib.sha256(content).hexdigest() + '  ' + name)
            manifest = ('\n'.join(records) + '\n').encode()
            (directory / 'CONNECTIVITY_SHA256SUMS').write_bytes(manifest)
            source = re.sub(r'^manifest_sha=.*$', 'manifest_sha=' + hashlib.sha256(manifest).hexdigest(), source, flags=re.MULTILINE)
            log = directory / 'ssh.log'
            mock = directory / 'ssh'
            mock.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "' + str(log) + '"\n' + ('exit 1\n' if remote_failure else ''))
            mock.chmod(0o700)
            source = source.replace('/usr/bin/ssh', str(mock)).replace('/usr/bin/scp', str(mock))
            launcher = directory / 'launcher.sh'
            launcher.write_text(source)
            if corrupt:
                (directory / 'connectivity_owner.py').write_text('secret')
            result = subprocess.run(['/bin/sh', str(launcher), action], capture_output=True, text=True, timeout=10)
            return result, log.read_text() if log.exists() else ''

    def test_activation_checks_remote_before_root_copy_and_never_embeds_delete_commands(self):
        result, log = self.run_fixture('--activate')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertLess(log.index('BatchMode=yes'), log.index('-t -o ServerAliveInterval'))
        self.assertIn('connectivity_owner.py --bundle-sha256', log)
        self.assertIn('sudo /usr/bin/env -i', log)
        self.assertNotIn('rm -rf', log)
        self.assertIn('No card payment, financial replay or paid-interest activation', result.stdout)

    def test_drift_or_failed_verification_never_executes_owner_code(self):
        for options in ({'corrupt': True}, {'remote_failure': True}):
            result, log = self.run_fixture('--activate', **options)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn('sudo /usr/bin/env', log)
            self.assertNotIn('secret', result.stdout + result.stderr)

    def test_staging_and_printing_do_not_execute_root_code(self):
        result, log = self.run_fixture('--stage')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('sudo ', log)
        result, log = self.run_fixture('--print-owner-command')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(log, '')
        self.assertIn('connectivity_owner.py --bundle-sha256', result.stdout)


if __name__ == '__main__':
    unittest.main()
