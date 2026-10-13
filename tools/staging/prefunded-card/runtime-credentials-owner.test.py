import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SOURCE = Path(__file__).with_name('runtime-credentials-owner.sql')
BIN = Path('/opt/homebrew/opt/postgresql@18/bin')
ROLES = ('prefunded_treasury_operator', 'prefunded_authorizer', 'prefunded_evidence')
INTEGRATION = 'd91d9e87-8e0d-44de-9b84-1e1d709633d2'
MERCHANT = '10000000-0000-4000-8000-000000000001'
TREASURY = 'ffffcb16-2e95-5cff-a591-e9cc81cf5f57'
BUSINESS = '01M2381RG34HQJMHQKE7DWDACR'
SOURCE_WALLET = '01M238A0V75387H4HZ15YFWGX3'
CUSTOMER = '10000000-0000-4000-8000-000000000002'
GOAL = '430314fd-cd8b-4579-98d4-e9f345713dd6'
EXPIRY = '2026-09-29T15:59:10Z'


class RuntimeCredentialsOwnerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='baci-runtime-credentials.')
        cls.path = Path(cls.directory.name)
        cls.environment = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
        cls.command([BIN / 'initdb', '-D', cls.path / 'data', '-A', 'trust', '-U', 'harness_admin', '--no-locale'])
        cls.command([BIN / 'pg_ctl', '-D', cls.path / 'data', '-l', cls.path / 'log', '-o', f"-k {cls.path} -h '' -p 55468", 'start'])
        cls.sql("""
          CREATE ROLE postgres LOGIN SUPERUSER;
          CREATE SCHEMA piggyvest_staging;
          CREATE SCHEMA piggyvest_savings_ledger;
          CREATE SCHEMA prefunded_card;
          CREATE TABLE piggyvest_staging.integrations(id uuid PRIMARY KEY,expected_provider_account_id text NOT NULL,enabled boolean NOT NULL);
          CREATE TABLE public.customers(id uuid PRIMARY KEY,merchant_id uuid NOT NULL);
          CREATE TABLE public.customer_savings_goals(id uuid PRIMARY KEY,merchant_id uuid NOT NULL,customer_id uuid NOT NULL,goal_kind text NOT NULL,current_amount numeric NOT NULL,status text NOT NULL,completed_at timestamptz,cancelled_at timestamptz,spent_at timestamptz);
          CREATE TABLE piggyvest_staging.wallet_goal_mappings(integration_id uuid NOT NULL,merchant_id uuid NOT NULL,customer_id uuid NOT NULL,goal_id uuid NOT NULL,provider_wallet_id text NOT NULL,provider_customer_id text NOT NULL,UNIQUE(integration_id,merchant_id,customer_id,goal_id));
          CREATE TABLE piggyvest_savings_ledger.bindings(goal_id uuid PRIMARY KEY,integration_id uuid NOT NULL,merchant_id uuid NOT NULL,customer_id uuid NOT NULL,authorized_login name NOT NULL,enabled boolean NOT NULL,UNIQUE(integration_id,merchant_id,customer_id,goal_id));
          CREATE TABLE prefunded_card.treasury_bindings(id uuid PRIMARY KEY,integration_id uuid NOT NULL,merchant_id uuid NOT NULL,expected_business_id text NOT NULL,source_wallet_id text NOT NULL,currency text NOT NULL,verified_available_kobo bigint NOT NULL,reserved_kobo bigint NOT NULL,consumed_kobo bigint NOT NULL,verified_at timestamptz NOT NULL,authorized_login name NOT NULL,enabled boolean NOT NULL);
          CREATE TABLE prefunded_card.treasury_identities(treasury_binding_id uuid PRIMARY KEY,integration_id uuid NOT NULL,merchant_id uuid NOT NULL,expected_business_id text NOT NULL,source_wallet_id text NOT NULL,authorized_login name NOT NULL,opening_available_kobo bigint NOT NULL);
          CREATE TABLE prefunded_card.operations(id uuid PRIMARY KEY);
          CREATE TABLE prefunded_card.checkout_intents(id uuid PRIMARY KEY);
          CREATE TABLE prefunded_card.credit_routes(goal_id uuid PRIMARY KEY);
          CREATE TABLE prefunded_card.private_guard(id integer PRIMARY KEY);
          CREATE ROLE prefunded_treasury_ledger_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
          CREATE ROLE prefunded_card_authorization_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
          CREATE ROLE prefunded_card_authorization_provisioner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
          CREATE ROLE prefunded_treasury_operator NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
          CREATE ROLE prefunded_authorizer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
          CREATE ROLE prefunded_evidence NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
        """)
        cls.system_identifier = cls.sql('SELECT system_identifier::text FROM pg_catalog.pg_control_system()')

    @classmethod
    def tearDownClass(cls):
        cls.command([BIN / 'pg_ctl', '-D', cls.path / 'data', '-m', 'immediate', 'stop'])
        cls.directory.cleanup()

    @classmethod
    def command(cls, arguments, **kwargs):
        try:
            return subprocess.run([str(value) for value in arguments], env=cls.environment, text=True, capture_output=True, check=True, timeout=60, **kwargs)
        except subprocess.CalledProcessError as error:
            raise RuntimeError(error.stderr) from error

    @classmethod
    def sql(cls, statement, user='harness_admin'):
        return cls.command([BIN / 'psql', '-X', '-w', '-At', '-v', 'ON_ERROR_STOP=1', '-h', cls.path, '-p', '55468', '-U', user, '-d', 'postgres', '-c', statement]).stdout.strip()

    def setUp(self):
        self.sql("""
          DROP FUNCTION IF EXISTS prefunded_card.executor_system_identity();
          REVOKE ALL ON SCHEMA prefunded_card FROM prefunded_treasury_operator,prefunded_authorizer,prefunded_evidence;
          REVOKE prefunded_treasury_ledger_worker,prefunded_card_authorization_reader FROM prefunded_treasury_operator;
          REVOKE prefunded_card_authorization_provisioner FROM prefunded_authorizer;
          DROP ROLE IF EXISTS prefunded_treasury_operator,prefunded_authorizer,prefunded_evidence;
          CREATE ROLE prefunded_treasury_operator NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
          CREATE ROLE prefunded_authorizer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
          CREATE ROLE prefunded_evidence NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
          GRANT prefunded_treasury_ledger_worker TO prefunded_treasury_operator;
          GRANT prefunded_card_authorization_reader TO prefunded_treasury_operator;
          GRANT prefunded_card_authorization_provisioner TO prefunded_authorizer;
          TRUNCATE piggyvest_staging.integrations,public.customers,public.customer_savings_goals,piggyvest_staging.wallet_goal_mappings,piggyvest_savings_ledger.bindings,prefunded_card.treasury_identities,prefunded_card.treasury_bindings,prefunded_card.operations,prefunded_card.checkout_intents,prefunded_card.credit_routes;
          INSERT INTO piggyvest_staging.integrations VALUES('%s','%s',true);
          INSERT INTO public.customers VALUES('%s','%s');
          INSERT INTO public.customer_savings_goals VALUES('%s','%s','%s','legacy',100,'active',NULL,NULL,NULL);
          INSERT INTO piggyvest_staging.wallet_goal_mappings VALUES('%s','%s','%s','%s','destination-wallet','destination-customer');
          INSERT INTO piggyvest_savings_ledger.bindings VALUES('%s','%s','%s','%s','prefunded_treasury_operator',true);
          INSERT INTO prefunded_card.treasury_bindings VALUES('%s','%s','%s','%s','%s','NGN',10000,0,0,clock_timestamp(),'prefunded_treasury_operator',true);
          INSERT INTO prefunded_card.treasury_identities VALUES('%s','%s','%s','%s','%s','prefunded_treasury_operator',10000);
          SET SESSION AUTHORIZATION postgres;
          CREATE FUNCTION prefunded_card.executor_system_identity() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT jsonb_build_object('database',current_database(),'login',session_user,'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system())) $$;
          RESET SESSION AUTHORIZATION;
          REVOKE ALL ON FUNCTION prefunded_card.executor_system_identity() FROM PUBLIC;
          GRANT USAGE ON SCHEMA prefunded_card TO prefunded_treasury_operator,prefunded_authorizer,prefunded_evidence;
          GRANT EXECUTE ON FUNCTION prefunded_card.executor_system_identity() TO prefunded_treasury_operator,prefunded_authorizer,prefunded_evidence;
        """ % (INTEGRATION, BUSINESS, CUSTOMER, MERCHANT, GOAL, MERCHANT, CUSTOMER, INTEGRATION, MERCHANT, CUSTOMER, GOAL, GOAL, INTEGRATION, MERCHANT, CUSTOMER, TREASURY, INTEGRATION, MERCHANT, BUSINESS, SOURCE_WALLET, TREASURY, INTEGRATION, MERCHANT, BUSINESS, SOURCE_WALLET))

    def owner_input(self, mode='initial', proof='q' * 64):
        value = {'systemIdentifier': self.system_identifier, 'databaseName': 'postgres', 'integrationId': INTEGRATION, 'merchantId': MERCHANT, 'treasuryBindingId': TREASURY, 'businessId': BUSINESS, 'sourceWalletId': SOURCE_WALLET, 'openingAvailableKobo': 10000, 'expiresAt': EXPIRY, 'mode': mode, 'credentialProof': proof}
        if mode == 'initial':
            value |= {'treasuryPassword': 'a' * 64, 'authorizerPassword': 'b' * 64, 'evidencePassword': 'c' * 64}
        return value

    def render(self, value):
        source = SOURCE.read_text()
        self.assertEqual(source.count('__OWNER_INPUT__'), 1)
        return source.replace('7685292944002592802', self.system_identifier).replace('__OWNER_INPUT__', "'" + json.dumps(value).replace("'", "''") + "'")

    def apply(self, value, source=None):
        return subprocess.run([str(BIN / 'psql'), '-X', '-w', '-v', 'ON_ERROR_STOP=1', '-h', str(self.path), '-p', '55468', '-U', 'postgres', '-d', 'postgres'], input=source or self.render(value), text=True, capture_output=True, timeout=30, env=self.environment)

    def logins(self):
        return self.sql("SELECT string_agg(rolname || ':' || rolcanlogin::text || ':' || coalesce(rolvaliduntil::text,'NULL') || ':' || coalesce(rolpassword,''),E'\\n' ORDER BY rolname) FROM pg_catalog.pg_authid WHERE rolname IN ('prefunded_treasury_operator','prefunded_authorizer','prefunded_evidence')")

    def test_initial_accepts_natural_null_valid_until_and_exact_baseline(self):
        self.assertEqual(self.sql("SELECT count(*) FROM pg_catalog.pg_authid WHERE rolname IN ('prefunded_treasury_operator','prefunded_authorizer','prefunded_evidence') AND rolvaliduntil IS NULL AND rolpassword IS NULL AND NOT rolcanlogin"), '3')
        result = self.apply(self.owner_input())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.sql("SELECT count(*) FROM pg_catalog.pg_authid WHERE rolname IN ('prefunded_treasury_operator','prefunded_authorizer','prefunded_evidence') AND rolcanlogin AND rolvaliduntil='2026-09-29T15:59:10Z'::timestamptz"), '3')
        self.assertEqual(self.sql("SELECT pg_get_userbyid(proowner) FROM pg_catalog.pg_proc WHERE oid='prefunded_card.executor_system_identity()'::regprocedure"), 'postgres')

    def test_null_for_every_required_field_refuses_without_enabling_a_login(self):
        for key in self.owner_input():
            with self.subTest(key=key):
                candidate = self.owner_input()
                candidate[key] = None
                result = self.apply(candidate)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.sql("SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('prefunded_treasury_operator','prefunded_authorizer','prefunded_evidence') AND rolcanlogin"), '0')

    def test_database_preflight_refuses_changed_registry_treasury_or_empty_state(self):
        cases = [
            ("UPDATE piggyvest_staging.integrations SET enabled=false", "UPDATE piggyvest_staging.integrations SET enabled=true"),
            ("UPDATE prefunded_card.treasury_bindings SET reserved_kobo=1", "UPDATE prefunded_card.treasury_bindings SET reserved_kobo=0"),
            ("UPDATE prefunded_card.treasury_identities SET source_wallet_id='foreign'", "UPDATE prefunded_card.treasury_identities SET source_wallet_id='%s'" % SOURCE_WALLET),
            ("UPDATE public.customer_savings_goals SET current_amount=99", "UPDATE public.customer_savings_goals SET current_amount=100"),
            ("INSERT INTO prefunded_card.operations VALUES('00000000-0000-4000-8000-000000000001')", "TRUNCATE prefunded_card.operations"),
            ("INSERT INTO prefunded_card.checkout_intents VALUES('00000000-0000-4000-8000-000000000002')", "TRUNCATE prefunded_card.checkout_intents"),
            ("INSERT INTO prefunded_card.credit_routes VALUES('00000000-0000-4000-8000-000000000003')", "TRUNCATE prefunded_card.credit_routes"),
        ]
        for broken, repaired in cases:
            with self.subTest(broken=broken):
                self.sql(broken)
                try:
                    result = self.apply(self.owner_input())
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual(self.sql("SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('prefunded_treasury_operator','prefunded_authorizer','prefunded_evidence') AND rolcanlogin"), '0')
                finally:
                    self.sql(repaired)

    def test_retry_requires_proof_and_never_adopts_or_rotates_foreign_state(self):
        initial = self.apply(self.owner_input())
        self.assertEqual(initial.returncode, 0, initial.stderr)
        before = self.logins()
        rejected = self.apply(self.owner_input('retry', 'z' * 64))
        self.assertNotEqual(rejected.returncode, 0)
        self.assertEqual(self.logins(), before)
        retried = self.apply(self.owner_input('retry'))
        self.assertEqual(retried.returncode, 0, retried.stderr)
        self.assertEqual(self.logins(), before)

    def test_forced_failure_rolls_back_and_foreign_login_is_not_adopted(self):
        foreign = self.owner_input()
        self.sql("ALTER ROLE prefunded_evidence LOGIN PASSWORD 'foreign' VALID UNTIL '%s'" % EXPIRY)
        before = self.logins()
        self.assertNotEqual(self.apply(foreign).returncode, 0)
        self.assertEqual(self.logins(), before)
        self.sql("ALTER ROLE prefunded_evidence NOLOGIN PASSWORD NULL VALID UNTIL 'infinity'")
        mutation_error = self.render(self.owner_input()).replace("role_name,input->>password_key,input->>'expiresAt'", "'missing_prefunded_role',input->>password_key,input->>'expiresAt'")
        rejected = self.apply(self.owner_input(), mutation_error)
        self.assertNotEqual(rejected.returncode, 0)
        self.assertNotIn('a' * 64, rejected.stdout + rejected.stderr)
        self.assertNotIn('q' * 64, rejected.stdout + rejected.stderr)
        source = self.render(self.owner_input()).replace('\nCOMMIT;', "\nDO $$ BEGIN RAISE EXCEPTION 'rollback rehearsal'; END $$;\nCOMMIT;")
        result = self.apply(self.owner_input(), source)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('a' * 64, result.stdout + result.stderr)
        self.assertNotIn('q' * 64, result.stdout + result.stderr)
        self.assertEqual(self.sql("SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('prefunded_treasury_operator','prefunded_authorizer','prefunded_evidence') AND rolcanlogin"), '0')
        log = (self.path / 'log').read_text()
        self.assertNotIn('a' * 64, log)
        self.assertNotIn('q' * 64, log)


if __name__ == '__main__':
    unittest.main()
