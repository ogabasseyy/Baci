import importlib.util
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
BIN = Path('/opt/homebrew/opt/postgresql@17/bin')
GENERATION = '1a420a7b-0c17-4312-84dc-d276a32f19f4'
SIGNATURE = 'public.claim_piggyvest_staging_receipts(integer,integer)'


class ClaimFencePostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not (BIN / 'postgres').is_file():
            raise unittest.SkipTest('Disposable PostgreSQL 17 unavailable')
        cls.directory = tempfile.TemporaryDirectory(prefix='claim-fence-', dir='/tmp')
        cls.root = Path(cls.directory.name)
        cls.environment = {key: value for key, value in os.environ.items()
                           if not key.startswith('PG')}
        cls.started = False
        try:
            cls.command([BIN / 'initdb', '-D', cls.root / 'data', '-A', 'trust',
                         '-U', 'postgres', '--no-locale', '--encoding=UTF8'])
            cls.command([BIN / 'pg_ctl', '-D', cls.root / 'data', '-l', cls.root / 'log',
                         '-o', f"-k {cls.root} -h '' -p 55479", '-w', 'start'])
            cls.started = True
        except Exception:
            cls.cleanup_cluster()
            raise

    @classmethod
    def cleanup_cluster(cls):
        try:
            if cls.started:
                cls.command([BIN / 'pg_ctl', '-D', cls.root / 'data', '-m', 'fast',
                             '-w', 'stop'])
        finally:
            cls.directory.cleanup()

    @classmethod
    def tearDownClass(cls):
        cls.cleanup_cluster()

    @classmethod
    def command(cls, arguments, source=None, checked=True):
        result = subprocess.run(list(map(str, arguments)), input=source,
                                env=cls.environment, text=True, capture_output=True,
                                timeout=30)
        if checked and result.returncode:
            raise AssertionError(result.stderr.strip())
        return result

    def sql(self, source, checked=True):
        return self.command([BIN / 'psql', '-XqAt', '-w', '-v', 'ON_ERROR_STOP=1',
                             '-h', self.root, '-p', '55479', '-U', 'postgres',
                             '-d', self.database], source, checked)

    def setUp(self):
        self.database = 'fence_' + self._testMethodName[:55]
        self.command([BIN / 'createdb', '-h', self.root, '-p', '55479',
                      '-U', 'postgres', self.database])
        self.addCleanup(self.command, [BIN / 'dropdb', '-h', self.root, '-p', '55479',
                                      '-U', 'postgres', self.database])

    def fixture(self, guard='', *, after_exhaustion=False):
        source = (HERE / 'fixture.sql').read_text()
        body = (HERE / 'baseline-body.sql').read_text()
        self.assertEqual(hashlib.sha256(body.encode()).hexdigest(),
                         '3e60a019e83ae140dd6d35fc6f378292e8f672d8b2d209fee18b22c8be671cdc')
        self.assertEqual(body.count('\nBEGIN\n'), 1)
        self.assertEqual(source.count('__TEST_BODY__'), 1)
        patched_body = (body.replace('  RETURN QUERY\n', guard + '  RETURN QUERY\n', 1)
                        if after_exhaustion else body.replace('\nBEGIN\n', '\nBEGIN\n' + guard, 1))
        self.sql(source.replace('__TEST_BODY__', patched_body))

    def renderer(self):
        specification = importlib.util.spec_from_file_location('claim_fence_renderer',
                                                               HERE / 'renderer.py')
        module = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(module)
        return module

    def guard(self):
        return self.renderer()._guard()

    def context(self):
        claims = json.dumps(dict(role='pvb_staging_worker', aud='pvb-staging-receipts',
                                 replay_claimant_generation=GENERATION, exp=1791302350))
        return "SELECT set_config('request.jwt.claims','" + claims + "',false);\n"

    def rows(self):
        return self.sql('SELECT jsonb_agg(to_jsonb(receipt) ORDER BY id) '
                        'FROM public.piggyvest_staging_receipts receipt;').stdout.strip()

    def probe(self):
        return self.sql("SELECT jsonb_build_object('last_value',last_value,'is_called',is_called) "
                        'FROM public.claim_fence_mutation_probe;').stdout.strip()

    def definition(self):
        return json.loads(self.sql("SELECT to_json(pg_get_functiondef('" + SIGNATURE
                                   + "'::regprocedure));").stdout)

    def candidate(self, mode='rollback'):
        renderer = self.renderer()
        metadata = json.loads(self.sql("SELECT json_build_object('system',"
            "(SELECT system_identifier::text FROM pg_control_system()),'oid',oid) "
            "FROM pg_proc WHERE oid='" + SIGNATURE + "'::regprocedure;").stdout)
        with patch.multiple(renderer.contract, SYSTEM_IDENTIFIER=metadata['system'],
                            INSTALLER_LOGIN='postgres', ROUTINE_OID=metadata['oid'],
                            OWNER='postgres', ACL=None, DATABASE=self.database):
            return renderer.render_transaction(self.definition(), mode=mode)

    def test_unguarded_baseline_reproduces_pre_mutation_regression(self):
        self.fixture()
        result = self.sql((HERE / 'gate.test.sql').read_text().replace(
            '__GENERATION__', GENERATION), checked=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('unauthorized fixture accepted', result.stderr)
        self.assertTrue(json.loads(self.probe())['is_called'])

    def test_invalid_contexts_refuse_before_exhaustion_or_claim_updates(self):
        self.fixture(self.guard())
        before_rows, before_probe = self.rows(), self.probe()
        self.sql((HERE / 'gate.test.sql').read_text().replace('__GENERATION__', GENERATION))
        self.assertEqual(self.rows(), before_rows)
        self.assertEqual(self.probe(), before_probe)

    def test_unset_context_refuses_without_mutation(self):
        self.fixture(self.guard())
        before_rows, before_probe = self.rows(), self.probe()
        result = self.sql('SELECT * FROM public.claim_piggyvest_staging_receipts(10,300);', checked=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Replay claimant refused', result.stderr)
        self.assertEqual(self.rows(), before_rows)
        self.assertEqual(self.probe(), before_probe)

    def test_exact_claims_preserve_existing_exhaustion_claim_and_replay_behavior(self):
        self.fixture(self.guard())
        before = json.loads(self.rows())
        result = self.sql(self.context() + 'SELECT receipt_id FROM public.claim_piggyvest_staging_receipts(10,300);')
        self.assertEqual(result.stdout.strip().splitlines()[-1], '20000000-0000-4000-8000-000000000002')
        after = json.loads(self.rows())
        self.assertEqual(after[0]['status'], 'dead_letter')
        self.assertEqual(after[0]['attempts'], 10)
        self.assertEqual(after[1]['status'], 'processing')
        self.assertEqual(after[1]['attempts'], 5)
        self.assertIsNotNone(after[1]['claim_token'])
        self.assertEqual(after[2:], before[2:])
        replay = self.sql(self.context() + 'SELECT count(*) FROM public.claim_piggyvest_staging_receipts(10,300);')
        self.assertEqual(replay.stdout.strip().splitlines()[-1], '0')
        self.assertEqual(json.loads(self.rows()), after)

    def test_existing_parameter_guards_remain_before_updates(self):
        self.fixture(self.guard())
        before_rows, before_probe = self.rows(), self.probe()
        for arguments in ('NULL,300', '0,300', '101,300', '1,NULL', '1,29', '1,3601'):
            with self.subTest(arguments=arguments):
                result = self.sql(self.context() + 'SELECT * FROM public.claim_piggyvest_staging_receipts('
                                  + arguments + ');', checked=False)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Invalid claim bounds', result.stderr)
                self.assertEqual(self.rows(), before_rows)
                self.assertEqual(self.probe(), before_probe)

    def test_private_expired_deadline_fixture_refuses_before_updates(self):
        guard = self.guard()
        self.assertEqual(guard.count("'2026-10-06T15:59:10Z'"), 1)
        self.fixture(guard.replace("'2026-10-06T15:59:10Z'", "'2000-01-01T00:00:00Z'"))
        before_rows, before_probe = self.rows(), self.probe()
        result = self.sql(self.context() + 'SELECT * FROM public.claim_piggyvest_staging_receipts(10,300);',
                          checked=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Replay claimant refused', result.stderr)
        self.assertEqual(self.rows(), before_rows)
        self.assertEqual(self.probe(), before_probe)

    def test_fixture_definition_matches_parent_live_definition_pin(self):
        self.fixture()
        self.assertEqual(hashlib.sha256(self.definition().encode()).hexdigest(),
                         '650e050f359e295abc9bcb306f33a05afa3ffa14bc128f4a7b3b93faaaa5b824')

    def test_default_rehearsal_rolls_back_only_function_body_and_preserves_rows(self):
        self.fixture()
        before_definition, before_rows, before_probe = self.definition(), self.rows(), self.probe()
        candidate = self.candidate()
        self.assertTrue(candidate.startswith('BEGIN;\n'))
        self.assertTrue(candidate.endswith('ROLLBACK;\n'))
        self.sql(candidate)
        self.assertEqual(self.definition(), before_definition)
        self.assertEqual(self.rows(), before_rows)
        self.assertEqual(self.probe(), before_probe)

    def test_explicit_commit_preserves_metadata_and_rows_and_fences_old_context(self):
        self.fixture()
        before_metadata = self.sql("SELECT to_jsonb(routine)-'prosrc' FROM pg_proc routine "
                                   "WHERE oid='" + SIGNATURE + "'::regprocedure;").stdout
        before_rows, before_probe = self.rows(), self.probe()
        candidate = self.candidate('commit')
        self.assertTrue(candidate.endswith('COMMIT;\n'))
        self.sql(candidate)
        after_metadata = self.sql("SELECT to_jsonb(routine)-'prosrc' FROM pg_proc routine "
                                  "WHERE oid='" + SIGNATURE + "'::regprocedure;").stdout
        self.assertEqual(after_metadata, before_metadata)
        self.assertEqual(self.rows(), before_rows)
        self.assertEqual(self.probe(), before_probe)
        self.sql((HERE / 'gate.test.sql').read_text().replace('__GENERATION__', GENERATION))
        result = self.sql(self.context() + 'SELECT receipt_id FROM public.claim_piggyvest_staging_receipts(10,300);')
        self.assertEqual(result.stdout.strip().splitlines()[-1], '20000000-0000-4000-8000-000000000002')

    def test_wrong_baseline_hash_refuses_without_mutations(self):
        self.fixture()
        before_definition, before_rows, before_probe = self.definition(), self.rows(), self.probe()
        candidate = self.candidate()
        original_sha = '3e60a019e83ae140dd6d35fc6f378292e8f672d8b2d209fee18b22c8be671cdc'
        self.assertEqual(candidate.count(original_sha), 1)
        result = self.sql(candidate.replace(original_sha, '0' * 64), checked=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Claim fence routine baseline refused', result.stderr)
        self.assertEqual(self.definition(), before_definition)
        self.assertEqual(self.rows(), before_rows)
        self.assertEqual(self.probe(), before_probe)

    def test_sequence_probe_detects_a_gate_incorrectly_placed_after_exhaustion(self):
        self.fixture(self.guard(), after_exhaustion=True)
        before_rows = self.rows()
        result = self.sql((HERE / 'gate.test.sql').read_text().replace(
            '__GENERATION__', GENERATION), checked=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('refusal executed a mutation before raising', result.stderr)
        self.assertEqual(self.rows(), before_rows)
        self.assertTrue(json.loads(self.probe())['is_called'])

    def test_production_scope_refuses_the_disposable_database(self):
        self.fixture()
        before_definition, before_rows, before_probe = self.definition(), self.rows(), self.probe()
        result = self.sql(self.renderer().render_transaction(self.definition()), checked=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Claim fence owner scope refused', result.stderr)
        self.assertEqual(self.definition(), before_definition)
        self.assertEqual(self.rows(), before_rows)
        self.assertEqual(self.probe(), before_probe)

    def test_owner_acl_search_path_and_definer_drift_refuse_before_replacement(self):
        self.fixture()
        before_definition, before_rows, before_probe = self.definition(), self.rows(), self.probe()
        candidate = self.candidate()
        mutations = (
            ("pg_get_userbyid(routine.proowner) = 'postgres'", "pg_get_userbyid(routine.proowner) = 'absent'"),
            ('IS NOT DISTINCT FROM NULL::jsonb', "IS NOT DISTINCT FROM '[]'::jsonb"),
            ('AND routine.prosecdef AND', 'AND NOT routine.prosecdef AND'),
            ("ARRAY['search_path=pg_catalog']", "ARRAY['search_path=pg_temp']"))
        for original, replacement in mutations:
            with self.subTest(original=original):
                self.assertEqual(candidate.count(original), 1)
                result = self.sql(candidate.replace(original, replacement), checked=False)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Claim fence routine baseline refused', result.stderr)
                self.assertEqual(self.definition(), before_definition)
                self.assertEqual(self.rows(), before_rows)
                self.assertEqual(self.probe(), before_probe)

    def test_failed_postflight_rolls_back_replacement_and_preserves_rows(self):
        self.fixture()
        before_definition, before_rows, before_probe = self.definition(), self.rows(), self.probe()
        renderer = self.renderer()
        fenced = before_definition.replace('\nBEGIN\n', '\nBEGIN\n' + renderer._guard(), 1)
        expected = renderer.contract.sha256(fenced)
        candidate = self.candidate('commit')
        self.assertEqual(candidate.count(expected), 1)
        result = self.sql(candidate.replace(expected, '0' * 64), checked=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Claim fence postflight refused', result.stderr)
        self.assertEqual(self.definition(), before_definition)
        self.assertEqual(self.rows(), before_rows)
        self.assertEqual(self.probe(), before_probe)


if __name__ == '__main__':
    unittest.main()
