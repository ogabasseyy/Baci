import importlib.util
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location('projection_fixture', ROOT / 'tools/test/prefunded-card-projection.test.py')
FIXTURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FIXTURE)
TREASURY = FIXTURE.TREASURY
VERIFIER = 'prefunded_snapshot_verifier'


class TreasurySnapshotStore(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database = FIXTURE.PrefundedProjection
        cls.database.setUpClass()
        try:
            cls.database.sql(f"""
              CREATE ROLE {VERIFIER} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
              GRANT prefunded_treasury_verifier TO {VERIFIER} WITH INHERIT FALSE, SET FALSE;
              GRANT USAGE ON SCHEMA prefunded_card TO treasury_owner;
              GRANT EXECUTE ON FUNCTION prefunded_card.provision_treasury_identity(uuid,uuid,uuid,text,text,name,bigint) TO treasury_owner;
            """)
            cls.database.sql(f"SELECT prefunded_card.provision_treasury_identity('{TREASURY}',"
                             f"'{FIXTURE.INTEGRATION}','{FIXTURE.MERCHANT}','business','treasury-wallet',"
                             f"'{FIXTURE.WORKER}',10000)", 'treasury_owner')
            cls.database.file('tools/staging/prefunded-card/treasury-snapshot-store.sql')
            cls.database.sql(f"""
              INSERT INTO prefunded_card.treasury_verifier_bindings
                (login_name,treasury_binding_id,system_identifier,expires_at)
              VALUES('{VERIFIER}','{TREASURY}','{cls.database.system}',clock_timestamp()+interval '1 hour');
            """)
        except Exception:
            cls.database.tearDownClass()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.database.tearDownClass()

    def query(self, query, login=VERIFIER):
        return self.database.sql(query, login)

    def refused(self, query, login=VERIFIER):
        with self.assertRaises(subprocess.CalledProcessError):
            self.query(query, login)

    def test_binding_and_database_identity_are_checked(self):
        query = (f"SELECT prefunded_card.verify_snapshot_binding('{TREASURY}',"
                 f"'{self.database.system}','business','treasury-wallet')")
        self.assertEqual(self.query(query), 'verified')
        self.refused(query.replace(self.database.system, '1'))
        self.refused(query.replace("'business'", "'other-business'"))
        self.refused(query.replace('treasury-wallet', 'customer-wallet'))
        self.refused(query.replace(TREASURY, '50000000-0000-4000-8000-000000000009'))
        self.refused(query, FIXTURE.WORKER)
        self.refused(query, 'harness_admin')

    def test_clock_and_table_privileges_are_restricted(self):
        self.assertEqual(self.query(f"SELECT prefunded_card.snapshot_database_time('{TREASURY}') IS NOT NULL"), 't')
        self.refused('SELECT count(*) FROM prefunded_card.treasury_snapshots')
        self.refused('SELECT count(*) FROM prefunded_card.treasury_verifier_bindings')
        self.refused('SET ROLE prefunded_treasury_verifier')
        self.refused(f"SELECT prefunded_card.record_treasury_snapshot('{TREASURY}','bypass',1,clock_timestamp(),20000)")

    def test_duplicate_parallel_observation_allocates_one_sequence(self):
        observed = self.database.sql('SELECT clock_timestamp()')
        query = (f"SELECT prefunded_card.record_scoped_treasury_snapshot('{TREASURY}',"
                 f"'same-evidence','{observed}',10000)")
        with ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(lambda unused: self.query(query), range(6)))
        self.assertEqual(results.count('recorded'), 1)
        self.assertEqual(results.count('duplicate'), 5)
        self.refused(query.replace('10000)', '9999)'))
        self.assertEqual(self.database.sql('SELECT count(*) FROM prefunded_card.treasury_snapshots'), '1')
        self.assertEqual(self.database.sql('SELECT sequence_number FROM prefunded_card.treasury_snapshots'), '1')
        self.assertEqual(self.query(f"SELECT prefunded_card.record_scoped_treasury_snapshot('{TREASURY}',"
                                    "'new-observation',clock_timestamp(),8000)"), 'recorded')
        self.assertEqual(self.database.sql('SELECT max(sequence_number) FROM prefunded_card.treasury_snapshots'), '2')
        self.assertEqual(self.database.sql('SELECT verified_available_kobo FROM prefunded_card.treasury_bindings'), '10000')

    def test_expiry_and_unsafe_role_deny_recording(self):
        query = f"SELECT prefunded_card.snapshot_database_time('{TREASURY}')"
        for change, restore in [
            (f'ALTER ROLE {VERIFIER} SUPERUSER', f'ALTER ROLE {VERIFIER} NOSUPERUSER'),
            (f'ALTER ROLE {VERIFIER} BYPASSRLS', f'ALTER ROLE {VERIFIER} NOBYPASSRLS'),
            (f'ALTER ROLE {VERIFIER} INHERIT', f'ALTER ROLE {VERIFIER} NOINHERIT'),
            (f'ALTER ROLE {VERIFIER} NOLOGIN', f'ALTER ROLE {VERIFIER} LOGIN'),
            (f'GRANT prefunded_treasury_verifier TO {VERIFIER} WITH SET TRUE',
             f'GRANT prefunded_treasury_verifier TO {VERIFIER} WITH SET FALSE'),
            (f'GRANT prefunded_treasury_ledger_worker TO {VERIFIER}',
             f'REVOKE prefunded_treasury_ledger_worker FROM {VERIFIER}'),
        ]:
            self.database.sql(change)
            try:
                self.refused(query)
            finally:
                self.database.sql(restore)
        result = self.database.sql(f"""
          BEGIN;
          ALTER TABLE prefunded_card.treasury_verifier_bindings DISABLE TRIGGER USER;
          UPDATE prefunded_card.treasury_verifier_bindings SET expires_at=clock_timestamp()-interval '1 second';
          SET SESSION AUTHORIZATION {VERIFIER};
          DO $$ BEGIN
            BEGIN PERFORM prefunded_card.snapshot_database_time('{TREASURY}');
              RAISE EXCEPTION 'expired verifier accepted';
            EXCEPTION WHEN insufficient_privilege THEN NULL; END;
          END $$;
          ROLLBACK;
        """)
        self.assertIn('ROLLBACK', result)

    def test_stale_future_null_and_wrong_scope_refuse(self):
        for timestamp in ["clock_timestamp()-interval '31 seconds'", "clock_timestamp()+interval '31 seconds'", 'NULL']:
            self.refused(f"SELECT prefunded_card.record_scoped_treasury_snapshot('{TREASURY}',"
                         f"'invalid-time',{timestamp},10000)")
        self.refused(f"SELECT prefunded_card.record_scoped_treasury_snapshot('{TREASURY}',NULL,clock_timestamp(),10000)")
        self.refused(f"SELECT prefunded_card.record_scoped_treasury_snapshot('{TREASURY}','invalid-amount',clock_timestamp(),-1)")
        self.refused(f"SELECT prefunded_card.record_scoped_treasury_snapshot('{TREASURY}','over-budget',clock_timestamp(),10001)")
        self.refused("SELECT prefunded_card.record_scoped_treasury_snapshot('50000000-0000-4000-8000-000000000009',"
                     "'wrong-binding',clock_timestamp(),10000)")

    def test_immutable_binding_and_lower_level_grant_drift_refuse(self):
        self.refused(f"UPDATE prefunded_card.treasury_verifier_bindings SET expires_at=clock_timestamp()+interval '1 day'", 'harness_admin')
        signature = 'prefunded_card.record_treasury_snapshot(uuid,text,bigint,timestamptz,bigint)'
        self.database.sql(f'GRANT EXECUTE ON FUNCTION {signature} TO {VERIFIER}')
        try:
            self.refused(f"SELECT prefunded_card.snapshot_database_time('{TREASURY}')")
        finally:
            self.database.sql(f'REVOKE EXECUTE ON FUNCTION {signature} FROM {VERIFIER}')


if __name__ == '__main__':
    unittest.main()
