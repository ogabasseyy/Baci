import hashlib
import re


SOURCE_PINS = {
    'customer-capability.sql': 'd0e740e4b83c88236b5c059af2fcc5ba091f3b6c1c0aed9007a1e94d9e2fc542',
    'checkout-capability.sql': '3a1e61aa4456862e104677e1c30f43d237b6be0e8c855094d163a5b65c0da618',
    'checkout-promotion.sql': '7bc492814c213f7bb35bd74704764f79ecda566b55a3d4d068abaec1cbb8f11a',
}
FUNCTIONS = (
    ('prefunded_card.customer_capabilities(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)', 45645,
     '09f9239ff42336ed6d1e9d9855800114a39f34a77deb118e382c1f3941af9573',
     '135806a79c865e20578bb043e4c2a60ad020c6b462ffb3566c9d83ceeb36bfb4', 'prefunded_treasury_operator'),
    ('prefunded_card.checkout_capability(jsonb,uuid,uuid,uuid,bigint)', 45998,
     '927bc8db1038f4fd3d61d726337f258d5121c72d8f0c3a6b80bdcbb6beb71aa7',
     '7e3978cbb02dfb3600f58f74981c997016a9bd41966cc0c0017036582322262f', 'prefunded_treasury_operator'),
    ('prefunded_card.checkout_validate_collection(prefunded_card.checkout_intents,jsonb)', 45994,
     '1ee3c0b37f6f5928343b17974ab48a2ad5c31c7568c572e552128a0c033a318d',
     '1ee3c0b37f6f5928343b17974ab48a2ad5c31c7568c572e552128a0c033a318d', ''),
    ('prefunded_card.checkout_promote_collection(jsonb,jsonb,jsonb)', 45995,
     'f332abcb56781dc90c6063bd503348dccf6ce23c92e8ab791daaa1b1ebecf381',
     'e078268766bdac768b934ff8428be005c6060c89fbeec1bd55c4a6f1c80b7c7f', 'prefunded_authorizer'),
    ('prefunded_card.checkout_flag_reconciliation(jsonb,jsonb)', 45996,
     '6adc7ab33f27f1ee1956c81b649ba6190d481ba72de48f9bc27abf1f411fa1aa',
     '6adc7ab33f27f1ee1956c81b649ba6190d481ba72de48f9bc27abf1f411fa1aa', 'prefunded_authorizer'),
)
SYSTEM = '7685292944002592802'
DEADLINE_EPOCH = 1790697550


def render_activation(customer_source: str, checkout_source: str, promotion_source: str, *, rehearsal: bool = False) -> str:
    return _render((customer_source, checkout_source, promotion_source), rehearsal, None)


def _render_activation_fixture(customer_source, checkout_source, promotion_source, *, system, rehearsal=False):
    if not isinstance(system, str) or not re.fullmatch(r'[0-9]{1,20}', system) or system == SYSTEM:
        raise ValueError('Activation scratch identity refused')
    return _render((customer_source, checkout_source, promotion_source), rehearsal, system)


def _render(sources, rehearsal, scratch_system):
    if type(rehearsal) is not bool:
        raise ValueError('Activation rehearsal must be boolean')
    for source, digest in zip(sources, SOURCE_PINS.values()):
        if not isinstance(source, str) or hashlib.sha256(source.encode()).hexdigest() != digest:
            raise ValueError('Reviewed activation source checksum differs')
    scratch = scratch_system is not None
    system = scratch_system or SYSTEM
    owner = 'harness_admin' if scratch else 'postgres'
    merchant = '11111111-1111-4111-8111-111111111111' if scratch else '10000000-0000-4000-8000-000000000001'
    customer = '22222222-2222-4222-8222-222222222222' if scratch else '10000000-0000-4000-8000-000000000002'
    goal = '33333333-3333-4333-8333-333333333333' if scratch else '430314fd-cd8b-4579-98d4-e9f345713dd6'
    business = 'business' if scratch else '01M2381RG34HQJMHQKE7DWDACR'
    wallet = 'scratch-private-wallet' if scratch else '01M3CQX27G9687EFSF1TKYMPR9'
    provider_customer = 'scratch-event-customer' if scratch else 'c096507d-dc32-45d2-9c01-871a27abfd10'
    target = ("current_database() NOT LIKE 'piggyvest_legacy_enrollment_scratch%'" if scratch
              else "current_database()<>'postgres'")
    expected = []
    for signature, oid, baseline, desired, reader in FUNCTIONS:
        acl = "ARRAY['postgres=X/postgres'" + (f",'{reader}=X/postgres'" if reader else '') + ']::text[]'
        expected.append(f"('{signature}',{oid}::oid,'{baseline}','{desired}',{acl})")
    values = ',\n'.join(expected)
    metadata = f"""SELECT 1 FROM (VALUES {values}) expected(signature,oid,baseline,desired,acl)
    LEFT JOIN pg_proc routine ON routine.oid=to_regprocedure(expected.signature)
    WHERE routine.oid IS NULL OR ({str(not scratch).lower()} AND routine.oid IS DISTINCT FROM expected.oid)
      OR routine.proowner IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname='postgres')
      OR routine.prosecdef IS DISTINCT FROM true OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
      OR routine.prokind IS DISTINCT FROM 'f' OR routine.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname='plpgsql')
      OR ARRAY(SELECT item::text FROM unnest(routine.proacl) item ORDER BY item::text) IS DISTINCT FROM expected.acl
      OR NOT coalesce(encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(expected.signature)),'UTF8')),'hex')
        IN (expected.baseline,expected.desired),false)"""
    sql = f"""\\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
SET LOCAL search_path=pg_catalog,pg_temp;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL idle_in_transaction_session_timeout='60s';
DO $activation_identity$
BEGIN
  IF current_user IS DISTINCT FROM '{owner}' OR session_user IS DISTINCT FROM '{owner}' OR {target}
    OR inet_client_addr() IS NOT NULL
    OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '{system}'
    OR ({str(scratch).lower()} AND (SELECT system_identifier::text FROM pg_control_system())='{SYSTEM}')
    OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolsuper)
    OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 189999 THEN
    RAISE EXCEPTION 'activation owner scope refused' USING ERRCODE='55000';
  END IF;
  IF clock_timestamp()>=to_timestamp({DEADLINE_EPOCH}) THEN
    RAISE EXCEPTION 'activation lease expired' USING ERRCODE='55000'; END IF;
  IF EXISTS({metadata}) THEN
    RAISE EXCEPTION 'activation function baseline refused' USING ERRCODE='55000'; END IF;
END $activation_identity$;
SELECT pg_advisory_xact_lock(hashtextextended('prefunded-card-legacy-route:{goal}',0));
LOCK TABLE prefunded_card.operations,prefunded_card.checkout_intents,prefunded_card.credit_routes,
  prefunded_card.treasury_bindings,prefunded_card.treasury_identities,piggyvest_staging.integrations,
  public.customers,public.customer_savings_goals,piggyvest_staging.wallet_goal_mappings,
  piggyvest_savings_ledger.bindings,public.customer_savings_contributions,public.piggyvest_inflow_credits,
  piggyvest_staging.goal_inflow_projections,piggyvest_savings_ledger.operations,piggyvest_savings_ledger.postings,
  prefunded_card.bank_projections,prefunded_card.provider_evidence IN SHARE MODE;
DO $activation_scope$
BEGIN
  IF EXISTS(SELECT 1 FROM prefunded_card.operations) OR EXISTS(SELECT 1 FROM prefunded_card.checkout_intents)
    OR (SELECT count(*) FROM prefunded_card.credit_routes)<>1
    OR NOT EXISTS(SELECT 1 FROM prefunded_card.credit_routes route
      JOIN public.customer_savings_goals goal ON goal.id=route.goal_id AND goal.merchant_id=route.merchant_id AND goal.customer_id=route.customer_id
      JOIN public.customers customer ON customer.id=goal.customer_id AND customer.merchant_id=goal.merchant_id
      JOIN piggyvest_savings_ledger.bindings binding ON binding.goal_id=route.goal_id AND binding.integration_id=route.integration_id
        AND binding.merchant_id=route.merchant_id AND binding.customer_id=route.customer_id
      JOIN piggyvest_staging.wallet_goal_mappings mapping ON mapping.goal_id=route.goal_id AND mapping.integration_id=route.integration_id
        AND mapping.merchant_id=route.merchant_id AND mapping.customer_id=route.customer_id
      JOIN piggyvest_staging.integrations registry ON registry.id=route.integration_id
      WHERE route.integration_id='d91d9e87-8e0d-44de-9b84-1e1d709633d2' AND route.goal_id='{goal}'
        AND route.merchant_id='{merchant}' AND route.customer_id='{customer}' AND route.system_identifier='{system}'
        AND registry.enabled AND registry.expected_provider_account_id='{business}'
        AND binding.enabled AND binding.authorized_login='prefunded_treasury_operator'
        AND mapping.provider_wallet_id='{wallet}' AND mapping.provider_customer_id='{provider_customer}'
        AND goal.goal_kind='legacy' AND goal.source_mode='manual' AND goal.status='active' AND goal.current_amount=100.00
        AND goal.completed_at IS NULL AND goal.cancelled_at IS NULL AND goal.spent_at IS NULL)
    OR NOT EXISTS(SELECT 1 FROM prefunded_card.treasury_bindings treasury
      JOIN prefunded_card.treasury_identities identity ON identity.treasury_binding_id=treasury.id
        AND identity.integration_id=treasury.integration_id AND identity.merchant_id=treasury.merchant_id
        AND identity.expected_business_id=treasury.expected_business_id AND identity.source_wallet_id=treasury.source_wallet_id
        AND identity.authorized_login=treasury.authorized_login AND identity.opening_available_kobo=10000
      WHERE treasury.id='ffffcb16-2e95-5cff-a591-e9cc81cf5f57' AND treasury.integration_id='d91d9e87-8e0d-44de-9b84-1e1d709633d2'
        AND treasury.merchant_id='{merchant}' AND treasury.expected_business_id='{business}'
        AND treasury.source_wallet_id='01M238A0V75387H4HZ15YFWGX3' AND treasury.authorized_login='prefunded_treasury_operator'
        AND treasury.currency='NGN' AND treasury.enabled AND treasury.verified_available_kobo=10000
        AND treasury.reserved_kobo=0 AND treasury.consumed_kobo=0)
    OR EXISTS(SELECT 1 FROM piggyvest_staging.wallet_goal_mappings WHERE provider_wallet_id='01M238A0V75387H4HZ15YFWGX3')
    OR (SELECT count(*) FROM public.customer_savings_contributions WHERE goal_id='{goal}')<>1
    OR (SELECT count(*) FROM piggyvest_staging.goal_inflow_projections WHERE goal_id='{goal}')<>1
    OR (SELECT count(*) FROM prefunded_card.bank_projections WHERE goal_id='{goal}')<>1
    OR (SELECT count(*) FROM piggyvest_savings_ledger.operations WHERE goal_id='{goal}')<>1
    OR (SELECT count(*) FROM public.piggyvest_inflow_credits WHERE wallet_id='{wallet}' AND customer_id='{provider_customer}')<>1
    OR (SELECT count(*) FROM piggyvest_staging.goal_inflow_projections legacy
      JOIN public.customer_savings_contributions contribution ON contribution.id=legacy.contribution_id
        AND contribution.goal_id=legacy.goal_id AND contribution.merchant_id=legacy.merchant_id AND contribution.customer_id=legacy.customer_id
      JOIN public.piggyvest_inflow_credits credit ON credit.provider_transaction_id=legacy.provider_transaction_id
      JOIN prefunded_card.bank_projections bank ON bank.contribution_id=contribution.id AND bank.integration_id=legacy.integration_id
        AND bank.goal_id=legacy.goal_id AND bank.merchant_id=legacy.merchant_id AND bank.customer_id=legacy.customer_id
      JOIN piggyvest_savings_ledger.operations operation ON operation.id=bank.operation_id AND operation.integration_id=bank.integration_id
        AND operation.goal_id=bank.goal_id AND operation.merchant_id=bank.merchant_id AND operation.customer_id=bank.customer_id
      JOIN prefunded_card.provider_evidence evidence ON evidence.integration_id=bank.integration_id AND evidence.event_id=bank.event_id
      WHERE legacy.goal_id='{goal}' AND legacy.integration_id='d91d9e87-8e0d-44de-9b84-1e1d709633d2'
        AND legacy.merchant_id='{merchant}' AND legacy.customer_id='{customer}'
        AND legacy.provider_wallet_id='{wallet}' AND legacy.provider_customer_id='{provider_customer}' AND legacy.amount_kobo=10000
        AND contribution.amount=100.00 AND contribution.status='completed' AND contribution.source_type='piggyvest_inflow'
        AND contribution.idempotency_key='piggyvest:'||legacy.provider_transaction_id
        AND credit.wallet_id=legacy.provider_wallet_id AND credit.customer_id=legacy.provider_customer_id
        AND credit.event_id=legacy.event_id AND credit.event_data_id=legacy.event_data_id AND credit.amount_kobo=legacy.amount_kobo
        AND credit.fee_kobo=legacy.fee_kobo AND credit.reference=legacy.reference AND credit.session_id IS NOT DISTINCT FROM legacy.session_id
        AND credit.credited_at=legacy.credited_at AND bank.event_id=legacy.event_id AND bank.amount_kobo=10000
        AND bank.provider_transaction_id=evidence.observation->>'providerTransactionId'
        AND operation.id=md5('legacy-opening-v1:'||legacy.integration_id::text||':'||legacy.provider_transaction_id)::uuid
        AND operation.command->>'kind'='credit_principal' AND operation.command->>'principalKobo'='10000'
        AND operation.command->>'evidenceId'='legacy-opening-v1:'||operation.id::text
        AND evidence.business_id='{business}' AND evidence.ingestion_login='{owner}' AND NOT evidence.conflicted
        AND evidence.observation->>'status'='verified' AND evidence.observation->>'kind'='bank_inflow'
        AND evidence.observation->>'eventId'=legacy.event_id AND evidence.observation->>'eventDataId'=legacy.event_data_id
        AND evidence.observation->>'destinationWalletId'='{wallet}' AND evidence.observation->>'destinationCustomerId'='{provider_customer}'
        AND evidence.observation->>'amountKobo'='10000' AND evidence.observation->>'feeKobo'='0'
        AND evidence.observation->>'reference'=legacy.reference AND evidence.observation->>'sessionId' IS NOT DISTINCT FROM legacy.session_id
        AND (evidence.observation->>'creditedAt')::timestamptz=legacy.credited_at
        AND (SELECT count(*) FROM piggyvest_savings_ledger.postings WHERE operation_id=operation.id)=2
        AND (SELECT amount_kobo FROM piggyvest_savings_ledger.postings WHERE operation_id=operation.id AND account='principal')=10000
        AND (SELECT amount_kobo FROM piggyvest_savings_ledger.postings WHERE operation_id=operation.id AND account='internal_clearing')=-10000)<>1 THEN
    RAISE EXCEPTION 'activation scope refused' USING ERRCODE='55000';
  END IF;
END $activation_scope$;
CREATE TEMP TABLE activation_before ON COMMIT DROP AS
  SELECT expected.signature,expected.desired,routine.oid,routine.proowner,routine.proacl
  FROM (VALUES {values}) expected(signature,oid,baseline,desired,acl)
  JOIN pg_proc routine ON routine.oid=to_regprocedure(expected.signature);
"""
    scope_guard = sql[sql.index('DO $activation_scope$'):sql.index('CREATE TEMP TABLE activation_before')]
    for source in sources:
        delta = source.removeprefix('BEGIN;\n').split('\nREVOKE ALL ON FUNCTION ', 1)[0]
        sql += delta.replace('CREATE FUNCTION ', 'CREATE OR REPLACE FUNCTION ') + '\n'
    sql += scope_guard + f"""DO $activation_postflight$
DECLARE prior record; current_oid oid;
BEGIN
  IF (SELECT count(*) FROM activation_before)<>5 OR EXISTS({metadata}) THEN
    RAISE EXCEPTION 'activation function postflight refused' USING ERRCODE='55000'; END IF;
  FOR prior IN SELECT * FROM activation_before LOOP
    current_oid:=to_regprocedure(prior.signature);
    IF current_oid IS DISTINCT FROM prior.oid
      OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=current_oid AND proowner=prior.proowner AND proacl IS NOT DISTINCT FROM prior.proacl)
      OR encode(sha256(convert_to(pg_get_functiondef(current_oid),'UTF8')),'hex') IS DISTINCT FROM prior.desired THEN
      RAISE EXCEPTION 'activation function postflight refused' USING ERRCODE='55000'; END IF;
  END LOOP;
  IF clock_timestamp()>=to_timestamp({DEADLINE_EPOCH}) THEN
    RAISE EXCEPTION 'activation lease expired' USING ERRCODE='55000'; END IF;
END $activation_postflight$;
"""
    return sql + ('ROLLBACK;\n' if rehearsal else 'COMMIT;\n')
