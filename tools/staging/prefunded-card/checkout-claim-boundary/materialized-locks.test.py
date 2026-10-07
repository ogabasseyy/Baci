import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import time
import unittest


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('materialized_fixture', HERE / 'materialized_pg17_fixture.py')
FIXTURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FIXTURE)
INSTALLER = FIXTURE.INSTALLER


class MaterializedLockTests(FIXTURE.MaterializedPg17Fixture):
    def test_same_owner_holds_access_exclusive_until_rollback_without_any_catalog_or_row_delta(self):
        before = self.snapshot()
        with self.held_materialized_locks(before) as backend:
            held = json.loads(self.sql(f"""SELECT jsonb_agg(relation.relname ORDER BY relation.relname)
              FROM pg_locks held JOIN pg_class relation ON relation.oid=held.relation
              WHERE held.pid={backend} AND held.granted AND held.mode='AccessExclusiveLock'
                AND relation.relkind='m'"""))
            self.assertEqual(held, ['mv_empty', 'mv_populated', 'mv_unpopulated'])
        after = self.snapshot()
        self.assertEqual(before['tableRows'], after['tableRows'])
        self.assertEqual(before['permanentMetadataSha256'], after['permanentMetadataSha256'])
        self.assertEqual(before['functions'], after['functions'])

    def test_same_owner_commit_preserves_quoted_schema_view_and_nonpostgres_owner(self):
        self.sql('CREATE ROLE "materialized""owner" NOLOGIN; CREATE SCHEMA "materialized.scope"; '
            'GRANT USAGE,CREATE ON SCHEMA "materialized.scope" TO "materialized""owner"; '
            'SET ROLE "materialized""owner"; '
            'CREATE MATERIALIZED VIEW "materialized.scope"."view\"\"name" AS SELECT 10000 amount; RESET ROLE;')
        before = self.snapshot()
        self.sql(self.locks_sql(before) + 'COMMIT;')
        after = self.snapshot()
        self.assertEqual(before['permanentMetadataSha256'], after['permanentMetadataSha256'])
        self.assertEqual(before['tableRows'], after['tableRows'])

    def test_materialized_lock_refuses_without_catalog_locks_even_with_matching_snapshots(self):
        evidence = self.snapshot()
        with self.assertRaisesRegex(RuntimeError, 'materialized preflight refused'):
            self.sql('BEGIN;' + self.expected_sql(evidence) + self.snapshot_guard_sql()
                + (HERE / 'materialized-locks.sql').read_text() + 'COMMIT;')
        self.assertEqual(evidence['permanentMetadataSha256'], self.snapshot()['permanentMetadataSha256'])

    def test_stale_owner_oid_population_and_row_pins_refuse_before_same_owner_ddl(self):
        before = self.snapshot()
        for field, value in dict(owner='foreign-owner', ownerOid=1, oid=1,
                populated=False, sha256='0' * 64).items():
            evidence = copy.deepcopy(before)
            evidence['tableRows']['public.mv_populated'][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(RuntimeError, 'exact fresh snapshot differs'):
                self.sql(self.locks_sql(evidence) + 'COMMIT;')
        self.assertEqual(before['tableRows'], self.snapshot()['tableRows'])

    def test_foreign_relation_remains_unsupported_and_is_never_queried(self):
        self.sql('CREATE FOREIGN DATA WRAPPER inert; CREATE SERVER inert FOREIGN DATA WRAPPER inert; '
            'CREATE FOREIGN TABLE public.foreign_financial(amount bigint) SERVER inert;')
        evidence = self.snapshot()
        self.assertEqual(evidence['unsupportedRelations'], ['public.foreign_financial'])
        self.assertNotIn('public.foreign_financial', evidence['tableRows'])
        with self.assertRaisesRegex(RuntimeError, 'unsupported relation'):
            self.sql(self.locks_sql(evidence) + 'COMMIT;')

    def test_regular_and_concurrent_refresh_both_wait_on_held_materialized_relation_lock(self):
        before = self.snapshot()
        for modifier in ('', 'CONCURRENTLY '):
            with self.subTest(modifier=modifier), self.held_materialized_locks(before):
                name = 'blocked_refresh_concurrent' if modifier else 'blocked_refresh_regular'
                process = subprocess.Popen(list(map(str, self.arguments() + ['-c',
                    f"SET application_name='{name}'; SET lock_timeout='3s'; "
                    f'REFRESH MATERIALIZED VIEW {modifier}public.mv_populated;'])),
                    env=self.environment, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                try:
                    waiting = False
                    deadline = time.monotonic() + 2
                    while time.monotonic() < deadline and process.poll() is None:
                        waiting = self.sql(f"""SELECT EXISTS(SELECT 1 FROM pg_stat_activity activity
                          JOIN pg_locks held ON held.pid=activity.pid
                          WHERE activity.application_name='{name}' AND NOT held.granted
                            AND held.locktype='relation' AND held.relation='public.mv_populated'::regclass)""") == 't'
                        if waiting:
                            break
                        time.sleep(0.02)
                    self.assertTrue(waiting, 'refresh must wait specifically on the materialized relation')
                    _output, errors = process.communicate(timeout=5)
                    self.assertNotEqual(process.returncode, 0)
                    self.assertIn('lock timeout', errors)
                finally:
                    if process.poll() is None:
                        process.kill()
                        process.communicate(timeout=5)
        self.assertEqual(before['tableRows'], self.snapshot()['tableRows'])
        self.assertEqual(before['permanentMetadataSha256'], self.snapshot()['permanentMetadataSha256'])

    def test_pinned_rewriter_changes_only_two_bodies_after_materialized_locks_and_postguard(self):
        before = self.snapshot()
        source = INSTALLER._source(None)
        after = copy.deepcopy(before)
        after['functions'] = INSTALLER._after(before, source)
        settings = ''
        for signature, (anchor, replacement) in zip(INSTALLER.SIGNATURES, INSTALLER._patches(source)):
            name = 'claim_due' if signature == INSTALLER.SIGNATURES[0] else 'claim_reconciliation'
            settings += f"SET LOCAL prefunded_card.claim_boundary_{name}_sha256='" + INSTALLER._sha(
                before['functions'][signature]['body'].replace(replacement, anchor)) + "';"
        settings += f"SET LOCAL prefunded_card.claim_boundary_database='{self.database}';"
        settings += f"SET LOCAL prefunded_card.claim_boundary_system='{before['identity']['systemIdentifier']}';"
        for ending in ('ROLLBACK', 'COMMIT'):
            self.sql(self.locks_sql(before) + settings + source
                + 'UPDATE pg_temp.cb_expected SET evidence=' + INSTALLER._literal(INSTALLER._json(after))
                + '::jsonb; DROP TABLE pg_temp.cb_snapshot;' + self.snapshot_guard_sql() + ending + ';')
            observed = self.snapshot()
            self.assertEqual(observed['tableRows'], before['tableRows'])
            self.assertEqual(observed['permanentMetadataSha256'], before['permanentMetadataSha256'])
            self.assertEqual(observed['functions'], before['functions'] if ending == 'ROLLBACK' else after['functions'])


if __name__ == '__main__':
    unittest.main()
