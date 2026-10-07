BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
SET LOCAL idle_in_transaction_session_timeout='60s';
SET LOCAL synchronous_commit=on;
SET LOCAL ROLE postgres;
SELECT pg_advisory_xact_lock(1790841600);
DO $$ BEGIN
  IF current_database()<>'postgres' OR session_user<>'supabase_admin'
    OR (SELECT system_identifier::text FROM pg_control_system())<>'7685292944002592802'
    OR clock_timestamp()>='2026-10-06T15:56:10Z'::timestamptz
    OR to_regclass('piggyvest_savings_ledger.interest_policies') IS NOT NULL
    OR to_regprocedure('public.get_customer_savings_earnings(uuid,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'interest policy installation identity refused';
  END IF;
END $$;
LOCK TABLE pg_catalog.pg_proc IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE pg_catalog.pg_auth_members,pg_catalog.pg_authid IN SHARE MODE;
LOCK TABLE piggyvest_staging.integrations,piggyvest_savings_ledger.bindings,
  piggyvest_savings_ledger.operations,piggyvest_savings_ledger.postings,
  piggyvest_savings_ledger.interest_allocations,piggyvest_savings_ledger.interest_receipts,
  prefunded_card.treasury_bindings,prefunded_card.checkout_intents,prefunded_card.operations,
  public.customers,public.customer_savings_goals,savings_notifications.events IN SHARE MODE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM piggyvest_staging.integrations WHERE
    id='d91d9e87-8e0d-44de-9b84-1e1d709633d2'
    AND expected_provider_account_id='01M2381RG34HQJMHQKE7DWDACR' AND enabled)
    OR (SELECT count(*) FROM piggyvest_savings_ledger.bindings)<>1
    OR NOT EXISTS (SELECT 1 FROM piggyvest_savings_ledger.bindings WHERE
      integration_id='d91d9e87-8e0d-44de-9b84-1e1d709633d2'
      AND merchant_id='10000000-0000-4000-8000-000000000001'
      AND customer_id='10000000-0000-4000-8000-000000000002'
      AND goal_id='430314fd-cd8b-4579-98d4-e9f345713dd6'
      AND authorized_login='prefunded_treasury_operator' AND enabled)
    OR NOT EXISTS (SELECT 1 FROM public.customer_savings_goals WHERE
      id='430314fd-cd8b-4579-98d4-e9f345713dd6' AND status='active' AND current_amount=100
      AND merchant_id='10000000-0000-4000-8000-000000000001'
      AND customer_id='10000000-0000-4000-8000-000000000002')
    OR NOT EXISTS (SELECT 1 FROM prefunded_card.treasury_bindings WHERE
      id='ffffcb16-2e95-5cff-a591-e9cc81cf5f57' AND enabled
      AND verified_available_kobo=10000 AND reserved_kobo=0 AND consumed_kobo=0)
    OR NOT EXISTS (SELECT 1 FROM prefunded_card.checkout_intents WHERE
      id='d8bcf921-61b3-4647-90e2-5648e4d6967d' AND phase='retired_unconfirmed')
    OR NOT EXISTS (SELECT 1 FROM prefunded_card.operations WHERE
      id='d8bcf921-61b3-4647-90e2-5648e4d6967d' AND checkout_retired
      AND collection_status='pending' AND transfer_status='not_started' AND projection_status='unapplied')
    OR (SELECT count(*) FROM piggyvest_savings_ledger.interest_allocations)<>0
    OR (SELECT count(*) FROM piggyvest_savings_ledger.interest_receipts)<>0
    OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE
      oid='piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)'::regprocedure
      AND md5(prosrc)='dcbae2bf1f7ac02f1292b2a1e417efc0' AND pg_get_userbyid(proowner)='postgres'
      AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog'])
    OR has_function_privilege('prefunded_treasury_operator',
      'piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)','EXECUTE') THEN
    RAISE EXCEPTION 'interest policy protected state refused';
  END IF;
END $$;
CREATE FUNCTION pg_temp.interest_policy_protected_state() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'bindings',(SELECT jsonb_agg(to_jsonb(binding) ORDER BY goal_id) FROM piggyvest_savings_ledger.bindings binding),
    'operations',(SELECT jsonb_agg(to_jsonb(operation) ORDER BY id) FROM piggyvest_savings_ledger.operations operation),
    'postings',(SELECT jsonb_agg(to_jsonb(posting) ORDER BY operation_id,account) FROM piggyvest_savings_ledger.postings posting),
    'allocations',(SELECT jsonb_agg(to_jsonb(allocation) ORDER BY id) FROM piggyvest_savings_ledger.interest_allocations allocation),
    'receipts',(SELECT jsonb_agg(to_jsonb(receipt) ORDER BY allocation_id) FROM piggyvest_savings_ledger.interest_receipts receipt),
    'notifications',(SELECT jsonb_agg(to_jsonb(event) ORDER BY id) FROM savings_notifications.events event),
    'registry',(SELECT jsonb_agg(to_jsonb(registry) ORDER BY id) FROM piggyvest_staging.integrations registry),
    'customers',(SELECT jsonb_agg(to_jsonb(customer) ORDER BY id) FROM public.customers customer),
    'plans',(SELECT jsonb_agg(to_jsonb(goal) ORDER BY id) FROM public.customer_savings_goals goal),
    'treasury',(SELECT jsonb_agg(to_jsonb(treasury) ORDER BY id) FROM prefunded_card.treasury_bindings treasury),
    'intents',(SELECT jsonb_agg(to_jsonb(intent) ORDER BY id) FROM prefunded_card.checkout_intents intent),
    'payments',(SELECT jsonb_agg(to_jsonb(payment) ORDER BY id) FROM prefunded_card.operations payment),
    'roles',(SELECT jsonb_agg(to_jsonb(role) ORDER BY oid) FROM pg_roles role),
    'memberships',(SELECT jsonb_agg(to_jsonb(membership) ORDER BY roleid,member,grantor) FROM pg_auth_members membership),
    'routines',(SELECT jsonb_agg(to_jsonb(routine) ORDER BY routine.oid)
      FROM pg_proc routine JOIN pg_namespace namespace ON namespace.oid=routine.pronamespace
      WHERE namespace.nspname IN ('public','piggyvest_savings_ledger','savings_notifications')
      AND NOT (namespace.nspname='piggyvest_savings_ledger'
        AND routine.proname IN ('apply_interest_receipt','guard_interest_policy','prepare_interest_allocation'))
      AND NOT (namespace.nspname='public' AND routine.proname='get_customer_savings_earnings' AND routine.pronargs=2))
  );
$$;
CREATE TEMP TABLE policy_before ON COMMIT DROP AS SELECT pg_temp.interest_policy_protected_state() AS value;
__MIGRATION__
DO $$ BEGIN
  IF (SELECT value FROM policy_before) IS DISTINCT FROM pg_temp.interest_policy_protected_state()
    OR (SELECT count(*) FROM piggyvest_savings_ledger.interest_policies)<>0
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='piggyvest_savings_ledger.interest_policies'::regclass)
    OR has_function_privilege('prefunded_treasury_operator',
      'piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)','EXECUTE') THEN
    RAISE EXCEPTION 'interest policy postcondition refused';
  END IF;
  IF EXISTS (SELECT 1 FROM (VALUES __FUNCTION_PINS__) expected(signature,body_md5,definer)
    JOIN pg_proc routine ON routine.oid=expected.signature::regprocedure
    WHERE md5(routine.prosrc)<>expected.body_md5 OR pg_get_userbyid(routine.proowner)<>'postgres'
      OR routine.prosecdef IS DISTINCT FROM expected.definer
      OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']) THEN
    RAISE EXCEPTION 'interest policy function pin refused';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class relation,
    LATERAL aclexplode(coalesce(relation.relacl,acldefault('r',relation.relowner))) permission
    WHERE relation.oid='piggyvest_savings_ledger.interest_policies'::regclass
      AND permission.grantee<>relation.relowner)
    OR EXISTS (SELECT 1 FROM pg_proc routine,
      LATERAL aclexplode(coalesce(routine.proacl,acldefault('f',routine.proowner))) permission
      WHERE routine.oid IN (
        'piggyvest_savings_ledger.prepare_interest_allocation(uuid,text,jsonb)'::regprocedure,
        'piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)'::regprocedure,
        'piggyvest_savings_ledger.guard_interest_policy()'::regprocedure)
        AND permission.grantee<>routine.proowner)
    OR NOT has_function_privilege('authenticated','public.get_customer_savings_earnings(uuid,boolean)','EXECUTE')
    OR has_function_privilege('anon','public.get_customer_savings_earnings(uuid,boolean)','EXECUTE')
    OR has_function_privilege('service_role','public.get_customer_savings_earnings(uuid,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'interest policy access refused';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles login,pg_class relation
    WHERE relation.oid='piggyvest_savings_ledger.interest_policies'::regclass
      AND (login.rolname IN ('anon','authenticated','service_role')
        OR login.rolname ~ '^(prefunded_|pvb_staging_|piggyvest_staging_|baci_savings_)')
      AND (pg_has_role(login.oid,relation.relowner,'MEMBER')
        OR has_table_privilege(login.oid,relation.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')))
    OR EXISTS (SELECT 1 FROM pg_roles login,pg_proc routine
      WHERE routine.oid IN (
        'piggyvest_savings_ledger.prepare_interest_allocation(uuid,text,jsonb)'::regprocedure,
        'piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)'::regprocedure)
      AND (login.rolname IN ('anon','authenticated','service_role')
        OR login.rolname ~ '^(prefunded_|pvb_staging_|piggyvest_staging_|baci_savings_)')
      AND (pg_has_role(login.oid,routine.proowner,'MEMBER')
        OR has_function_privilege(login.oid,routine.oid,'EXECUTE'))) THEN
    RAISE EXCEPTION 'interest policy inherited access refused';
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
__FINISH__
