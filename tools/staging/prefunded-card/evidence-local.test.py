import importlib.util
import json
from pathlib import Path
import subprocess
import time
import unittest
from concurrent.futures import ThreadPoolExecutor


ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location('projection_fixture', ROOT / 'tools/test/prefunded-card-projection.test.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
INTEGRATION = 'd91d9e87-8e0d-44de-9b84-1e1d709633d2'
FIRST = '70000000-0000-4000-8000-000000000010'
SECOND = '70000000-0000-4000-8000-000000000011'


class ProviderEvidence(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database = MODULE.PrefundedProjection
        cls.database.setUpClass()
        try:
            for filename in ['evidence-storage.sql', 'evidence-projection-storage.sql', 'evidence-conflict.sql', 'evidence-record.sql',
                             'evidence-transfer.sql', 'evidence-inflow.sql', 'evidence-projection.sql', 'evidence-legacy.sql', 'evidence-fixture.sql']:
                cls.database.file('tools/staging/prefunded-card/' + filename)
            cls.database.sql('UPDATE public.customer_savings_goals SET target_amount=1000')
        except subprocess.CalledProcessError as error:
            cls.database.tearDownClass()
            raise AssertionError(error.stderr) from error

    @classmethod
    def tearDownClass(cls):
        cls.database.tearDownClass()

    def sql(self, query, user='projection_worker'):
        try:
            return self.database.sql(query, user)
        except subprocess.CalledProcessError as error:
            raise AssertionError(error.stderr) from error

    def record_query(self, event, reference, changes='{}', kind='internal_transfer'):
        return (f"SELECT prefunded_card.record_provider_evidence('{INTEGRATION}','{self.database.system}',"
                f"public.evidence_fixture('{event}','{reference}','{kind}','{changes}'))")

    def prepare(self, operation, reference):
        self.sql(f"SELECT prefunded_card.reserve(public.evidence_command('{operation}','{reference}'))")
        self.sql(f"SELECT prefunded_card.claim_collection('{operation}',0)")
        collection = json.dumps(dict(reference=reference + '-collection', amountKobo=10000, currency='NGN',
                                     savedMethodId=MODULE.METHOD, providerTransactionId=reference + '-charge'))
        self.sql(f"SELECT prefunded_card.record_collection('{operation}',1,'verified_success','{collection}')")
        self.sql(f"SELECT prefunded_card.claim_transfer('{operation}',0)")

    def verify_and_record(self, operation):
        result = json.loads(self.sql(f"SELECT prefunded_card.read_transfer_evidence('{operation}','{self.database.system}')"))
        self.assertEqual(result['outcome'], 'verified_success')
        evidence = json.dumps(result['evidence'])
        self.sql(f"SELECT prefunded_card.record_transfer('{operation}',1,'verified_success','{evidence}')")

    def test_owned_evidence_races_conflict_fence_and_restart(self):
        try:
            self.database.file('tools/staging/prefunded-card/evidence.test.sql')
            self.database.file('tools/staging/prefunded-card/evidence-projection.test.sql')
            self.database.file('tools/staging/prefunded-card/evidence-legacy.test.sql')
            self.database.file('tools/staging/prefunded-card/evidence-public-route.test.sql')
        except subprocess.CalledProcessError as error:
            raise AssertionError(error.stderr) from error
        self.prepare(FIRST, 'race-transfer-first')
        self.prepare(SECOND, 'race-transfer-second')
        with ThreadPoolExecutor(max_workers=8) as pool:
            outcomes = list(pool.map(lambda _: self.sql(self.record_query('race-event-first', 'race-transfer-first'), 'evidence_ingestor'), range(8)))
        self.assertEqual(outcomes.count('stored'), 1)
        self.assertEqual(outcomes.count('duplicate'), 7)
        self.sql(self.record_query('race-event-second', 'race-transfer-second'), 'evidence_ingestor')
        self.verify_and_record(FIRST)
        self.verify_and_record(SECOND)
        self.sql(self.record_query('multiple-bridge-ids', 'race-transfer-first',
            '{"references":["multiple-bridge-ids-transaction","race-transfer-first","race-transfer-second"]}', 'bank_inflow'), 'evidence_ingestor')
        self.assertEqual(json.loads(self.sql(f"SELECT prefunded_card.classify_provider_inflow('{INTEGRATION}','{self.database.system}','multiple-bridge-ids')"))['outcome'], 'reconciliation_required')
        self.sql(self.record_query('race-bank', 'ordinary-bank', kind='bank_inflow'), 'evidence_ingestor')
        with ThreadPoolExecutor(max_workers=8) as pool:
            outcomes = list(pool.map(lambda _: json.loads(self.sql(
                f"SELECT prefunded_card.classify_provider_inflow('{INTEGRATION}','{self.database.system}','race-bank')"))['outcome'], range(8)))
        self.assertEqual(outcomes, ['bank_inflow'] * 8)
        self.assertEqual(self.sql("SELECT count(*) FROM prefunded_card.inflow_attributions WHERE result->>'outcome'='bank_inflow'", 'harness_admin'), '1')
        with ThreadPoolExecutor(max_workers=8) as pool:
            card = [pool.submit(self.sql, f"SELECT prefunded_card.project('{FIRST}','{self.database.system}')") for _ in range(8)]
            bank = [pool.submit(self.sql, f"SELECT prefunded_card.apply_classified_inflow('{INTEGRATION}','{self.database.system}','race-bank')") for _ in range(8)]
            for competing in [card, bank]:
                outcomes = [result.result() for result in competing]
                self.assertEqual(outcomes.count('applied'), 1)
                self.assertEqual(outcomes.count('duplicate'), 7)
        self.assertEqual(self.sql('SELECT sum(amount_kobo) FROM piggyvest_savings_ledger.postings WHERE account=\'principal\'', 'harness_admin'), '20000')
        self.assertEqual(self.sql('SELECT current_amount FROM public.customer_savings_goals', 'harness_admin'), '200.00')
        self.sql(self.record_query('bank-card-alias', 'race-transfer-first', kind='bank_inflow'), 'evidence_ingestor')
        self.assertEqual(self.sql(f"SELECT prefunded_card.apply_classified_inflow('{INTEGRATION}','{self.database.system}','bank-card-alias')"), 'duplicate')
        self.assertEqual(self.sql("SELECT count(*) FROM prefunded_card.provider_aliases WHERE provider_transaction_id='bank-card-alias-transaction'", 'harness_admin'), '1')
        legacy = "SELECT prefunded_card.apply_verified_legacy_inflow('race-bank-transaction','race-bank-data','race-bank'," \
                 "'scratch-event-customer','scratch-private-wallet',10000,0,'ordinary-bank','race-bank-session','2026-09-26T12:00:00Z')"
        self.assertEqual(self.sql(legacy), 'duplicate')
        self.assertEqual(self.sql(legacy.replace('10000,0', '10001,0')), 'reconciliation_required')
        self.assertEqual(self.sql(self.record_query('race-event-first', 'race-transfer-first', '{"amountKobo":10001}'), 'evidence_ingestor'), 'conflict')
        self.assertEqual(self.sql(f"SELECT projection_status FROM prefunded_card.operations WHERE id='{FIRST}'", 'harness_admin'), 'applied')
        self.assertEqual(self.sql(f"SELECT already_applied FROM prefunded_card.evidence_conflicts WHERE operation_id='{FIRST}'", 'harness_admin'), 't')

        process = subprocess.Popen([str(MODULE.BIN / 'psql'), '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1',
                                    '-h', str(self.database.path), '-p', '55461', '-U', 'evidence_ingestor', '-d', 'postgres'],
                                   env=self.database.environment, text=True, stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            process.stdin.write('BEGIN;\n' + self.record_query('race-event-second', 'race-transfer-second', '{"amountKobo":10001}') + ';\n')
            process.stdin.flush()
            self.assertEqual(process.stdout.readline().strip(), 'conflict')
            with ThreadPoolExecutor(max_workers=1) as pool:
                projecting = pool.submit(self.sql, "SET application_name='evidence_projection_race'; "
                                          f"SELECT prefunded_card.project('{SECOND}','{self.database.system}')")
                deadline = time.monotonic() + 5
                while self.sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='evidence_projection_race' AND wait_event_type='Lock'", 'harness_admin') != '1':
                    if time.monotonic() > deadline:
                        process.stdin.write('ROLLBACK;\n\\q\n')
                        process.stdin.flush()
                        self.fail('projection did not block behind the evidence conflict transaction')
                    time.sleep(0.01)
                process.stdin.write('COMMIT;\n\\q\n')
                process.stdin.flush()
                process.wait(timeout=5)
                self.assertEqual(projecting.result(timeout=5).splitlines()[-1], 'deferred')
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
            for stream in [process.stdin, process.stdout, process.stderr]:
                stream.close()
        self.assertEqual(self.sql('SELECT count(*) FROM public.customer_savings_contributions', 'harness_admin'), '2')
        self.assertEqual(self.sql(f"SELECT projection_status FROM prefunded_card.operations WHERE id='{SECOND}'", 'harness_admin'), 'reconciliation_required')
        self.assertEqual(self.sql(f"SELECT already_applied FROM prefunded_card.evidence_conflicts WHERE operation_id='{SECOND}'", 'harness_admin'), 'f')
        self.database.shell([MODULE.BIN / 'pg_ctl', '-D', self.database.path / 'data', '-l', self.database.path / 'log',
                             '-m', 'fast', 'restart', '-o', f"-k {self.database.path} -h '' -p 55461"])
        self.assertEqual(self.sql('SELECT count(*) FROM prefunded_card.evidence_conflicts', 'harness_admin'), '2')
        self.assertEqual(self.sql(f"SELECT prefunded_card.project('{SECOND}','{self.database.system}')"), 'deferred')
        self.assertEqual(self.sql('SELECT count(*) FROM public.customer_savings_contributions', 'harness_admin'), '2')
        self.assertEqual(self.sql("SELECT has_table_privilege('evidence_ingestor','prefunded_card.provider_evidence','INSERT')", 'harness_admin'), 'f')


if __name__ == '__main__':
    unittest.main()
