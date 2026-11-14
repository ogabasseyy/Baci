-- REGRESSION TEST (behaviour): funding fence, dispatch, fences and settlement validation
-- (migration 20261103085004_piggyvest_goal_cancel_refund). Fixture and
-- helpers live in the included part; registered in the replay registry folder
-- 20261103085004_piggyvest_goal_cancel_refund.
\set ON_ERROR_STOP on
\ir piggyvest_goal_cancel_behaviour.fixture.inc.sql

DO $behaviour$
DECLARE
  c_goal constant text := 'f3860000-0000-4000-8000-000000000005';
  c_invented constant text := 'f3860000-0000-4000-8000-0000000000ee';
  c_other constant text := 'f3860000-0000-4000-8000-0000000000ef';
  v_scope jsonb := pg_temp.gc_scope();
  v_issue jsonb;
  v_issue2 jsonb;
  v_op text;
  v_op2 text;
  v_result jsonb;
  v_text text;
BEGIN
  v_op := pg_temp.gc_reserved('exact');

  -- 9. Funding cannot be reserved for a goal with a cancel in flight.
  BEGIN
    INSERT INTO piggyvest_primary.savings_operations (
      id, integration_id, intent_id, goal_id, amount_kobo, source_wallet_id,
      destination_wallet_id, reference, state, wallet_transaction_id)
    VALUES ('f3860000-0000-4000-8000-0000000000f1', 'f3860000-0000-4000-8000-000000000006',
      'f3860000-0000-4000-8000-000000000007', c_goal::uuid, 100, 'synthetic-goalcancel-main',
      'synthetic-goalcancel-goal-wallet', 'pvb-save-f3860000-0000-4000-8000-0000000000f1', 'reserved',
      'f3860000-0000-4000-8000-000000000009');
    -- A custom SQLSTATE the handler below does not catch: if the insert
    -- succeeds the test fails here instead of passing by accident.
    RAISE EXCEPTION 'funding was reserved during a cancel' USING ERRCODE = 'PVT00';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    PERFORM pg_temp.gc_assert(SQLERRM = 'savings goal is being cancelled',
      'funding fence raised another error: ' || SQLERRM);
  END;

  -- 10. Dispatch records the principal as the amount, exactly once (the split
  -- dispatch of 20261112190514; the provider balance equals the principal here).
  BEGIN
    PERFORM piggyvest_primary.dispatch_goal_cancel_split(v_scope, v_op::uuid, NULL);
    RAISE EXCEPTION 'dispatch without a balance was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM piggyvest_primary.dispatch_goal_cancel_split(v_scope, v_op::uuid, 0);
    RAISE EXCEPTION 'dispatch with a zero balance was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  PERFORM pg_temp.gc_assert(NOT piggyvest_primary.manage_goal_cancel(v_scope, v_op::uuid, 'cancel_stale', NULL),
    'a fresh reservation was cancelled as stale');
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.dispatch_goal_cancel_split(v_scope, v_op::uuid, 250000) ->> 'status' = 'dispatched',
    'dispatch refused');
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.dispatch_goal_cancel_split(v_scope, v_op::uuid, 250000) ->> 'status' = 'not_claimed',
    'a second dispatch was accepted');
  PERFORM pg_temp.gc_assert(
    (SELECT amount_kobo FROM piggyvest_primary.goal_cancel_operations WHERE id = v_op::uuid) = 250000
    AND piggyvest_primary.read_goal_cancel_status(v_scope, v_op::uuid) = 'dispatched',
    'dispatch did not record the amount');
  PERFORM pg_temp.gc_assert(NOT piggyvest_primary.manage_goal_cancel(v_scope, v_op::uuid, 'cancel', NULL),
    'a dispatched attempt was cancelled before dispatch');
  v_result := piggyvest_primary.read_dispatched_goal_cancel(
    'f3860000-0000-4000-8000-000000000006'::uuid, 'staging', v_op::uuid);
  PERFORM pg_temp.gc_assert(v_result ->> 'amountKobo' = '250000' AND v_result ->> 'businessId' = 'synthetic-goalcancel-business',
    'dispatched read: ' || COALESCE(v_result::text, 'null'));
  -- The webhook path resolves the dispatched attempt by its provider reference.
  v_result := piggyvest_primary.find_dispatched_goal_cancel_by_reference(
    'f3860000-0000-4000-8000-000000000006'::uuid, 'staging', 'pvb-cancel-' || c_goal);
  PERFORM pg_temp.gc_assert(v_result ->> 'operationId' = v_op, 'find by reference: ' || COALESCE(v_result::text, 'null'));
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.find_dispatched_goal_cancel_by_reference(
      'f3860000-0000-4000-8000-000000000006'::uuid, 'staging', 'pvb-cancel-' || c_goal || '-9') IS NULL,
    'find by reference matched an unknown reference');
  -- A dispatched cancel blocks an order redemption of the goal (the trigger
  -- fires before the foreign keys, so a synthetic order id is enough).
  BEGIN
    INSERT INTO public.customer_savings_redemptions
      (goal_id, merchant_id, customer_id, order_id, amount, idempotency_key)
    VALUES (c_goal::uuid, 'f3860000-0000-4000-8000-000000000002', 'f3860000-0000-4000-8000-000000000003',
      'f3860000-0000-4000-8000-0000000000f3', 1, 'synthetic-goalcancel-redemption');
    RAISE EXCEPTION 'a goal with a dispatched cancel was redeemed' USING ERRCODE = 'PVT00';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    PERFORM pg_temp.gc_assert(SQLERRM = 'savings_goal_cancel_in_progress',
      'redemption guard raised another error: ' || SQLERRM);
  END;
  -- Customer and goal deletion wait for the unresolved cancel.
  BEGIN
    DELETE FROM public.customer_savings_goals WHERE id = c_goal::uuid;
    RAISE EXCEPTION 'a goal with a dispatched cancel was deleted' USING ERRCODE = 'PVT00';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    PERFORM pg_temp.gc_assert(SQLERRM = 'cannot delete goal with unsettled goal cancellations',
      'goal deletion guard raised another error: ' || SQLERRM);
  END;
  -- The earlier bank-inbox guard refuses a customer whose provider wallet is
  -- still open before this guard runs, so the fixture's wallet is closed first.
  -- The close is undone with the failed delete when the handler below runs.
  BEGIN
    UPDATE piggyvest_primary.onboarding_intents SET provider_closed_at = pg_catalog.clock_timestamp()
     WHERE id = 'f3860000-0000-4000-8000-000000000007';
    DELETE FROM public.customers WHERE id = 'f3860000-0000-4000-8000-000000000003';
    RAISE EXCEPTION 'a customer with a dispatched cancel was deleted' USING ERRCODE = 'PVT00';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    PERFORM pg_temp.gc_assert(SQLERRM = 'cannot delete customer with unsettled goal cancellations',
      'customer deletion guard raised another error: ' || SQLERRM);
  END;

  -- 11. Settlement refuses any mismatch and a malformed proof.
  BEGIN
    PERFORM piggyvest_primary.settle_goal_cancel('f3860000-0000-4000-8000-000000000006'::uuid, 'staging',
      pg_temp.gc_proof(v_op) - 'businessId');
    RAISE EXCEPTION 'a proof with a missing key was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  FOREACH v_text IN ARRAY ARRAY['amountKobo', 'reference', 'sourceWalletId', 'destinationWalletId', 'businessId'] LOOP
    v_result := pg_catalog.to_jsonb(piggyvest_primary.settle_goal_cancel(
      'f3860000-0000-4000-8000-000000000006'::uuid, 'staging',
      CASE WHEN v_text = 'amountKobo' THEN pg_temp.gc_proof(v_op) || '{"amountKobo":250001}'::jsonb
           ELSE pg_temp.gc_proof(v_op) || pg_catalog.jsonb_build_object(v_text, 'tampered') END));
    PERFORM pg_temp.gc_assert(v_result #>> '{}' = 'conflict', 'tampered ' || v_text || ': ' || v_result::text);
  END LOOP;
  PERFORM pg_temp.gc_assert(pg_temp.gc_state(v_op) = 'dispatched'
    AND (SELECT status FROM public.customer_savings_goals WHERE id = c_goal::uuid) = 'active',
    'a refused settlement changed state');

END
$behaviour$;

ROLLBACK;
