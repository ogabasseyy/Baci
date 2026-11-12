-- REGRESSION TEST (behaviour): an early goal cancel refunds ONLY the saved
-- principal; the goal's interest is forfeited to Ogabassey's interest wallet
-- (owner decision 2026-11-12; migration
-- 20261112190514_piggyvest_goal_cancel_interest_forfeit). Before it, the
-- cancel moved the whole provider balance, interest included, to the
-- customer. Fixture and helpers live in the included part; registered in the
-- replay registry folder 20261112190514_piggyvest_goal_cancel_interest_forfeit.
\set ON_ERROR_STOP on
\ir piggyvest_goal_cancel_behaviour.fixture.inc.sql

CREATE FUNCTION pg_temp.gf_split(p_op text, p_balance bigint) RETURNS jsonb LANGUAGE sql AS $$
  SELECT piggyvest_primary.dispatch_goal_cancel_split(pg_temp.gc_scope(), p_op::uuid, p_balance);
$$;
CREATE FUNCTION pg_temp.gf_forfeit(p_op text, p_column text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_catalog.to_jsonb(forfeit) ->> p_column
    FROM piggyvest_primary.goal_cancel_interest_forfeits AS forfeit
   WHERE forfeit.cancel_operation_id = p_op::uuid
   ORDER BY forfeit.reserved_at DESC LIMIT 1;
$$;
CREATE FUNCTION pg_temp.gf_forfeit_proof(p_forfeit text, p_status text DEFAULT 'success') RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_catalog.jsonb_build_object(
    'operationId', forfeit.id, 'providerTransactionId', 'synthetic-gf-txn-' || p_status || '-' || forfeit.id,
    'reference', forfeit.reference, 'amountKobo', forfeit.amount_kobo,
    'sourceWalletId', forfeit.source_wallet_id, 'destinationWalletId', forfeit.destination_wallet_id,
    'businessId', 'synthetic-goalcancel-business')
    FROM piggyvest_primary.goal_cancel_interest_forfeits AS forfeit WHERE forfeit.id = p_forfeit::uuid;
$$;
CREATE FUNCTION pg_temp.gf_configure_wallet() RETURNS void LANGUAGE sql AS $$
  INSERT INTO piggyvest_primary.goal_interest_forfeit_wallets (integration_id, provider_wallet_id, enabled)
  VALUES ('f3860000-0000-4000-8000-000000000006', 'synthetic-goalcancel-interest-wallet', true);
$$;

DO $behaviour$
DECLARE
  c_goal constant text := 'f3860000-0000-4000-8000-000000000005';
  c_integration constant uuid := 'f3860000-0000-4000-8000-000000000006';
  v_scope jsonb := pg_temp.gc_scope();
  v_op text;
  v_forfeit text;
  v_result jsonb;
  v_text text;
BEGIN
  -- 1. The old whole-balance dispatch is gone: manage_goal_cancel no longer
  --    dispatches, so nothing can move interest to the customer any more.
  v_op := pg_temp.gc_reserved('old-dispatch');
  PERFORM pg_temp.gc_assert(NOT piggyvest_primary.manage_goal_cancel(v_scope, v_op::uuid, 'dispatch', 262000),
    'the whole-balance dispatch still works');
  PERFORM pg_temp.gc_assert(pg_temp.gc_state(v_op) = 'reserved', 'the refused old dispatch changed the attempt');
  PERFORM piggyvest_primary.manage_goal_cancel(v_scope, v_op::uuid, 'cancel', 0);

  -- 2. Interest owed but no interest wallet configured: nothing is sent, the
  --    attempt is released (PIN already spent, nothing reserved forever).
  v_op := pg_temp.gc_reserved('no-wallet');
  v_result := pg_temp.gf_split(v_op, 262000);
  PERFORM pg_temp.gc_assert(v_result ->> 'status' = 'forfeit_unavailable',
    'a cancel with interest dispatched without an interest wallet: ' || v_result::text);
  PERFORM pg_temp.gc_assert(pg_temp.gc_state(v_op) = 'released'
    AND NOT EXISTS (SELECT 1 FROM piggyvest_primary.goal_cancel_interest_forfeits),
    'the unavailable interest wallet left the attempt live or wrote a forfeit');

  PERFORM pg_temp.gf_configure_wallet();

  -- 3. The provider holds LESS than our recorded principal: never refund over
  --    the provider balance; a person reviews it and nothing is sent.
  v_op := pg_temp.gc_reserved('short');
  v_result := pg_temp.gf_split(v_op, 249999);
  PERFORM pg_temp.gc_assert(v_result ->> 'status' = 'needs_review',
    'a provider balance below the principal was dispatched: ' || v_result::text);
  PERFORM pg_temp.gc_assert(pg_temp.gc_state(v_op) = 'released'
    AND (SELECT amount_kobo FROM piggyvest_primary.goal_cancel_operations WHERE id = v_op::uuid) IS NULL,
    'a short provider balance left a dispatched attempt');

  -- Invalid balances are refused outright.
  v_op := pg_temp.gc_reserved('bad-balance');
  FOREACH v_text IN ARRAY ARRAY['0', '-1', '10000000000'] LOOP
    BEGIN
      PERFORM pg_temp.gf_split(v_op, v_text::bigint);
      RAISE EXCEPTION 'an invalid provider balance was accepted: %', v_text USING ERRCODE = 'PVT00';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;
  END LOOP;
  PERFORM piggyvest_primary.manage_goal_cancel(v_scope, v_op::uuid, 'cancel', 0);

  -- 4. Balance equal to the principal: the customer gets it all, no forfeit.
  BEGIN
    v_op := pg_temp.gc_reserved('no-interest');
    v_result := pg_temp.gf_split(v_op, 250000);
    PERFORM pg_temp.gc_assert(v_result = '{"status":"dispatched","principalKobo":250000,"forfeitedInterestKobo":0}'::jsonb,
      'a goal without interest did not dispatch its principal: ' || v_result::text);
    PERFORM pg_temp.gc_assert(NOT EXISTS (SELECT 1 FROM piggyvest_primary.goal_cancel_interest_forfeits
                                           WHERE cancel_operation_id = v_op::uuid),
      'a goal without interest wrote a forfeit');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;

  -- 5. The split: principal 250000 to the customer, 12000 interest forfeited.
  v_op := pg_temp.gc_reserved('split');
  v_result := pg_temp.gf_split(v_op, 262000);
  PERFORM pg_temp.gc_assert(v_result = '{"status":"dispatched","principalKobo":250000,"forfeitedInterestKobo":12000}'::jsonb,
    'the split dispatch answered wrongly: ' || v_result::text);
  PERFORM pg_temp.gc_assert(pg_temp.gc_state(v_op) = 'dispatched'
    AND (SELECT amount_kobo FROM piggyvest_primary.goal_cancel_operations WHERE id = v_op::uuid) = 250000
    AND (SELECT forfeited_interest_kobo FROM piggyvest_primary.goal_cancel_operations WHERE id = v_op::uuid) = 12000,
    'the customer leg did not record the principal only');
  PERFORM pg_temp.gc_assert(pg_temp.gf_forfeit(v_op, 'state') = 'reserved'
    AND pg_temp.gf_forfeit(v_op, 'amount_kobo')::bigint = 12000
    AND pg_temp.gf_forfeit(v_op, 'reference') = 'pvb-forfeit-' || c_goal
    AND pg_temp.gf_forfeit(v_op, 'source_wallet_id') = 'synthetic-goalcancel-goal-wallet'
    AND pg_temp.gf_forfeit(v_op, 'destination_wallet_id') = 'synthetic-goalcancel-interest-wallet',
    'the forfeit leg was not planned for the interest wallet');
  -- A second split of the same attempt claims nothing.
  PERFORM pg_temp.gc_assert(pg_temp.gf_split(v_op, 262000) ->> 'status' = 'not_claimed',
    'a dispatched attempt was split twice');
  v_forfeit := pg_temp.gf_forfeit(v_op, 'id');

  -- The app reads the split from the server, never a client guess.
  v_result := piggyvest_primary.read_goal_cancel_amounts(v_scope, v_op::uuid);
  PERFORM pg_temp.gc_assert(v_result = '{"principalKobo":250000,"forfeitedInterestKobo":12000}'::jsonb,
    'the cancel amounts read answered wrongly: ' || COALESCE(v_result::text, 'null'));

  -- 6. The forfeit is never sent before the customer's principal is confirmed.
  v_result := piggyvest_primary.claim_goal_cancel_forfeit(v_scope, v_op::uuid);
  PERFORM pg_temp.gc_assert(v_result ->> 'status' = 'waiting' AND pg_temp.gf_forfeit(v_op, 'state') = 'reserved',
    'the forfeit was claimed before the principal settled: ' || v_result::text);

  -- 7. Principal settlement tolerates the not-yet-moved interest as residual,
  --    but more than that is still a review.
  BEGIN
    PERFORM pg_temp.gc_assert(
      pg_temp.gc_settle(pg_temp.gc_proof(v_op) || '{"residualKobo":12001}'::jsonb) = 'conflict'
      AND pg_temp.gc_state(v_op) = 'needs_review',
      'a residual above the planned forfeit was not reviewed');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
  PERFORM pg_temp.gc_assert(
    pg_temp.gc_settle(pg_temp.gc_proof(v_op) || '{"residualKobo":12000}'::jsonb) = 'confirmed',
    'the principal did not settle while the interest still sat in the goal wallet');
  PERFORM pg_temp.gc_assert(pg_temp.gc_goal('status') = 'cancelled' AND pg_temp.gc_goal('current_amount')::numeric = 0
    AND pg_temp.gc_wallet() = 1000,
    'principal settlement did not cancel the goal, or touched the legacy wallet');
  PERFORM pg_temp.gc_assert(EXISTS (
    SELECT 1 FROM public.customer_savings_events
     WHERE goal_id = c_goal::uuid AND event_type = 'goal_cancelled_refunded'
       AND metadata ->> 'principal_kobo' = '250000' AND metadata ->> 'forfeited_interest_kobo' = '12000'),
    'the cancel event does not say what was refunded and what was forfeited');

  -- 8. Now the forfeit may go: claimed once, then pending (never resent).
  v_result := piggyvest_primary.claim_goal_cancel_forfeit(v_scope, v_op::uuid);
  PERFORM pg_temp.gc_assert(v_result ->> 'status' = 'claimed'
    AND v_result -> 'forfeit' = pg_catalog.jsonb_build_object(
      'operationId', v_forfeit, 'goalId', c_goal, 'amountKobo', 12000,
      'sourceWalletId', 'synthetic-goalcancel-goal-wallet',
      'destinationWalletId', 'synthetic-goalcancel-interest-wallet',
      'reference', 'pvb-forfeit-' || c_goal, 'businessId', 'synthetic-goalcancel-business',
      'providerCustomerId', 'synthetic-goalcancel-customer'),
    'the forfeit claim answered wrongly: ' || v_result::text);
  PERFORM pg_temp.gc_assert(pg_temp.gf_forfeit(v_op, 'state') = 'dispatched',
    'the claimed forfeit is not dispatched');
  PERFORM pg_temp.gc_assert(piggyvest_primary.claim_goal_cancel_forfeit(v_scope, v_op::uuid) ->> 'status' = 'pending',
    'a dispatched forfeit was claimed twice');

  -- 9. Evidence: read, find by reference, settle (with ledger event), replay.
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.read_dispatched_goal_cancel_forfeit(c_integration, 'staging', v_forfeit::uuid)
      = v_result -> 'forfeit',
    'the evidence read of the forfeit disagrees with the claim');
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.find_dispatched_goal_cancel_forfeit_by_reference(c_integration, 'staging', 'pvb-forfeit-' || c_goal)
      = pg_catalog.jsonb_build_object('operationId', v_forfeit),
    'the forfeit was not found by its reference');
  BEGIN
    PERFORM pg_temp.gc_assert(piggyvest_primary.settle_goal_cancel_forfeit(c_integration, 'staging',
        pg_temp.gf_forfeit_proof(v_forfeit) || '{"residualKobo":5}'::jsonb) = 'conflict'
      AND pg_temp.gf_forfeit(v_op, 'state') = 'needs_review',
      'money left in the goal wallet after the forfeit was not reviewed');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
  PERFORM pg_temp.gc_assert(piggyvest_primary.settle_goal_cancel_forfeit(c_integration, 'staging',
      pg_temp.gf_forfeit_proof(v_forfeit) || '{"amountKobo":12001}'::jsonb) = 'conflict',
    'a forfeit proof for another amount settled');
  PERFORM pg_temp.gc_assert(piggyvest_primary.settle_goal_cancel_forfeit(c_integration, 'staging',
      pg_temp.gf_forfeit_proof(v_forfeit)) = 'confirmed', 'the forfeit did not settle');
  PERFORM pg_temp.gc_assert(pg_temp.gf_forfeit(v_op, 'state') = 'confirmed'
    AND EXISTS (SELECT 1 FROM public.customer_savings_events
                 WHERE goal_id = c_goal::uuid AND event_type = 'goal_cancel_interest_forfeited'
                   AND metadata ->> 'amount_kobo' = '12000'
                   AND metadata ->> 'operation_id' = v_op
                   AND metadata ->> 'forfeit_id' = v_forfeit),
    'the forfeited interest is not recorded distinctly');
  PERFORM pg_temp.gc_assert(piggyvest_primary.settle_goal_cancel_forfeit(c_integration, 'staging',
      pg_temp.gf_forfeit_proof(v_forfeit)) = 'duplicate', 'a forfeit replay was not a duplicate');
  PERFORM pg_temp.gc_assert(piggyvest_primary.claim_goal_cancel_forfeit(v_scope, v_op::uuid) ->> 'status' = 'confirmed',
    'a confirmed forfeit did not read confirmed');
  -- The customer's main-wallet availability counts the principal only.
  PERFORM pg_temp.gc_assert((SELECT pg_catalog.sum(amount_kobo) FROM piggyvest_primary.goal_cancel_operations
                              WHERE state IN ('confirmed', 'needs_review', 'reviewed')) = 250000,
    'the refunded amount on record includes the interest');
END
$behaviour$;

-- Rejection and release paths (separate block so the goal starts open again).
DO $release$
DECLARE
  c_goal constant text := 'f3860000-0000-4000-8000-000000000005';
  c_integration constant uuid := 'f3860000-0000-4000-8000-000000000006';
  v_scope jsonb := pg_temp.gc_scope();
  v_op text;
  v_forfeit text;
  v_result jsonb;
BEGIN
  DELETE FROM piggyvest_primary.goal_cancel_interest_forfeits;
  UPDATE piggyvest_primary.goal_cancel_operations SET state = 'released'
   WHERE state IN ('confirmed', 'dispatched', 'reserved');
  UPDATE public.customer_savings_goals SET status = 'active', current_amount = 2500, cancelled_at = NULL
   WHERE id = c_goal::uuid;

  -- 10. The customer's transfer is definitively rejected: the planned forfeit
  --     is released with it and never sent.
  v_op := pg_temp.gc_reserved('principal-rejected');
  PERFORM pg_temp.gc_assert(pg_temp.gf_split(v_op, 262000) ->> 'status' = 'dispatched', 'split for rejection');
  PERFORM pg_temp.gc_assert(piggyvest_primary.manage_goal_cancel(v_scope, v_op::uuid, 'release', 0), 'release');
  PERFORM pg_temp.gc_assert(pg_temp.gf_forfeit(v_op, 'state') = 'released'
    AND piggyvest_primary.claim_goal_cancel_forfeit(v_scope, v_op::uuid) ->> 'status' = 'none',
    'a rejected cancel still had a sendable forfeit');

  -- References are never reused: the next forfeit takes a fresh suffix.
  v_op := pg_temp.gc_reserved('forfeit-rejected');
  PERFORM pg_temp.gc_assert(pg_temp.gf_split(v_op, 262000) ->> 'status' = 'dispatched', 'second split');
  PERFORM pg_temp.gc_assert(pg_temp.gf_forfeit(v_op, 'reference') = 'pvb-forfeit-' || c_goal || '-1',
    'a forfeit reference was reused: ' || pg_temp.gf_forfeit(v_op, 'reference'));
  PERFORM pg_temp.gc_assert(pg_temp.gc_settle(pg_temp.gc_proof(v_op)) = 'confirmed', 'principal settle');

  -- 11. A definitively rejected forfeit is released and replaced by a fresh
  --     reference; after three rejections it goes to review instead.
  PERFORM piggyvest_primary.claim_goal_cancel_forfeit(v_scope, v_op::uuid);
  v_forfeit := pg_temp.gf_forfeit(v_op, 'id');
  BEGIN
    PERFORM piggyvest_primary.manage_goal_cancel_forfeit(v_scope, v_forfeit::uuid, 'bogus');
    RAISE EXCEPTION 'an unknown forfeit action was accepted' USING ERRCODE = 'PVT00';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
END
$release$;

DO $replace$
DECLARE
  c_goal constant text := 'f3860000-0000-4000-8000-000000000005';
  c_integration constant uuid := 'f3860000-0000-4000-8000-000000000006';
  v_scope jsonb := pg_temp.gc_scope();
  v_op text := (SELECT id::text FROM piggyvest_primary.goal_cancel_operations WHERE state = 'confirmed');
  v_forfeit text;
  v_round integer;
BEGIN
  -- Round 1 is a provider-reported failure (evidence release), rounds 2 and 3
  -- are definitive rejections at submit (authorizer release).
  FOR v_round IN 1..3 LOOP
    PERFORM piggyvest_primary.claim_goal_cancel_forfeit(v_scope, v_op::uuid);
    v_forfeit := pg_temp.gf_forfeit(v_op, 'id');
    PERFORM pg_temp.gc_assert(pg_temp.gf_forfeit(v_op, 'state') = 'dispatched', 'round ' || v_round || ' not dispatched');
    IF v_round = 1 THEN
      PERFORM pg_temp.gc_assert(piggyvest_primary.release_failed_goal_cancel_forfeit(c_integration, 'staging',
          pg_temp.gf_forfeit_proof(v_forfeit, 'failed')) = 'released', 'the evidence release refused');
      PERFORM pg_temp.gc_assert(piggyvest_primary.release_failed_goal_cancel_forfeit(c_integration, 'staging',
          pg_temp.gf_forfeit_proof(v_forfeit, 'failed')) = 'duplicate', 'an evidence release replay was not a duplicate');
    ELSE
      PERFORM pg_temp.gc_assert(piggyvest_primary.manage_goal_cancel_forfeit(v_scope, v_forfeit::uuid, 'release'),
        'round ' || v_round || ' release refused');
    END IF;
    PERFORM pg_temp.gc_assert(
      (SELECT state FROM piggyvest_primary.goal_cancel_interest_forfeits WHERE id = v_forfeit::uuid)
        = CASE WHEN v_round < 3 THEN 'released' ELSE 'needs_review' END,
      'round ' || v_round || ' left the wrong state');
  END LOOP;
  PERFORM pg_temp.gc_assert((SELECT pg_catalog.count(*) FROM piggyvest_primary.goal_cancel_interest_forfeits
                              WHERE cancel_operation_id = v_op::uuid) = 3
    AND (SELECT pg_catalog.count(DISTINCT reference) FROM piggyvest_primary.goal_cancel_interest_forfeits) = 4
    AND piggyvest_primary.claim_goal_cancel_forfeit(v_scope, v_op::uuid) ->> 'status' = 'needs_review',
    'forfeit replacements are unbounded or reuse references');

  -- 12. Grants: customer-side functions for the authorizer, settlement for the
  --     evidence login, nothing for anyone else.
  PERFORM pg_temp.gc_assert(
    has_function_privilege('piggyvest_primary_authorizer', 'piggyvest_primary.dispatch_goal_cancel_split(jsonb,uuid,bigint)', 'EXECUTE')
    AND has_function_privilege('piggyvest_primary_authorizer', 'piggyvest_primary.claim_goal_cancel_forfeit(jsonb,uuid)', 'EXECUTE')
    AND has_function_privilege('piggyvest_primary_authorizer', 'piggyvest_primary.manage_goal_cancel_forfeit(jsonb,uuid,text)', 'EXECUTE')
    AND has_function_privilege('piggyvest_primary_authorizer', 'piggyvest_primary.read_goal_cancel_amounts(jsonb,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('piggyvest_primary_authorizer', 'piggyvest_primary.settle_goal_cancel_forfeit(uuid,text,jsonb)', 'EXECUTE')
    AND has_function_privilege('piggyvest_primary_evidence', 'piggyvest_primary.settle_goal_cancel_forfeit(uuid,text,jsonb)', 'EXECUTE')
    AND has_function_privilege('piggyvest_primary_evidence', 'piggyvest_primary.release_failed_goal_cancel_forfeit(uuid,text,jsonb)', 'EXECUTE')
    AND has_function_privilege('piggyvest_primary_evidence', 'piggyvest_primary.read_dispatched_goal_cancel_forfeit(uuid,text,uuid)', 'EXECUTE')
    AND has_function_privilege('piggyvest_primary_evidence', 'piggyvest_primary.find_dispatched_goal_cancel_forfeit_by_reference(uuid,text,text)', 'EXECUTE')
    AND NOT has_function_privilege('piggyvest_primary_evidence', 'piggyvest_primary.dispatch_goal_cancel_split(jsonb,uuid,bigint)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'piggyvest_primary.dispatch_goal_cancel_split(jsonb,uuid,bigint)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'piggyvest_primary.claim_goal_cancel_forfeit(jsonb,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'piggyvest_primary.settle_goal_cancel_forfeit(uuid,text,jsonb)', 'EXECUTE')
    AND NOT has_table_privilege('service_role', 'piggyvest_primary.goal_cancel_interest_forfeits', 'SELECT')
    AND NOT has_table_privilege('piggyvest_primary_authorizer', 'piggyvest_primary.goal_interest_forfeit_wallets', 'SELECT'),
    'the forfeit functions are granted to the wrong roles');
END
$replace$;

-- 13. Catalog: both new tables are row-level-secured and closed; every new
--     function is SECURITY DEFINER with an empty search_path and not PUBLIC.
DO $catalog$
DECLARE
  v_signature text;
  v_oid regprocedure;
BEGIN
  PERFORM pg_temp.gc_assert(COALESCE((SELECT bool_and(class.relrowsecurity) FROM pg_catalog.pg_class AS class
    WHERE class.oid IN ('piggyvest_primary.goal_cancel_interest_forfeits'::regclass,
                        'piggyvest_primary.goal_interest_forfeit_wallets'::regclass)), false),
    'a forfeit table has no row level security');
  FOREACH v_signature IN ARRAY ARRAY[
    'piggyvest_primary.dispatch_goal_cancel_split(jsonb,uuid,bigint)',
    'piggyvest_primary.read_goal_cancel_amounts(jsonb,uuid)',
    'piggyvest_primary.release_goal_cancel_forfeit_row(uuid)',
    'piggyvest_primary.claim_goal_cancel_forfeit(jsonb,uuid)',
    'piggyvest_primary.manage_goal_cancel_forfeit(jsonb,uuid,text)',
    'piggyvest_primary.assert_goal_cancel_evidence(uuid,text)',
    'piggyvest_primary.read_dispatched_goal_cancel_forfeit(uuid,text,uuid)',
    'piggyvest_primary.find_dispatched_goal_cancel_forfeit_by_reference(uuid,text,text)',
    'piggyvest_primary.lock_goal_cancel_forfeit_for_proof(piggyvest_primary.integrations,jsonb)',
    'piggyvest_primary.settle_goal_cancel_forfeit(uuid,text,jsonb)',
    'piggyvest_primary.release_failed_goal_cancel_forfeit(uuid,text,jsonb)',
    'piggyvest_primary.release_unsent_goal_cancel_forfeit()',
    'piggyvest_primary.block_in_flight_goal_cancel_forfeit_customer_deletion()'
  ] LOOP
    v_oid := v_signature::regprocedure;
    PERFORM pg_temp.gc_assert((SELECT proc.prosecdef AND proc.proconfig @> ARRAY['search_path=""']
                                 FROM pg_catalog.pg_proc AS proc WHERE proc.oid = v_oid),
      v_signature || ' must be SECURITY DEFINER with an empty search_path');
    PERFORM pg_temp.gc_assert(NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS proc,
             pg_catalog.aclexplode(COALESCE(proc.proacl, pg_catalog.acldefault('f', proc.proowner))) AS acl
       WHERE proc.oid = v_oid AND acl.grantee = 0), v_signature || ' must not be executable by PUBLIC');
  END LOOP;
END
$catalog$;

ROLLBACK;
