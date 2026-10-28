import importlib.util
import os
from pathlib import Path
import stat
import tempfile
import unittest
import subprocess
from contextlib import nullcontext
from unittest.mock import patch

MODULE = Path(__file__).with_name('provision-release-locks.py')
SPEC = importlib.util.spec_from_file_location('provision_release_locks', MODULE)
LOCKS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LOCKS)


class ProvisionReleaseLocksTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='worker-locks-')
        self.root = Path(self.tmp.name) / 'worker-root'
        self.root.mkdir(mode=0o710)
        os.chmod(self.root, 0o710)
        self.uid = os.getuid()
        self.gid = os.getgid()

    def tearDown(self):
        self.tmp.cleanup()

    def provision(self, cron, dotenv=''):
        return LOCKS.provision_locks(self.root, cron, dotenv, uid=self.uid,
                                     gid=self.gid, owner_uid=self.uid)

    def test_discovers_all_fixed_namespace_cron_locks_and_global_lock_idempotently(self):
        cron = '\n'.join([
            '*/5 * * * * flock -n /tmp/other.lock bash -c true',
            f'*/5 * * * * flock -n {self.root}/locks/a.lock flock -w 60 {self.root}/locks/b.lock run',
        ])
        # temp paths are useful in unit tests, while production is fixed by main().
        names = self.provision(cron, 'BACI_REMEDIATION_GLOBAL_LOCK_PATH=locks/custom.lock\n')
        self.assertEqual(names, ['a.lock', 'b.lock', 'custom.lock'])
        lock_dir = self.root / 'locks'
        self.assertEqual(stat.S_IMODE(lock_dir.stat().st_mode), 0o710)
        for name in names:
            info = (lock_dir / name).stat()
            self.assertTrue(stat.S_ISREG(info.st_mode))
            self.assertEqual((info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)),
                             (self.uid, self.gid, 0o660))
        # Repeated invocation leaves the same inodes in place.
        before = {name: (lock_dir / name).stat().st_ino for name in names}
        self.assertEqual(self.provision(cron, 'BACI_REMEDIATION_GLOBAL_LOCK_PATH=locks/custom.lock\n'), names)
        self.assertEqual({name: (lock_dir / name).stat().st_ino for name in names}, before)

    def test_uses_default_global_lock_when_unset(self):
        names = self.provision('')
        self.assertEqual(names, ['error-remediator-global.lock'])

    def test_rejects_global_lock_outside_fixed_directory_or_with_traversal(self):
        for value in ('/tmp/outside.lock', 'locks/../outside.lock', 'locks/subdir/x.lock'):
            with self.subTest(value=value), self.assertRaises(LOCKS.ProvisionError):
                self.provision('', f'BACI_REMEDIATION_GLOBAL_LOCK_PATH={value}\n')

    def test_rejects_cron_lock_path_that_escapes_fixed_directory(self):
        escaped = self.root / 'locks' / '..' / 'escape.lock'
        with self.assertRaises(LOCKS.ProvisionError):
            self.provision(f'*/5 * * * * flock -n {escaped} true')

    def test_refuses_legacy_home_locks_instead_of_provisioning_different_srv_inodes(self):
        legacy = '/home/bassey/baci-workers/locks/gigl-tracking.lock'
        with self.assertRaisesRegex(LOCKS.ProvisionError, 'legacy lock path must be migrated'):
            self.provision(f'*/5 * * * * flock -n {legacy} true')

    def test_rejects_relative_cron_lock_instead_of_silently_omitting_it(self):
        with self.assertRaisesRegex(LOCKS.ProvisionError, 'relative flock path'):
            self.provision('*/5 * * * * flock -n locks/relative.lock true')

    def test_dotenv_value_matches_shared_reader_assignment_and_separator_semantics(self):
        text = '\n'.join([
            'BACI_REMEDIATION_GLOBAL_LOCK_PATH=locks/old.lock',
            'export BACI_REMEDIATION_GLOBAL_LOCK_PATH: locks/final.lock # comment',
            'BACI_REMEDIATION_GLOBAL_LOCK_PATH :ignored.lock',
        ])
        self.assertEqual(LOCKS._dotenv_value(text, 'BACI_REMEDIATION_GLOBAL_LOCK_PATH'),
                         'locks/final.lock')
        self.assertEqual(self.provision('', text), ['final.lock'])

    def test_dotenv_reader_handles_quoted_hash_escapes_and_fallback_like_shared_reader(self):
        self.assertEqual(LOCKS._dotenv_value(
            'BACI_REMEDIATION_GLOBAL_LOCK_PATH="locks/final\\n.lock" # note\n',
            'BACI_REMEDIATION_GLOBAL_LOCK_PATH'), 'locks/final\n.lock')
        self.assertEqual(LOCKS._dotenv_value(
            "BACI_REMEDIATION_GLOBAL_LOCK_PATH='locks/a#b.lock'\n",
            'BACI_REMEDIATION_GLOBAL_LOCK_PATH'), 'locks/a#b.lock')
        self.assertEqual(LOCKS._dotenv_value(
            'BACI_REMEDIATION_GLOBAL_LOCK_PATH="locks/a.lock"junk # fallback\n',
            'BACI_REMEDIATION_GLOBAL_LOCK_PATH'), '"locks/a.lock"junk')

    def test_refuses_symlink_lock_instead_of_following_it(self):
        lock_dir = self.root / 'locks'
        lock_dir.mkdir(mode=0o710)
        target = self.root / 'victim'
        target.write_text('untouched')
        (lock_dir / 'unsafe.lock').symlink_to(target)
        with self.assertRaises((OSError, LOCKS.ProvisionError)):
            self.provision('*/5 * * * * flock -n ' + str(lock_dir / 'unsafe.lock') + ' true')
        self.assertEqual(target.read_text(), 'untouched')

    def test_rejects_non_trusted_lock_directory_mode(self):
        lock_dir = self.root / 'locks'
        lock_dir.mkdir(mode=0o777)
        os.chmod(lock_dir, 0o777)
        with self.assertRaises(LOCKS.ProvisionError):
            self.provision('')

    def test_main_uses_release_crontab_and_isolated_runtime_environment(self):
        runtime = self.root / 'runtime'
        runtime.mkdir(mode=0o700)
        os.chmod(runtime, 0o700)
        environment = runtime / 'worker.env'
        environment.write_text('BACI_REMEDIATION_GLOBAL_LOCK_PATH=locks/isolated-global.lock\n')
        os.chmod(environment, 0o600)
        calls = []

        def runner(argv, **_kwargs):
            argv = tuple(argv)
            calls.append(argv)
            if argv[:2] == ('id', '-u'):
                output = str(self.uid)
            elif argv[:2] == ('id', '-g'):
                output = str(self.gid)
            elif argv[0] == '/usr/bin/crontab':
                output = f'*/5 * * * * flock -n {self.root}/locks/release-job.lock true\n'
            else:
                raise AssertionError(f'unexpected command: {argv}')
            return subprocess.CompletedProcess(argv, 0, stdout=output)

        with patch.object(LOCKS, 'TRUSTED_ROOT', self.root), \
             patch.object(LOCKS, 'ROOT_OWNER_UID', self.uid), \
             patch.object(LOCKS, '_serialized_provisioning', nullcontext), \
             patch.object(LOCKS.os, 'geteuid', return_value=self.uid), \
             patch.object(LOCKS.subprocess, 'run', side_effect=runner):
            self.assertEqual(LOCKS.main(), 0)

        self.assertIn(('/usr/bin/crontab', '-u', 'bassey', '-l'), calls)
        self.assertNotIn(('crontab', '-u', 'baci-worker', '-l'), calls)
        self.assertTrue((self.root / 'locks' / 'release-job.lock').is_file())
        self.assertTrue((self.root / 'locks' / 'isolated-global.lock').is_file())

    def test_runtime_environment_reader_rejects_unsafe_mode_and_symlink(self):
        runtime = self.root / 'runtime'
        runtime.mkdir(mode=0o700)
        os.chmod(runtime, 0o700)
        environment = runtime / 'worker.env'
        environment.write_text('')
        os.chmod(environment, 0o640)
        with self.assertRaises(LOCKS.ProvisionError):
            LOCKS._read_worker_environment(self.root, worker_uid=self.uid, worker_gid=self.gid)
        environment.unlink()
        target = self.root / 'outside.env'
        target.write_text('BACI_REMEDIATION_GLOBAL_LOCK_PATH=locks/custom.lock\n')
        environment.symlink_to(target)
        with self.assertRaises((OSError, LOCKS.ProvisionError)):
            LOCKS._read_worker_environment(self.root, worker_uid=self.uid, worker_gid=self.gid)


if __name__ == '__main__':
    unittest.main()
