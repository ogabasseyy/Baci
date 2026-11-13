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

-- The sweep's work list without the per-forfeit id, for exact comparisons.
CREATE FUNCTION pg_temp.gf_work(p_limit integer, p_unsent boolean) RETURNS jsonb LANGUAGE sql AS $$
  SELECT COALESCE(pg_catalog.jsonb_agg(item.value - 'forfeitId' ORDER BY item.ordinality), '[]'::jsonb)
    FROM pg_catalog.jsonb_array_elements(piggyvest_primary.list_goal_cancel_forfeit_work(
      'f3860000-0000-4000-8000-000000000006', 'staging', p_limit, p_unsent)) WITH ORDINALITY AS item;
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
  -- Held: a retry can not succeed until the wallet is set up, so no new
  -- cancel starts until an operator clears it.
  PERFORM pg_temp.gc_assert(pg_temp.gc_issue_op() = '{"status":"needs_review"}'::jsonb,
    'a new cancel started while the interest wallet is still missing');
  UPDATE piggyvest_primary.goal_cancel_operations SET held_reason = NULL WHERE id = v_op::uuid;

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
  -- The shortfall is held: no new cancel starts until an operator clears it.
  PERFORM pg_temp.gc_assert(pg_temp.gc_issue_op() = '{"status":"needs_review"}'::jsonb,
    'a new cancel started over an uncleared shortfall');
  UPDATE piggyvest_primary.goal_cancel_operations SET held_reason = NULL WHERE id = v_op::uuid;

  -- Invalid balances are refused outright.
  v_op := pg_temp.gc_reserved('bad-balance');
  FOREACH v_text IN ARRAY ARRAY['0', '-1', '1000000000000000'] LOOP
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
      AND pg_temp.gf_forfeit(v_op, 'state') = 'needs_review'
      -- Regression: not stamped before anyone is paged; the daily sweep pages
      -- it until a page is acknowledged.
      AND pg_temp.gf_forfeit(v_op, 'alerted_at') IS NULL
      AND pg_temp.gf_work(10, true) @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'operationId', v_op, 'state', 'needs_review', 'alert', true))
      -- Regression: once the evidence side has paged it and acknowledged,
      -- the sweep does not page the same review again.
      AND piggyvest_primary.ack_goal_cancel_forfeit_alert_evidence(c_integration, 'staging', v_forfeit::uuid)
      AND NOT pg_catalog.jsonb_path_exists(pg_temp.gf_work(10, true), '$[*] ? (@.alert == true)')
      AND has_function_privilege('piggyvest_primary_evidence',
            'piggyvest_primary.ack_goal_cancel_forfeit_alert_evidence(uuid,text,uuid)', 'EXECUTE')
      AND NOT has_function_privilege('piggyvest_primary_authorizer',
            'piggyvest_primary.ack_goal_cancel_forfeit_alert_evidence(uuid,text,uuid)', 'EXECUTE'),
      'money left in the goal wallet after the forfeit was not reviewed, or its page could be lost or repeated');
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
  -- Regression: a plan already moved to review (never sent) is released with
  -- the cancel too, so nobody is paged to forfeit interest of a cancel that
  -- did not happen.
  v_op := pg_temp.gc_reserved('review-then-rejected');
  PERFORM pg_temp.gc_assert(pg_temp.gf_split(v_op, 262000) ->> 'status' = 'dispatched', 'split');
  UPDATE piggyvest_primary.goal_cancel_interest_forfeits SET state = 'needs_review'
   WHERE cancel_operation_id = v_op::uuid;
  PERFORM pg_temp.gc_assert(piggyvest_primary.manage_goal_cancel(v_scope, v_op::uuid, 'release', 0), 'release');
  PERFORM pg_temp.gc_assert(pg_temp.gf_forfeit(v_op, 'state') = 'released',
    'an unsent review plan survived its released cancel');

  -- A cancel settled into review whose review an operator clears retires its
  -- unsent forfeit too (no unreachable reserved row is left behind).
  BEGIN
    v_op := pg_temp.gc_reserved('review-cleared');
    PERFORM pg_temp.gc_assert(pg_temp.gf_split(v_op, 262000) ->> 'status' = 'dispatched', 'split for review');
    PERFORM pg_temp.gc_assert(
      pg_temp.gc_settle(pg_temp.gc_proof(v_op) || '{"residualKobo":20000}'::jsonb) = 'conflict', 'review settle');
    PERFORM pg_temp.gc_assert(piggyvest_primary.clear_goal_cancel_review(v_op::uuid, 'checked'), 'clear');
    PERFORM pg_temp.gc_assert(pg_temp.gf_forfeit(v_op, 'state') = 'released'
      AND piggyvest_primary.claim_goal_cancel_forfeit(v_scope, v_op::uuid) ->> 'status' = 'none',
      'a cleared review left its forfeit live');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;

  -- References are never reused: the next forfeit takes a fresh suffix.
  v_op := pg_temp.gc_reserved('forfeit-rejected');
  PERFORM pg_temp.gc_assert(pg_temp.gf_split(v_op, 262000) ->> 'status' = 'dispatched', 'second split');
  PERFORM pg_temp.gc_assert(pg_temp.gf_forfeit(v_op, 'reference') = 'pvb-forfeit-' || c_goal || '-2',
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
      -- The third rejection answers needs_review so the caller pages.
      PERFORM pg_temp.gc_assert(piggyvest_primary.manage_goal_cancel_forfeit(v_scope, v_forfeit::uuid, 'release')
          = CASE WHEN v_round < 3 THEN 'released' ELSE 'needs_review' END,
        'round ' || v_round || ' release answered wrongly');
    END IF;
    PERFORM pg_temp.gc_assert(
      (SELECT state FROM piggyvest_primary.goal_cancel_interest_forfeits WHERE id = v_forfeit::uuid)
        = CASE WHEN v_round < 3 THEN 'released' ELSE 'needs_review' END,
      'round ' || v_round || ' left the wrong state');
  END LOOP;
  PERFORM pg_temp.gc_assert((SELECT pg_catalog.count(*) FROM piggyvest_primary.goal_cancel_interest_forfeits
                              WHERE cancel_operation_id = v_op::uuid) = 3
    AND (SELECT pg_catalog.count(DISTINCT reference) FROM piggyvest_primary.goal_cancel_interest_forfeits) = 5
    -- Regression: the cap is not stamped before the page is emitted; the
    -- claim keeps alerting until the caller acknowledges, then never again.
    AND piggyvest_primary.claim_goal_cancel_forfeit(v_scope, v_op::uuid)
      = pg_catalog.jsonb_build_object('status', 'needs_review', 'forfeitId', v_forfeit, 'alert', true)
    AND piggyvest_primary.manage_goal_cancel_forfeit(v_scope, v_forfeit::uuid, 'ack') = 'acked'
    AND piggyvest_primary.manage_goal_cancel_forfeit(v_scope, v_forfeit::uuid, 'ack') = 'not_released'
    AND piggyvest_primary.claim_goal_cancel_forfeit(v_scope, v_op::uuid)
      = pg_catalog.jsonb_build_object('status', 'needs_review', 'forfeitId', v_forfeit),
    'forfeit replacements are unbounded or reuse references, or the cap paged twice');
  -- Regression: a forfeit still stuck a day after its last page is paged
  -- again (never paged once and then left silent).
  UPDATE piggyvest_primary.goal_cancel_interest_forfeits
     SET alerted_at = pg_catalog.clock_timestamp() - interval '2 days' WHERE id = v_forfeit::uuid;
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.claim_goal_cancel_forfeit(v_scope, v_op::uuid)
      = pg_catalog.jsonb_build_object('status', 'needs_review', 'forfeitId', v_forfeit, 'alert', true)
    AND piggyvest_primary.manage_goal_cancel_forfeit(v_scope, v_forfeit::uuid, 'ack') = 'acked'
    AND piggyvest_primary.claim_goal_cancel_forfeit(v_scope, v_op::uuid)
      = pg_catalog.jsonb_build_object('status', 'needs_review', 'forfeitId', v_forfeit),
    'a forfeit stuck a day after its page was never paged again');
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.manage_goal_cancel_forfeit(v_scope, v_forfeit::uuid, 'release') = 'not_released',
    'an undispatched forfeit was released');

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

-- 14. The scheduled worker sweep: lists forfeits nobody's status check picked
--     up, sends them (following a rotated wallet), pages an overdue one once;
--     a late success of a released forfeit is found and refused; the
--     customer can not be deleted while a forfeit is planned.
DO $worker$
DECLARE
  c_goal constant text := 'f3860000-0000-4000-8000-000000000005';
  c_integration constant uuid := 'f3860000-0000-4000-8000-000000000006';
  v_scope jsonb := pg_temp.gc_scope();
  v_op text;
  v_forfeit text;
  v_old_ref text;
  v_result jsonb;
BEGIN
  DELETE FROM piggyvest_primary.goal_cancel_interest_forfeits;
  UPDATE piggyvest_primary.goal_cancel_operations SET state = 'released'
   WHERE state IN ('confirmed', 'dispatched', 'reserved', 'needs_review');
  UPDATE public.customer_savings_goals SET status = 'active', current_amount = 2500, cancelled_at = NULL
   WHERE id = c_goal::uuid;
  v_op := pg_temp.gc_reserved('worker');
  PERFORM pg_temp.gc_assert(pg_temp.gf_split(v_op, 262000) ->> 'status' = 'dispatched', 'worker split');
  -- Nothing to do while the principal is still in flight.
  PERFORM pg_temp.gc_assert(
    pg_temp.gf_work(10, true) = '[]'::jsonb,
    'the sweep listed a forfeit behind an unconfirmed principal');
  -- The customer can not be deleted while the forfeit is planned.
  BEGIN
    DELETE FROM public.customers WHERE id = 'f3860000-0000-4000-8000-000000000003';
    RAISE EXCEPTION 'a customer with a planned forfeit was deleted' USING ERRCODE = 'PVT00';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
  PERFORM pg_temp.gc_assert(pg_temp.gc_settle(pg_temp.gc_proof(v_op) || '{"residualKobo":12000}'::jsonb) = 'confirmed',
    'worker principal settle');
  PERFORM pg_temp.gc_assert(
    pg_temp.gf_work(10, true)
      = pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('operationId', v_op, 'state', 'reserved', 'alert', false)),
    'the sweep did not list the unsent forfeit');
  -- While new transfers are off, unsent work is not listed (only in-flight).
  PERFORM pg_temp.gc_assert(
    pg_temp.gf_work(10, false) = '[]'::jsonb,
    'the switched-off sweep listed unsent work');
  BEGIN
    PERFORM pg_temp.gf_work(0, true);
    RAISE EXCEPTION 'an invalid sweep limit was accepted' USING ERRCODE = 'PVT00';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM piggyvest_primary.list_goal_cancel_forfeit_work(c_integration, 'production', 10, true);
    RAISE EXCEPTION 'a foreign environment was swept' USING ERRCODE = 'PVT00';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  -- The operator rotated the interest wallet before the forfeit was sent.
  UPDATE piggyvest_primary.goal_interest_forfeit_wallets
     SET provider_wallet_id = 'synthetic-goalcancel-interest-wallet-2'
   WHERE integration_id = c_integration;
  v_result := piggyvest_primary.claim_goal_cancel_forfeit_worker(c_integration, 'staging', v_op::uuid);
  PERFORM pg_temp.gc_assert(v_result ->> 'status' = 'claimed'
    AND v_result #>> '{forfeit,destinationWalletId}' = 'synthetic-goalcancel-interest-wallet-2'
    AND v_result #>> '{forfeit,businessId}' = 'synthetic-goalcancel-business'
    AND pg_temp.gf_forfeit(v_op, 'destination_wallet_id') = 'synthetic-goalcancel-interest-wallet-2',
    'the worker claim did not follow the rotated wallet: ' || v_result::text);
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.claim_goal_cancel_forfeit_worker(c_integration, 'staging', v_op::uuid) ->> 'status' = 'pending',
    'a dispatched forfeit was claimed twice by the worker');
  v_forfeit := pg_temp.gf_forfeit(v_op, 'id');
  -- An in-flight forfeit is listed for settlement; a day overdue pages until
  -- the sweep acknowledges the page it emitted, then never again.
  UPDATE piggyvest_primary.goal_cancel_interest_forfeits
     SET dispatched_at = pg_catalog.clock_timestamp() - interval '2 days' WHERE id = v_forfeit::uuid;
  -- Regression: listing alone never stamps the alert, so a lost answer or a
  -- crash before the page can not suppress it.
  PERFORM pg_temp.gc_assert(
    pg_temp.gf_work(10, true) -> 0 ->> 'alert' = 'true'
    AND pg_temp.gf_work(10, true) -> 0 ->> 'alert' = 'true',
    'listing an overdue forfeit stamped its alert before the page was emitted');
  PERFORM pg_temp.gc_assert(
    (piggyvest_primary.list_goal_cancel_forfeit_work(c_integration, 'staging', 10, true) -> 0 ->> 'forfeitId') = v_forfeit
    AND piggyvest_primary.ack_goal_cancel_forfeit_alert_worker(c_integration, 'staging', v_forfeit::uuid)
    AND NOT piggyvest_primary.ack_goal_cancel_forfeit_alert_worker(c_integration, 'staging', v_forfeit::uuid)
    AND pg_temp.gf_work(10, true) -> 0 ->> 'alert' = 'false',
    'an acknowledged overdue forfeit paged again');
  -- Regression: still stuck a day after that page, it is paged again.
  UPDATE piggyvest_primary.goal_cancel_interest_forfeits
     SET alerted_at = pg_catalog.clock_timestamp() - interval '2 days' WHERE id = v_forfeit::uuid;
  PERFORM pg_temp.gc_assert(
    pg_temp.gf_work(10, true) -> 0 ->> 'alert' = 'true'
    AND piggyvest_primary.ack_goal_cancel_forfeit_alert_worker(c_integration, 'staging', v_forfeit::uuid)
    AND pg_temp.gf_work(10, true) -> 0 ->> 'alert' = 'false',
    'a transfer still stuck a day after its page was never paged again');
  -- An already-paged stuck transfer never starves newer work: an unsent
  -- forfeit of another cancel comes first in a window of one.
  INSERT INTO piggyvest_primary.goal_cancel_operations (
    id, integration_id, intent_id, goal_id, state, reference, source_wallet_id, destination_wallet_id,
    amount_kobo, forfeited_interest_kobo, provider_transaction_id, issued_at, expires_at, reserved_at,
    dispatched_at, settled_at)
  VALUES ('f3860000-0000-4000-8000-0000000000d1', c_integration, 'f3860000-0000-4000-8000-000000000007',
    'f3860000-0000-4000-8000-0000000000d2', 'confirmed', 'pvb-cancel-f3860000-0000-4000-8000-0000000000d2',
    'synthetic-goalcancel-goal-wallet-2', 'synthetic-goalcancel-main', 100, 5, 'synthetic-gf-other',
    pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());
  INSERT INTO piggyvest_primary.goal_cancel_interest_forfeits (
    cancel_operation_id, integration_id, intent_id, goal_id, state, reference,
    source_wallet_id, destination_wallet_id, amount_kobo, reserved_at)
  VALUES ('f3860000-0000-4000-8000-0000000000d1', c_integration, 'f3860000-0000-4000-8000-000000000007',
    'f3860000-0000-4000-8000-0000000000d2', 'reserved', 'pvb-forfeit-f3860000-0000-4000-8000-0000000000d2',
    'synthetic-goalcancel-goal-wallet-2', 'synthetic-goalcancel-interest-wallet-2', 5,
    pg_catalog.clock_timestamp());
  PERFORM pg_temp.gc_assert(
    pg_temp.gf_work(1, true)
      = '[{"operationId":"f3860000-0000-4000-8000-0000000000d1","state":"reserved","alert":false}]'::jsonb,
    'an already-paged stuck transfer starved newer work');
  DELETE FROM piggyvest_primary.goal_cancel_interest_forfeits
   WHERE cancel_operation_id = 'f3860000-0000-4000-8000-0000000000d1';
  -- A definitive rejection through the worker releases and replaces it.
  v_old_ref := pg_temp.gf_forfeit(v_op, 'reference');
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.release_goal_cancel_forfeit_worker(c_integration, 'staging', v_forfeit::uuid) = 'released'
    AND piggyvest_primary.release_goal_cancel_forfeit_worker(c_integration, 'staging', v_forfeit::uuid) = 'not_released',
    'the worker release answered wrongly');
  -- PiggyVest later reports the released reference successful: it is found
  -- and readable, and settlement refuses it (pages) instead of settling.
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.find_dispatched_goal_cancel_forfeit_by_reference(c_integration, 'staging', v_old_ref)
      = pg_catalog.jsonb_build_object('operationId', v_forfeit)
    AND piggyvest_primary.read_dispatched_goal_cancel_forfeit(c_integration, 'staging', v_forfeit::uuid) IS NOT NULL,
    'a late success of a released forfeit is unreachable');
  PERFORM pg_temp.gc_assert(pg_temp.gf_forfeit(v_op, 'state') = 'reserved', 'no replacement was planned');
  -- Regression: even a replacement already sent is frozen by a late success
  -- of the old reference, so the same interest can not move twice.
  BEGIN
    PERFORM piggyvest_primary.claim_goal_cancel_forfeit_worker(c_integration, 'staging', v_op::uuid);
    PERFORM pg_temp.gc_assert(pg_temp.gf_forfeit(v_op, 'state') = 'dispatched', 'replacement not sent');
    -- Regression: the frozen replacement is named, so the caller
    -- acknowledges it with the one page for this incident.
    PERFORM pg_temp.gc_assert(piggyvest_primary.settle_goal_cancel_forfeit(c_integration, 'staging',
        pg_temp.gf_forfeit_proof(v_forfeit))
        = 'conflict:' || (SELECT id::text FROM piggyvest_primary.goal_cancel_interest_forfeits
                           WHERE cancel_operation_id = v_op::uuid AND id <> v_forfeit::uuid
                             AND state = 'dispatched'),
      'late success settled, or the frozen replacement was not named');
    PERFORM pg_temp.gc_assert(pg_temp.gf_forfeit(v_op, 'state') = 'needs_review',
      'a sent replacement stayed live after the old reference succeeded late');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
  -- Regression: a replacement already marked posting stays findable for its
  -- own provider record, but is flagged to settle into review.
  BEGIN
    PERFORM piggyvest_primary.claim_goal_cancel_forfeit_worker(c_integration, 'staging', v_op::uuid);
    UPDATE piggyvest_primary.goal_cancel_interest_forfeits SET posted_at = pg_catalog.clock_timestamp()
     WHERE cancel_operation_id = v_op::uuid AND state = 'dispatched';
    PERFORM pg_temp.gc_assert(piggyvest_primary.settle_goal_cancel_forfeit(c_integration, 'staging',
        pg_temp.gf_forfeit_proof(v_forfeit)) = 'conflict', 'posted late success');
    PERFORM pg_temp.gc_assert(
      (SELECT state || '/' || review_on_settle FROM piggyvest_primary.goal_cancel_interest_forfeits
        WHERE cancel_operation_id = v_op::uuid AND id <> v_forfeit::uuid AND posted_at IS NOT NULL)
        = 'dispatched/true',
      'a posted replacement was hidden from its provider record, or not flagged for review');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
  PERFORM pg_temp.gc_assert(piggyvest_primary.settle_goal_cancel_forfeit(c_integration, 'staging',
      pg_temp.gf_forfeit_proof(v_forfeit)) LIKE 'conflict%',
    'a late success of a released forfeit settled automatically');
  -- Regression: a redelivery of the same late success is a duplicate (no
  -- second page), and the old reference is no longer matched.
  PERFORM pg_temp.gc_assert(piggyvest_primary.settle_goal_cancel_forfeit(c_integration, 'staging',
      pg_temp.gf_forfeit_proof(v_forfeit)) = 'duplicate'
    AND piggyvest_primary.find_dispatched_goal_cancel_forfeit_by_reference(c_integration, 'staging', v_old_ref) IS NULL,
    'a redelivered late success paged again');
  -- The money moved under the old reference: the replacement is frozen, so
  -- nothing can send the interest a second time.
  -- Only listed to be paged (until a page is acknowledged), never to send.
  PERFORM pg_temp.gc_assert(pg_temp.gf_forfeit(v_op, 'state') = 'needs_review'
    AND NOT pg_catalog.jsonb_path_exists(pg_temp.gf_work(10, true), '$[*] ? (@.state != "needs_review")')
    AND piggyvest_primary.claim_goal_cancel_forfeit_worker(c_integration, 'staging', v_op::uuid) ->> 'status' = 'needs_review',
    'a late success left the replacement sendable');
  PERFORM pg_temp.gc_assert(
    has_function_privilege('piggyvest_primary_authorizer', 'piggyvest_primary.list_goal_cancel_forfeit_work(uuid,text,integer,boolean)', 'EXECUTE')
    AND has_function_privilege('piggyvest_primary_authorizer', 'piggyvest_primary.claim_goal_cancel_forfeit_worker(uuid,text,uuid)', 'EXECUTE')
    AND has_function_privilege('piggyvest_primary_authorizer', 'piggyvest_primary.release_goal_cancel_forfeit_worker(uuid,text,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('piggyvest_primary_evidence', 'piggyvest_primary.claim_goal_cancel_forfeit_worker(uuid,text,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('piggyvest_primary_authorizer', 'piggyvest_primary.claim_goal_cancel_forfeit_core(uuid,text,text)', 'EXECUTE'),
    'the worker functions are granted to the wrong roles');
END
$worker$;

-- 15. Interest PiggyVest pays into the goal wallet after the cancel is
--     forfeited too: it plans (or merges into) an unsent forfeit, and a
--     payout to a goal with no live cancel plans nothing.
SET LOCAL session_replication_role = replica;
INSERT INTO piggyvest_primary.paid_interest_crosswalks(id, integration_id, goal_id, api_wallet_id,
  api_customer_id, onboarding_customer_id, webhook_customer_id, source_wallet_id, accrued_wallet_id,
  destination_wallet_id, envelope_destination_wallet_id, provider_evidence_sha256,
  policy_evidence_sha256, policy_reference, allocation_policy, enabled)
VALUES ('f3860000-0000-4000-8000-0000000000c1', 'f3860000-0000-4000-8000-000000000006',
  'f3860000-0000-4000-8000-000000000005', 'gf-api-wallet', 'gf-api-customer', 'gf-onboarding-customer',
  'gf-webhook-customer', 'gf-source', 'gf-accrued', 'synthetic-goalcancel-goal-wallet', NULL,
  repeat('a', 64), repeat('b', 64), 'synthetic-goal-cancel-forfeit-fixture',
  'provider_net_is_customer_plan_interest', true);
SET LOCAL session_replication_role = origin;
CREATE FUNCTION pg_temp.gf_receipt(p_payout text, p_net bigint,
  p_paid_at timestamptz DEFAULT pg_catalog.clock_timestamp()) RETURNS void LANGUAGE sql AS $$
  INSERT INTO piggyvest_primary.paid_interest_receipts(integration_id, payout_id, crosswalk_id,
    goal_id, merchant_id, customer_id, net_kobo, financial_identity, body_digest)
  VALUES ('f3860000-0000-4000-8000-000000000006', p_payout, 'f3860000-0000-4000-8000-0000000000c1',
    'f3860000-0000-4000-8000-000000000005', 'f3860000-0000-4000-8000-000000000002',
    'f3860000-0000-4000-8000-000000000003', p_net,
    jsonb_build_object('payoutId', p_payout, 'paidAt', p_paid_at), repeat('a', 64));
$$;
DO $late$
DECLARE
  v_text text;
  c_goal constant text := 'f3860000-0000-4000-8000-000000000005';
  c_integration constant uuid := 'f3860000-0000-4000-8000-000000000006';
  v_scope jsonb := pg_temp.gc_scope();
  v_op text;
  v_forfeit text;
BEGIN
  DELETE FROM piggyvest_primary.goal_cancel_interest_forfeits;
  UPDATE piggyvest_primary.goal_cancel_operations SET state = 'released'
   WHERE state IN ('confirmed', 'dispatched', 'reserved', 'needs_review');
  UPDATE public.customer_savings_goals SET status = 'active', current_amount = 2500, cancelled_at = NULL
   WHERE id = c_goal::uuid;
  -- No live cancel: an ordinary payout plans nothing.
  PERFORM pg_temp.gf_receipt('gf-before', 700);
  PERFORM pg_temp.gc_assert(NOT EXISTS (SELECT 1 FROM piggyvest_primary.goal_cancel_interest_forfeits),
    'a payout to a goal with no cancel planned a forfeit');
  v_op := pg_temp.gc_reserved('late');
  PERFORM pg_temp.gc_assert(pg_temp.gf_split(v_op, 262000) ->> 'status' = 'dispatched', 'late split');
  -- Paid while the principal is in flight: merges into the unsent forfeit,
  -- and the "interest added to your savings" notice is voided.
  INSERT INTO savings_notifications.events (merchant_id, customer_id, goal_id, event_key, type, title, body)
  VALUES ('f3860000-0000-4000-8000-000000000002', 'f3860000-0000-4000-8000-000000000003', c_goal::uuid,
    'primary-interest:' || c_integration::text || ':gf-during', 'interest_credited', 'Interest', 'Interest')
  ON CONFLICT DO NOTHING;
  -- Regression (double count): interest PiggyVest paid BEFORE the balance
  -- read is already inside the planned forfeit, so a late receipt for it
  -- plans nothing more.
  PERFORM pg_temp.gf_receipt('gf-before-read', 900, pg_catalog.clock_timestamp() - interval '1 hour');
  PERFORM pg_temp.gc_assert(pg_temp.gf_forfeit(v_op, 'amount_kobo')::bigint = 12000
    AND (SELECT forfeited_interest_kobo FROM piggyvest_primary.goal_cancel_operations WHERE id = v_op::uuid) = 12000,
    'interest already inside the planned forfeit was counted twice');
  PERFORM pg_temp.gf_receipt('gf-during', 500);
  -- While the principal is in flight the notice stays (the cancel may fail).
  PERFORM pg_temp.gc_assert((SELECT voided_at IS NULL FROM savings_notifications.events
                              WHERE event_key = 'primary-interest:' || c_integration::text || ':gf-during'),
    'the interest notice was voided before the cancel was confirmed');
  PERFORM pg_temp.gc_assert((SELECT pg_catalog.count(*) FROM piggyvest_primary.goal_cancel_interest_forfeits) = 1
    AND pg_temp.gf_forfeit(v_op, 'amount_kobo')::bigint = 12500,
    'interest paid during the cancel was not merged into the unsent forfeit');
  -- Regression (stale figure): the cancel's forfeited total, which the app
  -- shows as interest not refunded, includes the late payout.
  PERFORM pg_temp.gc_assert(
    (SELECT forfeited_interest_kobo FROM piggyvest_primary.goal_cancel_operations WHERE id = v_op::uuid) = 12500,
    'the forfeited interest shown to the customer stayed at the dispatch-time figure');
  PERFORM pg_temp.gc_assert(
    pg_temp.gc_settle(pg_temp.gc_proof(v_op) || '{"residualKobo":12500}'::jsonb) = 'confirmed',
    'the principal did not settle with the merged interest still in the goal wallet');
  -- Confirmed: the customer is no longer told that forfeited interest was
  -- added to their savings.
  PERFORM pg_temp.gc_assert((SELECT voided_at IS NOT NULL FROM savings_notifications.events
                              WHERE event_key = 'primary-interest:' || c_integration::text || ':gf-during'),
    'the customer was told forfeited interest was added to their savings');
  -- A single payout above the per-transfer ceiling is recorded for review.
  BEGIN
    PERFORM pg_temp.gf_receipt('gf-huge', 10000000000);
    PERFORM pg_temp.gc_assert(EXISTS (SELECT 1 FROM piggyvest_primary.goal_cancel_interest_forfeits
                                       WHERE cancel_operation_id = v_op::uuid AND state = 'needs_review'
                                         AND alerted_at IS NULL)
      AND (SELECT forfeited_interest_kobo FROM piggyvest_primary.goal_cancel_operations
            WHERE id = v_op::uuid) = 10000012500,
      'an oversized late payout was ignored instead of going to review');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
  PERFORM piggyvest_primary.claim_goal_cancel_forfeit(v_scope, v_op::uuid);
  v_forfeit := pg_temp.gf_forfeit(v_op, 'id');
  -- Paid after the forfeit was sent: a second, separate forfeit is planned.
  PERFORM pg_temp.gf_receipt('gf-after', 300);
  PERFORM pg_temp.gc_assert(
    (SELECT pg_catalog.count(*) FROM piggyvest_primary.goal_cancel_interest_forfeits
      WHERE cancel_operation_id = v_op::uuid AND state = 'reserved' AND amount_kobo = 300) = 1
    AND (SELECT forfeited_interest_kobo FROM piggyvest_primary.goal_cancel_operations WHERE id = v_op::uuid) = 12800
    AND piggyvest_primary.claim_goal_cancel_forfeit(v_scope, v_op::uuid) ->> 'status' = 'pending',
    'late interest after the forfeit was sent was not planned, or the in-flight one was not read first');
  -- The goal wallet still holding the planned 300 is expected, more is not.
  BEGIN
    PERFORM pg_temp.gc_assert(piggyvest_primary.settle_goal_cancel_forfeit(c_integration, 'staging',
        pg_temp.gf_forfeit_proof(v_forfeit) || '{"residualKobo":301}'::jsonb) = 'conflict',
      'a residual above the planned late forfeit was not reviewed');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
  PERFORM pg_temp.gc_assert(piggyvest_primary.settle_goal_cancel_forfeit(c_integration, 'staging',
      pg_temp.gf_forfeit_proof(v_forfeit) || '{"residualKobo":200}'::jsonb) = 'confirmed',
    'the first forfeit did not settle while the late one was still planned');
  -- Regression (reference race, needs two sessions so checked on the
  -- definition): a payout plans its forfeit under the customer's savings
  -- lock, the lock every other forfeit insert holds, so two plans can not
  -- compute the same reference; a plan that still fails never refuses the
  -- payout (the trigger catches it).
  PERFORM pg_temp.gc_assert(
    (SELECT proc.prosrc FROM pg_catalog.pg_proc AS proc
      WHERE proc.oid = 'piggyvest_primary.plan_forfeit_for_late_goal_interest()'::regprocedure)
      ~ 'pg_advisory_xact_lock\(\s*pg_catalog\.hashtextextended\(''primary-savings:'''
    AND (SELECT proc.prosrc FROM pg_catalog.pg_proc AS proc
          WHERE proc.oid = 'piggyvest_primary.plan_forfeit_for_late_goal_interest()'::regprocedure)
      ~ 'EXCEPTION WHEN unique_violation'
    -- The cancel is re-read under that lock, so one released meanwhile gets
    -- no new forfeit.
    AND (SELECT proc.prosrc FROM pg_catalog.pg_proc AS proc
          WHERE proc.oid = 'piggyvest_primary.plan_forfeit_for_late_goal_interest()'::regprocedure)
      ~ 'pg_advisory_xact_lock[\s\S]*cancel\.state IN \(''dispatched'', ''confirmed''\)\s*FOR SHARE',
    'the late-interest plan is not serialized on the customer lock, or its failure could refuse the payout');
  -- Regression: a reversal can not be attributed to one payout inside a
  -- merged plan, so the unsent plan goes to review instead of being shrunk
  -- or released for interest that may still be there.
  BEGIN
    v_text := (SELECT forfeited_interest_kobo::text FROM piggyvest_primary.goal_cancel_operations
                WHERE id = v_op::uuid);
    INSERT INTO piggyvest_primary.paid_interest_reversals (integration_id, provider_reversal_id, payout_id,
      amount_kobo, provider_evidence_sha256, evidence_reference)
    VALUES (c_integration, 'gf-reversal-1', 'gf-after', 100, repeat('c', 64), 'synthetic-reversal');
    -- Regression: the reversed amount leaves the cancel's forfeited total
    -- (it was still shown as forfeited, and Earnings were short by it).
    PERFORM pg_temp.gc_assert(
      (SELECT forfeited_interest_kobo FROM piggyvest_primary.goal_cancel_operations WHERE id = v_op::uuid)
        = v_text::bigint - 100,
      'a reversed late payout stayed in the forfeited total: was ' || v_text);
    -- Regression: a payout whose contribution to the total was not recorded
    -- (its plan failed and rolled back) is never subtracted, and a second
    -- reversal of the same payout can not subtract more than it added.
    v_text := (SELECT forfeited_interest_kobo::text FROM piggyvest_primary.goal_cancel_operations
                WHERE id = v_op::uuid);
    INSERT INTO piggyvest_primary.paid_interest_reversals (integration_id, provider_reversal_id, payout_id,
      amount_kobo, provider_evidence_sha256, evidence_reference)
    VALUES (c_integration, 'gf-reversal-1b', 'gf-after', 200, repeat('f', 64), 'synthetic-reversal-1b');
    PERFORM pg_temp.gc_assert(
      (SELECT forfeited_interest_kobo FROM piggyvest_primary.goal_cancel_operations WHERE id = v_op::uuid)
        = v_text::bigint - 200
      AND (SELECT amount_kobo FROM piggyvest_primary.goal_cancel_late_interest_contributions
            WHERE integration_id = c_integration AND payout_id = 'gf-after') = 0,
      'a second reversal of a payout did not consume exactly what remained of its contribution');
    DELETE FROM piggyvest_primary.goal_cancel_late_interest_contributions
     WHERE integration_id = c_integration AND payout_id = 'gf-during';
    v_text := (SELECT forfeited_interest_kobo::text FROM piggyvest_primary.goal_cancel_operations
                WHERE id = v_op::uuid);
    INSERT INTO piggyvest_primary.paid_interest_reversals (integration_id, provider_reversal_id, payout_id,
      amount_kobo, provider_evidence_sha256, evidence_reference)
    VALUES (c_integration, 'gf-reversal-during', 'gf-during', 100, repeat('9', 64), 'synthetic-reversal-4');
    PERFORM pg_temp.gc_assert(
      (SELECT forfeited_interest_kobo FROM piggyvest_primary.goal_cancel_operations WHERE id = v_op::uuid)
        = v_text::bigint,
      'a reversal subtracted a payout that never added to the total');
    -- Regression: a reversal of interest paid before the cancel read the
    -- balance is not subtracted (the snapshot may already exclude it).
    v_text := (SELECT forfeited_interest_kobo::text FROM piggyvest_primary.goal_cancel_operations
                WHERE id = v_op::uuid);
    INSERT INTO piggyvest_primary.paid_interest_reversals (integration_id, provider_reversal_id, payout_id,
      amount_kobo, provider_evidence_sha256, evidence_reference)
    VALUES (c_integration, 'gf-reversal-before', 'gf-before-read', 100, repeat('e', 64), 'synthetic-reversal-3');
    PERFORM pg_temp.gc_assert(
      (SELECT forfeited_interest_kobo FROM piggyvest_primary.goal_cancel_operations WHERE id = v_op::uuid)
        = v_text::bigint,
      'a reversal of interest inside the balance snapshot was subtracted a second time');
    PERFORM pg_temp.gc_assert(
      (SELECT state FROM piggyvest_primary.goal_cancel_interest_forfeits
        WHERE cancel_operation_id = v_op::uuid AND amount_kobo = 300) = 'needs_review'
      AND pg_temp.gf_work(10, true)
        -> 0 ->> 'alert' = 'true',
      'a reversal shrank or released an unsent plan instead of sending it to review');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
  -- The planned late forfeit is next.
  PERFORM pg_temp.gc_assert(
    (piggyvest_primary.claim_goal_cancel_forfeit(v_scope, v_op::uuid) #>> '{forfeit,amountKobo}')::bigint = 300,
    'the late forfeit was not claimed after the first settled');
END
$late$;


-- 16. A forfeit whose destination check fails before sending is handed back
--     unsent (same reference, nothing was POSTed): retryable any number of
--     times, never a rejection, so it can not drift into review.
DO $unclaim$
DECLARE
  c_goal constant text := 'f3860000-0000-4000-8000-000000000005';
  c_integration constant uuid := 'f3860000-0000-4000-8000-000000000006';
  v_scope jsonb := pg_temp.gc_scope();
  v_op text;
  v_forfeit text;
  v_ref text;
  v_text text;
  v_round integer;
BEGIN
  DELETE FROM piggyvest_primary.goal_cancel_interest_forfeits;
  UPDATE piggyvest_primary.goal_cancel_operations SET state = 'released'
   WHERE state IN ('confirmed', 'dispatched', 'reserved', 'needs_review');
  UPDATE public.customer_savings_goals SET status = 'active', current_amount = 2500, cancelled_at = NULL
   WHERE id = c_goal::uuid;
  v_op := pg_temp.gc_reserved('unclaim');
  PERFORM pg_temp.gc_assert(pg_temp.gf_split(v_op, 262000) ->> 'status' = 'dispatched', 'unclaim split');
  PERFORM pg_temp.gc_assert(pg_temp.gc_settle(pg_temp.gc_proof(v_op) || '{"residualKobo":12000}'::jsonb) = 'confirmed',
    'unclaim principal');
  v_ref := pg_temp.gf_forfeit(v_op, 'reference');
  FOR v_round IN 1..4 LOOP
    PERFORM piggyvest_primary.claim_goal_cancel_forfeit(v_scope, v_op::uuid);
    v_forfeit := pg_temp.gf_forfeit(v_op, 'id');
    PERFORM pg_temp.gc_assert(
      CASE WHEN v_round % 2 = 0
        THEN piggyvest_primary.unclaim_goal_cancel_forfeit_worker(c_integration, 'staging', v_forfeit::uuid)
        ELSE piggyvest_primary.manage_goal_cancel_forfeit(v_scope, v_forfeit::uuid, 'unclaim') END
        -- Regression: the hand-back is not stamped before the page is
        -- emitted, so it keeps answering unclaimed_first until the caller
        -- acknowledges the page (after round 2 here), then never again.
        = CASE WHEN v_round <= 2 THEN 'unclaimed_first' ELSE 'unclaimed' END,
      'round ' || v_round || ' was not handed back, or paged more than once');
    IF v_round = 2 THEN
      PERFORM pg_temp.gc_assert(
        piggyvest_primary.manage_goal_cancel_forfeit(v_scope, v_forfeit::uuid, 'ack') = 'acked',
        'the hand-back page was not acknowledged');
    END IF;
    PERFORM pg_temp.gc_assert(pg_temp.gf_forfeit(v_op, 'state') = 'reserved'
      AND pg_temp.gf_forfeit(v_op, 'reference') = v_ref
      AND pg_temp.gf_forfeit(v_op, 'dispatched_at') IS NULL,
      'round ' || v_round || ' did not hand the forfeit back unsent under its reference');
  END LOOP;
  PERFORM pg_temp.gc_assert(
    (SELECT pg_catalog.count(*) FROM piggyvest_primary.goal_cancel_interest_forfeits) = 1
    AND piggyvest_primary.claim_goal_cancel_forfeit(v_scope, v_op::uuid) ->> 'status' = 'claimed',
    'repeated hand-backs drifted toward review or created rows');
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.manage_goal_cancel_forfeit(v_scope, v_forfeit::uuid, 'unclaim') = 'unclaimed'
    AND piggyvest_primary.manage_goal_cancel_forfeit(v_scope, v_forfeit::uuid, 'unclaim') = 'not_released',
    'an unsent forfeit was handed back twice');
  -- Once marked as posting it was (or may have been) sent: never handed back.
  PERFORM piggyvest_primary.claim_goal_cancel_forfeit(v_scope, v_op::uuid);
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.manage_goal_cancel_forfeit(v_scope, v_forfeit::uuid, 'posting:11111111-1111-4111-8111-111111111111') = 'posting'
    -- Regression: a repeat of the same claimer's mark (its answer was lost)
    -- is told to go ahead; any other token is refused, so only that claimer
    -- ever makes the single POST.
    AND piggyvest_primary.manage_goal_cancel_forfeit(v_scope, v_forfeit::uuid, 'posting:11111111-1111-4111-8111-111111111111') = 'posting'
    AND piggyvest_primary.mark_goal_cancel_forfeit_posting_worker(c_integration, 'staging', v_forfeit::uuid,
          '22222222-2222-4222-8222-222222222222'::uuid) = 'not_released'
    AND piggyvest_primary.manage_goal_cancel_forfeit(v_scope, v_forfeit::uuid, 'unclaim') = 'not_released',
    'a posted forfeit could be handed back, or a lost posting answer stranded it');
  -- A claim abandoned before posting (no posted_at) for over ten minutes is
  -- recovered by the next claim instead of waiting on a transfer that does
  -- not exist.
  UPDATE piggyvest_primary.goal_cancel_interest_forfeits
     SET posted_at = NULL, dispatched_at = pg_catalog.clock_timestamp() - interval '11 minutes'
   WHERE id = v_forfeit::uuid;
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.claim_goal_cancel_forfeit(v_scope, v_op::uuid) ->> 'status' = 'claimed'
    AND pg_temp.gf_forfeit(v_op, 'reference') = v_ref,
    'an abandoned unposted claim was not recovered');
  -- Posting clears a spent wallet-check page, so a later overdue page can fire.
  UPDATE piggyvest_primary.goal_cancel_interest_forfeits SET alerted_at = pg_catalog.clock_timestamp()
   WHERE id = v_forfeit::uuid;
  PERFORM pg_temp.gc_assert( piggyvest_primary.manage_goal_cancel_forfeit(v_scope, v_forfeit::uuid, 'posting:11111111-1111-4111-8111-111111111111') = 'posting'
    AND pg_temp.gf_forfeit(v_op, 'alerted_at') IS NULL,
    'posting did not clear the wallet-check page stamp');
  UPDATE piggyvest_primary.goal_cancel_interest_forfeits SET posted_at = NULL WHERE id = v_forfeit::uuid;
  -- A fresh unposted claim is left alone (it may be mid-send).
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.claim_goal_cancel_forfeit(v_scope, v_op::uuid) ->> 'status' = 'pending',
    'a fresh claim was taken back');
  -- A merge that would pass the per-transfer ceiling goes to review as its
  -- own row with its full amount; the unsent plan stays sendable.
  BEGIN
    UPDATE piggyvest_primary.goal_cancel_interest_forfeits SET state = 'reserved', dispatched_at = NULL,
           amount_kobo = 9999999990, alerted_at = pg_catalog.clock_timestamp()
     WHERE id = v_forfeit::uuid;
    PERFORM pg_temp.gf_receipt('gf-overflow', 20);
    -- Regression: the payout's amount is kept on the review row, never
    -- dropped, and the waiting plan is not frozen with it.
    PERFORM pg_temp.gc_assert(pg_temp.gf_forfeit(v_op, 'state') = 'needs_review'
      AND pg_temp.gf_forfeit(v_op, 'amount_kobo')::bigint = 20
      AND (SELECT state || '/' || amount_kobo FROM piggyvest_primary.goal_cancel_interest_forfeits
            WHERE id = v_forfeit::uuid) = 'reserved/9999999990',
      'an overflowing merge was truncated, dropped, or froze the waiting plan');
    -- Nobody was paged by the payout: the sweep lists it with an alert until
    -- it acknowledges the page.
    PERFORM pg_temp.gc_assert(
      pg_temp.gf_work(10, true) @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'operationId', v_op, 'state', 'needs_review', 'alert', true))
      AND pg_temp.gf_work(10, true) @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'operationId', v_op, 'state', 'needs_review', 'alert', true))
      AND piggyvest_primary.ack_goal_cancel_forfeit_alert_worker(c_integration, 'staging',
            pg_temp.gf_forfeit(v_op, 'id')::uuid)
      AND NOT pg_catalog.jsonb_path_exists(pg_temp.gf_work(10, true), '$[*] ? (@.alert == true)'),
      'a review nobody was paged about was not paged until acknowledged');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
  -- A rejected forfeit whose replacement can not merge under the ceiling
  -- answers released_needs_review, so the caller pages for the review once.
  BEGIN
    UPDATE piggyvest_primary.goal_cancel_interest_forfeits
       SET state = 'dispatched', amount_kobo = 20, posted_at = pg_catalog.clock_timestamp(),
           dispatched_at = pg_catalog.clock_timestamp(), alerted_at = NULL
     WHERE id = v_forfeit::uuid;
    INSERT INTO piggyvest_primary.goal_cancel_interest_forfeits (
      cancel_operation_id, integration_id, intent_id, goal_id, state, reference,
      source_wallet_id, destination_wallet_id, amount_kobo, reserved_at)
    SELECT forfeit.cancel_operation_id, forfeit.integration_id, forfeit.intent_id, forfeit.goal_id,
      'reserved', piggyvest_primary.next_goal_cancel_forfeit_reference(forfeit.goal_id),
      forfeit.source_wallet_id, forfeit.destination_wallet_id, 9999999990, pg_catalog.clock_timestamp()
      FROM piggyvest_primary.goal_cancel_interest_forfeits AS forfeit WHERE forfeit.id = v_forfeit::uuid;
    -- It names the row in review, so the caller acknowledges exactly it.
    v_text := piggyvest_primary.manage_goal_cancel_forfeit(v_scope, v_forfeit::uuid, 'release');
    PERFORM pg_temp.gc_assert(
      v_text = 'released_needs_review:' || (SELECT id::text FROM piggyvest_primary.goal_cancel_interest_forfeits
                                             WHERE cancel_operation_id = v_op::uuid AND state = 'needs_review')
      -- Regression: the replacement keeps its own amount in review and the
      -- waiting plan stays sendable.
      AND (SELECT amount_kobo FROM piggyvest_primary.goal_cancel_interest_forfeits
            WHERE cancel_operation_id = v_op::uuid AND state = 'needs_review') = 20
      AND (SELECT amount_kobo FROM piggyvest_primary.goal_cancel_interest_forfeits
            WHERE cancel_operation_id = v_op::uuid AND state = 'reserved') = 9999999990,
      'an over-ceiling replacement went to review without the caller being told: ' || COALESCE(v_text, '-'));
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
  BEGIN
    UPDATE piggyvest_primary.goal_cancel_interest_forfeits
       SET state = 'dispatched', amount_kobo = 20, posted_at = pg_catalog.clock_timestamp(),
           dispatched_at = pg_catalog.clock_timestamp(), alerted_at = NULL
     WHERE id = v_forfeit::uuid;
    INSERT INTO piggyvest_primary.goal_cancel_interest_forfeits (
      cancel_operation_id, integration_id, intent_id, goal_id, state, reference,
      source_wallet_id, destination_wallet_id, amount_kobo, reserved_at)
    SELECT forfeit.cancel_operation_id, forfeit.integration_id, forfeit.intent_id, forfeit.goal_id,
      'reserved', piggyvest_primary.next_goal_cancel_forfeit_reference(forfeit.goal_id),
      forfeit.source_wallet_id, forfeit.destination_wallet_id, 9999999990, pg_catalog.clock_timestamp()
      FROM piggyvest_primary.goal_cancel_interest_forfeits AS forfeit WHERE forfeit.id = v_forfeit::uuid;
    -- Regression: the evidence release names the replacement row in review too
    -- ('conflict:<id>'), so its page is acknowledged on that row.
    v_text := piggyvest_primary.release_failed_goal_cancel_forfeit(c_integration, 'staging',
      pg_temp.gf_forfeit_proof(v_forfeit, 'failed'));
    PERFORM pg_temp.gc_assert(
      v_text = 'conflict:' || (SELECT id::text FROM piggyvest_primary.goal_cancel_interest_forfeits
                                             WHERE cancel_operation_id = v_op::uuid AND state = 'needs_review')
      -- Regression: the replacement keeps its own amount in review and the
      -- waiting plan stays sendable.
      AND (SELECT amount_kobo FROM piggyvest_primary.goal_cancel_interest_forfeits
            WHERE cancel_operation_id = v_op::uuid AND state = 'needs_review') = 20
      AND (SELECT amount_kobo FROM piggyvest_primary.goal_cancel_interest_forfeits
            WHERE cancel_operation_id = v_op::uuid AND state = 'reserved') = 9999999990,
      'an over-ceiling replacement went to review without the caller being told: ' || COALESCE(v_text, '-'));
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
END
$unclaim$;

-- 17. A goal whose PiggyVest setup never finished (no savings destination)
--     answers not_set_up at issue instead of raising.
DO $notsetup$
BEGIN
  UPDATE piggyvest_primary.goal_cancel_operations SET state = 'released'
   WHERE state IN ('confirmed', 'dispatched', 'reserved', 'needs_review');
  UPDATE public.customer_savings_goals SET status = 'active', current_amount = 2500, cancelled_at = NULL
   WHERE id = 'f3860000-0000-4000-8000-000000000005';
  PERFORM pg_temp.gc_unbind();
  PERFORM pg_temp.gc_assert(pg_temp.gc_issue_op() = '{"status":"not_set_up"}'::jsonb,
    'a goal without a PiggyVest destination did not answer not_set_up');
  PERFORM pg_temp.gc_bind();
END
$notsetup$;

-- 18. The per-transfer ceiling applies to each leg, not the goal balance.
DO $ceiling$
DECLARE
  c_goal constant uuid := 'f3860000-0000-4000-8000-000000000005';
  v_op text;
  v_before numeric;
  v_forfeit text;
  v_result jsonb;
BEGIN
  UPDATE piggyvest_primary.goal_cancel_operations SET state = 'released'
   WHERE state IN ('confirmed', 'dispatched', 'reserved', 'needs_review');
  UPDATE piggyvest_primary.goal_cancel_interest_forfeits SET state = 'released'
   WHERE state IN ('reserved', 'dispatched', 'needs_review');
  -- Regression: a balance above the ceiling whose legs both fit dispatches
  -- (it was refused outright, stranding a principal below the ceiling).
  BEGIN
    UPDATE public.customer_savings_goals SET status = 'active', current_amount = 99000000, cancelled_at = NULL
     WHERE id = c_goal;
    v_op := pg_temp.gc_reserved('ceiling-both-fit');
    v_result := pg_temp.gf_split(v_op, 10100000000);
    PERFORM pg_temp.gc_assert(v_result
        = '{"status":"dispatched","principalKobo":9900000000,"forfeitedInterestKobo":200000000}'::jsonb
      AND pg_temp.gf_forfeit(v_op, 'state') = 'reserved'
      AND pg_temp.gf_forfeit(v_op, 'amount_kobo')::bigint = 200000000,
      'a balance above the ceiling with both legs under it was not split: ' || v_result::text);
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
  -- Regression: interest held in review (never sent: here the forfeit went to
  -- review before sending, as after three rejections) is expected to still be
  -- in the goal wallet, so the customer's cancel confirms and only the
  -- interest leg needs a person; anything beyond it still goes to review.
  BEGIN
    UPDATE public.customer_savings_goals SET status = 'active', current_amount = 2500, cancelled_at = NULL
     WHERE id = c_goal;
    v_op := pg_temp.gc_reserved('review-held');
    PERFORM pg_temp.gc_assert(pg_temp.gf_split(v_op, 262000) ->> 'status' = 'dispatched', 'review-held split');
    UPDATE piggyvest_primary.goal_cancel_interest_forfeits SET state = 'needs_review'
     WHERE cancel_operation_id = v_op::uuid;
    BEGIN
      PERFORM pg_temp.gc_assert(
        pg_temp.gc_settle(pg_temp.gc_proof(v_op) || '{"residualKobo":12001}'::jsonb) = 'conflict'
          AND pg_temp.gc_state(v_op) = 'needs_review',
        'a residual above the review-held interest was not reviewed');
      RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP98';
    EXCEPTION WHEN SQLSTATE 'PVP98' THEN NULL;
    END;
    PERFORM pg_temp.gc_assert(
      pg_temp.gc_settle(pg_temp.gc_proof(v_op) || '{"residualKobo":12000}'::jsonb) = 'confirmed',
      'interest held in review moved the customer''s cancel into review');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
  -- Regression: settling a sent forfeit expects a sibling held in review
  -- (interest paid after the cancel, then reviewed) to still be in the goal
  -- wallet, so the successful transfer is confirmed, not reviewed.
  BEGIN
    UPDATE public.customer_savings_goals SET status = 'active', current_amount = 2500, cancelled_at = NULL
     WHERE id = c_goal;
    v_op := pg_temp.gc_reserved('sibling-review');
    PERFORM pg_temp.gc_assert(pg_temp.gf_split(v_op, 262000) ->> 'status' = 'dispatched', 'sibling split');
    PERFORM pg_temp.gc_assert(
      pg_temp.gc_settle(pg_temp.gc_proof(v_op) || '{"residualKobo":12000}'::jsonb) = 'confirmed', 'sibling principal');
    PERFORM piggyvest_primary.claim_goal_cancel_forfeit(pg_temp.gc_scope(), v_op::uuid);
    v_forfeit := (SELECT id::text FROM piggyvest_primary.goal_cancel_interest_forfeits
                   WHERE cancel_operation_id = v_op::uuid AND state = 'dispatched');
    PERFORM pg_temp.gf_receipt('gf-sibling', 300);
    UPDATE piggyvest_primary.goal_cancel_interest_forfeits SET state = 'needs_review'
     WHERE cancel_operation_id = v_op::uuid AND state = 'reserved';
    BEGIN
      PERFORM pg_temp.gc_assert(piggyvest_primary.settle_goal_cancel_forfeit(
          'f3860000-0000-4000-8000-000000000006', 'staging',
          pg_temp.gf_forfeit_proof(v_forfeit) || '{"residualKobo":301}'::jsonb) = 'conflict',
        'a residual above the review-held sibling was not reviewed');
      RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP98';
    EXCEPTION WHEN SQLSTATE 'PVP98' THEN NULL;
    END;
    PERFORM pg_temp.gc_assert(piggyvest_primary.settle_goal_cancel_forfeit(
        'f3860000-0000-4000-8000-000000000006', 'staging',
        pg_temp.gf_forfeit_proof(v_forfeit) || '{"residualKobo":300}'::jsonb) = 'confirmed',
      'a sibling held in review moved a successful forfeit into review');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
  -- Regression: a principal first reported failed (its unsent interest plan
  -- released with it) and later proven successful plans the interest again,
  -- so it is not stranded in the goal wallet with nothing left to send it.
  BEGIN
    UPDATE public.customer_savings_goals SET status = 'active', current_amount = 2500, cancelled_at = NULL
     WHERE id = c_goal;
    v_op := pg_temp.gc_reserved('late-principal');
    PERFORM pg_temp.gc_assert(pg_temp.gf_split(v_op, 262000) ->> 'status' = 'dispatched', 'late split');
    PERFORM pg_temp.gc_assert(
      piggyvest_primary.manage_goal_cancel(pg_temp.gc_scope(), v_op::uuid, 'release', 0), 'late release');
    PERFORM pg_temp.gc_assert(pg_temp.gf_forfeit(v_op, 'state') = 'released', 'plan not released');
    v_result := pg_catalog.to_jsonb(pg_temp.gc_settle(pg_temp.gc_proof(v_op) || '{"residualKobo":12000}'::jsonb));
    PERFORM pg_temp.gc_assert(
      v_result = '"confirmed"'::jsonb
      AND pg_temp.gf_forfeit(v_op, 'state') = 'reserved'
      AND pg_temp.gf_forfeit(v_op, 'amount_kobo')::bigint = 12000
      AND pg_temp.gf_forfeit(v_op, 'reference') <> 'pvb-forfeit-' || c_goal::text
      AND piggyvest_primary.claim_goal_cancel_forfeit(pg_temp.gc_scope(), v_op::uuid) ->> 'status' = 'claimed',
      'a late-confirmed principal left its interest with nothing to send it: ' || v_result::text
        || ' ' || COALESCE(pg_temp.gf_forfeit(v_op, 'state'), '-') || ' ' || COALESCE(pg_temp.gf_forfeit(v_op, 'reference'), '-')
        || ' ' || pg_temp.gc_state(v_op));
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
  -- Regression: interest forfeited by an early cancel leaves the customer's
  -- Earnings (it was still counted there after the transfer went out).
  BEGIN
    UPDATE public.customer_savings_goals SET status = 'active', current_amount = 2500, cancelled_at = NULL
     WHERE id = c_goal;
    PERFORM pg_temp.gf_receipt('gf-earned', 12000, pg_catalog.clock_timestamp() - interval '1 day');
    -- Earnings count production payouts only: switched just for the reads.
    UPDATE piggyvest_primary.integrations SET environment = 'production'
     WHERE id = 'f3860000-0000-4000-8000-000000000006';
    v_before := COALESCE((SELECT amount FROM piggyvest_primary.customer_paid_interest(
      'f3860000-0000-4000-8000-000000000002', 'f3860000-0000-4000-8000-000000000003') WHERE goal_id = c_goal), 0);
    UPDATE piggyvest_primary.integrations SET environment = 'staging'
     WHERE id = 'f3860000-0000-4000-8000-000000000006';
    -- Regression: deducted as soon as the cancel confirms, while the
    -- internal interest transfer has not even been sent.
    v_op := pg_temp.gc_reserved('earnings');
    PERFORM pg_temp.gc_assert(pg_temp.gf_split(v_op, 262000) ->> 'status' = 'dispatched', 'earnings split');
    PERFORM pg_temp.gc_assert(
      pg_temp.gc_settle(pg_temp.gc_proof(v_op) || '{"residualKobo":12000}'::jsonb) = 'confirmed'
      AND pg_temp.gf_forfeit(v_op, 'state') = 'reserved', 'earnings principal');
    UPDATE piggyvest_primary.integrations SET environment = 'production'
     WHERE id = 'f3860000-0000-4000-8000-000000000006';
    PERFORM pg_temp.gc_assert(
      COALESCE((SELECT amount FROM piggyvest_primary.customer_paid_interest(
        'f3860000-0000-4000-8000-000000000002', 'f3860000-0000-4000-8000-000000000003') WHERE goal_id = c_goal), 0)
        = v_before - 12000
      AND v_before >= 12000,
      'forfeited interest is still shown in the customer''s Earnings: ' || v_before::text);
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
  -- Regression: a forfeit claimed but never posted is released with its
  -- cancel, not left dispatched behind a released attempt.
  BEGIN
    UPDATE public.customer_savings_goals SET status = 'active', current_amount = 2500, cancelled_at = NULL
     WHERE id = c_goal;
    v_op := pg_temp.gc_reserved('claimed-unposted');
    PERFORM pg_temp.gc_assert(pg_temp.gf_split(v_op, 262000) ->> 'status' = 'dispatched', 'unposted split');
    UPDATE piggyvest_primary.goal_cancel_interest_forfeits
       SET state = 'dispatched', dispatched_at = pg_catalog.clock_timestamp()
     WHERE cancel_operation_id = v_op::uuid;
    PERFORM pg_temp.gc_assert(
      piggyvest_primary.manage_goal_cancel(pg_temp.gc_scope(), v_op::uuid, 'release', 0)
      AND pg_temp.gf_forfeit(v_op, 'state') = 'released',
      'a claimed but unposted forfeit was stranded behind a released cancel');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
  -- Regression: interest paid into a goal cancelled with no interest (so no
  -- interest wallet was ever needed) is still forfeited and becomes review
  -- work the sweep pages, never a silent surplus in the goal wallet.
  BEGIN
    DELETE FROM piggyvest_primary.goal_interest_forfeit_wallets;
    UPDATE public.customer_savings_goals SET status = 'active', current_amount = 2500, cancelled_at = NULL
     WHERE id = c_goal;
    v_op := pg_temp.gc_reserved('no-wallet-late');
    PERFORM pg_temp.gc_assert(pg_temp.gf_split(v_op, 250000) ->> 'status' = 'dispatched', 'no-interest split');
    PERFORM pg_temp.gc_assert(pg_temp.gc_settle(pg_temp.gc_proof(v_op)) = 'confirmed', 'no-interest principal');
    PERFORM pg_temp.gf_receipt('gf-no-wallet', 300);
    PERFORM pg_temp.gc_assert(
      pg_temp.gf_forfeit(v_op, 'state') = 'needs_review'
      AND pg_temp.gf_forfeit(v_op, 'amount_kobo')::bigint = 300
      AND (SELECT forfeited_interest_kobo FROM piggyvest_primary.goal_cancel_operations WHERE id = v_op::uuid) = 300
      AND pg_temp.gf_work(10, true) @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'operationId', v_op, 'state', 'needs_review', 'alert', true)),
      'late interest with no interest wallet was left silently in the goal wallet');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
  -- Regression: Earnings deduct production cancels only, bound to the
  -- merchant, like the receipts they are deducted from.
  PERFORM pg_temp.gc_assert(
    (SELECT proc.prosrc FROM pg_catalog.pg_proc AS proc
      WHERE proc.oid = 'piggyvest_primary.customer_paid_interest(uuid,uuid)'::regprocedure)
      ~ 'goal_cancel_operations cancel[\s\S]*cancel_integration\.environment=''production''[\s\S]*cancel_integration\.merchant_id=p_merchant',
    'a sandbox cancel can reduce the customer''s real Earnings');
  -- Regression: a reversal recorded while a forfeit is claimed but not yet
  -- posted freezes it, so the posting mark refuses and nothing is sent.
  BEGIN
    UPDATE public.customer_savings_goals SET status = 'active', current_amount = 2500, cancelled_at = NULL
     WHERE id = c_goal;
    v_op := pg_temp.gc_reserved('reversal-unposted');
    PERFORM pg_temp.gc_assert(pg_temp.gf_split(v_op, 262000) ->> 'status' = 'dispatched', 'reversal split');
    PERFORM pg_temp.gc_assert(
      pg_temp.gc_settle(pg_temp.gc_proof(v_op) || '{"residualKobo":12000}'::jsonb) = 'confirmed', 'reversal principal');
    PERFORM piggyvest_primary.claim_goal_cancel_forfeit(pg_temp.gc_scope(), v_op::uuid);
    v_forfeit := pg_temp.gf_forfeit(v_op, 'id');
    PERFORM pg_temp.gf_receipt('gf-reversed', 400, pg_catalog.clock_timestamp() - interval '2 days');
    INSERT INTO piggyvest_primary.paid_interest_reversals (integration_id, provider_reversal_id, payout_id,
      amount_kobo, provider_evidence_sha256, evidence_reference)
    VALUES ('f3860000-0000-4000-8000-000000000006', 'gf-reversal-unposted', 'gf-reversed', 100,
      repeat('d', 64), 'synthetic-reversal-2');
    PERFORM pg_temp.gc_assert(
      pg_temp.gf_forfeit(v_op, 'state') = 'needs_review'
      AND piggyvest_primary.manage_goal_cancel_forfeit(pg_temp.gc_scope(), v_forfeit::uuid, 'posting:11111111-1111-4111-8111-111111111111') = 'not_released',
      'a reversal left a claimed, unposted forfeit sendable');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
  -- Regression: a reversal arriving after the posting mark (sent, or about to
  -- be) sends the forfeit to review, so its success settles into review for a
  -- person instead of confirming the unreduced amount.
  BEGIN
    UPDATE public.customer_savings_goals SET status = 'active', current_amount = 2500, cancelled_at = NULL
     WHERE id = c_goal;
    v_op := pg_temp.gc_reserved('reversal-posted');
    PERFORM pg_temp.gc_assert(pg_temp.gf_split(v_op, 262000) ->> 'status' = 'dispatched', 'posted split');
    PERFORM pg_temp.gc_assert(
      pg_temp.gc_settle(pg_temp.gc_proof(v_op) || '{"residualKobo":12000}'::jsonb) = 'confirmed', 'posted principal');
    PERFORM piggyvest_primary.claim_goal_cancel_forfeit(pg_temp.gc_scope(), v_op::uuid);
    v_forfeit := pg_temp.gf_forfeit(v_op, 'id');
    PERFORM pg_temp.gc_assert(piggyvest_primary.manage_goal_cancel_forfeit(pg_temp.gc_scope(), v_forfeit::uuid,
      'posting:33333333-3333-4333-8333-333333333333') = 'posting', 'posted mark');
    PERFORM pg_temp.gf_receipt('gf-reversed-posted', 400, pg_catalog.clock_timestamp() - interval '2 days');
    INSERT INTO piggyvest_primary.paid_interest_reversals (integration_id, provider_reversal_id, payout_id,
      amount_kobo, provider_evidence_sha256, evidence_reference)
    VALUES ('f3860000-0000-4000-8000-000000000006', 'gf-reversal-posted', 'gf-reversed-posted', 100,
      repeat('7', 64), 'synthetic-reversal-5');
    -- Regression: it stays findable so the success is recorded (transaction
    -- id), but settles into review, never confirming the unreduced amount.
    PERFORM pg_temp.gc_assert(
      pg_temp.gf_forfeit(v_op, 'state') = 'dispatched'
      AND piggyvest_primary.read_dispatched_goal_cancel_forfeit('f3860000-0000-4000-8000-000000000006',
            'staging', v_forfeit::uuid) IS NOT NULL
      AND piggyvest_primary.settle_goal_cancel_forfeit('f3860000-0000-4000-8000-000000000006', 'staging',
            pg_temp.gf_forfeit_proof(v_forfeit)) = 'conflict'
      AND pg_temp.gf_forfeit(v_op, 'state') = 'needs_review'
      AND pg_temp.gf_forfeit(v_op, 'provider_transaction_id') IS NOT NULL,
      'a reversal after the posting mark lost the provider record or let the forfeit confirm');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
  -- Regression: a delayed record of interest paid before the cancel (already
  -- forfeited by the split) does not tell the customer interest was added.
  BEGIN
    UPDATE public.customer_savings_goals SET status = 'active', current_amount = 2500, cancelled_at = NULL
     WHERE id = c_goal;
    v_op := pg_temp.gc_reserved('delayed-notice');
    PERFORM pg_temp.gc_assert(pg_temp.gf_split(v_op, 262000) ->> 'status' = 'dispatched', 'notice split');
    PERFORM pg_temp.gc_assert(
      pg_temp.gc_settle(pg_temp.gc_proof(v_op) || '{"residualKobo":12000}'::jsonb) = 'confirmed', 'notice principal');
    INSERT INTO savings_notifications.events (merchant_id, customer_id, goal_id, event_key, type, title, body)
    VALUES ('f3860000-0000-4000-8000-000000000002', 'f3860000-0000-4000-8000-000000000003', c_goal,
      'primary-interest:f3860000-0000-4000-8000-000000000006:gf-delayed', 'interest_credited', 'Interest', 'Interest')
    ON CONFLICT DO NOTHING;
    PERFORM pg_temp.gf_receipt('gf-delayed', 500, pg_catalog.clock_timestamp() - interval '3 days');
    PERFORM pg_temp.gc_assert(
      (SELECT voided_at IS NOT NULL FROM savings_notifications.events
        WHERE event_key = 'primary-interest:f3860000-0000-4000-8000-000000000006:gf-delayed'),
      'a delayed pre-cancel interest record told the customer interest was added to a cancelled goal');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
  -- Regression: a reversal after every forfeit of the cancel was already sent
  -- keeps the forfeited total (that interest reached Ogabassey's wallet) and
  -- becomes review work the sweep pages, never a silent drop.
  BEGIN
    UPDATE public.customer_savings_goals SET status = 'active', current_amount = 2500, cancelled_at = NULL
     WHERE id = c_goal;
    v_op := pg_temp.gc_reserved('reversal-after-sent');
    PERFORM pg_temp.gc_assert(pg_temp.gf_split(v_op, 262000) ->> 'status' = 'dispatched', 'sent split');
    PERFORM pg_temp.gc_assert(
      pg_temp.gc_settle(pg_temp.gc_proof(v_op) || '{"residualKobo":12000}'::jsonb) = 'confirmed', 'sent principal');
    PERFORM pg_temp.gf_receipt('gf-late-sent', 400);
    UPDATE piggyvest_primary.goal_cancel_interest_forfeits
       SET state = 'confirmed', dispatched_at = pg_catalog.clock_timestamp(), posted_at = pg_catalog.clock_timestamp(),
           provider_transaction_id = 'synthetic-sent-' || id::text
     WHERE cancel_operation_id = v_op::uuid;
    v_before := (SELECT forfeited_interest_kobo FROM piggyvest_primary.goal_cancel_operations WHERE id = v_op::uuid);
    INSERT INTO piggyvest_primary.paid_interest_reversals (integration_id, provider_reversal_id, payout_id,
      amount_kobo, provider_evidence_sha256, evidence_reference)
    VALUES ('f3860000-0000-4000-8000-000000000006', 'gf-reversal-sent', 'gf-late-sent', 150,
      repeat('8', 64), 'synthetic-reversal-6');
    PERFORM pg_temp.gc_assert(
      (SELECT forfeited_interest_kobo FROM piggyvest_primary.goal_cancel_operations WHERE id = v_op::uuid) = v_before
      AND pg_temp.gf_forfeit(v_op, 'state') = 'needs_review'
      AND pg_temp.gf_forfeit(v_op, 'destination_wallet_id') = 'reversed-after-forfeit'
      AND pg_temp.gf_forfeit(v_op, 'amount_kobo')::bigint = 150,
      'a reversal after the interest was sent lowered the total silently');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
  -- A principal above the ceiling can not be sent: released, nothing planned.
  BEGIN
    UPDATE public.customer_savings_goals SET status = 'active', current_amount = 100000000, cancelled_at = NULL
     WHERE id = c_goal;
    v_op := pg_temp.gc_reserved('ceiling-principal');
    v_result := pg_temp.gf_split(v_op, 10000000000);
    PERFORM pg_temp.gc_assert(v_result = '{"status":"too_large"}'::jsonb
      AND pg_temp.gc_state(v_op) = 'released'
      AND NOT EXISTS (SELECT 1 FROM piggyvest_primary.goal_cancel_interest_forfeits
                       WHERE cancel_operation_id = v_op::uuid),
      'a principal above the ceiling was not released: ' || v_result::text);
    -- Regression: held (a retry can never succeed) and paged by the sweep
    -- until acknowledged, instead of the customer looping silently.
    PERFORM pg_temp.gc_assert(
      (SELECT held_reason FROM piggyvest_primary.goal_cancel_operations WHERE id = v_op::uuid)
        = 'principal_above_transfer_limit'
      AND pg_temp.gc_issue_op() = '{"status":"needs_review"}'::jsonb
      AND piggyvest_primary.list_goal_cancel_holds_worker('f3860000-0000-4000-8000-000000000006', 'staging')
        @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
             'operationId', v_op, 'reason', 'principal_above_transfer_limit'))
      AND piggyvest_primary.ack_goal_cancel_hold(pg_temp.gc_scope(), v_op::uuid)
      AND NOT piggyvest_primary.list_goal_cancel_holds_worker('f3860000-0000-4000-8000-000000000006', 'staging')
        @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('operationId', v_op))
      AND NOT piggyvest_primary.ack_goal_cancel_hold_worker('f3860000-0000-4000-8000-000000000006', 'staging', v_op::uuid),
      'a hold for a principal above the ceiling was not held and paged until acknowledged');
    UPDATE piggyvest_primary.goal_cancel_operations
       SET held_alerted_at = pg_catalog.clock_timestamp() - interval '2 days' WHERE id = v_op::uuid;
    PERFORM pg_temp.gc_assert(
      piggyvest_primary.list_goal_cancel_holds_worker('f3860000-0000-4000-8000-000000000006', 'staging')
        @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('operationId', v_op))
      AND piggyvest_primary.ack_goal_cancel_hold_worker('f3860000-0000-4000-8000-000000000006', 'staging', v_op::uuid),
      'a hold still open a day after its page was not paged again');
    -- Regression: a never-paged hold comes before daily repeats, so a backlog
    -- of repeats can not starve it.
    UPDATE piggyvest_primary.goal_cancel_operations
       SET held_alerted_at = pg_catalog.clock_timestamp() - interval '3 days',
           held_reason = 'provider_balance_below_principal'
     WHERE id <> v_op::uuid AND state = 'released';
    UPDATE piggyvest_primary.goal_cancel_operations SET held_alerted_at = NULL WHERE id = v_op::uuid;
    PERFORM pg_temp.gc_assert(
      piggyvest_primary.list_goal_cancel_holds_worker('f3860000-0000-4000-8000-000000000006', 'staging')
        -> 0 ->> 'operationId' = v_op,
      'a never-paged hold was listed after daily repeats');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
  -- Interest above the ceiling: the principal still goes; the interest is a
  -- forfeit in review (never sent or truncated), paged by the sweep.
  BEGIN
    UPDATE public.customer_savings_goals SET status = 'active', current_amount = 2500, cancelled_at = NULL
     WHERE id = c_goal;
    v_op := pg_temp.gc_reserved('ceiling-interest');
    v_result := pg_temp.gf_split(v_op, 10000250000);
    PERFORM pg_temp.gc_assert(v_result
        = '{"status":"dispatched","principalKobo":250000,"forfeitedInterestKobo":10000000000}'::jsonb
      AND pg_temp.gf_forfeit(v_op, 'state') = 'needs_review'
      AND pg_temp.gf_forfeit(v_op, 'amount_kobo')::bigint = 9999999999
      AND pg_temp.gf_forfeit(v_op, 'alerted_at') IS NULL
      AND pg_temp.gf_work(10, true)
        = pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'operationId', v_op, 'state', 'needs_review', 'alert', true)),
      'interest above the ceiling blocked the principal or was sent: ' || v_result::text);
    -- Regression: an acknowledgement covers only the forfeit that was paged;
    -- a sibling that became alertable is still paged.
    v_forfeit := pg_temp.gf_forfeit(v_op, 'id');
    INSERT INTO piggyvest_primary.goal_cancel_interest_forfeits (
      cancel_operation_id, integration_id, intent_id, goal_id, state, reference,
      source_wallet_id, destination_wallet_id, amount_kobo, reserved_at)
    SELECT cancel_operation_id, integration_id, intent_id, goal_id, 'needs_review',
           piggyvest_primary.next_goal_cancel_forfeit_reference(goal_id), source_wallet_id,
           destination_wallet_id, 5, pg_catalog.clock_timestamp()
      FROM piggyvest_primary.goal_cancel_interest_forfeits WHERE id = v_forfeit::uuid;
    PERFORM pg_temp.gc_assert(
      piggyvest_primary.ack_goal_cancel_forfeit_alert_worker('f3860000-0000-4000-8000-000000000006', 'staging',
        v_forfeit::uuid)
      AND pg_catalog.jsonb_array_length(pg_temp.gf_work(10, true)) = 1
      AND (piggyvest_primary.list_goal_cancel_forfeit_work('f3860000-0000-4000-8000-000000000006', 'staging', 10, true)
             -> 0 ->> 'forfeitId') <> v_forfeit,
      'acknowledging one page silenced a sibling forfeit that was never paged');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
END
$ceiling$;

-- 13. Catalog: both new tables are row-level-secured and closed; every new
--     function is SECURITY DEFINER with an empty search_path and not PUBLIC.
DO $catalog$
DECLARE
  v_signature text;
  v_oid regprocedure;
BEGIN
  PERFORM pg_temp.gc_assert(EXISTS (
    SELECT 1 FROM pg_catalog.pg_index AS idx
     WHERE idx.indrelid = 'piggyvest_primary.goal_cancel_interest_forfeits'::regclass
       AND idx.indpred IS NULL
       AND (idx.indkey::int2[])[0] = (SELECT attnum FROM pg_catalog.pg_attribute
                                      WHERE attrelid = 'piggyvest_primary.goal_cancel_interest_forfeits'::regclass
                                        AND attname = 'cancel_operation_id')),
    'the cancel-operation foreign key has no full index');
  PERFORM pg_temp.gc_assert(COALESCE((SELECT bool_and(class.relrowsecurity) FROM pg_catalog.pg_class AS class
    WHERE class.oid IN ('piggyvest_primary.goal_cancel_interest_forfeits'::regclass,
                        'piggyvest_primary.goal_interest_forfeit_wallets'::regclass,
                        'piggyvest_primary.goal_cancel_late_interest_contributions'::regclass)), false)
    AND NOT has_table_privilege('piggyvest_primary_authorizer',
      'piggyvest_primary.goal_cancel_late_interest_contributions', 'SELECT')
    AND NOT has_table_privilege('service_role',
      'piggyvest_primary.goal_cancel_late_interest_contributions', 'SELECT'),
    'a forfeit table has no row level security, or is readable');
  FOREACH v_signature IN ARRAY ARRAY[
    'piggyvest_primary.dispatch_goal_cancel_split(jsonb,uuid,bigint)',
    'piggyvest_primary.read_goal_cancel_amounts(jsonb,uuid)',
    'piggyvest_primary.release_goal_cancel_forfeit_row(uuid)',
    'piggyvest_primary.report_stuck_goal_cancel_forfeit(uuid,text)',
    'piggyvest_primary.claim_goal_cancel_forfeit(jsonb,uuid)',
    'piggyvest_primary.claim_goal_cancel_forfeit_core(uuid,text,text)',
    'piggyvest_primary.assert_goal_cancel_worker(uuid,text)',
    'piggyvest_primary.list_goal_cancel_forfeit_work(uuid,text,integer,boolean)',
    'piggyvest_primary.ack_goal_cancel_forfeit_alert_worker(uuid,text,uuid)',
    'piggyvest_primary.list_goal_cancel_holds_worker(uuid,text)',
    'piggyvest_primary.ack_goal_cancel_hold_row(uuid)',
    'piggyvest_primary.ack_goal_cancel_hold_worker(uuid,text,uuid)',
    'piggyvest_primary.ack_goal_cancel_hold(jsonb,uuid)',
    'piggyvest_primary.claim_goal_cancel_forfeit_worker(uuid,text,uuid)',
    'piggyvest_primary.release_goal_cancel_forfeit_worker(uuid,text,uuid)',
    'piggyvest_primary.unclaim_goal_cancel_forfeit_worker(uuid,text,uuid)',
    'piggyvest_primary.unclaim_goal_cancel_forfeit_row(uuid,boolean)',
    'piggyvest_primary.mark_goal_cancel_forfeit_posting_row(uuid,uuid)',
    'piggyvest_primary.mark_goal_cancel_forfeit_posting_worker(uuid,text,uuid,uuid)',
    'piggyvest_primary.manage_goal_cancel_forfeit(jsonb,uuid,text)',
    'piggyvest_primary.assert_goal_cancel_evidence(uuid,text)',
    'piggyvest_primary.read_dispatched_goal_cancel_forfeit(uuid,text,uuid)',
    'piggyvest_primary.find_dispatched_goal_cancel_forfeit_by_reference(uuid,text,text)',
    'piggyvest_primary.lock_goal_cancel_forfeit_for_proof(piggyvest_primary.integrations,jsonb)',
    'piggyvest_primary.settle_goal_cancel_forfeit(uuid,text,jsonb)',
    'piggyvest_primary.ack_goal_cancel_forfeit_alert_evidence(uuid,text,uuid)',
    'piggyvest_primary.release_failed_goal_cancel_forfeit(uuid,text,jsonb)',
    'piggyvest_primary.release_unsent_goal_cancel_forfeit()',
    'piggyvest_primary.block_in_flight_goal_cancel_forfeit_customer_deletion()',
    'piggyvest_primary.plan_forfeit_for_late_goal_interest()',
    'piggyvest_primary.reduce_forfeit_for_reversed_goal_interest()'
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
