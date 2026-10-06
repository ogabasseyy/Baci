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
    OR to_regprocedure('piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)') IS NOT NULL
    OR to_regclass('piggyvest_savings_ledger.interest_allocations') IS NOT NULL
    OR to_regclass('piggyvest_savings_ledger.interest_receipts') IS NOT NULL THEN
    RAISE EXCEPTION 'interest schema identity or existing state refused';
  END IF;
END $$;
LOCK TABLE pg_catalog.pg_proc IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE pg_catalog.pg_auth_members,pg_catalog.pg_authid IN SHARE MODE;
LOCK TABLE piggyvest_staging.integrations,piggyvest_savings_ledger.bindings,
  piggyvest_savings_ledger.operations,piggyvest_savings_ledger.postings,
  prefunded_card.treasury_bindings,prefunded_card.checkout_intents,prefunded_card.operations,
  public.customer_savings_goals,savings_notifications.events IN SHARE MODE;
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
      AND customer_id='10000000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'interest canonical scope refused';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM prefunded_card.treasury_bindings WHERE
    id='ffffcb16-2e95-5cff-a591-e9cc81cf5f57' AND enabled
    AND verified_available_kobo=10000 AND reserved_kobo=0 AND consumed_kobo=0)
    OR NOT EXISTS (SELECT 1 FROM prefunded_card.checkout_intents WHERE
      id='d8bcf921-61b3-4647-90e2-5648e4d6967d' AND phase='retired_unconfirmed')
    OR NOT EXISTS (SELECT 1 FROM prefunded_card.operations WHERE
      id='d8bcf921-61b3-4647-90e2-5648e4d6967d' AND checkout_retired
      AND collection_status='pending' AND transfer_status='not_started'
      AND projection_status='unapplied') THEN
    RAISE EXCEPTION 'interest protected payment state refused';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE
    oid='piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb)'::regprocedure)
      IS DISTINCT FROM '244ba1a62f14c3d0e1aabb2d90806831'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE
      oid='piggyvest_savings_ledger.apply_bound(uuid,uuid,uuid,uuid,jsonb)'::regprocedure)
      IS DISTINCT FROM 'eb7c5a9f7c8314dd331f7f8de853830a'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='savings_notifications.interest_recorded()'::regprocedure)
      IS DISTINCT FROM '018e14ba26d9ddc98db2436372e930b6' THEN
    RAISE EXCEPTION 'interest parent functions changed';
  END IF;
END $$;
CREATE FUNCTION pg_temp.interest_protected_state() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'bindings',(SELECT jsonb_agg(to_jsonb(binding) ORDER BY goal_id)
      FROM piggyvest_savings_ledger.bindings binding),
    'operations',(SELECT jsonb_agg(to_jsonb(operation) ORDER BY id)
      FROM piggyvest_savings_ledger.operations operation),
    'postings',(SELECT jsonb_agg(to_jsonb(posting) ORDER BY operation_id,account)
      FROM piggyvest_savings_ledger.postings posting),
    'notifications',(SELECT jsonb_agg(to_jsonb(event) ORDER BY id) FROM savings_notifications.events event),
    'treasury',(SELECT jsonb_build_object('verified',verified_available_kobo,'reserved',reserved_kobo,
      'consumed',consumed_kobo,'enabled',enabled) FROM prefunded_card.treasury_bindings
      WHERE id='ffffcb16-2e95-5cff-a591-e9cc81cf5f57'),
    'intent',(SELECT jsonb_build_object('phase',phase,'amount',amount_kobo,'deadline',expires_at)
      FROM prefunded_card.checkout_intents WHERE id='d8bcf921-61b3-4647-90e2-5648e4d6967d'),
    'payment',(SELECT jsonb_build_object('collection',collection_status,'transfer',transfer_status,
      'projection',projection_status,'retired',checkout_retired) FROM prefunded_card.operations
      WHERE id='d8bcf921-61b3-4647-90e2-5648e4d6967d'),
    'plan',(SELECT current_amount FROM public.customer_savings_goals
      WHERE id='430314fd-cd8b-4579-98d4-e9f345713dd6'),
    'roles',(SELECT jsonb_agg(jsonb_build_object('role',rolname,'login',rolcanlogin,
      'deadline',rolvaliduntil,'superuser',rolsuper,'bypassRls',rolbypassrls) ORDER BY rolname)
      FROM pg_roles WHERE rolname IN ('prefunded_treasury_operator','prefunded_evidence',
        'piggyvest_staging_ledger_worker','baci_savings_notifications_worker')),
    'memberships',(SELECT jsonb_agg(to_jsonb(membership) ORDER BY roleid,member,grantor)
      FROM pg_auth_members membership),
    'parentFunctions',(SELECT jsonb_agg(jsonb_build_object('signature',oid::regprocedure::text,
      'body',md5(prosrc),'acl',proacl,'owner',proowner,'definer',prosecdef,'configuration',proconfig)
      ORDER BY oid) FROM pg_proc WHERE oid IN (
        'piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb)'::regprocedure,
        'piggyvest_savings_ledger.apply_bound(uuid,uuid,uuid,uuid,jsonb)'::regprocedure,
        'savings_notifications.interest_recorded()'::regprocedure))
  );
$$;
CREATE TEMP TABLE interest_before ON COMMIT DROP AS SELECT pg_temp.interest_protected_state() AS value;
__MIGRATIONS__
DO $$ BEGIN
  IF (SELECT value FROM interest_before) IS DISTINCT FROM pg_temp.interest_protected_state()
    OR (SELECT count(*) FROM piggyvest_savings_ledger.interest_allocations)<>0
    OR (SELECT count(*) FROM piggyvest_savings_ledger.interest_receipts)<>0
    OR (SELECT count(*) FROM pg_class WHERE oid IN (
      'piggyvest_savings_ledger.interest_allocations'::regclass,
      'piggyvest_savings_ledger.interest_receipts'::regclass) AND relrowsecurity)<>2
    OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE
      oid='piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)'::regprocedure
      AND md5(prosrc)='__AUTHORITY_MD5__' AND pg_get_userbyid(proowner)='postgres'
      AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog']) THEN
    RAISE EXCEPTION 'interest schema postcondition refused';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc routine,
    LATERAL aclexplode(coalesce(routine.proacl,acldefault('f',routine.proowner))) permission
    WHERE routine.oid IN (
      'piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)'::regprocedure,
      'piggyvest_savings_ledger.valid_interest_economics(jsonb)'::regprocedure,
      'piggyvest_savings_ledger.guard_interest_allocation()'::regprocedure)
      AND permission.grantee<>routine.proowner)
    OR EXISTS (SELECT 1 FROM pg_class relation,
      LATERAL aclexplode(coalesce(relation.relacl,acldefault('r',relation.relowner))) permission
      WHERE relation.oid IN ('piggyvest_savings_ledger.interest_allocations'::regclass,
        'piggyvest_savings_ledger.interest_receipts'::regclass)
        AND permission.grantee<>relation.relowner) THEN
    RAISE EXCEPTION 'interest schema unexpected access';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles login, pg_proc routine WHERE routine.oid IN (
    'piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)'::regprocedure,
    'piggyvest_savings_ledger.valid_interest_economics(jsonb)'::regprocedure,
    'piggyvest_savings_ledger.guard_interest_allocation()'::regprocedure)
    AND (login.rolname IN ('anon','authenticated','service_role')
      OR login.rolname ~ '^(prefunded_|pvb_staging_|piggyvest_staging_|baci_savings_)')
    AND (pg_has_role(login.oid,routine.proowner,'MEMBER')
      OR has_function_privilege(login.oid,routine.oid,'EXECUTE')))
    OR EXISTS (SELECT 1 FROM pg_roles login, pg_class relation
      WHERE relation.oid IN ('piggyvest_savings_ledger.interest_allocations'::regclass,
        'piggyvest_savings_ledger.interest_receipts'::regclass)
      AND (login.rolname IN ('anon','authenticated','service_role')
        OR login.rolname ~ '^(prefunded_|pvb_staging_|piggyvest_staging_|baci_savings_)')
      AND (pg_has_role(login.oid,relation.relowner,'MEMBER')
        OR has_table_privilege(login.oid,relation.oid,
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))) THEN
    RAISE EXCEPTION 'interest schema inherited access refused';
  END IF;
  IF EXISTS (SELECT 1 FROM (VALUES
    ('piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb)', '244ba1a62f14c3d0e1aabb2d90806831'),
    ('piggyvest_savings_ledger.apply_bound(uuid,uuid,uuid,uuid,jsonb)', 'eb7c5a9f7c8314dd331f7f8de853830a'),
    ('savings_notifications.interest_recorded()', '018e14ba26d9ddc98db2436372e930b6')
  ) expected(signature,body_md5) WHERE (SELECT md5(prosrc) FROM pg_proc
    WHERE oid=expected.signature::regprocedure) IS DISTINCT FROM expected.body_md5) THEN
    RAISE EXCEPTION 'interest parent function postcondition refused';
  END IF;
END $$;
__FINISH__
