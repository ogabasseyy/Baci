import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

BASE = Path(__file__).parent


def load(name):
    spec = importlib.util.spec_from_file_location(name, BASE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


POLICY = load('managed-install-policy')
TRANSACTION = load('managed-install-transaction')
INSTALLER = load('install-managed-gateway')


def bundle():
    payloads = {name: (BASE / name).read_bytes() for name in POLICY.FILES}
    manifest = {'version': 1, 'files': {name: hashlib.sha256(content).hexdigest() for name, content in payloads.items()},
                'versions': {name: 'synthetic-reviewed-version' for name in POLICY.VERSIONS}}
    return manifest, payloads


class InstallerTests(unittest.TestCase):
    def test_lock_cleanup_cannot_mask_original_transaction_error(self):
        original = subprocess.CalledProcessError(9, ())
        transaction = types.SimpleNamespace(stage='systemd-unit-verify', install=lambda payloads: None)
        policy = types.SimpleNamespace(parents=lambda path: None, preflight=lambda *args: None)
        with patch.object(INSTALLER.sys, 'platform', 'linux'), patch.object(INSTALLER.sys, 'flags', types.SimpleNamespace(isolated=True)), \
                patch.object(INSTALLER.os, 'geteuid', return_value=0), patch.object(INSTALLER.os, 'getegid', return_value=0), \
                patch.object(INSTALLER.os, 'umask'), patch.object(INSTALLER.os, 'mkdir'), \
                patch.object(INSTALLER.os, 'rmdir', side_effect=OSError(5, 'private-cleanup')), \
                patch.object(INSTALLER, 'load_bundle', return_value=(policy, lambda *args: transaction, {}, {})), \
                patch.object(transaction, 'install', side_effect=original):
            with self.assertRaises(subprocess.CalledProcessError) as caught:
                INSTALLER.main(['--install', '/private', 'a' * 64])
        self.assertIs(caught.exception, original)
        self.assertEqual(INSTALLER.failure_report(original), 'stage=systemd-unit-verify type=CalledProcessError exit=9; cleanup stage=lock-cleanup type=OSError errno=5')

    def test_diagnostic_excludes_payloads_arguments_and_untrusted_names(self):
        error = subprocess.CalledProcessError(7, ['secret-command'], output=b'secret-output')
        error.install_stage = 'sudoers-global-validate'
        error.rollback_error = PermissionError(13, 'secret-rollback', '/secret/path')
        error.rollback_error.install_stage = 'rollback-verify'
        report = INSTALLER.failure_report(error)
        self.assertEqual(report, 'stage=sudoers-global-validate type=CalledProcessError exit=7; rollback stage=rollback-verify type=PermissionError errno=13')
        unknown = type('secret_class', (Exception,), {})('secret-body')
        unknown.install_stage = 'secret-stage'
        self.assertEqual(INSTALLER.failure_report(unknown), 'stage=unknown type=Exception')

    def test_manifest_digest_mismatch_stops_before_loading_any_module(self):
        with patch.object(INSTALLER, 'trusted_read', return_value=b'{}') as read:
            with self.assertRaisesRegex(RuntimeError, 'Manifest digest mismatch'):
                INSTALLER.load_bundle('/root/reviewed', 'a' * 64)
            self.assertEqual(read.call_count, 1)

    def test_cli_refuses_no_flag_without_side_effects(self):
        result = subprocess.run(['python3', '-I', str(BASE / 'install-managed-gateway.py')], capture_output=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn(b'No start/enable performed', result.stderr)

    def test_source_read_ignores_atime_but_rejects_changes_and_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'input'
            source.write_bytes(b'checked')
            source.chmod(0o400)
            before = types.SimpleNamespace(st_mode=stat.S_IFREG | 0o400, st_uid=0, st_nlink=1,
                                           st_ino=1, st_dev=1, st_size=7, st_mtime_ns=1, st_ctime_ns=1, st_atime_ns=1)
            after = types.SimpleNamespace(**{**vars(before), 'st_atime_ns': 2})
            directory_info = types.SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=0)
            with patch.object(INSTALLER.os, 'lstat', return_value=directory_info), patch.object(INSTALLER.os, 'fstat', side_effect=[before, after]):
                self.assertEqual(INSTALLER.trusted_read(str(source)), b'checked')
            link = Path(directory) / 'link'
            link.symlink_to(source)
            with patch.object(INSTALLER.os, 'lstat', return_value=directory_info), self.assertRaises(OSError):
                INSTALLER.trusted_read(str(link))


if __name__ == '__main__':
    unittest.main()
