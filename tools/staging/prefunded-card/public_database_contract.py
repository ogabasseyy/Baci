from runtime_activation_sql import FUNCTIONS
from runtime_owner_support import probe
from treasury_owner_contract import BUSINESS, DEADLINE, DEADLINE_EPOCH, INTEGRATION, MERCHANT, SOURCE, SYSTEM, TREASURY, Refused


def verify_database():
    functions = []
    for signature, oid, _, desired, role in FUNCTIONS:
        acl = "ARRAY['postgres=X/postgres'" + (f",'{role}=X/postgres'" if role else '') + ']::text[]'
        functions.append(f"('{signature}',{oid}::oid,'{desired}',{acl})")
    result = probe(f"""SELECT json_build_object(
      'functions', NOT EXISTS(SELECT 1 FROM (VALUES {','.join(functions)}) expected(signature,oid,digest,acl)
        LEFT JOIN pg_proc routine ON routine.oid=to_regprocedure(expected.signature)
        WHERE routine.oid IS DISTINCT FROM expected.oid
          OR routine.proowner IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname='postgres')
          OR routine.prosecdef IS DISTINCT FROM true
          OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
          OR ARRAY(SELECT item::text FROM unnest(routine.proacl) item ORDER BY item::text) IS DISTINCT FROM expected.acl
          OR encode(sha256(convert_to(pg_get_functiondef(routine.oid),'UTF8')),'hex') IS DISTINCT FROM expected.digest),
      'roles', (SELECT count(*)=2 AND bool_and(rolcanlogin AND NOT rolsuper AND NOT rolinherit
          AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls
          AND rolconnlimit=-1 AND rolvaliduntil IS NOT DISTINCT FROM '{DEADLINE}'::timestamptz)
          FROM pg_roles WHERE rolname IN ('prefunded_treasury_operator','prefunded_authorizer')),
      'scope', clock_timestamp()<to_timestamp({DEADLINE_EPOCH})
        AND current_database()='postgres' AND (SELECT system_identifier::text FROM pg_control_system())='{SYSTEM}'
        AND NOT EXISTS(SELECT 1 FROM prefunded_card.operations)
        AND NOT EXISTS(SELECT 1 FROM prefunded_card.checkout_intents)
        AND (SELECT count(*) FROM prefunded_card.credit_routes)=1
        AND EXISTS(SELECT 1 FROM prefunded_card.credit_routes route
          JOIN public.customer_savings_goals goal ON goal.id=route.goal_id AND goal.merchant_id=route.merchant_id
            AND goal.customer_id=route.customer_id
          JOIN piggyvest_staging.integrations registry ON registry.id=route.integration_id
          JOIN piggyvest_savings_ledger.bindings binding ON binding.goal_id=route.goal_id
            AND binding.integration_id=route.integration_id AND binding.merchant_id=route.merchant_id
            AND binding.customer_id=route.customer_id
          WHERE route.integration_id='{INTEGRATION}' AND route.merchant_id='{MERCHANT}'
            AND route.customer_id='10000000-0000-4000-8000-000000000002'
            AND route.goal_id='430314fd-cd8b-4579-98d4-e9f345713dd6' AND route.system_identifier='{SYSTEM}'
            AND registry.enabled AND registry.expected_provider_account_id='{BUSINESS}'
            AND binding.enabled AND binding.authorized_login='prefunded_treasury_operator'
            AND goal.goal_kind='legacy' AND goal.source_mode='manual' AND goal.status='active'
            AND goal.current_amount=100.00 AND goal.completed_at IS NULL AND goal.cancelled_at IS NULL AND goal.spent_at IS NULL)
        AND EXISTS(SELECT 1 FROM prefunded_card.treasury_bindings treasury
          JOIN prefunded_card.treasury_identities identity ON identity.treasury_binding_id=treasury.id
            AND identity.integration_id=treasury.integration_id AND identity.merchant_id=treasury.merchant_id
            AND identity.expected_business_id=treasury.expected_business_id AND identity.source_wallet_id=treasury.source_wallet_id
            AND identity.authorized_login=treasury.authorized_login AND identity.opening_available_kobo=10000
          WHERE treasury.id='{TREASURY}' AND treasury.integration_id='{INTEGRATION}' AND treasury.merchant_id='{MERCHANT}'
            AND treasury.expected_business_id='{BUSINESS}' AND treasury.source_wallet_id='{SOURCE}'
            AND treasury.authorized_login='prefunded_treasury_operator' AND treasury.currency='NGN' AND treasury.enabled
            AND treasury.verified_available_kobo=10000 AND treasury.reserved_kobo=0 AND treasury.consumed_kobo=0));""")
    if not isinstance(result, dict) or set(result) != {'functions', 'scope', 'roles'} or any(value is not True for value in result.values()):
        raise Refused('Public database capability baseline refused')
