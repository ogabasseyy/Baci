import os
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
BIN = Path('/opt/homebrew/opt/postgresql@18/bin')
CUSTOMER_SPEC = importlib.util.spec_from_file_location(
    'prefunded_card_customer_harness',
    Path(__file__).with_name('prefunded-card-customer.test.py'),
)
if CUSTOMER_SPEC is None or CUSTOMER_SPEC.loader is None:
    raise RuntimeError('prefunded customer harness unavailable')
CUSTOMER_MODULE = importlib.util.module_from_spec(CUSTOMER_SPEC)
CUSTOMER_SPEC.loader.exec_module(CUSTOMER_MODULE)
LOGIN_ROLES = [
    'prefunded_treasury_operator',
    'prefunded_authorizer',
    'prefunded_evidence',
]
FUNCTIONS = [
    'customer_capabilities(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)',
    'customer_request(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)',
    'customer_status(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)',
    'claim_due(uuid,text,text,integer,uuid,uuid)',
    'finish_dispatch(uuid,uuid,text)',
    'read_operation(uuid,text)',
    'project(uuid,text)',
    'reserve(jsonb)',
    'claim_collection(uuid,bigint)',
    'record_collection(uuid,bigint,text,jsonb)',
    'claim_transfer(uuid,bigint)',
    'record_transfer(uuid,bigint,text,jsonb)',
    'claim_reconciliation(uuid,integer)',
    'complete_reconciliation(uuid,uuid,bigint,text,text,jsonb)',
    'read_authorization(uuid,uuid,uuid,uuid,uuid,text)',
    'read_transfer_evidence(uuid,text)',
    'classify_provider_inflow(uuid,text,text)',
    'apply_classified_inflow(uuid,text,text)',
    'authorization_candidate(uuid,uuid,uuid,uuid,uuid,uuid,text)',
    'provision_authorization(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb)',
    'evidence_scope(uuid,text)',
    'record_provider_evidence(uuid,text,jsonb)',
    'evidence_destination_mapping(uuid,text,text)',
    'read_reversal_context(uuid,text)',
    'record_collection_reversal(text,jsonb)',
]


class PrefundedCardPostgresExecutor(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='baci-prefunded-card-executor.')
        cls.path = Path(cls.directory.name)
        cls.environment = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
        cls.shell([BIN / 'initdb', '-D', cls.path / 'data', '-A', 'trust', '-U', 'harness_admin', '--no-locale'])
        cls.shell([BIN / 'pg_ctl', '-D', cls.path / 'data', '-l', cls.path / 'log', '-o', f"-k {cls.path} -h '' -p 55463", 'start'])
        cls.sql('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE pvb_staging_app_worker; CREATE ROLE prefunded_treasury_operator LOGIN NOINHERIT; CREATE SCHEMA prefunded_card;')
        for signature in FUNCTIONS:
            cls.sql(f'CREATE FUNCTION prefunded_card.{signature} RETURNS jsonb LANGUAGE sql AS $$ SELECT \'{{}}\'::jsonb $$;')
        cls.sql("GRANT EXECUTE ON FUNCTION prefunded_card.project(uuid,text) TO prefunded_treasury_operator;")
        cls.file('tools/staging/prefunded-card/replay-enrollment.sql')
        cls.file('tools/staging/prefunded-card/executor-roles.sql')
        cls.file('tools/staging/prefunded-card/executor-identity.sql')

    @classmethod
    def tearDownClass(cls):
        cls.shell([BIN / 'pg_ctl', '-D', cls.path / 'data', '-m', 'immediate', 'stop'])
        cls.directory.cleanup()

    @classmethod
    def shell(cls, arguments):
        return subprocess.run([str(value) for value in arguments], env=cls.environment, text=True, capture_output=True, check=True, timeout=60)

    @classmethod
    def sql(cls, query, user='harness_admin'):
        return cls.shell([BIN / 'psql', '-X', '-w', '-At', '-v', 'ON_ERROR_STOP=1', '-h', cls.path, '-p', '55463', '-U', user, '-d', 'postgres', '-c', query]).stdout.strip()

    @classmethod
    def file(cls, filename):
        cls.shell([BIN / 'psql', '-X', '-w', '-v', 'ON_ERROR_STOP=1', '-h', cls.path, '-p', '55463', '-U', 'harness_admin', '-d', 'postgres', '-f', ROOT / filename])

    def test_profiles_have_only_their_expected_memberships_and_no_inheritance(self):
        expected = {
            'prefunded_treasury_operator': 'prefunded_card_authorization_reader,prefunded_treasury_ledger_worker',
            'prefunded_authorizer': 'prefunded_card_authorization_provisioner',
            'prefunded_evidence': '',
        }
        for login, memberships in expected.items():
            self.assertEqual(self.sql(f"SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication OR rolinherit FROM pg_roles WHERE rolname='{login}'"), 'f')
            self.assertEqual(self.sql(f"SELECT coalesce(string_agg(parent.rolname,',' ORDER BY parent.rolname),'') FROM pg_auth_members grant_role JOIN pg_roles member ON member.oid=grant_role.member JOIN pg_roles parent ON parent.oid=grant_role.roleid WHERE member.rolname='{login}' AND NOT grant_role.admin_option"), memberships)

    def test_grants_are_exact_and_identity_rpc_is_read_only(self):
        self.assertEqual(self.sql("SELECT has_function_privilege('prefunded_treasury_operator','prefunded_card.customer_capabilities(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)','EXECUTE')"), 't')
        self.assertEqual(self.sql("SELECT has_function_privilege('prefunded_authorizer','prefunded_card.customer_capabilities(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)','EXECUTE')"), 'f')
        self.assertEqual(self.sql("SELECT has_function_privilege('prefunded_evidence','prefunded_card.customer_capabilities(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)','EXECUTE')"), 'f')
        self.assertEqual(self.sql("SELECT has_function_privilege('prefunded_treasury_operator','prefunded_card.customer_request(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)','EXECUTE')"), 't')
        self.assertEqual(self.sql("SELECT has_function_privilege('prefunded_treasury_operator','prefunded_card.project(uuid,text)','EXECUTE')"), 't')
        self.assertEqual(self.sql("SELECT has_function_privilege('prefunded_treasury_operator','prefunded_card.classify_provider_inflow(uuid,text,text)','EXECUTE')"), 't')
        self.assertEqual(self.sql("SELECT has_function_privilege('prefunded_treasury_operator','prefunded_card.resolve_replay_enrollment(uuid,uuid,uuid,text,text,text,jsonb)','EXECUTE')"), 't')
        self.assertEqual(self.sql("SELECT has_function_privilege('prefunded_evidence','prefunded_card.resolve_replay_enrollment(uuid,uuid,uuid,text,text,text,jsonb)','EXECUTE')"), 'f')
        self.assertEqual(self.sql("SELECT has_function_privilege('prefunded_treasury_operator','prefunded_card.provision_authorization(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb)','EXECUTE')"), 'f')
        self.assertEqual(self.sql("SELECT has_function_privilege('prefunded_treasury_operator','prefunded_card.read_reversal_context(uuid,text)','EXECUTE')"), 't')
        self.assertEqual(self.sql("SELECT has_function_privilege('prefunded_authorizer','prefunded_card.authorization_candidate(uuid,uuid,uuid,uuid,uuid,uuid,text)','EXECUTE')"), 't')
        self.assertEqual(self.sql("SELECT has_function_privilege('prefunded_evidence','prefunded_card.record_provider_evidence(uuid,text,jsonb)','EXECUTE')"), 't')
        identity = self.sql('SELECT prefunded_card.executor_system_identity()->>\'login\'', 'prefunded_treasury_operator')
        self.assertEqual(identity, 'prefunded_treasury_operator')
        self.assertEqual(self.sql("SELECT has_function_privilege('anon','prefunded_card.executor_system_identity()','EXECUTE')"), 'f')
        self.assertEqual(self.sql("SELECT prosrc ~ '(INSERT|UPDATE|DELETE|MERGE)' FROM pg_proc WHERE oid='prefunded_card.executor_system_identity()'::regprocedure"), 'f')


class SharedTreasuryOperatorJourney(unittest.TestCase):
    treasury = '50000000-0000-4000-8000-0000000000aa'

    @classmethod
    def setUpClass(cls):
        cls.module = CUSTOMER_MODULE.MODULE
        cls.harness = cls.module.PrefundedProjection
        cls.harness.setUpClass()
        try:
            cls.harness.file('tools/staging/prefunded-card/customer-authorization-fixture.sql')
            for name in ['authorization-storage.sql', 'authorization-candidate.sql', 'authorization-functions.sql',
                         'customer-consent.sql', 'customer-entry.sql', 'customer-capability.sql', 'dispatch-queue.sql']:
                cls.harness.file(f'tools/staging/prefunded-card/{name}')
            cls.harness.sql(f"""
              ALTER TABLE public.customers ADD COLUMN user_id uuid DEFAULT '{CUSTOMER_MODULE.ACTOR}';
              INSERT INTO piggyvest_savings_ledger.bindings VALUES('{cls.module.GOAL}','{cls.module.INTEGRATION}',
                '{cls.module.MERCHANT}','{cls.module.CUSTOMER}','prefunded_treasury_operator',true);
              INSERT INTO prefunded_card.credit_routes VALUES('{cls.module.GOAL}','{cls.module.INTEGRATION}',
                '{cls.module.MERCHANT}','{cls.module.CUSTOMER}','{cls.harness.system}',now());
              GRANT USAGE ON SCHEMA prefunded_card TO treasury_owner,treasury_verifier;
              GRANT EXECUTE ON FUNCTION prefunded_card.provision_treasury_identity(uuid,uuid,uuid,text,text,name,bigint) TO treasury_owner;
              GRANT EXECUTE ON FUNCTION prefunded_card.record_treasury_snapshot(uuid,text,bigint,timestamptz,bigint) TO treasury_verifier;
            """)
            for signature in [
                'read_transfer_evidence(uuid,text)',
                'classify_provider_inflow(uuid,text,text)',
                'apply_classified_inflow(uuid,text,text)',
                'evidence_scope(uuid,text)',
                'record_provider_evidence(uuid,text,jsonb)',
                'evidence_destination_mapping(uuid,text,text)',
                'read_reversal_context(uuid,text)',
                'record_collection_reversal(text,jsonb)',
            ]:
                if cls.harness.sql(
                    f"SELECT to_regprocedure('prefunded_card.{signature}') IS NOT NULL"
                ) == 'f':
                    cls.harness.sql(
                        f"CREATE FUNCTION prefunded_card.{signature} RETURNS jsonb "
                        "LANGUAGE sql AS $$ SELECT '{}'::jsonb $$"
                    )
            cls.harness.file('tools/staging/prefunded-card/replay-enrollment.sql')
            cls.harness.file('tools/staging/prefunded-card/executor-roles.sql')
            cls.harness.file('tools/staging/prefunded-card/executor-identity.sql')
            cls.harness.sql(
                f"SELECT prefunded_card.provision_treasury_identity('{cls.treasury}',"
                f"'{cls.module.INTEGRATION}','{cls.module.MERCHANT}','business',"
                "'operator-treasury-wallet','prefunded_treasury_operator',50000)",
                'treasury_owner',
            )
            cls.harness.sql(
                f"SELECT prefunded_card.record_treasury_snapshot('{cls.treasury}',"
                "'operator-opening',1,clock_timestamp(),50000)",
                'treasury_verifier',
            )
            cls.harness.sql(
                f"INSERT INTO prefunded_card.authorization_bindings("
                "treasury_binding_id,saved_method_id,integration_id,merchant_id,customer_id,"
                "transaction_id,provider_transaction_id,provider_reference,email,authorization_code,"
                "authorization_signature,paystack_customer_code,domain,reusable,authorized_login,"
                "system_identifier,database_name,provisioned_by) VALUES("
                f"'{cls.treasury}','{cls.module.METHOD}','{cls.module.INTEGRATION}',"
                f"'{cls.module.MERCHANT}','{cls.module.CUSTOMER}',"
                "'60000000-0000-4000-8000-0000000000aa','124','fixture-card-operator',"
                "'fixture@example.test','AUTH_fixture','SIG_fixture','CUS_fixture','test',true,"
                f"'prefunded_treasury_operator','{cls.harness.system}','postgres','harness_admin')"
            )
        except Exception:
            cls.harness.tearDownClass()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.harness.tearDownClass()

    def test_customer_request_and_worker_claim_share_the_pinned_treasury_login(self):
        payload = json.dumps({
            'goalId': self.module.GOAL,
            'savedMethodId': self.module.METHOD,
            'idempotencyKey': '80000000-0000-4000-8000-0000000000aa',
            'amountKobo': 10000,
            'consent': {'version': 'prefunded-card-v1', 'oneTimeCharge': True},
        })
        self.assertEqual(
            self.harness.sql('SELECT session_user', 'prefunded_treasury_operator'),
            'prefunded_treasury_operator',
        )
        self.assertEqual(self.harness.sql(
            "SELECT authorized_login FROM piggyvest_savings_ledger.bindings "
            f"WHERE goal_id='{self.module.GOAL}' AND integration_id='{self.module.INTEGRATION}' "
            f"AND merchant_id='{self.module.MERCHANT}' AND customer_id='{self.module.CUSTOMER}'"
        ), 'prefunded_treasury_operator')
        request = json.loads(self.harness.sql(
            f"SELECT prefunded_card.customer_request('{self.module.INTEGRATION}',"
            f"'{self.module.MERCHANT}','{self.module.CUSTOMER}','{self.module.GOAL}',"
            f"'{CUSTOMER_MODULE.ACTOR}','business','{self.harness.system}','{payload}')",
            'prefunded_treasury_operator',
        ))
        claims = json.loads(self.harness.sql(
            f"SELECT prefunded_card.claim_due('{self.module.INTEGRATION}','business',"
            f"'{self.harness.system}',1,'{self.module.MERCHANT}','{self.treasury}')",
            'prefunded_treasury_operator',
        ))
        self.assertEqual(len(claims), 1)
        self.assertEqual(claims[0]['operationId'], request['operationId'])


class ReplayEnrollmentRouting(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location(
            'replay_enrollment_evidence_fixture',
            ROOT / 'tools/staging/prefunded-card/evidence-local.test.py',
        )
        if spec is None or spec.loader is None:
            raise RuntimeError('prefunded enrollment fixture unavailable')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        cls.fixture = module.ProviderEvidence
        cls.fixture.setUpClass()
        try:
            cls.fixture.database.file('tools/staging/prefunded-card/replay-enrollment.sql')
        except Exception:
            cls.fixture.tearDownClass()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.fixture.tearDownClass()

    def test_routing_uses_immutable_mappings_before_signature_or_evidence_ingestion(self):
        self.fixture.database.file('tools/staging/prefunded-card/replay-enrollment.test.sql')


if __name__ == '__main__':
    unittest.main()
