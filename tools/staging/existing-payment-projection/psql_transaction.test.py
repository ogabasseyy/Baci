import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools/test'))
from piggyvest_ledger_balance_harness import BIN, LedgerBalanceHarness, PORT


SPEC = importlib.util.spec_from_file_location('psql_transaction',
    Path(__file__).with_name('psql_transaction.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class PsqlTransactionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.harness = LedgerBalanceHarness()
        cls.harness.sql('CREATE TABLE transaction_fixture(id integer PRIMARY KEY, note text);')

    @classmethod
    def tearDownClass(cls):
        cls.harness.close()

    def setUp(self):
        self.harness.sql('TRUNCATE transaction_fixture;')
        command = [str(BIN / 'psql'), '-XqAt', '-w', '-h', str(self.harness.path),
            '-p', PORT, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1',
            '-v', 'VERBOSITY=sqlstate']
        self.connection = MODULE.PsqlTransaction(command, timeout=3, output_limit=100000)
        self.addCleanup(lambda: self.connection.close() if not self.connection.closed else None)

    def count(self):
        return int(self.harness.sql('SELECT count(*) FROM transaction_fixture;').stdout.strip())

    def test_connection_keeps_uncommitted_rows_private_until_explicit_commit(self):
        first = json.loads(self.connection.execute(
            'BEGIN; SELECT jsonb_build_object(\'backend\',pg_backend_pid());')[0])
        self.connection.execute("INSERT INTO transaction_fixture VALUES (1,'private');")
        second = json.loads(self.connection.execute(
            "SELECT jsonb_build_object('backend',pg_backend_pid(),'count',"
            '(SELECT count(*) FROM transaction_fixture));')[0])
        self.assertEqual(first['backend'], second['backend'])
        self.assertEqual(second['count'], 1)
        self.assertEqual(self.count(), 0)
        self.connection.finish(commit=True)
        self.assertTrue(self.connection.commit_acknowledged)
        self.assertEqual(self.count(), 1)

    def test_explicit_rollback_preserves_database_and_never_claims_commit(self):
        self.connection.execute("BEGIN; INSERT INTO transaction_fixture VALUES (1,'private');")
        self.connection.finish(commit=False)
        self.assertFalse(self.connection.commit_attempted)
        self.assertFalse(self.connection.commit_acknowledged)
        self.assertEqual(self.count(), 0)

    def test_sql_failure_rolls_back_previous_step_and_has_redacted_error(self):
        self.connection.execute("BEGIN; INSERT INTO transaction_fixture VALUES (1,'secret-value');")
        with self.assertRaisesRegex(ValueError, '^psql_transaction_unconfirmed$'):
            self.connection.execute("INSERT INTO transaction_fixture VALUES (1,'secret-value');")
        self.connection.close()
        self.assertEqual(self.count(), 0)
        self.assertFalse(self.connection.commit_attempted)

    def test_missing_command_error_stop_cannot_accept_a_frame_after_sql_failure(self):
        self.connection.close()
        command = [str(BIN / 'psql'), '-XqAt', '-w', '-h', str(self.harness.path),
            '-p', PORT, '-U', 'postgres', '-d', 'postgres', '-v', 'VERBOSITY=sqlstate']
        self.connection = MODULE.PsqlTransaction(command, timeout=3, output_limit=100000)
        self.connection.execute("BEGIN; INSERT INTO transaction_fixture VALUES (1,'private');")
        with self.assertRaisesRegex(ValueError, '^psql_transaction_unconfirmed$'):
            self.connection.execute('SELECT 1/0; ROLLBACK;')
        self.assertTrue(self.connection.closed)
        self.assertTrue(self.connection.cleanup_confirmed)
        self.assertFalse(self.connection.commit_attempted)
        self.assertFalse(self.connection.commit_acknowledged)
        self.assertEqual(self.count(), 0)

    def test_close_before_commit_rolls_back_the_open_transaction(self):
        self.connection.execute("BEGIN; INSERT INTO transaction_fixture VALUES (1,'private');")
        self.connection.close()
        self.assertEqual(self.count(), 0)
        with self.assertRaisesRegex(ValueError, '^psql_transaction_unconfirmed$'):
            self.connection.execute('SELECT 1;')

    def test_output_limit_aborts_instead_of_returning_a_partial_inspection(self):
        self.connection.output_limit = 80
        with self.assertRaisesRegex(ValueError, '^psql_transaction_unconfirmed$'):
            self.connection.execute("BEGIN; INSERT INTO transaction_fixture VALUES (1,'private');"
                "SELECT repeat('x',500);")
        self.connection.close()
        self.assertEqual(self.count(), 0)

    def test_execution_timeout_aborts_without_retrying_or_committing(self):
        self.connection.timeout = 0.15
        started = time.monotonic()
        with self.assertRaisesRegex(ValueError, '^psql_transaction_unconfirmed$'):
            self.connection.execute("BEGIN; INSERT INTO transaction_fixture VALUES (1,'private');"
                'SELECT pg_sleep(5);')
        self.assertLess(time.monotonic() - started, 3)
        self.assertEqual(self.count(), 0)
        self.assertFalse(self.connection.commit_attempted)

    def test_deferred_commit_failure_never_reports_acknowledged_commit(self):
        self.connection.execute('BEGIN; SET CONSTRAINTS ALL DEFERRED; '
            'CREATE TEMP TABLE deferred_fixture(value integer UNIQUE DEFERRABLE); '
            'INSERT INTO deferred_fixture VALUES (1),(1); '
            "INSERT INTO transaction_fixture VALUES (1,'private');")
        with self.assertRaisesRegex(ValueError, '^psql_transaction_unconfirmed$'):
            self.connection.finish(commit=True)
        self.assertTrue(self.connection.commit_attempted)
        self.assertFalse(self.connection.commit_acknowledged)
        self.assertEqual(self.count(), 0)

    def test_stderr_notice_cannot_be_misread_as_an_inspection_record(self):
        records = self.connection.execute("BEGIN; DO $$ BEGIN RAISE NOTICE 'not proof'; END $$;"
            "SELECT jsonb_build_object('actual',true);")
        self.assertEqual(list(map(json.loads, records)), [{'actual': True}])
        self.connection.finish(commit=False)

    def test_commit_without_open_assigned_transaction_is_not_acknowledged(self):
        with self.assertRaisesRegex(ValueError, '^psql_transaction_unconfirmed$'):
            self.connection.finish(commit=True)
        self.assertFalse(self.connection.commit_acknowledged)

    def test_aborted_transaction_cannot_be_finalized_as_a_commit(self):
        self.connection.execute("BEGIN; INSERT INTO transaction_fixture VALUES (1,'private');")
        with self.assertRaisesRegex(ValueError, '^psql_transaction_unconfirmed$'):
            self.connection.execute('SELECT 1/0;')
        with self.assertRaisesRegex(ValueError, '^psql_transaction_unconfirmed$'):
            self.connection.finish(commit=True)
        self.assertFalse(self.connection.commit_acknowledged)
        self.assertEqual(self.count(), 0)

    def test_lost_acknowledgement_preserves_ambiguous_commit_without_retry(self):
        self.connection.execute("BEGIN; INSERT INTO transaction_fixture VALUES (1,'private');")
        original_execute = self.connection.execute

        def lose_after_commit(source):
            records = original_execute(source)
            if 'COMMIT;' in source:
                raise OSError('lost acknowledgement')
            return records

        with patch.object(self.connection, 'execute', side_effect=lose_after_commit):
            with self.assertRaisesRegex(ValueError, '^psql_transaction_unconfirmed$'):
                self.connection.finish(commit=True)
        self.assertTrue(self.connection.commit_attempted)
        self.assertFalse(self.connection.commit_acknowledged)
        self.assertEqual(self.count(), 1)

    def test_failed_selector_initialization_does_not_leak_launched_process(self):
        launched = []
        original_launch = subprocess.Popen

        def record_launch(*arguments, **keywords):
            process = original_launch(*arguments, **keywords)
            if arguments[0][0] == sys.executable:
                launched.append(process)
            return process

        with patch.object(MODULE.subprocess, 'Popen', side_effect=record_launch), patch.object(
            MODULE.selectors, 'DefaultSelector') as factory:
            factory.return_value.register.side_effect = OSError('registration failure')
            with self.assertRaisesRegex(ValueError, '^psql_transaction_unconfirmed$'):
                MODULE.PsqlTransaction([sys.executable, '-c', 'import time; time.sleep(60)'])
        self.assertEqual(len(launched), 1)
        self.assertIsNotNone(launched[0].poll())

    def test_cleanup_signals_owned_group_after_leader_exits(self):
        source = "import os,time; child=os.fork(); " \
            "os._exit(0) if child else None; os.write(1,b'child-ready\\n'); time.sleep(60)"
        connection = MODULE.PsqlTransaction([sys.executable, '-c', source], timeout=0.3)
        self.addCleanup(connection.close)
        with self.assertRaisesRegex(ValueError, '^psql_transaction_unconfirmed$'):
            connection.execute('SELECT 1;')
        self.assertTrue(connection.cleanup_confirmed)
        with self.assertRaises(ProcessLookupError):
            os.killpg(connection.process.pid, 0)

    def test_selector_close_failure_still_closes_pipes_and_reaps_process(self):
        self.connection.execute("BEGIN; INSERT INTO transaction_fixture VALUES (1,'private');")
        original_close = self.connection.selector.close

        def fail_close():
            original_close()
            raise OSError('selector close failure')

        try:
            with patch.object(self.connection.selector, 'close', side_effect=fail_close):
                with self.assertRaisesRegex(ValueError, '^psql_transaction_unconfirmed$'):
                    self.connection.close()
            self.assertIsNotNone(self.connection.process.poll())
            self.assertTrue(self.connection.process.stdin.closed)
            self.assertTrue(self.connection.process.stdout.closed)
            self.assertTrue(self.connection.process.stderr.closed)
            self.assertFalse(self.connection.cleanup_confirmed)
            self.assertFalse(self.connection.commit_acknowledged)
            self.assertEqual(self.count(), 0)
        finally:
            if self.connection.process.poll() is None:
                self.connection.process.kill()
                self.connection.process.wait(timeout=2)
            self.connection.process.stdin.close()

    def test_acknowledged_commit_keeps_cleanup_uncertainty_without_retry(self):
        self.connection.execute("BEGIN; INSERT INTO transaction_fixture VALUES (1,'private');")
        with patch.object(self.connection, '_group_gone', side_effect=OSError('probe unavailable')), \
            patch.object(self.connection, '_signal_group', wraps=self.connection._signal_group) as signals:
            with self.assertRaisesRegex(ValueError, '^psql_transaction_unconfirmed$'):
                self.connection.finish(commit=True)
            self.assertGreaterEqual(signals.call_count, 1)
        self.assertTrue(self.connection.commit_attempted)
        self.assertTrue(self.connection.commit_acknowledged)
        self.assertFalse(self.connection.cleanup_confirmed)
        self.assertEqual(self.count(), 1)
        with self.assertRaisesRegex(ValueError, '^psql_transaction_unconfirmed$'):
            self.connection.finish(commit=True)
        self.assertEqual(self.count(), 1)

    def test_stdin_failure_and_group_signal_failure_still_reap_process(self):
        self.connection.execute("BEGIN; INSERT INTO transaction_fixture VALUES (1,'private');")
        original_close = self.connection.process.stdin.close

        def fail_close():
            original_close()
            raise OSError('stdin close failure')

        with patch.object(self.connection.process.stdin, 'close', side_effect=fail_close), \
            patch.object(self.connection, '_signal_group', side_effect=PermissionError):
            with self.assertRaisesRegex(ValueError, '^psql_transaction_unconfirmed$'):
                self.connection.close()
        self.assertIsNotNone(self.connection.process.poll())
        self.assertTrue(self.connection.process.stderr.closed)
        self.assertFalse(self.connection.cleanup_confirmed)
        self.assertEqual(self.count(), 0)

    def test_stdout_close_failure_does_not_skip_stderr_cleanup(self):
        original_close = self.connection.process.stdout.close

        def fail_close():
            original_close()
            raise OSError('stdout close failure')

        with patch.object(self.connection.process.stdout, 'close', side_effect=fail_close):
            with self.assertRaisesRegex(ValueError, '^psql_transaction_unconfirmed$'):
                self.connection.close()
        self.assertIsNotNone(self.connection.process.poll())
        self.assertTrue(self.connection.process.stderr.closed)
        self.assertFalse(self.connection.cleanup_confirmed)

    def test_group_absence_and_signal_disappearance_are_portable(self):
        with patch.object(MODULE.os, 'killpg', side_effect=ProcessLookupError):
            self.assertTrue(self.connection._group_gone())
            self.connection._signal_group(MODULE.signal.SIGTERM)

    def test_permission_denied_probe_uses_exact_group_inventory(self):
        for present in (False, True):
            groups = ' 1\n 22\n' + (f' {self.connection.process.pid}\n' if present else '')
            result = subprocess.CompletedProcess([], 0, stdout=groups, stderr='')
            with self.subTest(present=present), patch.object(MODULE.os, 'killpg',
                side_effect=PermissionError), patch.object(MODULE.subprocess, 'run', return_value=result):
                self.assertEqual(self.connection._group_gone(), not present)

    def test_group_inventory_failure_never_means_group_absent(self):
        failures = (subprocess.TimeoutExpired('ps', 2), subprocess.CalledProcessError(1, 'ps'))
        for failure in failures:
            with self.subTest(failure=type(failure).__name__), patch.object(MODULE.os, 'killpg',
                side_effect=PermissionError), patch.object(MODULE.subprocess, 'run', side_effect=failure):
                with self.assertRaisesRegex(ValueError, '^psql_transaction_unconfirmed$'):
                    self.connection._group_gone()
        for output in ('', '123 garbage\n'):
            with self.subTest(output=output), patch.object(MODULE.os, 'killpg',
                side_effect=PermissionError), patch.object(MODULE.subprocess, 'run',
                return_value=subprocess.CompletedProcess([], 0, stdout=output, stderr='')):
                with self.assertRaisesRegex(ValueError, '^psql_transaction_unconfirmed$'):
                    self.connection._group_gone()


if __name__ == '__main__':
    unittest.main()
