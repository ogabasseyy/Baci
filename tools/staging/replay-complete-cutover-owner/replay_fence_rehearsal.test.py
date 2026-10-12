import copy
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
NOW = datetime(2026, 10, 4, 12, tzinfo=timezone.utc)


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


class Tests(unittest.TestCase):
    def setUp(self):
        self.subject = load('replay_fence_rehearsal')
        database = load('cutover_database.test')
        self.database = database.CutoverDatabaseTests()
        self.database.setUp()
        self.database.current['observedAt'] = '2026-10-04T12:00:00Z'
        financial = load('financial_completion.test')
        snapshots = load('completion_snapshot.test')
        report = financial.completed_fixture()
        snapshot = snapshots.consistent_snapshot(report)
        self.audit = encode({'reconciliation': {'completedReport': report,
            'collection': {'protectedSnapshot': snapshot}}})
        self.inputs = dict(financialAudit=self.audit, originalDefinition=self.database.original.encode(),
            rollbackSql=self.database.rollback_sql.encode())
        self.reviewed = dict(financialAuditPath='/root/immutable-completed.json',
            financialAuditSha256=hashlib.sha256(self.audit).hexdigest())
        self.app = snapshot
        self.app['capturedAt'] = '2026-10-04T12:00:00Z'
        before, after, receipt = load('replay_quiescence.test').fixture()
        before['observedAt'] = after['observedAt'] = receipt['observedAt'] = '2026-10-04T12:00:00Z'
        self.measurement = dict(applicationSnapshot=self.app, before=before, after=after, receipt=receipt)
        self.executions, self.collections = [], 0
        self.inventory = dict(observedAt='2026-10-04T12:00:00Z', exclusive=True, unknownClaimants=[])
        self.now = NOW

    def authenticate(self, reviewed):
        self.assertEqual(reviewed, self.reviewed)
        return copy.deepcopy(self.inputs)

    def collect(self):
        self.collections += 1
        return copy.deepcopy(self.measurement)

    def execute(self, raw):
        self.assertIs(type(raw), bytes)
        self.assertEqual(raw, self.database.rollback_sql.encode())
        self.executions.append(raw)
        return self.database.execute(raw.decode())

    def invoke(self, **options):
        with patch.object(self.subject.cutover_database, '_now', return_value=self.now):
            return self.subject.rehearse_replay_fence(reviewed=self.reviewed,
                reviewed_sha256=hashlib.sha256(encode(self.reviewed)).hexdigest(),
                authenticate_inputs=self.authenticate, collect=self.collect,
                exclusive_inventory=lambda: copy.deepcopy(self.inventory),
                query=self.database.query, execute=self.execute, clock=lambda: self.now, **options)

    def test_rehearses_exact_prepared_rollback_without_start_or_financial_capability(self):
        result = self.invoke()
        self.assertEqual(result['status'], 'replay-fence-rollback-verified')
        self.assertTrue(result['protectedApplicationUnchanged'])
        self.assertTrue(result['rollbackAcknowledged'])
        self.assertFalse(result['launchAuthorized'])
        self.assertEqual(self.executions, [self.database.rollback_sql.encode()])
        self.assertEqual(self.subject.ROLLBACK_SQL_SHA256,
            '315028b8f028f3537dcf2226123a495238f2f85eb6a88855275c25f05078c69d')

    def test_historical_audit_is_not_normalized_to_current_collector_clock(self):
        original = copy.deepcopy(self.inputs)
        result = self.invoke()
        self.assertEqual(result['status'], 'replay-fence-rollback-verified')
        self.assertEqual(self.inputs, original)
        audit = json.loads(self.audit)
        audit['reconciliation']['completedReport']['observedAt'] = self.now.isoformat().replace('+00:00', 'Z')
        self.inputs['financialAudit'] = encode(audit)
        self.executions.clear()
        self.assertEqual(self.invoke()['status'], 'replay-fence-rollback-refused')
        self.assertEqual(self.executions, [])

    def test_no_mode_deadline_start_stop_or_grant_override_api(self):
        for key in ('mode', 'deadline', 'start', 'stop', 'grant'):
            with self.subTest(key=key), self.assertRaises(TypeError):
                self.invoke(**{key: 'commit'})
        self.reviewed['deadline'] = '2026-10-07T15:59:10Z'
        self.assertEqual(self.invoke()['status'], 'replay-fence-rollback-refused')
        self.assertEqual(self.executions, [])

    def test_unknown_claimant_inventory_before_execute_refuses(self):
        self.inventory['unknownClaimants'] = ['foreign']
        self.assertEqual(self.invoke()['status'], 'replay-fence-rollback-refused')
        self.assertEqual(self.executions, [])

    def test_unknown_claimant_or_application_row_drift_after_execution_refuses(self):
        for kind in ('unknown', 'notification', 'auth', 'metadata'):
            with self.subTest(kind=kind):
                self.setUp()
                original = lambda raw: Tests.execute(self, raw)
                def execute(raw):
                    result = original(raw)
                    if kind == 'unknown':
                        self.inventory['unknownClaimants'] = ['foreign']
                    elif kind == 'metadata':
                        self.measurement['applicationSnapshot']['permanentMetadataSha256'] = '9' * 64
                    else:
                        tables = self.measurement['applicationSnapshot']['tableRows']
                        name = 'savings_notifications.events' if kind == 'notification' else 'auth.sessions'
                        tables[name] = dict(count=1, sha256='9' * 64, oid=9999)
                    return result
                self.execute = execute
                result = self.invoke()
                self.assertEqual(result['status'], 'replay-fence-rollback-refused')
                self.assertFalse(result['launchAuthorized'])
                self.assertEqual(len(self.executions), 1)

    def test_lost_ack_retains_fresh_post_snapshot_and_never_retries_or_claims_rollback(self):
        self.database.ack = 'UNKNOWN'
        result = self.invoke()
        self.assertEqual(result['status'], 'replay-fence-rollback-refused')
        self.assertTrue(result['transactionAttempted'])
        self.assertFalse(result['rollbackAcknowledged'])
        self.assertIsNotNone(result['afterApplication'])
        self.assertEqual(len(self.executions), 1)
        self.assertFalse(result['launchAuthorized'])

    def test_changed_original_definition_or_commit_bytes_refuse_before_execution(self):
        for key, raw in (('originalDefinition', b'foreign'), ('rollbackSql', self.database.commit_sql.encode())):
            original = self.inputs[key]
            self.inputs[key] = raw
            with self.subTest(key=key):
                self.assertEqual(self.invoke()['status'], 'replay-fence-rollback-refused')
                self.assertEqual(self.executions, [])
            self.inputs[key] = original

    def test_stale_or_write_transaction_snapshot_is_not_normalized(self):
        for field, value in (('capturedAt', '2026-10-03T12:00:00Z'), ('readOnly', False)):
            original = self.app[field]
            self.app[field] = value
            with self.subTest(field=field):
                self.assertEqual(self.invoke()['status'], 'replay-fence-rollback-refused')
                self.assertEqual(self.executions, [])
            self.app[field] = original

    def test_execution_boundary_revalidates_inputs_inventory_and_actual_application(self):
        original = self.collect
        def collect():
            value = original()
            if self.collections == 2:
                value['applicationSnapshot']['permanentMetadataSha256'] = '9' * 64
            return value
        self.collect = collect
        self.assertEqual(self.invoke()['status'], 'replay-fence-rollback-refused')
        self.assertEqual(self.executions, [])

    def test_execute_adapter_itself_rejects_commit_bytes_or_second_submission(self):
        for mode in ('commit', 'repeat'):
            with self.subTest(mode=mode):
                self.setUp()
                def runner(query, execute, definition, proof, pin, mode='rollback'):
                    self.assertEqual(mode, 'rollback')
                    if scenario == 'commit':
                        execute(self.database.commit_sql)
                    else:
                        execute(self.database.rollback_sql)
                        execute(self.database.rollback_sql)
                scenario = mode
                with patch.object(self.subject.cutover_database, 'run_fence', side_effect=runner):
                    result = self.invoke()
                self.assertEqual(result['status'], 'replay-fence-rollback-refused')
                self.assertEqual(len(self.executions), 0 if mode == 'commit' else 1)

    def test_deadline_expired_inventory_stale_and_source_change_refuse_without_sql(self):
        original_inventory = copy.deepcopy(self.inventory)
        self.inventory['observedAt'] = '2026-10-04T11:59:59Z'
        self.assertEqual(self.invoke()['status'], 'replay-fence-rollback-refused')
        self.inventory = original_inventory
        self.now = datetime(2026, 10, 6, 15, 59, 10, tzinfo=timezone.utc)
        self.assertEqual(self.invoke()['status'], 'replay-fence-rollback-refused')
        self.now = NOW
        original = self.authenticate
        reads = 0
        def authenticate(reviewed):
            nonlocal reads
            reads += 1
            value = original(reviewed)
            if reads >= 2:
                value['rollbackSql'] += b'changed'
            return value
        self.authenticate = authenticate
        self.assertEqual(self.invoke()['status'], 'replay-fence-rollback-refused')
        self.assertEqual(self.executions, [])


if __name__ == '__main__':
    unittest.main()
