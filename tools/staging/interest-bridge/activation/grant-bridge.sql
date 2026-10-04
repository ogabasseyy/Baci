BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';
SET LOCAL search_path=pg_catalog;
SET LOCAL synchronous_commit=on;
SELECT pg_advisory_xact_lock(1790899190);
LOCK TABLE pg_catalog.pg_proc,pg_catalog.pg_authid,pg_catalog.pg_namespace IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE pg_catalog.pg_auth_members,piggyvest_staging.integrations,
 piggyvest_savings_ledger.bindings,piggyvest_savings_ledger.interest_policies,
 piggyvest_savings_ledger.interest_allocations,piggyvest_savings_ledger.interest_receipts,
 piggyvest_savings_ledger.operations,piggyvest_savings_ledger.postings,
 public.customer_savings_goals,prefunded_card.treasury_bindings,
 prefunded_card.checkout_intents,prefunded_card.operations,savings_notifications.events IN SHARE MODE;
DO $$ BEGIN
 IF session_user<>'postgres' OR current_database()<>'postgres' OR inet_client_addr() IS NOT NULL
  OR (SELECT system_identifier::text FROM pg_control_system())<>'7685292944002592802'
  OR clock_timestamp()>='2026-10-06T15:56:10Z'::timestamptz THEN
  RAISE EXCEPTION 'activation identity refused' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='prefunded_treasury_operator'
  AND rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole
  AND NOT rolcreatedb AND NOT rolreplication AND rolvaliduntil='2026-10-06T15:59:10Z')
  OR NOT EXISTS(SELECT 1 FROM public.customer_savings_goals
   WHERE id='430314fd-cd8b-4579-98d4-e9f345713dd6' AND current_amount=100 AND status='active'
   AND customer_id='10000000-0000-4000-8000-000000000002'
   AND merchant_id='10000000-0000-4000-8000-000000000001')
  OR NOT EXISTS(SELECT 1 FROM piggyvest_staging.integrations
   WHERE id='d91d9e87-8e0d-44de-9b84-1e1d709633d2' AND enabled
    AND expected_provider_account_id='01M2381RG34HQJMHQKE7DWDACR')
  OR (SELECT count(*) FROM piggyvest_savings_ledger.bindings)<>1
  OR NOT EXISTS(SELECT 1 FROM piggyvest_savings_ledger.bindings
   WHERE goal_id='430314fd-cd8b-4579-98d4-e9f345713dd6' AND enabled
    AND authorized_login='prefunded_treasury_operator'
    AND integration_id='d91d9e87-8e0d-44de-9b84-1e1d709633d2')
  OR (SELECT count(*) FROM piggyvest_savings_ledger.interest_policies)<>0
  OR (SELECT count(*) FROM piggyvest_savings_ledger.interest_allocations)<>0
  OR (SELECT count(*) FROM piggyvest_savings_ledger.interest_receipts)<>0
  OR NOT EXISTS(SELECT 1 FROM prefunded_card.treasury_bindings
   WHERE id='ffffcb16-2e95-5cff-a591-e9cc81cf5f57' AND enabled
    AND verified_available_kobo=10000 AND reserved_kobo=0 AND consumed_kobo=0)
  OR NOT EXISTS(SELECT 1 FROM prefunded_card.checkout_intents
   WHERE id='d8bcf921-61b3-4647-90e2-5648e4d6967d' AND phase='retired_unconfirmed') THEN
  RAISE EXCEPTION 'activation protected state refused' USING ERRCODE='42501'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE member='prefunded_treasury_operator'::regrole
  OR roleid='prefunded_treasury_operator'::regrole)<>2
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE
   (member='prefunded_treasury_operator'::regrole OR roleid='prefunded_treasury_operator'::regrole)
   AND NOT(member='prefunded_treasury_operator'::regrole
    AND pg_get_userbyid(roleid) IN ('prefunded_treasury_ledger_worker','prefunded_card_authorization_reader')
    AND pg_get_userbyid(grantor)='supabase_admin' AND NOT admin_option
    AND NOT inherit_option AND set_option)) THEN
  RAISE EXCEPTION 'activation memberships refused' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM (VALUES
  ('piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)','e889259e0d0361ab352e52d06b4ce69d',true),
  ('piggyvest_savings_ledger.prepare_interest_allocation(uuid,text,jsonb)','5c6c71054dbf911d13755454a559d546',true),
  ('piggyvest_savings_ledger.guard_interest_policy()','f769254f3d2392764e39d8786632afb0',false),
  ('piggyvest_savings_ledger.valid_interest_economics(jsonb)','d9a34debfc38c4e4aa90d319beb5333a',false),
  ('piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb)','244ba1a62f14c3d0e1aabb2d90806831',true),
  ('piggyvest_savings_ledger.apply_bound(uuid,uuid,uuid,uuid,jsonb)','eb7c5a9f7c8314dd331f7f8de853830a',true)
 ) expected(signature,digest,definer) LEFT JOIN pg_proc routine
  ON routine.oid=to_regprocedure(expected.signature)
 WHERE routine.oid IS NULL OR md5(routine.prosrc)<>expected.digest
  OR pg_get_userbyid(routine.proowner)<>'postgres' OR routine.prosecdef<>expected.definer
  OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
  OR routine.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
  OR (SELECT lanname FROM pg_language WHERE oid=routine.prolang)<>'plpgsql')
 OR has_function_privilege('prefunded_treasury_operator',
  'piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)','EXECUTE')
 OR has_function_privilege('prefunded_treasury_operator',
  'piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb)','EXECUTE')
 OR has_function_privilege('prefunded_treasury_operator',
  'piggyvest_savings_ledger.apply_bound(uuid,uuid,uuid,uuid,jsonb)','EXECUTE')
 OR has_table_privilege('prefunded_treasury_operator',
  'piggyvest_savings_ledger.interest_policies','SELECT,INSERT,UPDATE,DELETE')
 OR has_schema_privilege('prefunded_treasury_operator','piggyvest_savings_ledger','USAGE,CREATE')
 OR (SELECT nspacl::text FROM pg_namespace WHERE nspname='piggyvest_savings_ledger')
  IS DISTINCT FROM '{postgres=UC/postgres}'
 OR (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='piggyvest_savings_ledger')
  IS DISTINCT FROM 'postgres' THEN
  RAISE EXCEPTION 'activation authority baseline refused' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION pg_temp.activation_state() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
  'roles',(SELECT jsonb_agg(to_jsonb(role) ORDER BY oid) FROM pg_authid role),
  'memberships',(SELECT jsonb_agg(to_jsonb(membership) ORDER BY roleid,member,grantor) FROM pg_auth_members membership),
  'functions',(SELECT jsonb_agg(CASE WHEN oid='piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)'::regprocedure
   THEN to_jsonb(routine)-'proacl' ELSE to_jsonb(routine) END ORDER BY oid) FROM pg_proc routine),
  'schemas',(SELECT jsonb_agg(CASE WHEN nspname='piggyvest_savings_ledger'
   THEN to_jsonb(namespace)-'nspacl' ELSE to_jsonb(namespace) END ORDER BY oid) FROM pg_namespace namespace),
  'goals',(SELECT jsonb_agg(to_jsonb(goal) ORDER BY id) FROM public.customer_savings_goals goal),
  'bindings',(SELECT jsonb_agg(to_jsonb(binding) ORDER BY goal_id) FROM piggyvest_savings_ledger.bindings binding),
  'policies',(SELECT jsonb_agg(to_jsonb(policy) ORDER BY goal_id) FROM piggyvest_savings_ledger.interest_policies policy),
  'allocations',(SELECT jsonb_agg(to_jsonb(allocation) ORDER BY id) FROM piggyvest_savings_ledger.interest_allocations allocation),
  'receipts',(SELECT jsonb_agg(to_jsonb(receipt) ORDER BY allocation_id) FROM piggyvest_savings_ledger.interest_receipts receipt),
  'operations',(SELECT jsonb_agg(to_jsonb(operation) ORDER BY id) FROM piggyvest_savings_ledger.operations operation),
  'postings',(SELECT jsonb_agg(to_jsonb(posting) ORDER BY operation_id,account) FROM piggyvest_savings_ledger.postings posting),
  'treasury',(SELECT jsonb_agg(to_jsonb(treasury) ORDER BY id) FROM prefunded_card.treasury_bindings treasury),
  'intents',(SELECT jsonb_agg(to_jsonb(intent) ORDER BY id) FROM prefunded_card.checkout_intents intent),
  'payments',(SELECT jsonb_agg(to_jsonb(payment) ORDER BY id) FROM prefunded_card.operations payment),
  'notifications',(SELECT jsonb_agg(to_jsonb(event) ORDER BY id) FROM savings_notifications.events event));
$$;
CREATE TEMP TABLE activation_before ON COMMIT DROP AS SELECT pg_temp.activation_state() AS value;
GRANT USAGE ON SCHEMA piggyvest_savings_ledger TO prefunded_treasury_operator;
GRANT EXECUTE ON FUNCTION piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)
 TO prefunded_treasury_operator;
DO $$ BEGIN
 IF (SELECT value FROM activation_before) IS DISTINCT FROM pg_temp.activation_state()
  OR NOT has_function_privilege('prefunded_treasury_operator',
   'piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)','EXECUTE')
  OR (SELECT proacl::text FROM pg_proc WHERE oid=
   'piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)'::regprocedure)
   IS DISTINCT FROM '{postgres=X/postgres,prefunded_treasury_operator=X/postgres}'
  OR (SELECT nspacl::text FROM pg_namespace WHERE nspname='piggyvest_savings_ledger')
   IS DISTINCT FROM '{postgres=UC/postgres,prefunded_treasury_operator=U/postgres}' THEN
  RAISE EXCEPTION 'activation postcondition refused' USING ERRCODE='42501'; END IF;
END $$;
__FINISH__
