import importlib.util
from contextlib import contextmanager
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


HERE = Path(__file__).resolve().parent
BIN = Path('/opt/homebrew/opt/postgresql@17/bin')
SPEC = importlib.util.spec_from_file_location('claim_installer', HERE / 'installer.py')
INSTALLER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INSTALLER)


class MaterializedPg17Fixture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not (BIN / 'postgres').is_file():
            raise unittest.SkipTest('PostgreSQL 17 binary unavailable; materialized support remains unverified')
        cls.directory = tempfile.TemporaryDirectory(prefix='claim-mv-pg17-')
        cls.path = Path(cls.directory.name)
        cls.environment = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
        try:
            cls.command([BIN / 'initdb', '-D', cls.path / 'data', '-A', 'trust',
                '-U', 'postgres', '--no-locale', '--encoding=UTF8'])
            cls.command([BIN / 'pg_ctl', '-D', cls.path / 'data', '-l', cls.path / 'log',
                '-o', f"-k {cls.path} -h '' -p 55474", 'start'])
            cls.command([BIN / 'psql', '-XqAt', '-w', '-h', cls.path, '-p', '55474',
                '-U', 'postgres', '-d', 'postgres', '-c', 'CREATE ROLE mv_reader NOLOGIN;'])
        except Exception:
            cls.directory.cleanup()
            raise

    @classmethod
    def tearDownClass(cls):
        try:
            cls.command([BIN / 'pg_ctl', '-D', cls.path / 'data', '-m', 'immediate', 'stop'])
        finally:
            cls.directory.cleanup()

    @classmethod
    def command(cls, arguments):
        result = subprocess.run(list(map(str, arguments)), env=cls.environment,
            text=True, capture_output=True, timeout=30)
        if result.returncode:
            raise RuntimeError(result.stderr.strip())
        return result.stdout.strip()

    def arguments(self):
        return [BIN / 'psql', '-XqAt', '-w', '-v', 'ON_ERROR_STOP=1',
            '-h', self.path, '-p', '55474', '-U', 'postgres', '-d', self.database]

    def sql(self, statement):
        return self.command(self.arguments() + ['-c', statement])

    def setUp(self):
        self.database = 'mv_' + self._testMethodName[:55]
        self.command([BIN / 'createdb', '-h', self.path, '-p', '55474', '-U', 'postgres', self.database])
        self.addCleanup(self.command, [BIN / 'dropdb', '-h', self.path, '-p', '55474', '-U', 'postgres', self.database])
        self.sql("""
          CREATE SCHEMA prefunded_card; CREATE SCHEMA piggyvest_savings_ledger;
          CREATE TABLE prefunded_card.operations(id uuid PRIMARY KEY);
          CREATE TABLE prefunded_card.checkout_intents(operation_id uuid,phase text,verified_collection jsonb);
          CREATE TABLE prefunded_card.dispatch_queue(id uuid,operation_id uuid,finished_at timestamptz);
          CREATE TABLE prefunded_card.treasury_bindings(amount bigint);
          CREATE TABLE public.customer_savings_goals(amount bigint);
          CREATE TABLE public.customer_savings_contributions(amount bigint);
          CREATE TABLE public.customer_saved_payment_methods(id uuid);
          CREATE TABLE piggyvest_savings_ledger.operations(amount bigint);
          INSERT INTO public.customer_savings_goals VALUES(10000);
          INSERT INTO prefunded_card.treasury_bindings VALUES(10000);
          CREATE FUNCTION prefunded_card.lock_scoped_operation(p_operation uuid)
          RETURNS prefunded_card.operations LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog
          AS $$SELECT * FROM prefunded_card.operations WHERE id=p_operation FOR UPDATE$$;
          CREATE FUNCTION prefunded_card.claim_due(uuid,text,text,integer,uuid,uuid)
          RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
          BEGIN RETURN (SELECT coalesce(jsonb_agg(queue.id),'[]'::jsonb)
          FROM prefunded_card.dispatch_queue queue JOIN prefunded_card.operations operation
            ON operation.id=queue.operation_id WHERE true AND queue.finished_at IS NULL); END; $$;
          CREATE FUNCTION prefunded_card.claim_reconciliation(p_operation uuid,integer)
          RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
          DECLARE operation prefunded_card.operations%ROWTYPE;
          BEGIN
            operation:=prefunded_card.lock_scoped_operation(p_operation);
            RETURN jsonb_build_object('outcome','not_verifiable'); END; $$;
          CREATE MATERIALIZED VIEW public.mv_populated WITH (fillfactor=80,autovacuum_enabled=false)
            AS SELECT 1::integer id,10000::bigint amount;
          CREATE UNIQUE INDEX mv_populated_id ON public.mv_populated(id);
          GRANT SELECT ON public.mv_populated TO mv_reader;
          CREATE MATERIALIZED VIEW public.mv_empty AS SELECT 1::integer id WHERE false;
          CREATE MATERIALIZED VIEW public.mv_unpopulated AS SELECT 1::integer id WITH NO DATA;
        """)

    def snapshot(self):
        return json.loads(self.sql(self.snapshot_sql()))

    def snapshot_sql(self):
        return (HERE / 'snapshot.sql').read_text().replace('__CLOSURE__',
            INSTALLER._closure(INSTALLER._source(None))).rstrip().rstrip(';')

    def expected_sql(self, evidence):
        return 'CREATE TEMP TABLE cb_expected ON COMMIT DROP AS SELECT ' + INSTALLER._literal(
            INSTALLER._json(evidence)) + '::jsonb evidence;'

    def snapshot_guard_sql(self):
        return 'CREATE TEMP TABLE cb_snapshot ON COMMIT DROP AS ' + self.snapshot_sql() + ';' + (
            HERE / 'guard.sql').read_text()

    def locks_sql(self, evidence):
        return ('BEGIN; SET LOCAL lock_timeout=\'5s\';' + self.expected_sql(evidence)
            + 'DO $locks$' + (HERE / 'identity.sql').read_text().split('DO $locks$')[1]
            + self.snapshot_guard_sql() + (HERE / 'materialized-locks.sql').read_text()
            + 'DROP TABLE pg_temp.cb_snapshot;' + self.snapshot_guard_sql())

    @contextmanager
    def held_materialized_locks(self, evidence):
        process = subprocess.Popen(list(map(str, self.arguments())), env=self.environment,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            process.stdin.write(self.locks_sql(evidence) + "SELECT 'mv_ready:'||pg_backend_pid()::text;\n")
            process.stdin.flush()
            ready = process.stdout.readline().strip()
            if not ready.startswith('mv_ready:'):
                raise RuntimeError(process.stderr.read().strip())
            yield int(ready.split(':')[1])
        finally:
            if process.poll() is None:
                process.communicate('ROLLBACK;\n', timeout=10)
            else:
                process.communicate(timeout=10)
