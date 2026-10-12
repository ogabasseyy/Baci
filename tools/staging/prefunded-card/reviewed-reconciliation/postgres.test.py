import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import clone
import contract
from renderer import render_transaction
from test_support import bundle


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(HERE.parent))
SPEC = importlib.util.spec_from_file_location('reviewed_checkout_fixture', ROOT / 'tools/test/prefunded-card-checkout.test.py')
CHECKOUT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECKOUT)


class ReviewedPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        harness = CHECKOUT.CUSTOMER.MODULE.PrefundedProjection
        original_file = harness.file.__func__

        def fixture_file(fixture, filename):
            source = (ROOT / filename).read_text().replace('2026-09-29T15:59:10Z', contract.DEADLINE)
            if str(filename).endswith('projection.scratch-setup.sql'):
                source = source.replace("'legacy', 'manual', 0, 2500, 'active'", "'legacy', 'manual', 100, 2500, 'active'")
            fixture.sql(source)

        harness.file = classmethod(fixture_file)
        try:
            CHECKOUT.PrefundedFirstCardCheckout.setUpClass()
        finally:
            harness.file = classmethod(original_file)
        cls.addClassCleanup(CHECKOUT.PrefundedFirstCardCheckout.tearDownClass)
        cls.db = harness
        cls.fixture = CHECKOUT.PrefundedFirstCardCheckout()
        cls.scope = cls.fixture.scope()
        cls.scope['expiresAt'] = contract.DEADLINE
        original_shell = cls.db.shell.__func__

        def concise_shell(fixture, arguments):
            try:
                return original_shell(fixture, arguments)
            except subprocess.CalledProcessError as error:
                error.cmd = 'disposable PostgreSQL: ' + error.stderr
                raise

        cls.db.shell = classmethod(concise_shell)
        cls.addClassCleanup(setattr, cls.db, 'shell', classmethod(original_shell))
        cls.db.file(HERE.parent / 'evidence-storage.sql')
        cls.db.file(HERE.parent / 'evidence-projection-storage.sql')
        cls.db.file(HERE.parent / 'checkout-retirement-storage.sql')
        from checkout_retirement_patches import definitions
        for signature, _, _, changed, _ in definitions(HERE.parent):
            if signature.split('(')[0] in ('guard_operation', 'guard_first_card_checkout_intent', 'checkout_reserve'):
                cls.db.sql(changed.replace('2026-09-29T15:59:10Z', contract.DEADLINE))
        cls.db.sql((HERE.parent / 'checkout-retirement-apply.sql').read_text())
        cls.db.sql(f"GRANT USAGE ON SCHEMA piggyvest_savings_ledger TO {CHECKOUT.APP}; "
                   f"GRANT EXECUTE ON FUNCTION piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb) TO {CHECKOUT.APP}")
        opening = dict(operationId='77777777-7777-4777-8777-777777777777', kind='credit_principal',
                       principalKobo=10000, interestKobo=0, evidenceId='reviewed-fixture-opening', referenceId=None)
        cls.db.sql(f"SELECT piggyvest_savings_ledger.apply('{cls.scope['integrationId']}','{cls.scope['merchantId']}',"
                   f"'{cls.fixture.module.CUSTOMER}','{cls.fixture.module.GOAL}','{json.dumps(opening)}')", CHECKOUT.APP)
        cls.db.sql(f"REVOKE EXECUTE ON FUNCTION piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb) FROM {CHECKOUT.APP}")
        old = cls.fixture.execute('checkout_reserve', cls.scope, cls.fixture.request())['intent']
        cls.old_intent = old
        selected = {key: old[key] for key in ('intentId', 'customerId', 'actorId', 'goalId')}
        claim = cls.fixture.execute('checkout_claim_initialization', cls.scope, selected, user=CHECKOUT.VERIFIER)
        cls.fixture.execute('checkout_mark_initialization_uncertain', cls.scope, selected, claim, user=CHECKOUT.VERIFIER)
        evidence = dict(providerResult='transaction_not_found', providerHttp=400,
                        verifiedAt=datetime.now(timezone.utc).isoformat(), configurationSha256='a' * 64,
                        operatorApproval='retire-unconfirmed-test-checkout-v1')
        approved = {**cls.scope, **selected, 'amountKobo': 10000, 'reference': old['reference'],
                    'requestFingerprint': old['requestFingerprint'], 'evidence': evidence}
        cls.db.sql("SELECT prefunded_card.retire_unconfirmed_checkout('" + json.dumps(approved) + "'::jsonb)")
        cls.db.sql(f"""
          INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id,goal_kind,source_mode,current_amount,target_amount,status)
            VALUES('{contract.GOAL}','{cls.fixture.module.MERCHANT}','{cls.fixture.module.CUSTOMER}','legacy','manual',0,2500,'active');
          INSERT INTO piggyvest_savings_ledger.bindings VALUES('{contract.GOAL}','{cls.fixture.module.INTEGRATION}',
            '{cls.fixture.module.MERCHANT}','{cls.fixture.module.CUSTOMER}','{CHECKOUT.APP}',true);
          INSERT INTO prefunded_card.credit_routes SELECT '{contract.GOAL}',integration_id,merchant_id,customer_id,system_identifier,created_at
            FROM prefunded_card.credit_routes WHERE goal_id='{cls.fixture.module.GOAL}';
          INSERT INTO piggyvest_staging.wallet_goal_mappings SELECT integration_id,provider_wallet_id||'-new',provider_customer_id,
            merchant_id,customer_id,'{contract.GOAL}' FROM piggyvest_staging.wallet_goal_mappings WHERE goal_id='{cls.fixture.module.GOAL}';
        """)
        request = {**cls.fixture.request('80000000-0000-4000-8000-0000000000fd'), 'goalId': contract.GOAL}
        cls.intent = cls.fixture.execute('checkout_reserve', cls.scope, request)['intent']
        cls.selection = {key: cls.intent[key] for key in ('intentId', 'customerId', 'actorId', 'goalId')}
        claim = cls.fixture.execute('checkout_claim_initialization', cls.scope, cls.selection, user=CHECKOUT.VERIFIER)
        cls.fixture.execute('checkout_mark_initialization_uncertain', cls.scope, cls.selection, claim, user=CHECKOUT.VERIFIER)
        cls.fixture.execute('checkout_flag_reconciliation', cls.scope, cls.selection, user=CHECKOUT.VERIFIER)
        cls.db.sql(f"UPDATE prefunded_card.treasury_bindings SET verified_available_kobo=10000 WHERE id='{CHECKOUT.TREASURY}'")
        cls.db.sql("CREATE ROLE postgres LOGIN SUPERUSER; CREATE ROLE reviewed_foreign; "
                   "ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO reviewed_foreign; "
                   "ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT SELECT ON TABLES TO reviewed_foreign; "
                   "ALTER FUNCTION prefunded_card.checkout_promote_collection(jsonb,jsonb,jsonb) OWNER TO postgres;")
        cls.source = json.loads(cls.db.sql("SELECT to_jsonb(pg_get_functiondef('prefunded_card.checkout_promote_collection(jsonb,jsonb,jsonb)'::regprocedure))"))
        cls.source_hash = contract.sha256(cls.source)

    def query(self, sql):
        return subprocess.run([str(CHECKOUT.CUSTOMER.MODULE.BIN / 'psql'), '-XqAt', '-w', '-v', 'ON_ERROR_STOP=1',
                               '-h', str(self.db.path), '-p', '55461', '-U', 'postgres', '-d', 'postgres'],
                              input=sql, capture_output=True, text=True, env=self.db.environment, timeout=60)

    def local(self, sql):
        return sql.replace('7685292944002592802', self.fixture.system_identifier).replace(
            'ff561046-58e7-428d-9163-f6e60b0dab65', self.intent['intentId']).replace(
            '430314fd-cd8b-4579-98d4-e9f345713dd6', self.fixture.module.GOAL).replace(
            'e078268766bdac768b934ff8428be005c6060c89fbeec1bd55c4a6f1c80b7c7f', self.source_hash)

    def setUp(self):
        for target, replacements in ((contract, dict(SOURCE_SHA256=self.source_hash, SCOPE=self.scope,
                SELECTION=self.selection, INTENT=self.intent['intentId'])), (clone, dict(SOURCE_SHA256=self.source_hash))):
            context = patch.multiple(target, **replacements)
            context.start()
            self.addCleanup(context.stop)

    def approved_bundle(self):
        value = bundle(self.source)
        value['collection']['authorization']['email'] = self.intent['email']
        value['proof']['paidAt'] = (datetime.now(timezone.utc)-timedelta(milliseconds=1)).isoformat().replace('+00:00', 'Z')
        value['proof']['verifiedAt'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        value['proof']['collectionSha256'] = contract.digest(value['collection'])
        state = self.local((HERE / 'state.sql').read_text())
        sql = 'BEGIN; ' + state + self.local((HERE / 'snapshot.sql').read_text()) + 'ROLLBACK;'
        result = self.query(sql)
        self.assertEqual(result.returncode, 0, result.stderr)
        value['preflight'] = json.loads(result.stdout)
        return value

    def test_01_original_is_noop_and_rehearsal_preserves_every_row_and_permanent_routine(self):
        value = self.approved_bundle()
        original = self.fixture.execute('checkout_promote_collection', self.scope, self.selection,
                                        value['collection'], user=CHECKOUT.VERIFIER)
        self.assertEqual(original['phase'], 'reconciliation_required')
        before = self.approved_bundle()['preflight']
        result = self.query(self.local(render_transaction(value, contract.digest(value))))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('reviewed_postflight_passed', result.stdout)
        self.assertNotIn('AUTH_fixture', result.stdout)
        self.assertEqual(self.approved_bundle()['preflight'], before)
        self.assertEqual(self.db.sql('SELECT count(*) FROM public.customer_saved_payment_methods'), '0')
        inspected = self.local(render_transaction(value, contract.digest(value))).replace(
            'SET SESSION AUTHORIZATION prefunded_authorizer;', """DO $acl_test$ BEGIN
              IF EXISTS(SELECT 1 FROM pg_proc routine CROSS JOIN LATERAL aclexplode(routine.proacl) acl
                WHERE routine.oid='pg_temp.reviewed_promote_collection(jsonb,jsonb,jsonb)'::regprocedure
                  AND acl.grantee NOT IN ((SELECT oid FROM pg_roles WHERE rolname='postgres'),
                    (SELECT oid FROM pg_roles WHERE rolname='prefunded_authorizer')))
                OR has_table_privilege('prefunded_authorizer','pg_temp.reviewed_approval','SELECT')
                OR has_table_privilege('reviewed_foreign','pg_temp.reviewed_approval','SELECT') THEN
                RAISE EXCEPTION 'temporary ACL leak'; END IF;
            END $acl_test$; SET SESSION AUTHORIZATION prefunded_authorizer;""", 1)
        inspected_result = self.query(inspected)
        self.assertEqual(inspected_result.returncode, 0, inspected_result.stderr)

    def test_02_wrong_digest_scope_goal_amount_expiry_retirement_and_lease_refuse(self):
        value = self.approved_bundle()
        rendered = self.local(render_transaction(value, contract.digest(value)))
        checks = [rendered.replace(value['preflight']['intentSha256'], 'f' * 64),
                  rendered.replace(value['preflight']['operationSha256'], 'f' * 64),
                  rendered.replace(self.source_hash, 'f' * 64),
                  rendered.replace(value['proof']['verifiedAt'], '2026-01-01T00:00:00Z'),
                  rendered.replace(contract.GOAL, self.fixture.module.GOAL)]
        for field, key, replacement in (('scope', 'businessId', 'foreign'), ('collection', 'amountKobo', 9999)):
            changed = copy.deepcopy(value)
            changed[field][key] = replacement
            with self.assertRaises(ValueError):
                render_transaction(changed, contract.digest(changed))
        for lease in ("UPDATE prefunded_card.operations SET verification_lease_expires_at=clock_timestamp()+interval '1 minute'",
                      "UPDATE prefunded_card.dispatch_queue SET lease_expires_at=clock_timestamp()+interval '1 minute'"):
            checks.append(rendered.replace('SELECT pg_temp.reviewed_preflight();', lease + '; SELECT pg_temp.reviewed_preflight();', 1))
        prefix, suffix = rendered.split('SET SESSION AUTHORIZATION prefunded_authorizer;', 1)
        for before, after in ((self.intent['intentId'], self.old_intent['intentId']),
                              (self.scope['businessId'], 'foreign-business'),
                              ('"amountKobo": 10000', '"amountKobo": 9999')):
            checks.append(prefix + 'SET SESSION AUTHORIZATION prefunded_authorizer;' + suffix.replace(before, after))
        checks.append(rendered.replace('SET SESSION AUTHORIZATION prefunded_authorizer;',
                                       'SET SESSION AUTHORIZATION prefunded_treasury_operator;', 1))
        checks.append(rendered.replace('RESET SESSION AUTHORIZATION;',
            "RESET SESSION AUTHORIZATION; UPDATE public.customers SET email='changed@example.test';", 1))
        checks.append(render_transaction(value, contract.digest(value)))
        for sql in checks:
            with self.subTest(refusal=checks.index(sql)):
                result = self.query(sql)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.approved_bundle()['preflight'], value['preflight'])

    def test_99_commit_once_replay_refuses_and_original_and_principal_stay_unchanged(self):
        value = self.approved_bundle()
        reviewed = contract.digest(value)
        rollback = render_transaction(value, reviewed)
        rehearsed = self.query(self.local(rollback))
        self.assertEqual(rehearsed.returncode, 0, rehearsed.stderr)
        receipt = dict(manifestSha256=reviewed, rollbackSqlSha256=contract.sha256(rollback),
                       preflightSha256=contract.digest(value['preflight']), rolledBack=True,
                       postflightPassed=True, independentlyReviewed=True,
                       reviewedAt=datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'))
        applied = self.local(render_transaction(value, reviewed, mode='apply', receipt=receipt,
                             reviewed_receipt_sha256=contract.digest(receipt)))
        result = self.query(applied)
        self.assertEqual(result.returncode, 0, result.stderr)
        after = self.approved_bundle()['preflight']
        self.assertEqual(after['protectedRowsSha256'], value['preflight']['protectedRowsSha256'])
        self.assertEqual(after['permanentMetadataSha256'], value['preflight']['permanentMetadataSha256'])
        self.assertNotEqual(self.query(applied).returncode, 0)
        self.assertEqual(self.db.sql('SELECT count(*) FROM public.customer_saved_payment_methods'), '1')
        self.assertEqual(self.db.sql('SELECT count(*) FROM prefunded_card.authorization_bindings'), '1')
        self.assertEqual(self.approved_bundle()['preflight'], after)

    def test_03_expired_verification_claim_is_preserved_without_allowing_active_claims(self):
        before = self.db.sql(f"SELECT jsonb_build_object('token',verification_token,'expiry',verification_lease_expires_at,'fence',verification_fence) FROM prefunded_card.operations WHERE id='{self.intent['intentId']}'")
        self.db.sql(f"UPDATE prefunded_card.operations SET verification_token='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',verification_lease_expires_at=clock_timestamp()-interval '1 minute',verification_fence=verification_fence+1 WHERE id='{self.intent['intentId']}'")
        try:
            value = self.approved_bundle()
            result = self.query(self.local(render_transaction(value, contract.digest(value))))
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(self.approved_bundle()['preflight'], value['preflight'])
            for clause in ("verification_lease_expires_at=clock_timestamp()+interval '1 minute'", 'verification_token=NULL'):
                changed = self.local(render_transaction(value, contract.digest(value))).replace('SELECT pg_temp.reviewed_preflight();', f"UPDATE prefunded_card.operations SET {clause} WHERE id='{self.intent['intentId']}'; SELECT pg_temp.reviewed_preflight();", 1)
                self.assertNotEqual(self.query(changed).returncode, 0)
                self.assertEqual(self.approved_bundle()['preflight'], value['preflight'])
        finally:
            restored = json.loads(before)
            self.db.sql(f"UPDATE prefunded_card.operations SET verification_token=NULL,verification_lease_expires_at=NULL,verification_fence={restored['fence']} WHERE id='{self.intent['intentId']}'")


if __name__ == '__main__':
    unittest.main()
