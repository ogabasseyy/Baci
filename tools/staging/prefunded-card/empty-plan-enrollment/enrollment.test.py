import importlib.util
import json
import os
from datetime import datetime, timezone
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from contract import GOAL, ROOT_SCOPE, digest
from enrollment import CANONICAL, SOURCE_PINS, collect_sql, render, sources


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('contract_tests', HERE / 'contract.test.py')
CONTRACT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONTRACT)
BIN = Path('/opt/homebrew/opt/postgresql@17/bin')


class SourceTests(unittest.TestCase):
    def source_content(self):
        return {name: (CANONICAL / name).read_bytes() for name in SOURCE_PINS}

    def fresh_evidence(self):
        evidence = CONTRACT.evidence_fixture()
        observed = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        evidence['providerWallet']['retrievedAt'] = observed
        evidence['database']['observedAt'] = observed
        return evidence

    def assert_source_map_refused(self, content, code):
        evidence = self.fresh_evidence()
        with self.assertRaisesRegex(ValueError, code):
            collect_sql(source_contents=content)
        with self.assertRaisesRegex(ValueError, code):
            render(evidence, CONTRACT.pins(evidence), source_contents=content)

    def test_missing_sealed_source_refuses_collect_and_render(self):
        content = self.source_content()
        del content['tools/staging/prefunded-card/public_database_contract.py']
        self.assert_source_map_refused(content, 'parent_source_set')

    def test_extra_sealed_source_refuses_collect_and_render(self):
        content = self.source_content()
        content['unexpected.sql'] = b'SELECT 1;'
        self.assert_source_map_refused(content, 'parent_source_set')

    def test_tampering_with_any_pinned_source_refuses_collect_and_render(self):
        for name in SOURCE_PINS:
            with self.subTest(name=name):
                content = self.source_content()
                content[name] += b'\n'
                self.assert_source_map_refused(content, 'parent_source_drift')

    def test_nonbyte_or_invalid_source_map_refuses_collect_and_render(self):
        self.assert_source_map_refused([], 'parent_source_set')
        content = self.source_content()
        name = next(iter(SOURCE_PINS))
        content[name] = content[name].decode()
        self.assert_source_map_refused(content, 'parent_source_content')

    def test_root_staged_content_matches_default_sql_without_local_repository_access(self):
        content = self.source_content()
        evidence = self.fresh_evidence()
        root_repository = Path('/root/parent-sealed-financial')
        with self.assertRaisesRegex(ValueError, 'canonical_repository'):
            collect_sql(repository=root_repository)
        self.assertEqual(collect_sql(source_contents=content, repository=root_repository), collect_sql())
        self.assertEqual(render(evidence, CONTRACT.pins(evidence), source_contents=content,
                                repository=root_repository), render(evidence, CONTRACT.pins(evidence)))
        candidate = render(evidence, CONTRACT.pins(evidence))
        receipt = {'candidateSha256': candidate['candidateSha256'], 'goalId': GOAL,
                   'rolledBack': True, 'protectedStateUnchanged': True, 'routeAbsentAfterRollback': True}
        parameters = {'mode': 'apply', 'rehearsal': receipt, 'rehearsal_pin': digest(receipt)}
        self.assertEqual(render(evidence, CONTRACT.pins(evidence), source_contents=content,
                                repository=root_repository, **parameters),
                         render(evidence, CONTRACT.pins(evidence), **parameters))
        with tempfile.TemporaryDirectory(prefix='baci-enrollment-staged.') as staged:
            for name in ('contract.py','enrollment.py','state.sql','guard.sql'):
                target = Path(staged) / name
                target.write_bytes((HERE / name).read_bytes())
                target.chmod(0o600)
            script = """import json,sys
from enrollment import collect_sql,render
request=json.load(sys.stdin)
content={name:value.encode() for name,value in request['sourceContents'].items()}
print(json.dumps({'collection':collect_sql(source_contents=content),
  'candidate':render(request['evidence'],request['pins'],source_contents=content)}))
"""
            request = {'evidence': evidence, 'pins': CONTRACT.pins(evidence),
                       'sourceContents': {name:raw.decode() for name,raw in content.items()}}
            process = subprocess.run([sys.executable,'-B','-c',script],cwd=staged,
                input=json.dumps(request),text=True,capture_output=True,check=True,timeout=10)
            self.assertEqual(json.loads(process.stdout), {'collection':collect_sql(),
                'candidate':render(evidence,CONTRACT.pins(evidence))})

    def test_parent_source_pins_and_modes(self):
        self.assertEqual(len(sources()), 7)
        evidence = CONTRACT.evidence_fixture()
        result = render(evidence, CONTRACT.pins(evidence), now=CONTRACT.NOW)
        self.assertTrue(result['sql'].endswith('ROLLBACK;\n'))
        self.assertFalse(result['liveProofProduced'])
        self.assertIn('SET CONSTRAINTS ALL IMMEDIATE', result['sql'])
        self.assertNotIn('DISABLE TRIGGER', result['sql'])
        self.assertNotIn('GRANT ', result['sql'])
        self.assertNotIn('ALTER ROLE', result['sql'])
        with self.assertRaisesRegex(ValueError, 'rollback_rehearsal_required'):
            render(evidence, CONTRACT.pins(evidence), mode='apply', now=CONTRACT.NOW)

    def test_apply_requires_independently_pinned_matching_rollback_receipt(self):
        evidence = CONTRACT.evidence_fixture()
        candidate = render(evidence, CONTRACT.pins(evidence), now=CONTRACT.NOW)
        receipt = {'candidateSha256': candidate['candidateSha256'], 'goalId': GOAL,
                   'rolledBack': True, 'protectedStateUnchanged': True, 'routeAbsentAfterRollback': True}
        applied = render(evidence, CONTRACT.pins(evidence), mode='apply', rehearsal=receipt,
                         rehearsal_pin=digest(receipt), now=CONTRACT.NOW)
        self.assertEqual(applied['candidateSha256'], candidate['candidateSha256'])
        self.assertEqual(applied['sql'][:-8], candidate['sql'][:-10])
        evidence['parentCommit']['approvalSha256'] = 'f'*64
        with self.assertRaisesRegex(ValueError, 'rollback_rehearsal_not_verified'):
            render(evidence, CONTRACT.pins(evidence), mode='apply', rehearsal=receipt,
                   rehearsal_pin=digest(receipt), now=CONTRACT.NOW)
        evidence = CONTRACT.evidence_fixture()
        receipt['rolledBack'] = False
        with self.assertRaisesRegex(ValueError, 'rollback_rehearsal_not_verified'):
            render(evidence, CONTRACT.pins(evidence), mode='apply', rehearsal=receipt,
                   rehearsal_pin=digest(receipt), now=CONTRACT.NOW)


@unittest.skipUnless((BIN / 'initdb').is_file(), 'existing PostgreSQL 17 required; no install')
class EnrollmentPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='baci-enrollment-test.')
        cls.root = Path(cls.temporary.name)
        cls.environment = {key:value for key,value in os.environ.items() if not key.startswith('PG')}
        try:
            cls.command([BIN/'initdb','-D',cls.root/'data','-A','trust','-U','postgres','--no-locale'])
            cls.command([BIN/'pg_ctl','-D',cls.root/'data','-l',cls.root/'server.log','-o',
                f"-k {cls.root} -h '' -p 55489 -c shared_buffers=4MB",'start'])
            cls.system = cls.query('SELECT system_identifier::text FROM pg_control_system()')
            cls.query((HERE / 'fixture.sql').read_text().replace(ROOT_SCOPE['systemIdentifier'], cls.system))
            cls.query('CREATE DATABASE enrollment_fixture TEMPLATE postgres')
            cls.system = cls.query('SELECT system_identifier::text FROM pg_control_system()')
            if cls.system == ROOT_SCOPE['systemIdentifier']:
                raise ValueError('scratch must never be the application cluster')
        except Exception:
            cls.tearDownClass()
            raise

    @classmethod
    def tearDownClass(cls):
        subprocess.run([str(BIN/'pg_ctl'),'-D',str(cls.root/'data'),'-m','immediate','stop'],
                       capture_output=True,timeout=20)
        cls.temporary.cleanup()

    @classmethod
    def command(cls, arguments, **kwargs):
        return subprocess.run([str(value) for value in arguments], env=cls.environment,
                              text=True,capture_output=True,check=True,timeout=40,**kwargs)

    @classmethod
    def query(cls, sql, database='postgres'):
        return cls.command([BIN/'psql','-XqAt','-v','ON_ERROR_STOP=1','-h',cls.root,
                            '-p','55489','-U','postgres','-d',database],input=sql).stdout.strip()

    def setUp(self):
        self.query('ALTER ROLE prefunded_treasury_operator NOSUPERUSER', 'template1')
        self.query('DROP DATABASE postgres WITH (FORCE); CREATE DATABASE postgres TEMPLATE enrollment_fixture;',
                   'template1')

    def scratch_sql(self, sql):
        return sql.replace(ROOT_SCOPE['systemIdentifier'], self.system).replace(
            'clock_timestamp()', "'2026-10-02T12:00:00Z'::timestamptz")

    def evidence(self):
        evidence = CONTRACT.evidence_fixture()
        snapshot = json.loads(self.query(self.scratch_sql(collect_sql())).splitlines()[-1])
        snapshot['systemIdentifier'] = ROOT_SCOPE['systemIdentifier']
        evidence['database'] = snapshot
        evidence['parentCommit']['schemaMd5'] = snapshot['metadata']['schemaMd5']
        return evidence

    def candidate(self, evidence):
        return render(evidence, CONTRACT.pins(evidence), now=CONTRACT.NOW)

    def apply_candidate(self, evidence):
        candidate = self.candidate(evidence)
        self.query(self.scratch_sql(candidate['sql']))
        self.assertEqual(self.route_count(), '0')
        receipt = {'candidateSha256': candidate['candidateSha256'], 'goalId': GOAL,
                   'rolledBack': True, 'protectedStateUnchanged': True, 'routeAbsentAfterRollback': True}
        applied = render(evidence, CONTRACT.pins(evidence), mode='apply', rehearsal=receipt,
                         rehearsal_pin=digest(receipt), now=CONTRACT.NOW)
        return self.query(self.scratch_sql(applied['sql']))

    def route_count(self):
        return self.query(f"SELECT count(*) FROM prefunded_card.credit_routes WHERE goal_id='{GOAL}'")

    def test_real_rollback_apply_and_idempotent_retry_preserve_all_state(self):
        evidence = self.evidence()
        output = self.apply_candidate(evidence)
        self.assertEqual(json.loads(output.splitlines()[-1])['outcome'], 'enrolled')
        self.assertEqual(self.route_count(), '1')
        snapshot = self.evidence()
        self.assertEqual(snapshot['database']['metadata'], evidence['database']['metadata'])
        candidate = self.candidate(evidence)
        receipt = {'candidateSha256':candidate['candidateSha256'],'goalId':GOAL,'rolledBack':True,
                   'protectedStateUnchanged':True,'routeAbsentAfterRollback':True}
        applied = render(evidence, CONTRACT.pins(evidence), mode='apply', rehearsal=receipt,
                         rehearsal_pin=digest(receipt), now=CONTRACT.NOW)
        output = self.query(self.scratch_sql(applied['sql']))
        self.assertEqual(json.loads(output.splitlines()[-1])['outcome'], 'already_enrolled')
        self.assertEqual(self.route_count(), '1')

    def test_nonempty_goal_wrong_alias_policy_and_extra_budget_are_refused(self):
        cases = [f"UPDATE public.customer_savings_goals SET current_amount=1 WHERE id='{GOAL}'",
            f"UPDATE piggyvest_staging.wallet_goal_mappings SET provider_wallet_id='01M3W0YENHMFJ8Z9FS76E3CC6T' WHERE goal_id='{GOAL}'",
            f"INSERT INTO piggyvest_savings_ledger.interest_policies VALUES ('{GOAL}')",
            "INSERT INTO prefunded_card.treasury_replenishments VALUES (1)",
            f"INSERT INTO piggyvest_savings_ledger.operations VALUES ('{GOAL}')",
            "UPDATE prefunded_card.evidence_authorities SET enabled=false",
            "UPDATE public.customer_savings_goals SET current_amount=0 WHERE id='430314fd-cd8b-4579-98d4-e9f345713dd6'"]
        for mutation in cases:
            with self.subTest(mutation=mutation):
                self.setUp()
                evidence = self.evidence()
                self.query(mutation)
                with self.assertRaises(subprocess.CalledProcessError):
                    self.query(self.scratch_sql(self.candidate(evidence)['sql']))
                self.assertEqual(self.route_count(),'0')

    def test_schema_role_and_unrelated_financial_drift_refuse_before_insert(self):
        mutations = ['ALTER ROLE prefunded_treasury_operator SUPERUSER',
            'ALTER TABLE prefunded_card.operations ADD COLUMN unexpected text',
            "INSERT INTO prefunded_card.checkout_intents VALUES ('430314fd-cd8b-4579-98d4-e9f345713dd6')"]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                self.setUp()
                self.query('ALTER ROLE prefunded_treasury_operator NOSUPERUSER')
                evidence = self.evidence()
                self.query(mutation)
                with self.assertRaises(subprocess.CalledProcessError):
                    self.query(self.scratch_sql(self.candidate(evidence)['sql']))
                self.assertEqual(self.route_count(),'0')
        self.query('ALTER ROLE prefunded_treasury_operator NOSUPERUSER')

    def test_late_trigger_mutation_rolls_back_route_and_old_goal(self):
        self.query("""CREATE FUNCTION public.test_bad_route() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN UPDATE public.customer_savings_goals SET status='changed'
            WHERE id='430314fd-cd8b-4579-98d4-e9f345713dd6'; RETURN NEW; END $$;
          CREATE TRIGGER test_bad_route AFTER INSERT ON prefunded_card.credit_routes
            FOR EACH ROW EXECUTE FUNCTION public.test_bad_route();""")
        evidence = self.evidence()
        with self.assertRaises(subprocess.CalledProcessError):
            self.query(self.scratch_sql(self.candidate(evidence)['sql']))
        self.assertEqual(self.route_count(),'0')
        self.assertEqual(self.query("SELECT status FROM public.customer_savings_goals "
          "WHERE id='430314fd-cd8b-4579-98d4-e9f345713dd6'"), 'active')

    def test_conflicting_route_cannot_be_silently_replaced(self):
        evidence = self.evidence()
        self.query(f"INSERT INTO prefunded_card.credit_routes VALUES ('{GOAL}',"
            "'d91d9e87-8e0d-44de-9b84-1e1d709633d2','10000000-0000-4000-8000-000000000001',"
            f"'10000000-0000-4000-8000-000000000002','wrong-system')")
        with self.assertRaises(subprocess.CalledProcessError):
            self.query(self.scratch_sql(self.candidate(evidence)['sql']))
        self.assertEqual(self.query('SELECT system_identifier FROM prefunded_card.credit_routes'), 'wrong-system')


if __name__ == '__main__':
    unittest.main()
