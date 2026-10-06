import hashlib
import importlib.util
import json
from pathlib import Path
import re
import unittest


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('observer_fixture', HERE / 'observer_fixture.test.py')
FIXTURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FIXTURE)
SOURCE = HERE / 'observer-contract.sql'


class ObserverContractTests(FIXTURE.ObserverFixture):
    def collect(self):
        source = SOURCE.read_text() if SOURCE.is_file() else (
            "BEGIN READ ONLY;SELECT jsonb_build_object('authority',jsonb_build_object('authorized',"
            "has_function_privilege(current_user," + FIXTURE.literal(FIXTURE.WRAPPER)
            + ",'EXECUTE')));ROLLBACK;")
        return json.loads(self.sql(self.copied(source)).stdout)

    def test_installer_owner_authority_never_substitutes_for_observer_execution(self):
        self.sql(f'REVOKE ALL ON FUNCTION {FIXTURE.WRAPPER} FROM {FIXTURE.ROLE};')
        self.assertFalse(self.collect()['authority']['authorized'])

    def test_real_definition_hashes_metadata_and_permissions_are_measured_read_only(self):
        before = self.rows(observations=True)
        original = self.catalog(FIXTURE.ORIGINAL)
        wrapper = self.catalog(FIXTURE.WRAPPER)
        report = self.collect()
        self.assertEqual(report['status'], 'accrual-observer-owner-readonly')
        self.assertEqual(report['appIdentity']['systemIdentifier'], self.system)
        self.assertTrue(report['appIdentity']['readOnly'])
        self.assertTrue(report['authority']['authorized'])
        self.assertTrue(report['authority']['restricted'])
        self.assertFalse(report['observerRole']['canLogin'])
        self.assertTrue(report['observerRole']['noInherit'])
        for name, signature, catalog in (('original', FIXTURE.ORIGINAL, original), ('wrapper', FIXTURE.WRAPPER, wrapper)):
            metadata = report['functions'][name]
            definition = json.loads(self.sql('SELECT to_json(pg_get_functiondef('
                                    + FIXTURE.literal(signature) + '::regprocedure));').stdout)
            self.assertEqual(metadata['definitionSha256'], hashlib.sha256(definition.encode()).hexdigest())
            self.assertEqual(metadata['bodySha256'], catalog['bodySha256'])
            self.assertEqual(metadata['oid'], int(catalog['catalog']['oid']))
            self.assertEqual(metadata['owner'], 'postgres')
            self.assertEqual(metadata['searchPath'], ['search_path=pg_catalog'])
            self.assertEqual(metadata['language'], 'plpgsql')
            self.assertTrue(metadata['securityDefiner'])
            self.assertFalse(metadata['publicExecute'])
            self.assertEqual(metadata['observerExecute'], name == 'wrapper')
        self.assertTrue(report['originalMatchesSource'])
        self.assertEqual(self.catalog(FIXTURE.ORIGINAL), original)
        self.assertEqual(self.catalog(FIXTURE.WRAPPER), wrapper)
        self.assertEqual(self.rows(observations=True), before)
        for forbidden in ('prosrc', 'rolpassword', 'webhookSecret', 'payload', 'signature', 'providerVerified'):
            self.assertNotIn(forbidden, json.dumps(report))

    def test_column_only_financial_write_and_direct_original_execution_are_disallowed(self):
        before = self.rows(observations=True)
        self.sql(f'GRANT UPDATE(current_amount) ON public.customer_savings_goals TO {FIXTURE.ROLE};')
        self.assertFalse(self.collect()['authority']['restricted'])
        self.sql(f'REVOKE UPDATE(current_amount) ON public.customer_savings_goals FROM {FIXTURE.ROLE};')
        self.sql(f'GRANT EXECUTE ON FUNCTION {FIXTURE.ORIGINAL} TO {FIXTURE.ROLE};')
        self.assertFalse(self.collect()['authority']['restricted'])
        self.assertEqual(self.rows(observations=True), before)

    def test_missing_wrapper_and_changed_original_body_are_not_hidden(self):
        self.sql(f'DROP FUNCTION {FIXTURE.WRAPPER};')
        report = self.collect()
        self.assertIsNone(report['functions']['wrapper'])
        self.assertFalse(report['authority']['authorized'])
        definition = json.loads(self.sql('SELECT to_json(pg_get_functiondef('
                                + FIXTURE.literal(FIXTURE.ORIGINAL) + '::regprocedure));').stdout)
        self.sql(definition.replace('interest accrual identity refused', 'synthetic changed original'))
        self.assertFalse(self.collect()['originalMatchesSource'])
        result = self.sql(self.copied(FIXTURE.SOURCE.read_text()), checked=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('accrual_observer_install_refused', result.stderr)

    def test_unmodified_owner_report_refuses_foreign_physical_database(self):
        before = self.rows(observations=True)
        result = self.sql(SOURCE.read_text(), checked=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('accrual_observer_contract_refused', result.stderr)
        self.assertEqual(self.rows(observations=True), before)

    def test_unknown_default_execution_grants_cannot_be_installed_silently(self):
        self.sql(f'DROP FUNCTION {FIXTURE.WRAPPER};')
        self.sql('ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO authenticated;')
        before = self.rows(observations=True)
        result = self.sql(self.copied(FIXTURE.SOURCE.read_text()).rsplit('ROLLBACK;', 1)[0] + 'COMMIT;', checked=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('accrual_observer_preservation_refused', result.stderr)
        self.assertEqual(self.sql('SELECT to_regprocedure(' + FIXTURE.literal(FIXTURE.WRAPPER) + ') IS NULL;').stdout.strip(), 't')
        self.assertEqual(self.catalog(FIXTURE.ORIGINAL), self.original_catalog)
        self.assertEqual(self.rows(observations=True), before)

    def test_unapproved_actor_cannot_inherit_wrapper_execution(self):
        self.sql(f'GRANT EXECUTE ON FUNCTION {FIXTURE.WRAPPER} TO authenticated;')
        self.assertFalse(self.collect()['authority']['authorized'])

    def test_missing_wrapper_does_not_mask_unsafe_original_execution(self):
        self.sql(f'DROP FUNCTION {FIXTURE.WRAPPER};')
        self.sql(f'GRANT EXECUTE ON FUNCTION {FIXTURE.ORIGINAL} TO {FIXTURE.ROLE};')
        self.assertFalse(self.collect()['authority']['restricted'])

    def test_unmodified_canonical_definition_pins_come_from_pg17_not_fixture_substitution(self):
        before = self.rows(observations=True)
        definition = re.search(r'CREATE FUNCTION[\s\S]*?END \$observer_scoped\$;', FIXTURE.SOURCE.read_text()).group()
        self.sql(f'DROP FUNCTION {FIXTURE.WRAPPER};' + definition
                 + f'REVOKE ALL ON FUNCTION {FIXTURE.WRAPPER} FROM PUBLIC;')
        original, wrapper = self.catalog(FIXTURE.ORIGINAL), self.catalog(FIXTURE.WRAPPER)
        canonical = json.loads(self.sql('SELECT to_json(pg_get_functiondef('
                               + FIXTURE.literal(FIXTURE.WRAPPER) + '::regprocedure));').stdout)
        self.assertEqual(wrapper['definitionSha256'], hashlib.sha256(canonical.encode()).hexdigest())
        self.assertEqual(self.catalog(FIXTURE.ORIGINAL), self.original_catalog)
        self.assertEqual(self.rows(observations=True), before)
        print('PG17 canonical definitions, local compilation only: ' + json.dumps({
            'originalDefinitionSha256': original['definitionSha256'],
            'wrapperDefinitionSha256': wrapper['definitionSha256']}), flush=True)


if __name__ == '__main__':
    unittest.main()
