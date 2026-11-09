-- REGRESSION TEST: privileges and shape of the goal complete objects
-- (migration 20261103181737_piggyvest_goal_complete_purchase_request).
--
-- Catalog checks only, never call-and-catch (a denied EXECUTE cannot be
-- trapped on the replay image). Registered in the replay registry folder
-- 20261103181737_piggyvest_goal_complete_purchase_request.

BEGIN;

DO $catalog$
DECLARE
  v_signature text;
  v_oid regprocedure;
  v_role text;
  v_table text;
BEGIN
  -- Both new tables are row-level-secured and closed to every role.
  FOREACH v_table IN ARRAY ARRAY['piggyvest_primary.goal_complete_operations',
                                 'piggyvest_primary.goal_purchase_requests'] LOOP
    IF NOT COALESCE((SELECT class.relrowsecurity FROM pg_catalog.pg_class AS class
                      WHERE class.oid = v_table::regclass), false) THEN
      RAISE EXCEPTION '% must have row level security', v_table;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role',
                                  'piggyvest_primary_authorizer', 'piggyvest_primary_evidence'] LOOP
      IF pg_catalog.has_table_privilege(v_role, v_table, 'SELECT,INSERT,UPDATE,DELETE') THEN
        RAISE EXCEPTION '% must not be accessible to %', v_table, v_role;
      END IF;
    END LOOP;
  END LOOP;

  -- Every piggyvest_primary function is SECURITY DEFINER with an empty
  -- search_path and closed to PUBLIC and the API roles.
  FOREACH v_signature IN ARRAY ARRAY[
    'piggyvest_primary.goal_complete_eligible(uuid)',
    'piggyvest_primary.goal_cancel_in_flight(uuid)',
    'piggyvest_primary.issue_goal_complete(jsonb,uuid)',
    'piggyvest_primary.reserve_goal_complete_with_pin(jsonb,jsonb,text)',
    'piggyvest_primary.manage_goal_complete(jsonb,uuid,text,bigint)',
    'piggyvest_primary.read_goal_complete_status(jsonb,uuid)',
    'piggyvest_primary.read_dispatched_goal_complete(uuid,text,uuid)',
    'piggyvest_primary.settle_goal_complete(uuid,text,jsonb)',
    'piggyvest_primary.release_failed_goal_complete(uuid,text,jsonb)',
    'piggyvest_primary.clear_goal_complete_review(uuid,text)',
    'piggyvest_primary.find_dispatched_goal_complete_by_reference(uuid,text,text)',
    'piggyvest_primary.check_goal_complete_issued(jsonb,uuid,uuid)',
    'piggyvest_primary.read_goal_purchase_request_alert(uuid,text,uuid)',
    'piggyvest_primary.mark_goal_purchase_request_alerted(uuid,text,uuid)',
    'piggyvest_primary.block_funding_during_goal_complete()',
    'piggyvest_primary.block_redemption_during_goal_complete()',
    'piggyvest_primary.block_goal_cancel_during_goal_complete()',
    'piggyvest_primary.block_unsettled_goal_complete_customer_deletion()',
    'piggyvest_primary.block_unsettled_goal_complete_goal_deletion()',
    'public.clear_goal_complete_review(uuid,text)',
    'public.list_open_goal_purchase_requests(integer)',
    'public.fulfil_goal_purchase_request(uuid,text)'
  ] LOOP
    v_oid := v_signature::regprocedure;
    IF NOT (SELECT proc.prosecdef FROM pg_catalog.pg_proc AS proc WHERE proc.oid = v_oid) THEN
      RAISE EXCEPTION '% must be SECURITY DEFINER', v_signature;
    END IF;
    IF NOT COALESCE((SELECT proc.proconfig @> ARRAY['search_path=""']
                       FROM pg_catalog.pg_proc AS proc WHERE proc.oid = v_oid), false) THEN
      RAISE EXCEPTION '% must pin an empty search_path', v_signature;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF pg_catalog.has_function_privilege(v_role, v_oid, 'EXECUTE') THEN
        RAISE EXCEPTION '% must not be executable by %', v_signature, v_role;
      END IF;
    END LOOP;
    IF v_signature NOT LIKE 'public.%' AND pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '% must not be executable by service_role', v_signature;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS proc,
             pg_catalog.aclexplode(COALESCE(proc.proacl, pg_catalog.acldefault('f', proc.proowner))) AS acl
       WHERE proc.oid = v_oid AND acl.grantee = 0
    ) THEN
      RAISE EXCEPTION '% must not be executable by PUBLIC', v_signature;
    END IF;
  END LOOP;

  -- The authorizer login reaches complete only through the four wrappers.
  FOREACH v_signature IN ARRAY ARRAY[
    'piggyvest_primary.issue_goal_complete(jsonb,uuid)',
    'piggyvest_primary.reserve_goal_complete_with_pin(jsonb,jsonb,text)',
    'piggyvest_primary.manage_goal_complete(jsonb,uuid,text,bigint)',
    'piggyvest_primary.read_goal_complete_status(jsonb,uuid)',
    'piggyvest_primary.check_goal_complete_issued(jsonb,uuid,uuid)'
  ] LOOP
    IF NOT pg_catalog.has_function_privilege('piggyvest_primary_authorizer', v_signature::regprocedure, 'EXECUTE')
       OR pg_catalog.has_function_privilege('piggyvest_primary_evidence', v_signature::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION '% must be executable by the authorizer login only', v_signature;
    END IF;
  END LOOP;

  -- Settlement, release, the alert state and the webhook lookup belong to the
  -- evidence login only.
  FOREACH v_signature IN ARRAY ARRAY[
    'piggyvest_primary.read_dispatched_goal_complete(uuid,text,uuid)',
    'piggyvest_primary.settle_goal_complete(uuid,text,jsonb)',
    'piggyvest_primary.release_failed_goal_complete(uuid,text,jsonb)',
    'piggyvest_primary.find_dispatched_goal_complete_by_reference(uuid,text,text)',
    'piggyvest_primary.read_goal_purchase_request_alert(uuid,text,uuid)',
    'piggyvest_primary.mark_goal_purchase_request_alerted(uuid,text,uuid)'
  ] LOOP
    IF NOT pg_catalog.has_function_privilege('piggyvest_primary_evidence', v_signature::regprocedure, 'EXECUTE')
       OR pg_catalog.has_function_privilege('piggyvest_primary_authorizer', v_signature::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION '% must be executable by the evidence login only', v_signature;
    END IF;
  END LOOP;

  -- The operator entry points are service role only (public wrappers).
  FOREACH v_signature IN ARRAY ARRAY[
    'public.clear_goal_complete_review(uuid,text)',
    'public.list_open_goal_purchase_requests(integer)',
    'public.fulfil_goal_purchase_request(uuid,text)'
  ] LOOP
    v_oid := v_signature::regprocedure;
    IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('piggyvest_primary_authorizer', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('piggyvest_primary_evidence', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '% must be executable by service_role only', v_signature;
    END IF;
  END LOOP;
  IF pg_catalog.has_schema_privilege('service_role', 'piggyvest_primary', 'USAGE') THEN
    RAISE EXCEPTION 'service_role must not have usage on piggyvest_primary';
  END IF;

  -- The unbound consume path stays closed to the authorizer login. Complete
  -- is reachable only through the operation-bound reserve wrapper above.
  IF pg_catalog.has_function_privilege('piggyvest_primary_authorizer',
       'piggyvest_primary.consume_goal_pin_proof(jsonb,uuid,text,text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'piggyvest_primary_authorizer must not execute consume_goal_pin_proof';
  END IF;

  -- References are unique, a live attempt per goal is a database rule and it
  -- covers review; one purchase request per settled completion.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS con
                  WHERE con.conrelid = 'piggyvest_primary.goal_complete_operations'::regclass
                    AND con.conname = 'goal_complete_reference_key' AND con.contype = 'u')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS con
                  WHERE con.conrelid = 'piggyvest_primary.goal_purchase_requests'::regclass
                    AND con.conname = 'goal_purchase_requests_operation_key' AND con.contype = 'u') THEN
    RAISE EXCEPTION 'a unique constraint is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes AS idx
                  WHERE idx.schemaname = 'piggyvest_primary'
                    AND idx.indexname = 'goal_complete_one_live_per_goal_idx'
                    AND idx.indexdef LIKE '%UNIQUE%' AND idx.indexdef LIKE '%needs_review%') THEN
    RAISE EXCEPTION 'the live complete index is missing or does not cover needs_review';
  END IF;

  -- Fences: funding, redemption, deletion, and cancel versus complete.
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger AS trg
       WHERE NOT trg.tgisinternal AND trg.tgenabled = 'O'
         AND (trg.tgrelid, trg.tgname) IN (
           ('piggyvest_primary.savings_operations'::regclass, 'block_funding_during_goal_complete'),
           ('public.customer_savings_redemptions'::regclass, 'block_redemption_during_goal_complete'),
           ('piggyvest_primary.goal_cancel_operations'::regclass, 'block_goal_cancel_during_goal_complete'),
           ('public.customers'::regclass, 'primary_goal_complete_block_unsettled_customer_deletion'),
           ('public.customer_savings_goals'::regclass, 'primary_goal_complete_block_unsettled_goal_deletion'))) <> 5 THEN
    RAISE EXCEPTION 'a goal complete fence trigger is missing';
  END IF;

  -- The daily reconciliation counts settled completions. Funding reservation no
  -- longer gates on a local balance, so it carries no completion accounting.
  IF pg_catalog.pg_get_functiondef('piggyvest_primary.reserve_savings_before_interest(jsonb,jsonb)'::regprocedure)
     LIKE '%goal_complete_operations%'
     OR pg_catalog.pg_get_functiondef('piggyvest_primary.read_daily_reconciliation(uuid,text,jsonb)'::regprocedure)
     NOT LIKE '%goal_complete_operations%' THEN
    RAISE EXCEPTION 'funding still counts completions, or reconciliation does not count settled completions';
  END IF;
END
$catalog$;

ROLLBACK;
