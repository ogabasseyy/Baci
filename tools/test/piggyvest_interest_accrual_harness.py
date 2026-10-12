import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
BIN = Path('/opt/homebrew/opt/postgresql@18/bin')
INTEGRATION = '40000000-0000-4000-8000-000000000001'
MERCHANT = '10000000-0000-4000-8000-000000000001'
USER = '50000000-0000-4000-8000-000000000001'
FUNCTION = 'piggyvest_staging.record_interest_accrual(uuid,text,text,uuid,text,json)'
OBSERVATIONS = 'piggyvest_staging.interest_accrual_observations'
RECEIPTS = 'piggyvest_staging.interest_accrual_receipts'
TOKEN = '406.8493150684931234'


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def payload(event='event-1', accrual='accrual-1', **changes):
    body = {
        'eventId': event, 'eventType': 'interest-accrued.success',
        'eventCategory': 'interest_accrued', 'customer_id': 'provider-customer',
        'pvb_wallet': 'public-wallet', 'pvb_wallet_name': 'Synthetic wallet',
        'pvb_split_interest_with_wallet': None, 'pvb_split_interest_with_wallet_name': None,
        'eventData': {
            'id': accrual, 'wallet_id': '70000000-0000-4000-8000-000000000001',
            'interest_date': '2026-09-28T00:00:00.000Z', 'interest_type': 'original',
            'amount': '__DECIMAL__', 'balance': 1650000, 'percentage': 9,
        },
    }
    body['eventData'].update(changes.pop('detail', {}))
    body.update(changes)
    return json.dumps(body).replace('"__DECIMAL__"', TOKEN)


class ScratchInterestAccrual(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.path = Path(tempfile.mkdtemp(prefix='baci-accrual-'))
        cls.environment = {key: value for key, value in os.environ.items()
                           if not key.startswith('PG')}
        cls.addClassCleanup(cls.cleanup)
        cls.shell([BIN / 'initdb', '-D', cls.path / 'data', '-A', 'trust',
                   '-U', 'harness_admin', '--no-locale', '--encoding=UTF8', '--wal-segsize=1'])
        cls.shell([BIN / 'pg_ctl', '-D', cls.path / 'data', '-l', cls.path / 'log',
                   '-o', f"-k {cls.path} -h '' -p 55459", 'start'])
        cls.server_pid = int((cls.path / 'data/postmaster.pid').read_text().splitlines()[0])
        print(f'Scratch PG started: pid={cls.server_pid}, data={cls.path / "data"}', flush=True)
        cls.sql_file(ROOT / 'tools/test/piggyvest-savings-ledger-setup.sql')
        for migration in sorted((ROOT / 'supabase/migrations').glob('20260912120[0-5]00_*.sql')):
            cls.sql_file(migration)
        cls.sql_file(ROOT / 'supabase/migrations/20260912080200_piggyvest_staging_wallet_goal_mappings.sql')
        cls.sql_file(ROOT / 'supabase/migrations/tests/piggyvest_interest_accrual_fixture.sql')
        for name in ['20260925130000_customer_savings_engagement_storage.sql',
                     '20260925130100_customer_savings_engagement_events.sql']:
            cls.sql_file(ROOT / 'supabase/migrations' / name)
        writer = ROOT / 'supabase/migrations/20260930120000_piggyvest_interest_accrual_observations.sql'
        if writer.exists():
            cls.sql_file(writer)
            cls.absent_worker = cls.sql("SELECT count(*) FROM pg_roles WHERE rolname='piggyvest_staging_ledger_worker'").strip()
            cls.absent_worker_grants = cls.sql(f"SELECT count(*) FROM pg_proc procedure,"
                " LATERAL aclexplode(procedure.proacl) grant_entry"
                f" WHERE procedure.oid='{FUNCTION}'::regprocedure AND grant_entry.grantee<>procedure.proowner").strip()
        cls.sql('CREATE ROLE piggyvest_staging_ledger_worker LOGIN NOINHERIT NOSUPERUSER'
                ' NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS')
        if writer.exists():
            cls.later_worker_can_execute = cls.sql(f"SELECT has_function_privilege('piggyvest_staging_ledger_worker','{FUNCTION}','EXECUTE')").strip()
            cls.sql(f'DROP TABLE {RECEIPTS}, {OBSERVATIONS}; DROP FUNCTION {FUNCTION};'
                    ' DROP FUNCTION piggyvest_staging.reject_interest_accrual_mutation()')
        for name in ['20260930120000_piggyvest_interest_accrual_observations.sql',
                     '20260930120100_customer_interest_accrual_observation_read.sql']:
            migration = ROOT / 'supabase/migrations' / name
            if migration.exists():
                cls.sql_file(migration)
        cls.system_id = cls.sql('SELECT system_identifier FROM pg_control_system()').strip()

    @classmethod
    def cleanup(cls):
        pid_file = cls.path / 'data/postmaster.pid'
        if pid_file.exists():
            identity = pid_file.read_text().splitlines()
            if Path(identity[1]).resolve() != (cls.path / 'data').resolve():
                raise AssertionError('Refusing cleanup of a different PostgreSQL data directory')
            cls.shell([BIN / 'pg_ctl', '-D', cls.path / 'data', '-m', 'immediate', '-t', '20', 'stop'])
            if pid_file.exists():
                raise AssertionError('Scratch PostgreSQL did not stop; preserving its files')
            print(f'Scratch PG stopped: pid={identity[0]}, data={cls.path / "data"}', flush=True)
        shutil.rmtree(cls.path)
        if cls.path.exists():
            raise AssertionError('Scratch directory cleanup incomplete')
        print(f'Scratch directory removed: {cls.path}', flush=True)

    @classmethod
    def shell(cls, args):
        result = subprocess.run([str(value) for value in args], env=cls.environment,
                                text=True, capture_output=True, timeout=30)
        if result.returncode:
            raise AssertionError(result.stderr)
        return result.stdout

    @classmethod
    def sql(cls, query, user='harness_admin'):
        return cls.shell([BIN / 'psql', '-X', '-w', '-At', '-v', 'ON_ERROR_STOP=1',
                          '-h', cls.path, '-p', '55459', '-U', user, '-d', 'postgres', '-c', query])

    @classmethod
    def sql_file(cls, path):
        cls.shell([BIN / 'psql', '-X', '-w', '-v', 'ON_ERROR_STOP=1', '-h', cls.path,
                   '-p', '55459', '-U', 'harness_admin', '-d', 'postgres', '-f', path])

    def setUp(self):
        self.assertEqual(self.sql(f"SELECT to_regprocedure('{FUNCTION}') IS NOT NULL").strip(), 't')

    def record_query(self, body=None, receipt=1, business='synthetic-account', pin=None,
                     digest=None):
        body = body or payload()
        digest = digest if digest is not None else hashlib.sha256(body.encode('utf-8')).hexdigest()
        return f"SELECT piggyvest_staging.record_interest_accrual('{INTEGRATION}'," + \
            f"{literal(business)},{literal(pin or self.system_id)}," + \
            f"'80000000-0000-4000-8000-{receipt:012d}',{literal(digest)},{literal(body)}::json)"

    def record(self, body=None, receipt=1, business='synthetic-account', pin=None,
               user='piggyvest_staging_ledger_worker', prefix='', digest=None):
        return self.sql(prefix + self.record_query(body, receipt, business, pin, digest), user).strip().splitlines()[-1]

    def read(self, merchant=MERCHANT, actor=USER):
        output = self.sql(f"BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub={literal(actor)};"
                          f"SELECT public.get_customer_savings_interest_accrual_observations('{merchant}'); ROLLBACK;")
        return json.loads(output.splitlines()[-2])
