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


class TransactionTests(unittest.TestCase):
    def test_install_error_survives_failed_rollback_with_both_stages(self):
        original = subprocess.CalledProcessError(9, 'private-arguments', output=b'private-output')
        rollback_error = PermissionError(13, 'private-rollback')
        with patch.object(self.policy, 'run', side_effect=original), patch.object(self.transaction, 'verify', side_effect=rollback_error):
            with self.assertRaises(subprocess.CalledProcessError) as caught:
                self.transaction.install(self.payloads)
        self.assertIs(caught.exception, original)
        self.assertEqual(original.install_stage, 'group-create')
        self.assertIs(original.rollback_error, rollback_error)
        self.assertEqual(rollback_error.install_stage, 'rollback-verify')

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.calls = []
        self.users, self.groups = {}, {}
        self.policy = types.SimpleNamespace(**{name: getattr(POLICY, name) for name in
            ('ACCOUNT', 'GROUP', 'RUNTIME_FILES', 'require')})
        for name in ('CODE', 'CONFIG', 'UNIT', 'SUDOERS', 'STATE'):
            setattr(self.policy, name, str(root / name.lower()))
        self.policy.parents = lambda path: None
        self.policy.metadata = lambda *args, **kwargs: None
        self.policy.read = lambda path: Path(path).read_bytes()
        self.policy.inactive = lambda: None
        self.policy.run = self.run_command
        self.pwd = types.SimpleNamespace(getpwnam=lambda name: self.users[name], getpwall=lambda: list(self.users.values()))
        self.grp = types.SimpleNamespace(getgrnam=lambda name: self.groups[name])
        self.transaction = TRANSACTION.Installation(self.policy, self.pwd, self.grp, 'a' * 64)
        self.payloads = bundle()[1]
        self.command_failure = None
        self.addCleanup(patch.stopall)
        patch.object(TRANSACTION.os, 'chown').start()
        patch.object(TRANSACTION.os, 'fchown').start()
        original_listdir = os.listdir
        patch.object(TRANSACTION.os, 'listdir', side_effect=lambda path: [] if path == '/proc' else original_listdir(path)).start()

    def run_command(self, arguments):
        self.calls.append(arguments)
        if arguments[0].endswith('/passwd'):
            return self.policy.ACCOUNT + ' L synthetic'
        if self.command_failure and self.command_failure in arguments:
            raise RuntimeError('Synthetic validator failure')
        if arguments[0].endswith('/groupadd'):
            self.groups[self.policy.GROUP] = types.SimpleNamespace(gr_gid=65430, gr_mem=[])
        if arguments[0].endswith('/useradd'):
            if '-K' in arguments and 'CREATE_MAIL_SPOOL=no' in arguments:
                raise subprocess.CalledProcessError(3, '/usr/sbin/useradd')
            self.users[self.policy.ACCOUNT] = types.SimpleNamespace(pw_name=self.policy.ACCOUNT, pw_uid=65431,
                pw_gid=65430, pw_dir='/nonexistent', pw_shell='/usr/sbin/nologin')
        if arguments[0].endswith('/userdel'):
            self.users.pop(self.policy.ACCOUNT)
        if arguments[0].endswith('/groupdel'):
            self.groups.pop(self.policy.GROUP)
        return ''

    def rollback(self):
        self.transaction.rollback()

    def test_user_create_succeeds_without_invalid_login_defs_mail_spool_override(self):
        self.transaction.install(self.payloads)

        creation = next(call for call in self.calls if call[0] == '/usr/sbin/useradd')
        self.assertEqual(creation, ['/usr/sbin/useradd', '--system', '--no-create-home',
            '--no-user-group', '--no-log-init', '--home-dir', '/nonexistent',
            '--shell', '/usr/sbin/nologin', '--gid', '65430', '--password', '!', self.policy.ACCOUNT])
        self.assertIn(self.policy.ACCOUNT, self.users)
        self.rollback()
        self.assertEqual((self.users, self.groups), ({}, {}))

    def test_installs_exact_immutable_closure_no_activation_and_reversible(self):
        self.transaction.install(self.payloads)
        for name in POLICY.RUNTIME_FILES:
            path = Path(self.policy.CODE) / name
            self.assertEqual(path.read_bytes(), self.payloads[name])
            self.assertEqual(path.stat().st_mode & 0o777, 0o550 if name == 'managed-inventory-helper.mjs' else 0o440)
        self.assertEqual(list(Path(self.policy.CONFIG).iterdir()), [])
        verification = next(call for call in self.calls if 'verify' in call)
        self.assertEqual(Path(verification[-1]).name, 'baci-savings-gateway.service')
        self.assertFalse(any(word in call for call in self.calls for word in ('start', 'enable', 'restart', 'reload')))
        self.assertLess(next(index for index, call in enumerate(self.calls) if 'verify' in call),
                        next(index for index, call in enumerate(self.calls) if 'daemon-reload' in call))
        self.rollback()
        for name in ('CODE', 'CONFIG', 'UNIT', 'SUDOERS', 'STATE'):
            self.assertFalse(Path(getattr(self.policy, name)).exists())
        self.assertEqual((self.users, self.groups), ({}, {}))

    def test_validator_failure_rolls_back_only_owned_new_resources(self):
        self.command_failure = 'verify'
        with self.assertRaises(RuntimeError) as caught:
            self.transaction.install(self.payloads)
        self.assertEqual(caught.exception.install_stage, 'systemd-unit-verify')
        self.assertFalse(hasattr(caught.exception, 'rollback_error'))
        self.assertFalse(Path(self.policy.STATE).exists())
        self.assertEqual((self.users, self.groups), ({}, {}))

    def test_rollback_refuses_changed_file_before_deleting_anything(self):
        self.transaction.install(self.payloads)
        path = Path(self.policy.CODE) / 'managed-gateway.mjs'
        path.chmod(0o600)
        path.write_bytes(b'changed by another owner')
        with self.assertRaisesRegex(RuntimeError, 'changed'):
            self.rollback()
        self.assertTrue(Path(self.policy.UNIT).exists())
        self.assertIn(self.policy.ACCOUNT, self.users)

    def test_rollback_refuses_new_binding_or_other_unrecorded_content(self):
        self.transaction.install(self.payloads)
        (Path(self.policy.CONFIG) / 'binding.json').write_text('{}')
        with self.assertRaisesRegex(RuntimeError, 'Unrecorded'):
            self.rollback()
        self.assertTrue(Path(self.policy.UNIT).exists())

    def test_exclusive_creation_refuses_even_dangling_symlinks(self):
        os.mkdir(self.policy.STATE)
        self.transaction.save()
        path = Path(self.policy.UNIT)
        path.symlink_to(Path(self.temporary.name) / 'does-not-exist')
        with self.assertRaises(FileExistsError):
            self.transaction.file(str(path), b'never overwrite', 0, 0o444)
        self.assertTrue(path.is_symlink())


if __name__ == '__main__':
    unittest.main()
