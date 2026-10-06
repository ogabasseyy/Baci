import hashlib
from pathlib import Path
import re
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from notification_contract import Refused
from notification_io import CLOSURE, run, verify_bundle


class NotificationIoTests(unittest.TestCase):
    def test_manifest_matches_exact_source_closure_and_every_readme_owner_command(self):
        directory = Path(__file__).parent
        manifest = (directory / 'SHA256SUMS').read_bytes()
        entries = {}
        for line in manifest.decode('ascii').splitlines():
            match = re.fullmatch(r'([0-9a-f]{64})  ([a-z_-]+\.(?:py|sql))', line)
            self.assertIsNotNone(match)
            pin, name = match.groups()
            self.assertNotIn(name, entries)
            entries[name] = pin
        self.assertEqual(set(entries), CLOSURE)
        for name, pin in entries.items():
            with self.subTest(name=name):
                self.assertEqual(hashlib.sha256((directory / name).read_bytes()).hexdigest(), pin)
        commands = re.findall(r'^/usr/bin/python3 -B notification_owner\.py --(inspect|rehearse|activate) --bundle-sha256 ([0-9a-f]{64})$',
                              (directory / 'README.md').read_text(), re.M)
        self.assertEqual(len(commands), 3)
        self.assertEqual({mode for mode, pin in commands}, {'inspect', 'rehearse', 'activate'})
        expected = hashlib.sha256(manifest).hexdigest()
        for mode, pin in commands:
            with self.subTest(mode=mode):
                self.assertEqual(pin, expected)

    def test_failed_or_timed_out_commands_never_become_success(self):
        import subprocess
        with patch('notification_io.subprocess.run', return_value=SimpleNamespace(returncode=1, stdout='secret-output', stderr='private')):
            with self.assertRaisesRegex(Refused, '^command-failed$'):
                run(['/usr/bin/false'])
        with patch('notification_io.subprocess.run', side_effect=subprocess.TimeoutExpired('private-command', 95)):
            with self.assertRaisesRegex(Refused, '^command-unconfirmed$'):
                run(['/usr/bin/false'])

    def test_source_seal_rejects_changed_file_and_missing_closure(self):
        contents = {name: name.encode() for name in CLOSURE}
        manifest = ''.join(hashlib.sha256(content).hexdigest() + '  ' + name + '\n' for name, content in sorted(contents.items())).encode()
        expected = hashlib.sha256(manifest).hexdigest()
        def read(path, mode):
            return manifest if path.name == 'SHA256SUMS' else contents[path.name]
        with patch.object(Path, 'lstat', return_value=SimpleNamespace(st_mode=0o40700)), patch('notification_io.read_file', side_effect=read):
            verify_bundle(Path('/root/reviewed'), expected)
            contents['notification_owner.py'] = b'changed'
            with self.assertRaisesRegex(Refused, 'source-pin'):
                verify_bundle(Path('/root/reviewed'), expected)
        with patch.object(Path, 'lstat', return_value=SimpleNamespace(st_mode=0o40700)), patch('notification_io.read_file', return_value=b''):
            with self.assertRaisesRegex(Refused, 'source-seal'):
                verify_bundle(Path('/root/reviewed'), expected)


if __name__ == '__main__':
    unittest.main()
