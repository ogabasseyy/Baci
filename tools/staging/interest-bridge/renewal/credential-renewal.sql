BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';
SET LOCAL idle_in_transaction_session_timeout='30s';
SET LOCAL synchronous_commit=on;
SET LOCAL search_path=pg_catalog;
SELECT pg_advisory_xact_lock(1790841600);
DO $$ BEGIN
  IF current_database()<>'postgres' OR session_user<>'postgres' OR inet_client_addr() IS NOT NULL
    OR (SELECT system_identifier::text FROM pg_control_system())<>'7685292944002592802'
    OR clock_timestamp() NOT BETWEEN '2026-09-29T15:59:10Z'::timestamptz
      AND '2026-10-06T15:56:10Z'::timestamptz THEN
    RAISE EXCEPTION 'interest credential identity or renewal window refused' USING ERRCODE='42501';
  END IF;
END $$;
LOCK TABLE pg_catalog.pg_authid IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE pg_catalog.pg_auth_members,pg_catalog.pg_proc IN SHARE MODE;
LOCK TABLE piggyvest_staging.integrations,piggyvest_savings_ledger.bindings,
  piggyvest_savings_ledger.operations,piggyvest_savings_ledger.postings,
  piggyvest_savings_ledger.interest_allocations,piggyvest_savings_ledger.interest_receipts,
  prefunded_card.treasury_bindings,prefunded_card.checkout_intents,prefunded_card.operations,
  public.customer_savings_goals,savings_notifications.events IN SHARE MODE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='prefunded_treasury_operator'
      AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole
      AND NOT rolcreatedb AND NOT rolreplication
      AND rolvaliduntil='2026-09-29T15:59:10Z'::timestamptz)
    OR NOT EXISTS (SELECT 1 FROM piggyvest_staging.integrations WHERE
      id='d91d9e87-8e0d-44de-9b84-1e1d709633d2' AND enabled
      AND expected_provider_account_id='01M2381RG34HQJMHQKE7DWDACR')
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
    RAISE EXCEPTION 'interest credential protected state refused' USING ERRCODE='42501';
  END IF;
END $$;
CREATE FUNCTION pg_temp.credential_protected_state() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'roles',(SELECT jsonb_agg(CASE WHEN rolname='prefunded_treasury_operator'
      THEN to_jsonb(role)-'rolvaliduntil' ELSE to_jsonb(role) END ORDER BY oid) FROM pg_authid role),
    'memberships',(SELECT jsonb_agg(to_jsonb(membership) ORDER BY roleid,member,grantor)
      FROM pg_auth_members membership),
    'functions',(SELECT jsonb_agg(to_jsonb(routine) ORDER BY oid) FROM pg_proc routine),
    'registry',(SELECT jsonb_agg(to_jsonb(registry) ORDER BY id) FROM piggyvest_staging.integrations registry),
    'bindings',(SELECT jsonb_agg(to_jsonb(binding) ORDER BY goal_id) FROM piggyvest_savings_ledger.bindings binding),
    'operations',(SELECT jsonb_agg(to_jsonb(operation) ORDER BY id) FROM piggyvest_savings_ledger.operations operation),
    'postings',(SELECT jsonb_agg(to_jsonb(posting) ORDER BY operation_id,account) FROM piggyvest_savings_ledger.postings posting),
    'interestAllocations',(SELECT jsonb_agg(to_jsonb(allocation) ORDER BY id) FROM piggyvest_savings_ledger.interest_allocations allocation),
    'interestReceipts',(SELECT jsonb_agg(to_jsonb(receipt) ORDER BY allocation_id) FROM piggyvest_savings_ledger.interest_receipts receipt),
    'notifications',(SELECT jsonb_agg(to_jsonb(event) ORDER BY id) FROM savings_notifications.events event),
    'treasury',(SELECT jsonb_agg(to_jsonb(binding) ORDER BY id) FROM prefunded_card.treasury_bindings binding),
    'intents',(SELECT jsonb_agg(to_jsonb(intent) ORDER BY id) FROM prefunded_card.checkout_intents intent),
    'payments',(SELECT jsonb_agg(to_jsonb(operation) ORDER BY id) FROM prefunded_card.operations operation),
    'plans',(SELECT jsonb_agg(to_jsonb(goal) ORDER BY id) FROM public.customer_savings_goals goal));
$$;
CREATE TEMP TABLE credential_before ON COMMIT DROP AS SELECT pg_temp.credential_protected_state() AS value;
ALTER ROLE prefunded_treasury_operator VALID UNTIL '2026-10-06T15:59:10Z';
DO $$ BEGIN
  IF (SELECT value FROM credential_before) IS DISTINCT FROM pg_temp.credential_protected_state()
    OR (SELECT rolvaliduntil FROM pg_roles WHERE rolname='prefunded_treasury_operator')
      IS DISTINCT FROM '2026-10-06T15:59:10Z'::timestamptz THEN
    RAISE EXCEPTION 'interest credential postcondition refused' USING ERRCODE='42501';
  END IF;
END $$;
__FINISH__
