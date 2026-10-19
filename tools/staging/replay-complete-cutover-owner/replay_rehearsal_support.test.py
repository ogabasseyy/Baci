import importlib.util
from pathlib import Path
import unittest
from types import SimpleNamespace
from unittest.mock import patch


HERE = Path(__file__).resolve().parent


class Tests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('rehearsal_support', HERE/'replay_rehearsal_support.py')
        self.subject = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.subject)

    def test_rejects_shell_and_start_commands_before_execution(self):
        for argv in (['/bin/sh', '-c', 'true'], ['/usr/bin/docker', 'start', 'anything'],
                ['/usr/bin/systemctl', 'start', 'baci-prefunded-background']):
            with patch.object(self.subject.subprocess, 'run') as execute:
                with self.assertRaises(ValueError):
                    self.subject.command(argv)
                execute.assert_not_called()

    def test_bounds_timeouts_and_input(self):
        for timeout in (0, 61, True):
            with self.assertRaises(ValueError):
                self.subject.command(['/usr/bin/systemctl', 'list-jobs'], timeout=timeout)

    def test_transport_errors_are_redacted(self):
        with patch.object(self.subject.subprocess, 'run', side_effect=RuntimeError('SECRET')):
            with self.assertRaisesRegex(ValueError, '^rehearsal_command_refused$'):
                self.subject.command(['/usr/bin/systemctl', 'list-jobs'])

    def test_exact_database_transport_uses_clean_environment(self):
        argv = ['/usr/bin/docker', 'exec', '-i', 'pvb-staging-receipts-db',
            '/usr/local/bin/psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres']
        with patch.object(self.subject.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout=b'ROLLBACK\n')) as execute:
            self.assertEqual(self.subject.command(argv, input=b'ROLLBACK;\n'), b'ROLLBACK\n')
            self.assertEqual(execute.call_args.kwargs['env']['DOCKER_HOST'], 'unix:///var/run/docker.sock')
            self.assertNotIn('PGPASSWORD', execute.call_args.kwargs['env'])

    def test_accepts_actual_root_sticky_run_lock_without_generalizing_writable_parents(self):
        info = SimpleNamespace(st_mode=0o41777, st_uid=0, st_gid=0)
        self.subject.verify_lock_parent(Path('/run/lock'), info)
        for path, bad in ((Path('/tmp'), info), (Path('/run/lock'), SimpleNamespace(st_mode=0o40777, st_uid=0, st_gid=0)),
                (Path('/run/lock'), SimpleNamespace(st_mode=0o41777, st_uid=1, st_gid=0))):
            with self.assertRaises(ValueError):
                self.subject.verify_lock_parent(path, bad)


if __name__ == '__main__':
    unittest.main()
