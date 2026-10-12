import hashlib
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

import replay_rehearsal_transport as subject


HERE = Path(__file__).resolve().parent


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.command = Mock(return_value='BEGIN\nSET\nDO\n{"readOnly":true}\nDO\nROLLBACK\n')
        self.read = Mock(return_value=(HERE / 'financial_snapshot.sql').read_bytes())
        self.transport = subject.ReplayRehearsalTransport(self.command, self.read)
        spec = importlib.util.spec_from_file_location('database_test', HERE / 'cutover_database.test.py')
        fixture = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(fixture)
        database = fixture.CutoverDatabaseTests()
        database.setUp()
        self.rollback = database.rollback_sql.encode('utf-8')

    def test_parent_run_keyword_accepts_stdout_bytes_without_double_wrapping(self):
        run = Mock(return_value=b'BEGIN\nSET\nDO\n{"readOnly":true}\nROLLBACK\n')
        transport = subject.ReplayRehearsalTransport(run=run, read=self.read)
        self.assertEqual(transport.query(subject.SNAPSHOT_SQL), {'readOnly': True})
        submitted = run.call_args.kwargs['input']
        self.assertIs(type(submitted), bytes)
        self.assertEqual(submitted, subject.OUTPUT_FORMAT + subject.SNAPSHOT_SQL.encode())
        self.assertEqual(submitted.count(b'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;'), 1)
        self.assertEqual(submitted.count(b'ROLLBACK;'), 1)

    def test_receipt_query_uses_exact_argv_and_existing_readonly_wrapper(self):
        self.assertEqual(self.transport.query(subject.SNAPSHOT_SQL), {'readOnly': True})
        self.command.assert_called_once_with([
            '/usr/bin/docker', 'exec', '-i', 'pvb-staging-receipts-db', '/usr/local/bin/psql',
            '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres'],
            input=subject.OUTPUT_FORMAT + subject.SNAPSHOT_SQL.encode(), timeout=60)
        self.read.assert_not_called()

    def test_arbitrary_or_modified_query_never_reaches_runner(self):
        for sql in ('SELECT 1;', subject.SNAPSHOT_SQL + '\nCOMMIT;', subject.SNAPSHOT_SQL.encode(), None):
            with self.subTest(sql=type(sql).__name__), self.assertRaisesRegex(ValueError, '^replay_transport_refused$'):
                self.transport.query(sql)
        self.command.assert_not_called()

    def test_application_snapshot_reads_fixed_authenticated_source_each_time(self):
        raw = self.read.return_value
        self.assertEqual(hashlib.sha256(raw).hexdigest(), subject.APPLICATION_SQL_SHA256)
        for _ in range(2):
            self.assertEqual(self.transport.application_snapshot(), {'readOnly': True})
        self.assertEqual(self.read.call_count, 2)
        self.read.assert_called_with(Path('/root/baci-existing-projection-source.btzzmjl9/financial_snapshot.sql'),
            '46fac83a0f1bb499b9d6fd17ebb8714cd72af148f1d5dfa56285eb61584cd7ed')
        self.command.assert_called_with([
            '/usr/bin/docker', 'exec', '-i', 'baci-isolated-savings-db-1', '/usr/bin/psql',
            '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'],
            input=subject.OUTPUT_FORMAT + raw, timeout=60)

    def test_changed_or_unavailable_application_source_never_reaches_runner(self):
        for raw in (self.read.return_value + b'\n', b'BEGIN;\nCOMMIT;\n', b'', 'SELECT 1;', None):
            self.read.return_value = raw
            with self.assertRaisesRegex(ValueError, '^replay_transport_refused$'):
                self.transport.application_snapshot()
        self.read.side_effect = OSError('private path and secret')
        with self.assertRaisesRegex(ValueError, '^replay_transport_refused$'):
            self.transport.application_snapshot()
        self.command.assert_not_called()

    def test_execute_preserves_pinned_bytes_and_returns_real_terminal_tag(self):
        self.assertEqual(hashlib.sha256(self.rollback).hexdigest(), subject.ROLLBACK_SQL_SHA256)
        self.command.return_value = b'BEGIN\nSET\nDO\nCREATE FUNCTION\nDO\nROLLBACK\n'
        self.assertEqual(self.transport.execute(self.rollback), 'ROLLBACK')
        self.command.assert_called_once_with(list(subject.RECEIPT_ARGV), input=self.rollback, timeout=60)
        with self.assertRaisesRegex(ValueError, '^replay_transport_refused$'):
            self.transport.execute(self.rollback)
        self.assertEqual(self.command.call_count, 1)

    def test_execute_rejects_unpinned_bytes_commit_and_string_before_submission(self):
        for raw in (self.rollback + b'\n', self.rollback.replace(b'ROLLBACK;\n', b'COMMIT;\n'),
                    self.rollback.decode(), bytearray(self.rollback), b'ROLLBACK;\n', None):
            with self.subTest(raw=type(raw).__name__), self.assertRaisesRegex(ValueError, '^replay_transport_refused$'):
                self.transport.execute(raw)
        self.command.assert_not_called()

    def test_rollback_suffix_is_checked_even_with_a_matching_pin(self):
        raw = b'BEGIN;\nCOMMIT;\n'
        with patch.object(subject, 'ROLLBACK_SQL_SHA256', hashlib.sha256(raw).hexdigest()):
            with self.assertRaisesRegex(ValueError, '^replay_transport_refused$'):
                self.transport.execute(raw)
        self.command.assert_not_called()

    def test_missing_or_nonterminal_ack_does_not_allow_execute_retry(self):
        for output in ('', 'BEGIN\nDO\n', 'BEGIN\nROLLBACK\nCOMMIT\n', 'BEGIN\nCOMMIT\nROLLBACK\n',
                       'BEGIN\nROLLBACK\nERROR\n', 'BEGIN\nROLLBACK \n', 'BEGIN\nROLLBACK\nROLLBACK\n'):
            command = Mock(return_value=output)
            transport = subject.ReplayRehearsalTransport(command, self.read)
            for _ in range(2):
                with self.assertRaisesRegex(ValueError, '^replay_transport_refused$'):
                    transport.execute(self.rollback)
            self.assertEqual(command.call_count, 1)

    def test_timeout_and_runner_failure_are_redacted_and_never_retried(self):
        for error in (TimeoutError('private detail'), RuntimeError('secret provider body')):
            command = Mock(side_effect=error)
            transport = subject.ReplayRehearsalTransport(command, self.read)
            for _ in range(2):
                with self.assertRaisesRegex(ValueError, '^replay_transport_refused$'):
                    transport.execute(self.rollback)
            self.assertEqual(command.call_count, 1)

    def test_snapshot_rejects_duplicate_keys_nonfinite_multiple_rows_and_forged_ack(self):
        for output in ('BEGIN\n{"key":1,"key":2}\nROLLBACK\n',
                       'BEGIN\n{"nested":{"key":1,"key":2}}\nROLLBACK\n',
                       'BEGIN\n{"value":NaN}\nROLLBACK\n', 'BEGIN\n[]\nROLLBACK\n',
                       'BEGIN\n{}\n{}\nROLLBACK\n', 'BEGIN\n{"tag":"ROLLBACK"}\n',
                       '{}\nROLLBACK\n', 'BEGIN\n{}\nNOTICE: secret\nROLLBACK\n'):
            self.command.return_value = output
            with self.assertRaisesRegex(ValueError, '^replay_transport_refused$'):
                self.transport.query(subject.SNAPSHOT_SQL)

    def test_snapshot_accepts_utf8_bytes_and_rejects_invalid_or_oversized_output(self):
        self.command.return_value = b'BEGIN\n{"readOnly":true}\nROLLBACK\n'
        self.assertEqual(self.transport.query(subject.SNAPSHOT_SQL), {'readOnly': True})
        for output in (b'\xff', None, {'readOnly': True}, 'x' * (subject.LIMIT + 1)):
            self.command.return_value = output
            with self.assertRaisesRegex(ValueError, '^replay_transport_refused$'):
                self.transport.query(subject.SNAPSHOT_SQL)

    def test_invalid_callbacks_are_refused(self):
        for command, read in ((None, self.read), (self.command, None)):
            with self.assertRaisesRegex(ValueError, '^replay_transport_refused$'):
                subject.ReplayRehearsalTransport(command, read)


if __name__ == '__main__':
    unittest.main()
