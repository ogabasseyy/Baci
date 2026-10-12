from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import select
import subprocess
import tempfile
import unittest

import snapshot_binding_sql as renewal

ROOT = Path(__file__).resolve().parents[4]
BIN = Path('/opt/homebrew/opt/postgresql@18/bin')


@unittest.skipUnless((BIN / 'initdb').exists(), 'local PostgreSQL unavailable')
class SnapshotBindingRenewalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='baci-snapshot-renewal-')
        cls.root = Path(cls.directory.name)
        cls.environment = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
        cls.run_command([BIN / 'initdb', '-D', cls.root / 'data', '-A', 'trust', '-U',
                         'harness_admin', '--no-locale', '--encoding=UTF8', '--no-sync'])
        cls.run_command([BIN / 'pg_ctl', '-D', cls.root / 'data', '-l', cls.root / 'log',
                         '-o', f"-k {cls.root} -h '' -p 55496", 'start'])
        cls.system = cls.sql('SELECT system_identifier FROM pg_control_system()')
        guard_source = (ROOT / 'tools/staging/prefunded-card/treasury-storage.sql').read_text()
        guard = re.search(r'CREATE FUNCTION prefunded_card.guard_treasury_identity\(\)[\s\S]*?\$\$;',
                          guard_source)[0]
        cls.sql(f"""CREATE SCHEMA prefunded_card;
          ALTER DATABASE postgres SET timezone='UTC';
          CREATE ROLE prefunded_treasury_verifier NOLOGIN;
          CREATE ROLE prefunded_snapshot_verifier LOGIN NOINHERIT PASSWORD 'synthetic-local-only'
            VALID UNTIL '2026-09-29T15:59:10Z';
          GRANT prefunded_treasury_verifier TO prefunded_snapshot_verifier WITH INHERIT FALSE, SET FALSE;
          CREATE TABLE prefunded_card.treasury_verifier_bindings(login_name name PRIMARY KEY,
            treasury_binding_id uuid,system_identifier text,expires_at timestamptz,created_at timestamptz);
          ALTER TABLE prefunded_card.treasury_verifier_bindings ENABLE ROW LEVEL SECURITY;
          {guard}
          REVOKE ALL ON FUNCTION prefunded_card.guard_treasury_identity() FROM PUBLIC;
          CREATE TRIGGER prefunded_treasury_verifier_immutable BEFORE UPDATE OR DELETE
            ON prefunded_card.treasury_verifier_bindings FOR EACH ROW
            EXECUTE FUNCTION prefunded_card.guard_treasury_identity();
          CREATE TRIGGER prefunded_treasury_verifier_no_truncate BEFORE TRUNCATE
            ON prefunded_card.treasury_verifier_bindings FOR EACH STATEMENT
            EXECUTE FUNCTION prefunded_card.guard_treasury_identity();
          CREATE TABLE public.customer_savings_goals(id uuid,current_amount numeric,customer_id uuid,merchant_id uuid);
          CREATE TABLE prefunded_card.checkout_intents(id uuid,expires_at timestamptz);
          CREATE TABLE prefunded_card.operations(id uuid,checkout_retired boolean);
          CREATE TABLE prefunded_card.checkout_retirements(operation_id uuid,intent_before_sha256 text);
          CREATE TABLE prefunded_card.treasury_bindings(id uuid,verified_available_kobo bigint);
          CREATE TABLE prefunded_card.treasury_identities(treasury_binding_id uuid,opening_available_kobo bigint);
          CREATE TABLE prefunded_card.treasury_replenishments(id uuid,treasury_binding_id uuid,amount_kobo bigint);
          INSERT INTO prefunded_card.treasury_verifier_bindings VALUES('prefunded_snapshot_verifier',
            '{renewal.BINDING}','{cls.system}','2026-09-29T15:59:10Z','2026-09-27T00:00:00Z');
          INSERT INTO prefunded_card.checkout_intents VALUES('d8bcf921-61b3-4647-90e2-5648e4d6967d',
            '2026-09-29T15:59:10Z');
          INSERT INTO prefunded_card.treasury_bindings VALUES('{renewal.BINDING}',10000);
        """)
        cls.sql('CREATE SCHEMA piggyvest_savings_ledger; CREATE SCHEMA piggyvest_staging;')
        for table in renewal.TABLES:
            cls.sql(f'CREATE TABLE IF NOT EXISTS {table}(id uuid,payload text)')

    @classmethod
    def run_command(cls, args, input_text=None):
        return subprocess.run([str(arg) for arg in args], input=input_text, env=cls.environment,
            text=True, capture_output=True, timeout=30, check=True).stdout.strip()

    @classmethod
    def sql(cls, query):
        return cls.run_command([BIN / 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-h', cls.root,
            '-p', '55496', '-U', 'harness_admin', '-d', 'postgres'], query)

    @classmethod
    def tearDownClass(cls):
        cls.run_command([BIN / 'pg_ctl', '-D', cls.root / 'data', '-m', 'immediate', 'stop'])
        cls.directory.cleanup()

    def baseline(self):
        try:
            metadata = self.sql('SELECT ' + renewal.metadata_expression())
        except subprocess.CalledProcessError as error:
            self.fail(error.stderr)
        return {'readOnly': True, 'systemIdentifier': self.system,
            'observedAt': datetime.now(timezone.utc).isoformat(),
            'metadata': json.loads(metadata)}

    def candidate(self, baseline=None, rehearsal=True):
        return renewal._render(baseline or self.baseline(), ROOT, rehearsal, None,
                               self.system, 'harness_admin').decode()

    def execute_successfully(self, sql):
        try:
            self.sql(sql)
        except subprocess.CalledProcessError as error:
            self.fail(error.stderr)

    def test_rehearsal_rolls_back_expiry_and_restores_immutable_trigger(self):
        before = self.baseline()['metadata']
        self.execute_successfully(self.candidate())
        self.assertEqual(self.baseline()['metadata'], before)
        with self.assertRaises(subprocess.CalledProcessError):
            self.sql("UPDATE prefunded_card.treasury_verifier_bindings SET expires_at=now()")

    def test_commit_changes_only_the_two_expiry_fences_and_keeps_retired_expiry(self):
        before = self.baseline()['metadata']
        self.execute_successfully(self.candidate(rehearsal=False))
        after = self.baseline()['metadata']
        self.assertEqual(after, {**before, 'roleExpiry': renewal.DEADLINE, 'bindingExpiry': renewal.DEADLINE})
        self.assertEqual(self.sql("SELECT to_char(expires_at AT TIME ZONE 'UTC',"
            "'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') FROM prefunded_card.checkout_intents"), renewal.OLD_DEADLINE)
        with self.assertRaises(subprocess.CalledProcessError):
            self.sql('DELETE FROM prefunded_card.treasury_verifier_bindings')

    def test_failure_while_trigger_is_disabled_rolls_back_every_change(self):
        before = self.baseline()['metadata']
        candidate = self.candidate(rehearsal=False).replace(
            'ALTER TABLE prefunded_card.treasury_verifier_bindings ENABLE TRIGGER',
            "DO $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$;\n"
            'ALTER TABLE prefunded_card.treasury_verifier_bindings ENABLE TRIGGER')
        with self.assertRaises(subprocess.CalledProcessError):
            self.sql(candidate)
        self.assertEqual(self.baseline()['metadata'], before)

    def test_repeated_commits_with_fresh_baselines_preserve_identity_password_and_history(self):
        before = self.baseline()['metadata']
        self.execute_successfully(self.candidate(rehearsal=False))
        first = self.baseline()['metadata']
        self.execute_successfully(self.candidate(rehearsal=False))
        self.assertEqual(self.baseline()['metadata'], first)
        self.assertEqual(first, {**before, 'roleExpiry': renewal.DEADLINE, 'bindingExpiry': renewal.DEADLINE})

    def test_refuses_password_or_acl_fingerprint_drift_before_exception(self):
        baseline = self.baseline()
        for key in ('rolesHash', 'tableHash', 'bindingHash', 'protectedHash'):
            changed = {**baseline, 'metadata': {**baseline['metadata'], key: '0' * 64}}
            with self.subTest(key=key), self.assertRaises(subprocess.CalledProcessError):
                self.sql(self.candidate(changed, rehearsal=False))
        self.assertEqual(self.baseline()['metadata'], baseline['metadata'])

    def test_unprotected_update_and_truncate_remain_forbidden(self):
        for query in ('UPDATE prefunded_card.treasury_verifier_bindings SET expires_at=now()',
                      'TRUNCATE prefunded_card.treasury_verifier_bindings'):
            with self.subTest(query=query), self.assertRaises(subprocess.CalledProcessError):
                self.sql(query)

    def test_other_session_cannot_read_binding_while_trigger_exception_is_open(self):
        before = self.baseline()['metadata']
        sql = self.candidate()
        marker = 'ALTER TABLE prefunded_card.treasury_verifier_bindings ENABLE TRIGGER'
        prefix, suffix = sql.split(marker, 1)
        process = subprocess.Popen([str(BIN / 'psql'), '-XqAt', '-v', 'ON_ERROR_STOP=1',
            '-h', str(self.root), '-p', '55496', '-U', 'harness_admin', '-d', 'postgres'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, env=self.environment)
        try:
            process.stdin.write(prefix + "SELECT 'PAUSED';\n")
            process.stdin.flush()
            self.assertTrue(select.select([process.stdout], [], [], 10)[0], 'transaction checkpoint unavailable')
            line = process.stdout.readline().strip()
            self.assertEqual(line, 'PAUSED')
            with self.assertRaises(subprocess.CalledProcessError) as error:
                self.sql("SET lock_timeout='100ms'; SELECT count(*) FROM prefunded_card.treasury_verifier_bindings")
            self.assertIn('lock timeout', error.exception.stderr)
            _, stderr = process.communicate(marker + suffix, timeout=10)
            self.assertEqual(process.returncode, 0, stderr)
        finally:
            if process.poll() is None:
                process.communicate('ROLLBACK;\n', timeout=10)
        self.assertEqual(self.baseline()['metadata'], before)

    def test_fresh_inventory_cannot_bless_public_acl_drift_on_immutable_guard(self):
        self.sql('GRANT EXECUTE ON FUNCTION prefunded_card.guard_treasury_identity() TO PUBLIC')
        try:
            with self.assertRaises(subprocess.CalledProcessError) as error:
                self.sql(self.candidate(rehearsal=False))
            self.assertIn('immutable guard refused', error.exception.stderr)
        finally:
            self.sql('REVOKE ALL ON FUNCTION prefunded_card.guard_treasury_identity() FROM PUBLIC')

    def test_refuses_stale_baseline_and_unapproved_binding_expiry(self):
        baseline = self.baseline()
        baseline['observedAt'] = '2026-09-29T00:00:00Z'
        with self.assertRaisesRegex(ValueError, 'snapshot_renewal_baseline_stale'):
            self.candidate(baseline)
        baseline = self.baseline()
        baseline['metadata']['bindingExpiry'] = '2026-10-07T00:00:00Z'
        with self.assertRaisesRegex(ValueError, 'snapshot_renewal_baseline_refused'):
            self.candidate(baseline)
        baseline = self.baseline()
        baseline['observedAt'] = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
        with self.assertRaisesRegex(ValueError, 'snapshot_renewal_baseline_stale'):
            self.candidate(baseline)


if __name__ == '__main__':
    unittest.main()
