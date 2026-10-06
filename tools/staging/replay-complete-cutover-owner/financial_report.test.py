"""Disposable local PostgreSQL query tests, never a live financial proof.

The collector returns {schemaVersion, reportKind, observedAt, appIdentity,
nativeApplication, completedApplication}. Refuse anything except one result row.
nativeApplication has scope/collection/evidence/conflicts and applicationCrosswalk
as a cardinality-preserving array. Parent must require exactly one crosswalk row,
retain every application flag (AND independently verified provider flags), and
add authenticated faasWalletId/apiCustomerId/nativeCustomerId/publicFaasMatches,
where nativeCustomerId is the signed customer UUID, never the business ID.
fresh receiptStorage and original audit provenance; never copy fixture claims.
Assemble native_transfer with that data and outer identity/time. Assemble
financial_completion with the same native report, outer identity/time and all
completedApplication fields. Pass these to the closed validators.
Read the parent audit and receipt DB first; both must precede the app timestamp
by at most 60 seconds. Full-row/catalog protection remains a separate parent gate.
Only the test's SQL copy substitutes its disposable physical system ID.
"""

import copy
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('financial_contract_fixtures', HERE / 'financial_completion.test.py')
FIXTURES = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FIXTURES)
PIN = '7685292944002592802'
SOURCE = HERE / 'financial_report.sql'
DDL = """
CREATE SCHEMA prefunded_card; CREATE SCHEMA piggyvest_staging;
CREATE SCHEMA piggyvest_savings_ledger; CREATE SCHEMA savings_notifications;
CREATE TABLE public.customers(id uuid,merchant_id uuid);
CREATE TABLE public.customer_savings_goals(id uuid,merchant_id uuid,customer_id uuid,current_amount numeric,target_amount numeric,status text,completed_at timestamptz);
CREATE TABLE public.customer_savings_contributions(id uuid,goal_id uuid,merchant_id uuid,customer_id uuid,amount numeric,source_type text,status text,idempotency_key text,metadata jsonb);
CREATE TABLE piggyvest_staging.integrations(id uuid,expected_provider_account_id text,enabled boolean);
CREATE TABLE piggyvest_staging.wallet_goal_mappings(integration_id uuid,provider_wallet_id text,provider_customer_id text,merchant_id uuid,customer_id uuid,goal_id uuid);
CREATE TABLE prefunded_card.credit_routes(goal_id uuid,integration_id uuid,merchant_id uuid,customer_id uuid,system_identifier text);
CREATE TABLE prefunded_card.operations(id uuid,integration_id uuid,merchant_id uuid,customer_id uuid,goal_id uuid,treasury_binding_id uuid,amount_kobo bigint,currency text,destination_wallet_id text,destination_customer_id text,transfer_reference text,checkout_retired boolean,collection_status text,transfer_status text,projection_status text,transfer_provider_transaction_id text,collection_provider_transaction_id text,verification_token uuid,verification_lease_expires_at timestamptz,transfer_attempted_at timestamptz);
CREATE TABLE prefunded_card.checkout_intents(operation_id uuid,phase text,verified_collection jsonb,initialization_token uuid,initialization_lease_expires_at timestamptz);
CREATE TABLE prefunded_card.dispatch_queue(operation_id uuid,claim_token uuid,lease_expires_at timestamptz,finished_at timestamptz);
CREATE TABLE prefunded_card.treasury_bindings(id uuid,integration_id uuid,expected_business_id text,source_wallet_id text,reserved_kobo bigint,consumed_kobo bigint);
CREATE TABLE prefunded_card.treasury_identities(treasury_binding_id uuid,opening_available_kobo bigint);
CREATE TABLE prefunded_card.treasury_replenishments(treasury_binding_id uuid,amount_kobo bigint);
CREATE TABLE prefunded_card.provider_evidence(integration_id uuid,event_id text,fingerprint text,business_id text,observation jsonb,created_at timestamptz,conflicted boolean);
CREATE TABLE prefunded_card.evidence_conflicts(integration_id uuid,event_id text,operation_id uuid,already_applied boolean,recorded_at timestamptz);
CREATE TABLE prefunded_card.projections(operation_id uuid,ledger_operation_id uuid,contribution_id uuid,amount_kobo bigint,created_at timestamptz);
CREATE TABLE prefunded_card.provider_aliases(integration_id uuid,provider_transaction_id text,operation_id uuid);
CREATE TABLE piggyvest_savings_ledger.operations(id uuid,integration_id uuid,merchant_id uuid,customer_id uuid,goal_id uuid,evidence_id text,command jsonb);
CREATE TABLE piggyvest_savings_ledger.postings(operation_id uuid,account text,amount_kobo bigint);
CREATE TABLE savings_notifications.events(id uuid,merchant_id uuid,customer_id uuid,goal_id uuid,event_key text,type text,voided_at timestamptz);
"""
TABLES = re.findall(r'CREATE TABLE ([a-z_.]+)', DDL)


def literal(value):
    if value is None:
        return 'NULL'
    if type(value) is bool:
        return 'true' if value else 'false'
    if type(value) in (int, float):
        return str(value)
    text = json.dumps(value) if type(value) in (dict, list) else value
    return "'" + text.replace("'", "''") + "'"


class FinancialReportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        binaries = {name: shutil.which(name) for name in ('initdb', 'pg_ctl', 'psql')}
        if not all(binaries.values()):
            raise unittest.SkipTest('installed local PostgreSQL tools unavailable')
        cls.directory = tempfile.TemporaryDirectory(prefix='baci-finreport-', dir='/tmp')
        cls.addClassCleanup(cls.directory.cleanup)
        root = Path(cls.directory.name)
        cls.env = dict(PATH=str(Path(binaries['psql']).parent) + ':/usr/bin:/bin', HOME=str(root), LC_ALL='C')
        cls.data = root / 'data'
        cls.socket = root / 'socket'
        cls.socket.mkdir(mode=0o700)
        subprocess.run([binaries['initdb'], '-D', str(cls.data), '-U', 'postgres', '-A', 'trust', '--no-locale'],
                       env=cls.env, check=True, capture_output=True, timeout=30)
        cls.addClassCleanup(lambda: subprocess.run([binaries['pg_ctl'], '-D', str(cls.data), '-m', 'immediate',
                            '-w', 'stop'], env=cls.env, capture_output=True, timeout=30))
        options = "-c listen_addresses='' -c unix_socket_directories='" + str(cls.socket) + "' -c port=55432"
        subprocess.run([binaries['pg_ctl'], '-D', str(cls.data), '-l', str(root / 'server.log'), '-o', options,
                        '-w', 'start'], env=cls.env, check=True, capture_output=True, timeout=30)
        cls.command = [binaries['psql'], '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', str(cls.socket),
                       '-p', '55432', '-U', 'postgres', '-d', 'postgres']
        cls.system = cls.execute('SELECT system_identifier::text FROM pg_control_system();').strip()
        cls.execute(DDL)

    @classmethod
    def execute(cls, sql):
        result = subprocess.run(cls.command, input=sql, env=cls.env, text=True, capture_output=True, timeout=20)
        if result.returncode:
            raise AssertionError('disposable PostgreSQL query failed: ' + result.stderr)
        return result.stdout

    def insert(self, table, **values):
        self.execute('INSERT INTO ' + table + '(' + ','.join(values) + ') VALUES (' +
                     ','.join(literal(value) for value in values.values()) + ');')

    def setUp(self):
        self.execute('TRUNCATE ' + ','.join(TABLES) + ';')
        report = FIXTURES.completed_fixture()
        native, operation = report['nativeEvidence'], report['operation']
        scope = native['scope']
        self.insert('public.customers', id=scope['customerId'], merchant_id=scope['merchantId'])
        self.insert('piggyvest_staging.integrations', id=scope['integrationId'],
                    expected_provider_account_id=scope['businessId'], enabled=True)
        shared = dict(merchant_id=scope['merchantId'], customer_id=scope['customerId'])
        for goal in report['goals']:
            self.insert('public.customer_savings_goals', id=goal['goalId'], **shared,
                        current_amount=100, target_amount=100, status='completed',
                        completed_at='2026-10-03T07:47:00Z')
        self.insert('piggyvest_staging.wallet_goal_mappings', integration_id=scope['integrationId'], **shared,
                    goal_id=scope['goalId'], provider_wallet_id=scope['destinationWalletId'],
                    provider_customer_id=scope['destinationCustomerId'])
        self.insert('prefunded_card.credit_routes', goal_id=scope['goalId'], integration_id=scope['integrationId'],
                    **shared, system_identifier=self.system)
        self.insert('prefunded_card.treasury_bindings', id=scope['treasuryBindingId'], integration_id=scope['integrationId'],
                    expected_business_id=scope['businessId'], source_wallet_id=scope['sourceWalletId'],
                    reserved_kobo=0, consumed_kobo=10000)
        self.insert('prefunded_card.treasury_identities', treasury_binding_id=scope['treasuryBindingId'], opening_available_kobo=10000)
        columns = dict(id='operationId', integration_id='integrationId', goal_id='goalId', treasury_binding_id='treasuryBindingId',
            merchant_id='merchantId', customer_id='customerId', amount_kobo='amountKobo', currency='currency',
            destination_wallet_id='destinationWalletId', destination_customer_id='destinationCustomerId', checkout_retired='checkoutRetired',
            collection_status='collectionStatus', transfer_status='transferStatus', projection_status='projectionStatus',
            transfer_provider_transaction_id='transferProviderTransactionId', collection_provider_transaction_id='collectionProviderTransactionId',
            transfer_attempted_at='transferAttemptedAt')
        self.insert('prefunded_card.operations', **{key: operation[value] for key, value in columns.items()},
                    transfer_reference=FIXTURES.REFERENCE, verification_token=None, verification_lease_expires_at=None)
        self.insert('prefunded_card.checkout_intents', operation_id=FIXTURES.OPERATION,
                    phase='funding_pending', verified_collection={'private': 'secret-proof-marker'})
        self.insert('prefunded_card.dispatch_queue', operation_id=FIXTURES.OPERATION,
                    finished_at='2026-10-03T07:47:10Z', claim_token=None, lease_expires_at=None)
        evidence = copy.deepcopy(native['evidence'][0])
        self.insert('prefunded_card.provider_evidence', integration_id=evidence.pop('integrationId'),
                    event_id=evidence.pop('eventId'), fingerprint=evidence.pop('fingerprint'),
                    business_id=evidence.pop('businessId'), created_at=evidence.pop('createdAt'),
                    conflicted=evidence.pop('conflicted'), observation=evidence | {'sessionId': 'secret-session-marker'})
        for goal_id, operation_id in ((FIXTURES.GOAL, FIXTURES.OPERATION),
                                      (FIXTURES.OLD_GOAL, '30000000-0000-4000-8000-000000000001')):
            self.insert('piggyvest_savings_ledger.operations', id=operation_id, integration_id=scope['integrationId'], **shared,
                        goal_id=goal_id, evidence_id=FIXTURES.KEY if goal_id == FIXTURES.GOAL else 'old-credit',
                        command=dict(kind='credit_principal', principalKobo=10000, interestKobo=0, private='secret-command-marker'))
            for account, amount in (('principal', 10000), ('internal_clearing', -10000)):
                self.insert('piggyvest_savings_ledger.postings', operation_id=operation_id, account=account, amount_kobo=amount)
        self.insert('prefunded_card.projections', operation_id=FIXTURES.OPERATION, ledger_operation_id=FIXTURES.OPERATION,
                    contribution_id=FIXTURES.CONTRIBUTION, amount_kobo=10000, created_at='2026-10-03T07:47:00Z')
        self.insert('public.customer_savings_contributions', id=FIXTURES.CONTRIBUTION, goal_id=FIXTURES.GOAL, **shared,
                    amount=100, source_type='paystack_authorization', status='completed', idempotency_key=FIXTURES.KEY,
                    metadata=dict(operation_id=FIXTURES.OPERATION, provider_transaction_id=FIXTURES.TRANSACTION,
                                  transfer_reference=FIXTURES.REFERENCE, private='secret-metadata-marker'))
        self.insert('prefunded_card.provider_aliases', integration_id=FIXTURES.INTEGRATION,
                    provider_transaction_id=FIXTURES.TRANSACTION, operation_id=FIXTURES.OPERATION)
        self.insert('savings_notifications.events', id=report['notifications'][0]['notificationId'], **shared,
                    goal_id=FIXTURES.GOAL, event_key='milestone:100', type='goal_completed', voided_at=None)

    def collect(self):
        source = SOURCE.read_text()
        self.assertEqual(source.count(PIN), 1)
        output = self.execute(source.replace(PIN, self.system)).strip().splitlines()
        self.assertEqual(len(output), 1)
        return json.loads(output[0].replace('.000000Z', 'Z'))

    def test_original_physical_pin_refuses_disposable_database(self):
        self.assertEqual(self.execute(SOURCE.read_text()).strip(), '')

    def test_real_query_maps_closed_application_schema_and_both_principals(self):
        report = self.collect()
        self.assertEqual(set(report), {'schemaVersion', 'reportKind', 'observedAt', 'appIdentity',
                                      'nativeApplication', 'completedApplication'})
        self.assertEqual(report['appIdentity'], FIXTURES.identity(self.system, 'postgres'))
        FIXTURES.MODULE._timestamp(report['observedAt'])
        expected = FIXTURES.completed_fixture()
        native = report['nativeApplication']
        self.assertEqual(native['scope'], expected['nativeEvidence']['scope'])
        self.assertEqual(native['collection'], expected['nativeEvidence']['collection'])
        self.assertEqual(native['evidence'][0] | {'createdAt': '2026-10-03T07:45:30Z'}, expected['nativeEvidence']['evidence'][0])
        crosswalk = expected['nativeEvidence']['crosswalk']
        self.assertEqual(native['applicationCrosswalk'], [{name: value for name, value in crosswalk.items()
            if name not in {'faasWalletId', 'apiCustomerId', 'nativeCustomerId', 'publicFaasMatches'}}])
        for name, rows in report['completedApplication'].items():
            order = 'goalId' if name == 'goals' else 'account' if name == 'postings' else None
            if order:
                rows = sorted(rows, key=lambda row: row[order])
            wanted = sorted(expected[name], key=lambda row: row[order]) if order else expected[name]
            self.assertEqual(rows, wanted, name)
        serialized = json.dumps(report)
        for forbidden in ('secret-', 'hmacSha512Verified', 'aeadVerified', 'sourceProofSha256', 'receiptStorage',
                          'faasWalletId', 'apiCustomerId', 'publicFaasMatches', 'nativeCustomerId'):
            self.assertNotIn(forbidden, serialized)

    def test_pending_state_is_reported_without_claiming_completion(self):
        self.execute("UPDATE prefunded_card.operations SET transfer_status='dispatching',projection_status='unapplied'; "
                     "UPDATE prefunded_card.treasury_bindings SET reserved_kobo=10000,consumed_kobo=0; "
                     "UPDATE prefunded_card.dispatch_queue SET finished_at=NULL;")
        report = self.collect()['completedApplication']
        self.assertEqual(report['operation']['transferStatus'], 'dispatching')
        self.assertEqual(report['treasury']['reservedKobo'], 10000)
        self.assertEqual(report['unfinishedOperations'], [{'operationId': FIXTURES.OPERATION}])

    def test_extra_matching_evidence_conflicts_and_aliases_are_not_hidden(self):
        self.execute("INSERT INTO prefunded_card.provider_evidence SELECT integration_id,'extra-native',fingerprint,"
                     "business_id,observation,created_at,false FROM prefunded_card.provider_evidence;")
        self.insert('prefunded_card.evidence_conflicts', integration_id=FIXTURES.INTEGRATION,
                    event_id=FIXTURES.EVENT, operation_id=FIXTURES.OPERATION, already_applied=False,
                    recorded_at='2026-10-03T07:45:40Z')
        self.insert('prefunded_card.provider_aliases', integration_id=FIXTURES.INTEGRATION,
                    provider_transaction_id='wrong-native', operation_id=FIXTURES.OPERATION)
        report = self.collect()
        self.assertEqual(len(report['nativeApplication']['evidence']), 2)
        self.assertEqual(len(report['nativeApplication']['conflicts']), 1)
        self.assertEqual(len(report['completedApplication']['aliases']), 2)

    def test_missing_ownership_is_not_turned_into_true_crosswalk(self):
        self.execute('DELETE FROM prefunded_card.credit_routes;')
        self.assertEqual(self.collect()['nativeApplication']['applicationCrosswalk'], [])

    def test_customer_uuid_and_business_authority_are_independent_namespaces(self):
        self.execute("UPDATE prefunded_card.provider_evidence SET business_id='" + FIXTURES.PROVIDER_CUSTOMER + "';")
        native = self.collect()['nativeApplication']
        crosswalk = native['applicationCrosswalk'][0]
        self.assertEqual(crosswalk['providerCustomerId'], FIXTURES.PROVIDER_CUSTOMER)
        self.assertIs(crosswalk['customerMatches'], True)
        self.assertIs(crosswalk['businessMatches'], False)
        self.execute("UPDATE prefunded_card.provider_evidence SET business_id='" + FIXTURES.BUSINESS + "',"
                     "observation=jsonb_set(observation,'{destinationCustomerId}',to_jsonb('" + FIXTURES.BUSINESS + "'::text));")
        native = self.collect()['nativeApplication']
        self.assertIs(native['applicationCrosswalk'][0]['customerMatches'], False)
        self.assertIs(native['applicationCrosswalk'][0]['businessMatches'], True)
        self.assertEqual(native['evidence'][0]['destinationCustomerId'], FIXTURES.BUSINESS)

    def test_query_does_not_change_rows_and_counts_uncleared_target_leases(self):
        self.execute("UPDATE prefunded_card.operations SET verification_token='40000000-0000-4000-8000-000000000001'; "
                     "UPDATE prefunded_card.dispatch_queue SET claim_token='40000000-0000-4000-8000-000000000002';")
        witness = 'SELECT jsonb_build_object(' + ','.join(literal(table) +
            ',(SELECT coalesce(jsonb_agg(to_jsonb(entry) ORDER BY to_jsonb(entry)::text),\'[]\'::jsonb) FROM ' +
            table + ' entry)' for table in TABLES) + ');'
        before = self.execute(witness)
        report = self.collect()['completedApplication']
        self.assertEqual(report['activeLeaseCount'], 2)
        self.assertIs(report['operation']['verificationTokenPresent'], True)
        self.assertIs(report['queue'][0]['claimTokenPresent'], True)
        self.assertEqual(self.execute(witness), before)

    def test_source_contains_only_read_only_collection_not_money_rpcs(self):
        source = SOURCE.read_text()
        self.assertIn('REPEATABLE READ READ ONLY', source)
        self.assertTrue(source.rstrip().endswith('ROLLBACK;'))
        self.assertIsNone(re.search(r'\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|CALL|DO|LOCK)\b', source, re.I))
        self.assertIsNone(re.search(r'\b(claim_due|project|read_transfer_evidence|complete_reconciliation)\s*\(', source))


if __name__ == '__main__':
    unittest.main()
