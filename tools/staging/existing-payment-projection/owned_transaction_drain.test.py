import json
import unittest
from unittest.mock import Mock, patch

import owned_transaction_drain as subject
from pg_fixture import BIN, ProjectionHarness
import projection_sql
from psql_transaction import PsqlTransaction


def observation():
    return dict(subject.EXPECTED, backendPid=12345, transactionId='98765')


class PreparedHarness(ProjectionHarness):
    def command(self, arguments, source=None, checked=True):
        arguments = list(arguments)
        if arguments[0] == BIN / 'pg_ctl' and '-o' in arguments:
            position = arguments.index('-o') + 1
            arguments[position] += ' -c max_prepared_transactions=4'
        return super().command(arguments, source, checked)


class FixtureTransport:
    def __init__(self, database, transaction):
        self.database, self.transaction = database, transaction

    def execute(self, source):
        return self.transaction.execute(self.database.generated(source))


class OwnedDrainContractTests(unittest.TestCase):
    def test_empty_collector_output_refuses_owned_binding(self):
        transaction = Mock()
        transaction.execute.return_value = []
        with self.assertRaises(ValueError):
            subject.OwnedTransactionDrain(transaction)

    def test_owned_identity_is_bound_once_and_verified_on_same_transport(self):
        transaction = Mock()
        transaction.execute.return_value = [json.dumps(observation())]
        drain = subject.OwnedTransactionDrain(transaction)
        baseline = drain.baseline
        baseline['backendPid'] = 1
        self.assertEqual(drain.verify(), observation())
        self.assertEqual(drain.baseline, observation())
        self.assertEqual(transaction.execute.call_count, 2)
        transaction.execute.assert_called_with(subject.DRAIN_SQL)

    def test_changed_pid_or_xid_refuses_and_revokes_without_retry(self):
        for field, value in (('backendPid', 12346), ('transactionId', '98766')):
            with self.subTest(field=field):
                transaction = Mock()
                transaction.execute.side_effect = [[json.dumps(observation())],
                    [json.dumps(dict(observation(), **{field: value}))]]
                drain = subject.OwnedTransactionDrain(transaction)
                for _ in range(2):
                    with self.assertRaisesRegex(ValueError, '^owned_transaction_drain_refused$'):
                        drain.verify()
                self.assertEqual(transaction.execute.call_count, 2)
                self.assertEqual(drain.baseline, observation())

    def test_exact_identity_schema_and_types_are_required(self):
        changes = [('systemIdentifier', 'foreign'), ('sessionUser', 'operator'),
            ('currentUser', 'operator'), ('database', 'foreign'), ('localUnix', False),
            ('readOnly', True), ('readOnly', 0), ('readWrite', False),
            ('preparedTransactions', 1), ('preparedTransactions', False),
            ('otherClientTransactions', 1), ('otherClientTransactions', 0.0),
            ('backendPid', False), ('backendPid', 0), ('backendPid', 2147483648),
            ('transactionId', None), ('transactionId', 98765), ('transactionId', '0'),
            ('transactionId', '01'), ('transactionId', '18446744073709551616')]
        for field, value in changes:
            with self.subTest(field=field, value=value):
                transaction = Mock(execute=Mock(return_value=[json.dumps(
                    dict(observation(), **{field: value}))]))
                with self.assertRaises(ValueError):
                    subject.OwnedTransactionDrain(transaction)

    def test_malformed_duplicate_extra_missing_or_multiple_records_refuse(self):
        raw = json.dumps(observation())
        missing = observation()
        del missing['localUnix']
        records = [None, (), [], [raw, raw], [None], ['x' * 8193], ['not-json'],
            ['[]'], [json.dumps(missing)], [json.dumps(dict(observation(), extra=True))],
            [raw[:-1] + ',"readOnly":false}'], [raw.replace('12345', 'NaN')]]
        for output in records:
            with self.subTest(output_type=type(output).__name__):
                with self.assertRaises(ValueError):
                    subject.OwnedTransactionDrain(Mock(execute=Mock(return_value=output)))

    def test_transport_failure_is_redacted_and_revokes_binding(self):
        transaction = Mock()
        transaction.execute.side_effect = [[json.dumps(observation())], RuntimeError('private')]
        drain = subject.OwnedTransactionDrain(transaction)
        with self.assertRaisesRegex(ValueError, '^owned_transaction_drain_refused$'):
            drain.verify()
        with self.assertRaises(ValueError):
            drain.verify()
        self.assertEqual(transaction.execute.call_count, 2)

    def test_sql_retains_fixed_guards_without_setting_or_transaction_mutation(self):
        sql = subject.DRAIN_SQL
        self.assertIn("'7685292944002592802'", sql)
        self.assertIn("'2026-10-06T15:59:10Z'::timestamptz", sql)
        self.assertIn('PERFORM pg_catalog.pg_stat_clear_snapshot();', sql)
        self.assertEqual(sql.count('WHERE pid<>pg_catalog.pg_backend_pid()'), 2)
        for forbidden in ('SET ', 'BEGIN;', 'COMMIT;', 'ROLLBACK;', 'INSERT ',
                          'UPDATE ', 'DELETE ', 'pg_current_xact_id()'):
            self.assertNotIn(forbidden, sql)


class OwnedDrainPostgresTests(unittest.TestCase):
    def setUp(self):
        self.database = PreparedHarness()
        self.addCleanup(self.database.close)
        expected = patch.dict(subject.EXPECTED, systemIdentifier=self.database.system)
        expected.start()
        self.addCleanup(expected.stop)

    def connection(self, source=None):
        transaction = PsqlTransaction(list(map(str, self.database.arguments())))
        self.addCleanup(transaction.close)
        transport = FixtureTransport(self.database, transaction)
        transport.execute(source if source is not None else projection_sql.start_sql())
        return transport

    def refuse(self, drain):
        with self.assertRaisesRegex(ValueError, '^owned_transaction_drain_refused$'):
            drain.verify()

    def test_real_owned_rw_session_emits_one_record_and_preserves_timeouts(self):
        transport = self.connection()
        settings = "SELECT current_setting('statement_timeout')||'|'||current_setting('lock_timeout')||'|'||" \
                   "current_setting('idle_in_transaction_session_timeout');"
        self.assertEqual(transport.execute(settings), ['20s|2s|15s'])
        drain = subject.OwnedTransactionDrain(transport)
        self.assertEqual(drain.verify(), drain.baseline)
        self.assertIs(drain.baseline['readOnly'], False)
        self.assertIs(drain.baseline['readWrite'], True)
        self.assertEqual(transport.execute(settings), ['20s|2s|15s'])
        transport.transaction.finish(commit=False)

    def test_second_client_transaction_is_not_excluded_and_cached_stats_refresh(self):
        transport = self.connection()
        drain = subject.OwnedTransactionDrain(transport)
        transport.execute('SELECT count(*) FROM pg_stat_activity;')
        other = self.connection('BEGIN; SELECT 1;')
        self.assertEqual(other.execute('SELECT 1;'), ['1'])
        self.refuse(drain)
        other.transaction.finish(commit=False)

    def test_other_readonly_client_transaction_is_also_rejected(self):
        drain = subject.OwnedTransactionDrain(self.connection())
        other = self.connection('BEGIN READ ONLY; SELECT 1;')
        self.refuse(drain)
        other.transaction.finish(commit=False)

    def test_prepared_transaction_rejects_after_its_client_disconnects(self):
        drain = subject.OwnedTransactionDrain(self.connection())
        self.database.sql("BEGIN; SELECT pg_current_xact_id(); PREPARE TRANSACTION 'owned-drain-fixture';")
        self.addCleanup(self.database.sql, "ROLLBACK PREPARED 'owned-drain-fixture';")
        self.refuse(drain)

    def test_new_transaction_on_same_backend_fails_xid_continuity(self):
        transport = self.connection()
        drain = subject.OwnedTransactionDrain(transport)
        transport.execute('ROLLBACK;' + projection_sql.start_sql())
        self.refuse(drain)
        transport.transaction.finish(commit=False)

    def test_reconnected_transport_fails_backend_continuity(self):
        transport = self.connection()
        drain = subject.OwnedTransactionDrain(transport)
        transport.transaction.finish(commit=False)
        transport.transaction = self.connection().transaction
        self.refuse(drain)
        transport.transaction.finish(commit=False)

    def test_wrong_physical_system_refuses_before_reporting(self):
        transport = self.connection()
        with self.assertRaises(ValueError):
            transport.transaction.execute(subject.DRAIN_SQL)

    def test_restricted_session_and_replica_origin_refuse(self):
        for setting in ('SET SESSION AUTHORIZATION prefunded_treasury_operator;',
                        "SET LOCAL session_replication_role='replica';"):
            with self.subTest(setting=setting):
                transport = self.connection()
                drain = subject.OwnedTransactionDrain(transport)
                transport.execute(setting)
                self.refuse(drain)

    def test_readonly_or_wrong_isolation_or_unassigned_transaction_refuses(self):
        statements = ["BEGIN READ ONLY; SET LOCAL search_path=pg_catalog;",
            "BEGIN ISOLATION LEVEL REPEATABLE READ; SET LOCAL search_path=pg_catalog; "
            "SELECT pg_current_xact_id();",
            "BEGIN; SET LOCAL search_path=pg_catalog;"]
        for statement in statements:
            with self.subTest(statement=statement):
                transport = self.connection(statement)
                with self.assertRaises(ValueError):
                    subject.OwnedTransactionDrain(transport)

    def test_no_active_transaction_cannot_bind_implicit_statement_transaction(self):
        transport = self.connection('SET search_path=pg_catalog;')
        with self.assertRaises(ValueError):
            subject.OwnedTransactionDrain(transport)

    def test_wrong_search_path_or_standard_strings_is_not_silently_corrected(self):
        for setting in ("SET LOCAL search_path=public;", "SET LOCAL standard_conforming_strings=off;"):
            with self.subTest(setting=setting):
                transport = self.connection()
                drain = subject.OwnedTransactionDrain(transport)
                transport.execute(setting)
                self.refuse(drain)


if __name__ == '__main__':
    unittest.main()
