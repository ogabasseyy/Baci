-- REGRESSION TEST: privileges and shape of the goal cancel refund objects
-- (migration 20261103085004_piggyvest_goal_cancel_refund).
--
-- Catalog checks only, never call-and-catch (a denied EXECUTE cannot be
-- trapped on the replay image). Registered in the replay registry folder
-- 20261103085004_piggyvest_goal_cancel_refund.

BEGIN;

DO $catalog$
DECLARE
  v_signature text;
  v_oid regprocedure;
  v_role text;
BEGIN
  -- The attempt table is row-level-secured and closed to every API role.
  IF NOT COALESCE((SELECT class.relrowsecurity FROM pg_catalog.pg_class AS class
                    WHERE class.oid = 'piggyvest_primary.goal_cancel_operations'::regclass), false) THEN
    RAISE EXCEPTION 'goal_cancel_operations must have row level security';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role',
                                'piggyvest_primary_authorizer', 'piggyvest_primary_evidence'] LOOP
    IF pg_catalog.has_table_privilege(v_role, 'piggyvest_primary.goal_cancel_operations',
                                      'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'goal_cancel_operations must not be accessible to %', v_role;
    END IF;
  END LOOP;

  FOREACH v_signature IN ARRAY ARRAY[
    'piggyvest_primary.issue_goal_cancel(jsonb,uuid)',
    'piggyvest_primary.reserve_goal_cancel_with_pin(jsonb,jsonb,text)',
    'piggyvest_primary.manage_goal_cancel(jsonb,uuid,text,bigint)',
    'piggyvest_primary.read_goal_cancel_status(jsonb,uuid)',
    'piggyvest_primary.read_dispatched_goal_cancel(uuid,text,uuid)',
    'piggyvest_primary.settle_goal_cancel(uuid,text,jsonb)',
    'piggyvest_primary.release_failed_goal_cancel(uuid,text,jsonb)',
    'piggyvest_primary.block_funding_during_goal_cancel()',
    'piggyvest_primary.find_dispatched_goal_cancel_by_reference(uuid,text,text)',
    'piggyvest_primary.check_goal_cancel_issued(jsonb,uuid,uuid)',
    'piggyvest_primary.block_unsettled_goal_cancel_customer_deletion()',
    'piggyvest_primary.block_unsettled_goal_cancel_goal_deletion()',
    'piggyvest_primary.block_redemption_during_goal_cancel()',
    'piggyvest_primary.goal_cancel_needs_review(uuid)',
    'piggyvest_primary.block_legacy_contribution_on_primary_goal()'
  ] LOOP
    v_oid := v_signature::regprocedure;
    IF NOT (SELECT proc.prosecdef FROM pg_catalog.pg_proc AS proc WHERE proc.oid = v_oid) THEN
      RAISE EXCEPTION '% must be SECURITY DEFINER', v_signature;
    END IF;
    IF NOT COALESCE((SELECT proc.proconfig @> ARRAY['search_path=""']
                       FROM pg_catalog.pg_proc AS proc WHERE proc.oid = v_oid), false) THEN
      RAISE EXCEPTION '% must pin an empty search_path', v_signature;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF pg_catalog.has_function_privilege(v_role, v_oid, 'EXECUTE') THEN
        RAISE EXCEPTION '% must not be executable by %', v_signature, v_role;
      END IF;
    END LOOP;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS proc,
             pg_catalog.aclexplode(COALESCE(proc.proacl, pg_catalog.acldefault('f', proc.proowner))) AS acl
       WHERE proc.oid = v_oid AND acl.grantee = 0
    ) THEN
      RAISE EXCEPTION '% must not be executable by PUBLIC', v_signature;
    END IF;
  END LOOP;

  -- The executor login reaches the cancel only through the five wrappers.
  FOREACH v_signature IN ARRAY ARRAY[
    'piggyvest_primary.issue_goal_cancel(jsonb,uuid)',
    'piggyvest_primary.reserve_goal_cancel_with_pin(jsonb,jsonb,text)',
    'piggyvest_primary.manage_goal_cancel(jsonb,uuid,text,bigint)',
    'piggyvest_primary.read_goal_cancel_status(jsonb,uuid)',
    'piggyvest_primary.check_goal_cancel_issued(jsonb,uuid,uuid)'
  ] LOOP
    IF NOT pg_catalog.has_function_privilege('piggyvest_primary_authorizer', v_signature::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION '% must be executable by piggyvest_primary_authorizer', v_signature;
    END IF;
    IF pg_catalog.has_function_privilege('piggyvest_primary_evidence', v_signature::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION '% must not be executable by piggyvest_primary_evidence', v_signature;
    END IF;
  END LOOP;

  -- Settlement and release belong to the evidence login only.
  FOREACH v_signature IN ARRAY ARRAY[
    'piggyvest_primary.read_dispatched_goal_cancel(uuid,text,uuid)',
    'piggyvest_primary.settle_goal_cancel(uuid,text,jsonb)',
    'piggyvest_primary.release_failed_goal_cancel(uuid,text,jsonb)',
    'piggyvest_primary.find_dispatched_goal_cancel_by_reference(uuid,text,text)'
  ] LOOP
    IF NOT pg_catalog.has_function_privilege('piggyvest_primary_evidence', v_signature::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION '% must be executable by piggyvest_primary_evidence', v_signature;
    END IF;
    IF pg_catalog.has_function_privilege('piggyvest_primary_authorizer', v_signature::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION '% must not be executable by piggyvest_primary_authorizer', v_signature;
    END IF;
  END LOOP;

  -- The operator review clearance and the legacy auto-debit classification are
  -- ops-tooling entry points: service role only, never the API roles, never PUBLIC
  -- and never the executor logins.
  FOREACH v_signature IN ARRAY ARRAY[
    'public.clear_goal_cancel_review(uuid,text)',
    'public.savings_goal_ids_bound_to_primary(uuid[])'
  ] LOOP
    v_oid := v_signature::regprocedure;
    IF NOT (SELECT proc.prosecdef FROM pg_catalog.pg_proc AS proc WHERE proc.oid = v_oid) THEN
      RAISE EXCEPTION '% must be SECURITY DEFINER', v_signature;
    END IF;
    IF NOT COALESCE((SELECT proc.proconfig @> ARRAY['search_path=""']
                       FROM pg_catalog.pg_proc AS proc WHERE proc.oid = v_oid), false) THEN
      RAISE EXCEPTION '% must pin an empty search_path', v_signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '% must be executable by service_role', v_signature;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated',
                                  'piggyvest_primary_authorizer', 'piggyvest_primary_evidence'] LOOP
      IF pg_catalog.has_function_privilege(v_role, v_oid, 'EXECUTE') THEN
        RAISE EXCEPTION '% must not be executable by %', v_signature, v_role;
      END IF;
    END LOOP;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS proc,
             pg_catalog.aclexplode(COALESCE(proc.proacl, pg_catalog.acldefault('f', proc.proowner))) AS acl
       WHERE proc.oid = v_oid AND acl.grantee = 0
    ) THEN
      RAISE EXCEPTION '% must not be executable by PUBLIC', v_signature;
    END IF;
  END LOOP;

  -- The piggyvest_primary function behind the wrapper has no grant for any
  -- API or ops role, and service_role has no schema usage to reach it.
  v_oid := 'piggyvest_primary.clear_goal_cancel_review(uuid,text)'::regprocedure;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role',
                                'piggyvest_primary_authorizer', 'piggyvest_primary_evidence'] LOOP
    IF pg_catalog.has_function_privilege(v_role, v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'the schema-internal clearance must not be executable by %', v_role;
    END IF;
  END LOOP;
  IF pg_catalog.has_schema_privilege('service_role', 'piggyvest_primary', 'USAGE') THEN
    RAISE EXCEPTION 'service_role must not have usage on piggyvest_primary';
  END IF;

  -- Provider references are unique, and review blocks a new cancel (the live
  -- index) until an operator clears it.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS con
                  WHERE con.conrelid = 'piggyvest_primary.goal_cancel_operations'::regclass
                    AND con.conname = 'goal_cancel_reference_key' AND con.contype = 'u') THEN
    RAISE EXCEPTION 'the provider reference unique constraint is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes AS idx
                  WHERE idx.schemaname = 'piggyvest_primary'
                    AND idx.indexname = 'goal_cancel_one_live_per_goal_idx'
                    AND idx.indexdef LIKE '%needs_review%') THEN
    RAISE EXCEPTION 'the live cancel index does not cover needs_review';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS con
                  WHERE con.conrelid = 'piggyvest_primary.goal_cancel_operations'::regclass
                    AND con.contype = 'c'
                    AND pg_catalog.pg_get_constraintdef(con.oid) LIKE '%needs_review%'
                    AND pg_catalog.pg_get_constraintdef(con.oid) LIKE '%reviewed%') THEN
    RAISE EXCEPTION 'the state check does not know the review states';
  END IF;

  -- The unbound consume path stays closed to the executor login: cancel is
  -- reachable only through the operation-bound wrapper above.
  IF pg_catalog.has_function_privilege('piggyvest_primary_authorizer',
       'piggyvest_primary.consume_goal_pin_proof(jsonb,uuid,text,text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'piggyvest_primary_authorizer must not execute consume_goal_pin_proof';
  END IF;
  IF pg_catalog.has_function_privilege('piggyvest_primary_authorizer',
       'piggyvest_primary.reserve_savings(jsonb,jsonb)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'piggyvest_primary_authorizer must not execute reserve_savings directly';
  END IF;

  -- One live attempt per goal is a database rule, and funding is fenced.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes AS idx
                  WHERE idx.schemaname = 'piggyvest_primary'
                    AND idx.indexname = 'goal_cancel_one_live_per_goal_idx'
                    AND idx.indexdef LIKE '%UNIQUE%') THEN
    RAISE EXCEPTION 'one live cancel per goal index is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS trg
                  WHERE trg.tgrelid = 'piggyvest_primary.savings_operations'::regclass
                    AND trg.tgname = 'block_funding_during_goal_cancel' AND NOT trg.tgisinternal) THEN
    RAISE EXCEPTION 'funding fence trigger is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS trg
                  WHERE trg.tgrelid = 'public.customer_savings_redemptions'::regclass
                    AND trg.tgname = 'block_redemption_during_goal_cancel' AND NOT trg.tgisinternal) THEN
    RAISE EXCEPTION 'redemption fence trigger is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS trg
                  WHERE trg.tgrelid = 'public.customer_savings_contributions'::regclass
                    AND trg.tgname = 'block_legacy_contribution_on_primary_goal' AND NOT trg.tgisinternal
                    AND trg.tgenabled = 'O') THEN
    RAISE EXCEPTION 'legacy contribution fence trigger is missing';
  END IF;
  -- The needs-review helper is not callable by the executor logins directly.
  IF pg_catalog.has_function_privilege('piggyvest_primary_authorizer',
       'piggyvest_primary.goal_cancel_needs_review(uuid)'::regprocedure, 'EXECUTE')
     OR pg_catalog.has_function_privilege('piggyvest_primary_evidence',
       'piggyvest_primary.goal_cancel_needs_review(uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'goal_cancel_needs_review must not be executable by the executor logins';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS trg
                  WHERE trg.tgrelid = 'public.customers'::regclass
                    AND trg.tgname = 'primary_goal_cancel_block_unsettled_customer_deletion' AND NOT trg.tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS trg
                  WHERE trg.tgrelid = 'public.customer_savings_goals'::regclass
                    AND trg.tgname = 'primary_goal_cancel_block_unsettled_goal_deletion' AND NOT trg.tgisinternal) THEN
    RAISE EXCEPTION 'deletion guard triggers are missing';
  END IF;
  -- Funding no longer gates on a local balance, so a settled refund needs no
  -- availability accounting in the reservation (the refund lands in the
  -- PiggyVest main wallet, which is the system of record).
  IF pg_catalog.pg_get_functiondef('piggyvest_primary.reserve_savings_before_interest(jsonb,jsonb)'::regprocedure)
     LIKE '%goal_cancel_operations%' THEN
    RAISE EXCEPTION 'funding reservation still counts goal cancel refunds against a local balance';
  END IF;
END
$catalog$;

ROLLBACK;
