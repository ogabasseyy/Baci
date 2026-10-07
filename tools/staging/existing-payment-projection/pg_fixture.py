import importlib.util
import os
from pathlib import Path
import re
import tempfile

import projection_sql as subject


ROOT = Path(__file__).resolve().parents[3]
BIN = Path('/opt/homebrew/opt/postgresql@17/bin')
SPEC = importlib.util.spec_from_file_location(
    'existing_payment_ledger_harness', ROOT / 'tools/test/piggyvest_ledger_balance_harness.py')
BASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BASE)
PORT = '55491'
CARD = ROOT / 'tools/staging/prefunded-card'


class ProjectionHarness(BASE.LedgerBalanceHarness):
    def __init__(self):
        self.directory = tempfile.TemporaryDirectory(prefix='existing-payment-pg-', dir='/private/tmp')
        self.path = Path(self.directory.name)
        self.environment = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
        self.started = False
        try:
            self.command([BIN / 'initdb', '-D', self.path / 'data', '-A', 'trust',
                          '-U', 'postgres', '--no-locale', '--encoding=UTF8'])
            self.command([BIN / 'pg_ctl', '-D', self.path / 'data', '-l', self.path / 'log',
                          '-o', f"-k {self.path} -h '' -p {PORT}", '-w', 'start'])
            self.started = True
            self.install()
        except Exception:
            self.close()
            raise

    def arguments(self, login='postgres'):
        return [BIN / 'psql', '-XqAt', '-w', '-h', self.path, '-p', PORT,
                '-U', login, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']

    def sql(self, source, login='postgres', checked=True):
        return self.command(self.arguments(login), source, checked)

    def generated(self, source):
        return source.replace(subject.SYSTEM, self.system).replace(subject.DEADLINE, self.deadline)

    def function(self, name):
        source = (CARD / 'storage-functions.sql').read_text()
        match = re.search(r'CREATE (?:OR REPLACE )?FUNCTION prefunded_card\.' + name
                          + r'\(.*?END \$\$;', source, re.S)
        if match is None:
            raise AssertionError('Canonical function unavailable')
        return match.group()

    def install(self):
        super().install()
        self.system = self.sql('SELECT system_identifier FROM pg_control_system()').stdout.strip()
        self.deadline = self.sql("SELECT to_char((clock_timestamp()+interval '1 day') "
                                 "AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')").stdout.strip()
        self.sql((Path(__file__).parent / 'fixture_schema.sql').read_text())
        for filename in ['storage.sql', 'projection-storage.sql', 'dispatch-queue.sql',
                         'checkout-storage.sql']:
            self.sql((CARD / filename).read_text())
        self.sql('ALTER TABLE prefunded_card.operations ADD checkout_retired boolean NOT NULL DEFAULT false;')
        self.sql(self.function('lock_scoped_operation') + self.function('claim_reconciliation'))
        self.sql((CARD / 'projection-functions.sql').read_text())
        signatures = ['claim_due(uuid,text,text,integer,uuid,uuid)', 'claim_reconciliation(uuid,integer)']
        settings = ''
        for signature in signatures:
            sha = self.sql(f"SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc "
                           f"WHERE oid='prefunded_card.{signature}'::regprocedure").stdout.strip()
            name = signature.split('(')[0]
            settings += f"SET LOCAL prefunded_card.claim_boundary_{name}_sha256='{sha}';"
        migration = ROOT / 'supabase/migrations/20261002160000_prefunded_first_card_claim_boundary.sql'
        self.sql(f"BEGIN ISOLATION LEVEL READ COMMITTED; {settings} "
                 f"SET LOCAL prefunded_card.claim_boundary_database='postgres'; "
                 f"SET LOCAL prefunded_card.claim_boundary_system='{self.system}'; "
                 + migration.read_text() + 'COMMIT;')
        self.sql(self.generated((Path(__file__).parent / 'fixture_seed.sql').read_text()))

    def snapshot(self):
        return self.sql("""SELECT jsonb_build_object(
          'queue',(SELECT jsonb_agg(to_jsonb(row) ORDER BY operation_id) FROM prefunded_card.dispatch_queue row),
          'operations',(SELECT jsonb_agg(to_jsonb(row) ORDER BY id) FROM prefunded_card.operations row),
          'treasury',(SELECT jsonb_agg(to_jsonb(row) ORDER BY id) FROM prefunded_card.treasury_bindings row),
          'goals',(SELECT jsonb_agg(to_jsonb(row) ORDER BY id) FROM public.customer_savings_goals row),
          'projections',(SELECT jsonb_agg(to_jsonb(row)) FROM prefunded_card.projections row),
          'aliases',(SELECT jsonb_agg(to_jsonb(row)) FROM prefunded_card.provider_aliases row),
          'contributions',(SELECT jsonb_agg(to_jsonb(row)) FROM public.customer_savings_contributions row),
          'ledger',(SELECT jsonb_agg(to_jsonb(row) ORDER BY id) FROM piggyvest_savings_ledger.operations row),
          'postings',(SELECT jsonb_agg(to_jsonb(row) ORDER BY operation_id,account) FROM piggyvest_savings_ledger.postings row))
        """).stdout.strip()

    def replace_function(self, name, signature, returns, body):
        self.sql(f"CREATE OR REPLACE FUNCTION prefunded_card.{name}({signature}) RETURNS {returns} "
                 "LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ "
                 f"BEGIN {body} END $$;")
