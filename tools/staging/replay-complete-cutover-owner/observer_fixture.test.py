"""Isolated PG17 only; copied wrapper pins/deadlines are test-only, never live proof."""

import hashlib
import importlib.util
import json
from pathlib import Path
import re
import unittest


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SPEC = importlib.util.spec_from_file_location('observer_pg17', HERE.parent / 'replay-claim-fence/postgres.test.py')
PG17 = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PG17)
MIGRATION = ROOT / 'supabase/migrations/20260930120000_piggyvest_interest_accrual_observations.sql'
MIGRATION_SHA = '191d10435aec4df4e99f9d5e3f2ea95bb658442b5001d31505d4752c39f2200a'
BODY_SHA = 'ded145ffbd571962691cb16fc520f3c2b8f93f015dc5583f295c69b66bfb4efb'
PIN = '7685292944002592802'
DEADLINE = '2026-10-06T15:59:10Z'
INTEGRATION = 'd91d9e87-8e0d-44de-9b84-1e1d709633d2'
BUSINESS = '01M2381RG34HQJMHQKE7DWDACR'
ROLE = 'piggyvest_staging_ledger_worker'
ORIGINAL = 'piggyvest_staging.record_interest_accrual(uuid,text,text,uuid,text,json)'
WRAPPER = 'piggyvest_staging.record_interest_accrual_scoped(uuid,text,text,uuid,text,json)'
SOURCE = HERE / 'observer-wrapper.sql'
TOKEN = '406.8493150684931'


def literal(value):
    return 'NULL' if value is None else "'" + str(value).replace("'", "''") + "'"


def payload(event='synthetic-accrual-event', accrual='synthetic-accrual-id', **changes):
    body = dict(eventId=event, eventType='interest-accrued.success', eventCategory='interest_accrued',
                customer_id='c096507d-dc32-45d2-9c01-871a27abfd10', pvb_wallet='01M3W0Y93XHJY9RPQ2G75X81WG',
                pvb_wallet_name='Synthetic ₦ observation', pvb_split_interest_with_wallet=None,
                pvb_split_interest_with_wallet_name=None, eventData=dict(id=accrual,
                wallet_id='01M3W0YENHMFJ8Z9FS76E3CC6T', interest_date='2026-10-03T00:00:00Z',
                interest_type='original', amount='__DECIMAL__', balance=10000, percentage=9))
    body['eventData'].update(changes.pop('detail', {}))
    body.update(changes)
    return json.dumps(body, ensure_ascii=False).replace('"__DECIMAL__"', TOKEN) + '\n'


class ObserverFixture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture_type = PG17.ClaimFencePostgresTests
        cls.fixture_type.setUpClass()
        cls.addClassCleanup(cls.fixture_type.tearDownClass)

    def setUp(self):
        self.harness = self.fixture_type('runTest')
        self.harness.setUp()
        self.addCleanup(self.harness.doCleanups)
        self.sql = self.harness.sql
        self.assertEqual(hashlib.sha256(MIGRATION.read_bytes()).hexdigest(), MIGRATION_SHA)
        self.sql((HERE / 'observer-fixture.sql').read_text())
        self.sql(MIGRATION.read_text())
        self.sql(f"""DO $role$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='{ROLE}') THEN
  CREATE ROLE {ROLE} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
 END IF;
END $role$;
REVOKE ALL ON FUNCTION {ORIGINAL} FROM {ROLE};
GRANT USAGE ON SCHEMA piggyvest_staging,prefunded_card TO {ROLE};
GRANT EXECUTE ON FUNCTION prefunded_card.executor_system_identity() TO {ROLE};""")
        self.system = self.sql('SELECT system_identifier::text FROM pg_control_system();').stdout.strip()
        self.original_catalog = self.catalog(ORIGINAL)
        self.assertEqual(self.original_catalog['bodySha256'], BODY_SHA)
        self.function = ORIGINAL
        if SOURCE.is_file():
            self.install()
        else:
            self.sql(f'GRANT EXECUTE ON FUNCTION {ORIGINAL} TO {ROLE};')

    def copied(self, source):
        return source.replace(PIN, self.system).replace(
            "current_database() IS DISTINCT FROM 'postgres'", "current_database() IS DISTINCT FROM " + literal(self.harness.database))

    def install(self, deadline=DEADLINE, *, frame=True):
        source = self.copied(SOURCE.read_text()).replace(DEADLINE, deadline)
        self.sql(f'DROP FUNCTION IF EXISTS {WRAPPER};')
        if frame:
            self.assertTrue(source.rstrip().endswith('ROLLBACK;'))
            source = source.rsplit('ROLLBACK;', 1)[0] + 'COMMIT;'
        else:
            source = re.search(r'CREATE FUNCTION[\s\S]*?END \$observer_scoped\$;', source).group()
            source += f'REVOKE ALL ON FUNCTION {WRAPPER} FROM PUBLIC;'
        self.sql(source)
        self.sql(f'GRANT EXECUTE ON FUNCTION {WRAPPER} TO {ROLE};')
        self.function = WRAPPER

    def query(self, body=None, receipt=1, business=BUSINESS, integration=INTEGRATION, system=None, digest=None):
        body = payload() if body is None else body
        digest = hashlib.sha256(body.encode()).hexdigest() if digest is None else digest
        return 'SELECT ' + self.function.split('(')[0] + '(' + ','.join(map(literal, [
            integration, business, self.system if system is None else system,
            f'80000000-0000-4000-8000-{receipt:012d}', digest, body])) + '::json);'

    def record(self, **values):
        output = self.sql(f"SET track_functions='all'; SET SESSION AUTHORIZATION {ROLE};"
                          'BEGIN ISOLATION LEVEL READ COMMITTED;' + self.query(**values) + 'COMMIT;').stdout
        return output.strip().splitlines()[-1]

    def catalog(self, signature):
        return json.loads(self.sql("SELECT jsonb_build_object('catalog',to_jsonb(routine),"
            "'definitionSha256',encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex'),"
            "'bodySha256',encode(sha256(convert_to(prosrc,'UTF8')),'hex')) FROM pg_proc routine WHERE oid="
            + literal(signature) + '::regprocedure;').stdout)

    def rows(self, *, observations=False):
        condition = '' if observations else "AND NOT (namespace.nspname='piggyvest_staging' AND relation.relname IN ('interest_accrual_observations','interest_accrual_receipts'))"
        return self.sql("SELECT string_agg(format('%I.%I:',namespace.nspname,relation.relname)||"
            "query_to_xml(format('SELECT coalesce(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text),''[]''::jsonb) FROM %I.%I row',"
            "namespace.nspname,relation.relname),false,false,'')::text,E'\\n' ORDER BY namespace.nspname,relation.relname) "
            "FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace "
            "WHERE relation.relkind='r' AND namespace.nspname IN ('public','prefunded_card','piggyvest_staging',"
            "'piggyvest_savings_ledger','savings_notifications') " + condition + ';').stdout

    def counts(self):
        return self.sql('SELECT (SELECT count(*) FROM piggyvest_staging.interest_accrual_observations)||\'|\'||'
                        '(SELECT count(*) FROM piggyvest_staging.interest_accrual_receipts);').stdout.strip()


class FixtureContractTests(ObserverFixture):
    def test_legacy_migration_is_byte_identical_and_fixture_is_pg17_local_only(self):
        self.assertTrue(self.sql('SHOW server_version;').stdout.startswith('17.'))
        self.assertEqual(self.sql('SELECT inet_client_addr() IS NULL;').stdout.strip(), 't')
        self.assertEqual(self.catalog(ORIGINAL), self.original_catalog)
        self.assertEqual(hashlib.sha256(MIGRATION.read_bytes()).hexdigest(), MIGRATION_SHA)


if __name__ == '__main__':
    unittest.main()
