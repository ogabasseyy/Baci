import importlib.util
import json
from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools/test'))
from piggyvest_ledger_balance_harness import LedgerBalanceHarness


SPEC = importlib.util.spec_from_file_location('ledger_repair_owner', Path(__file__).with_name('owner.py'))
OWNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(OWNER)
SNAPSHOT = b"""
BEGIN READ ONLY;
SET LOCAL standard_conforming_strings=on;
WITH full_snapshot AS MATERIALIZED (
  WITH targets AS (
    SELECT 'piggyvest_savings_ledger.check_balance()'::regprocedure::oid AS oid
  ), routines AS (
    SELECT md5(jsonb_agg(
      CASE WHEN oid IN (SELECT oid FROM targets) THEN to_jsonb(entry)-'prosrc'
      ELSE to_jsonb(entry) END ORDER BY oid)::text) AS fingerprint
    FROM pg_catalog.pg_proc entry
  )
  SELECT jsonb_build_object(
    'capturedAt',clock_timestamp()::text,
    'readOnly',current_setting('transaction_read_only')='on',
    'unsupportedRelations','[]'::jsonb,
    'routines',(SELECT fingerprint FROM routines),
    'roles',(SELECT jsonb_agg(to_jsonb(role) ORDER BY oid) FROM pg_catalog.pg_roles role),
    'markerRows',(SELECT COALESCE(jsonb_agg(to_jsonb(marker) ORDER BY id),'[]'::jsonb)
      FROM fence_fixture.markers marker)
  ) AS evidence
)
SELECT evidence FROM full_snapshot;
DO $financial_deadline$ BEGIN NULL; END $financial_deadline$;
ROLLBACK;
"""


class OwnerPostgresTransactionFenceTests(unittest.TestCase):
    def setUp(self):
        self.harness = LedgerBalanceHarness()
        self.addCleanup(self.harness.close)
        self.harness.install()
        self.harness.sql("""
          CREATE SCHEMA fence_fixture;
          CREATE TABLE fence_fixture.markers(id integer PRIMARY KEY, note text NOT NULL);
          INSERT INTO fence_fixture.markers VALUES (1,'baseline quote '' and slash ' || chr(92));
          CREATE ROLE fence_unrelated NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
            NOREPLICATION NOBYPASSRLS;
          CREATE FUNCTION fence_fixture.unrelated() RETURNS integer LANGUAGE sql
            IMMUTABLE SET search_path=pg_catalog AS 'SELECT 1';
        """)
        self.assertFalse(self.checker_authority())
        self.expected = self.capture()
        self.assertIs(self.expected['readOnly'], True)
        self.assertEqual(self.expected['unsupportedRelations'], [])
        self.fence = OWNER.transaction_fence(SNAPSHOT, self.expected)

    def capture(self):
        result = self.harness.sql(OWNER.masked_source(SNAPSHOT))
        rows = result.stdout.strip().splitlines()
        self.assertEqual(len(rows), 1)
        return json.loads(rows[0])

    def checker_authority(self):
        result = self.harness.sql("SELECT prosecdef FROM pg_catalog.pg_proc "
            "WHERE oid='piggyvest_savings_ledger.check_balance()'::regprocedure;")
        self.assertIn(result.stdout.strip(), ('t', 'f'))
        return result.stdout.strip() == 't'

    def execute_fence(self, unexpected=''):
        return self.harness.sql(
            'BEGIN; SET LOCAL standard_conforming_strings=on; '
            'ALTER FUNCTION piggyvest_savings_ledger.check_balance() SECURITY DEFINER; '
            + unexpected + self.fence + 'COMMIT;', checked=False)

    def assert_unchanged_witness(self):
        after = self.capture()
        self.assertNotEqual(after['capturedAt'], self.expected['capturedAt'])
        self.assertEqual({key: value for key, value in after.items() if key != 'capturedAt'},
            {key: value for key, value in self.expected.items() if key != 'capturedAt'})

    def assert_guard_refusal_rolls_back(self, result):
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('42501: repair full snapshot refused', result.stderr)
        self.assertFalse(self.checker_authority())
        self.assert_unchanged_witness()

    def test_actual_fence_commits_only_expected_checker_authority_change(self):
        self.assertIn("current_setting('transaction_read_only') IS DISTINCT FROM 'off'", self.fence)
        result = self.execute_fence()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(self.checker_authority())
        self.assert_unchanged_witness()
        self.assertEqual(self.harness.sql("""
          SELECT proconfig::text,proacl::text FROM pg_catalog.pg_proc
            WHERE oid='piggyvest_savings_ledger.check_balance()'::regprocedure;
        """).stdout.strip(), '{search_path=pg_catalog}|{postgres=X/postgres}')

    def test_marker_insert_refuses_commit_and_rolls_back_marker_and_authority(self):
        result = self.execute_fence("INSERT INTO fence_fixture.markers VALUES (2,'unexpected'); ")
        self.assert_guard_refusal_rolls_back(result)
        self.assertEqual(self.harness.sql('SELECT count(*) FROM fence_fixture.markers;').stdout.strip(), '1')

    def test_unrelated_role_metadata_change_rolls_back_role_and_authority(self):
        result = self.execute_fence('ALTER ROLE fence_unrelated CREATEDB; ')
        self.assert_guard_refusal_rolls_back(result)
        self.assertEqual(self.harness.sql("SELECT rolcreatedb FROM pg_catalog.pg_roles "
            "WHERE rolname='fence_unrelated';").stdout.strip(), 'f')

    def test_unrelated_function_metadata_change_rolls_back_function_and_authority(self):
        result = self.execute_fence('ALTER FUNCTION fence_fixture.unrelated() SET search_path=public; ')
        self.assert_guard_refusal_rolls_back(result)
        self.assertEqual(self.harness.sql("SELECT proconfig::text FROM pg_catalog.pg_proc "
            "WHERE oid='fence_fixture.unrelated()'::regprocedure;").stdout.strip(), '{search_path=pg_catalog}')

    def test_checker_non_authority_metadata_is_not_masked_or_committed(self):
        result = self.execute_fence('ALTER FUNCTION piggyvest_savings_ledger.check_balance() STABLE; ')
        self.assert_guard_refusal_rolls_back(result)
        self.assertEqual(self.harness.sql("SELECT provolatile FROM pg_catalog.pg_proc "
            "WHERE oid='piggyvest_savings_ledger.check_balance()'::regprocedure;").stdout.strip(), 'v')


if __name__ == '__main__':
    unittest.main()
