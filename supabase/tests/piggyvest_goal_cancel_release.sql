-- REGRESSION TEST (behaviour): failed transfers, late success, stale reservations and expiry
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
  v_op := pg_temp.gc_dispatched('exact');
  -- 12. A failed provider record releases the attempt; a NEW attempt with a
  -- new PIN proof and a fresh reference can be tried.
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.release_failed_goal_cancel('f3860000-0000-4000-8000-000000000006'::uuid, 'staging',
      pg_temp.gc_proof(v_op, 'failed')) = 'released', 'failed record did not release');
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.release_failed_goal_cancel('f3860000-0000-4000-8000-000000000006'::uuid, 'staging',
      pg_temp.gc_proof(v_op, 'failed')) = 'duplicate', 'a replayed release was not idempotent');
  -- The released attempt was dispatched, so reconciliation can still load it
  -- (read and by-reference lookup), which is what makes a late success reachable.
  v_result := piggyvest_primary.read_dispatched_goal_cancel(
    'f3860000-0000-4000-8000-000000000006'::uuid, 'staging', v_op::uuid);
  PERFORM pg_temp.gc_assert(v_result ->> 'operationId' = v_op AND v_result ->> 'amountKobo' = '250000',
    'a released-but-dispatched attempt was not loadable: ' || COALESCE(v_result::text, 'null'));
  v_result := piggyvest_primary.find_dispatched_goal_cancel_by_reference(
    'f3860000-0000-4000-8000-000000000006'::uuid, 'staging', 'pvb-cancel-' || c_goal);
  PERFORM pg_temp.gc_assert(v_result ->> 'operationId' = v_op,
    'a released-but-dispatched attempt was not found by reference');
  -- A transfer the provider indexed late and then completed settles the
  -- released (but dispatched) attempt. Probed in a block that is rolled back.
  BEGIN
    PERFORM pg_temp.gc_assert(
      piggyvest_primary.settle_goal_cancel('f3860000-0000-4000-8000-000000000006'::uuid, 'staging',
        pg_temp.gc_proof(v_op)) = 'confirmed', 'a late success on a released attempt was not settled');
    PERFORM pg_temp.gc_assert(pg_temp.gc_state(v_op) = 'confirmed'
      AND (SELECT status FROM public.customer_savings_goals WHERE id = c_goal::uuid) = 'cancelled',
      'a late success did not cancel the goal');
    PERFORM pg_temp.gc_assert(
      (SELECT available_balance FROM public.customer_wallets
        WHERE id = 'f3860000-0000-4000-8000-000000000008') = 1000,
      'a late success changed the legacy wallet');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
  PERFORM pg_temp.gc_assert(pg_temp.gc_state(v_op) = 'released'
    AND (SELECT status FROM public.customer_savings_goals WHERE id = c_goal::uuid) = 'active',
    'the late-success probe was not rolled back');
  PERFORM pg_temp.gc_assert(
    (SELECT available_balance FROM public.customer_wallets
      WHERE id = 'f3860000-0000-4000-8000-000000000008') = 1000,
    'the late-success probe left a wallet credit behind');
  -- Release, fund again, then a late success: the refund settles only its own
  -- amount (main wallet credited, local goal reduced by that amount), the goal
  -- KEEPS the newer contribution and stays open, a review marker is written and
  -- the answer is 'conflict' so the application pages an operator.
  BEGIN
    INSERT INTO piggyvest_primary.savings_operations (
      id, integration_id, intent_id, goal_id, amount_kobo, source_wallet_id,
      destination_wallet_id, reference, state, wallet_transaction_id)
    VALUES ('f3860000-0000-4000-8000-0000000000f3', 'f3860000-0000-4000-8000-000000000006',
      'f3860000-0000-4000-8000-000000000007', c_goal::uuid, 10000, 'synthetic-goalcancel-main',
      'synthetic-goalcancel-goal-wallet', 'pvb-save-f3860000-0000-4000-8000-0000000000f3', 'confirmed',
      'f3860000-0000-4000-8000-000000000009');
    UPDATE public.customer_savings_goals SET current_amount = current_amount + 100
     WHERE id = c_goal::uuid;
    PERFORM pg_temp.gc_assert(
      piggyvest_primary.settle_goal_cancel('f3860000-0000-4000-8000-000000000006'::uuid, 'staging',
        pg_temp.gc_proof(v_op)) = 'conflict', 'a late success after new funding was not routed to review');
    PERFORM pg_temp.gc_assert(pg_temp.gc_state(v_op) = 'needs_review'
      AND (SELECT status FROM public.customer_savings_goals WHERE id = c_goal::uuid) = 'active'
      AND (SELECT current_amount FROM public.customer_savings_goals WHERE id = c_goal::uuid) = 100,
      'a late success zeroed, closed or confirmed a goal that was funded again');
    PERFORM pg_temp.gc_assert(
      (SELECT available_balance FROM public.customer_wallets
        WHERE id = 'f3860000-0000-4000-8000-000000000008') = 1000,
      'a late success after new funding changed the legacy wallet');
    PERFORM pg_temp.gc_assert(
      EXISTS (SELECT 1 FROM public.customer_savings_events
               WHERE goal_id = c_goal::uuid AND event_type = 'goal_cancel_needs_review')
      AND NOT EXISTS (SELECT 1 FROM public.customer_savings_events
               WHERE goal_id = c_goal::uuid AND event_type = 'goal_cancelled_refunded'),
      'a late success after new funding wrote no review marker');
    PERFORM pg_temp.gc_assert(
      piggyvest_primary.settle_goal_cancel('f3860000-0000-4000-8000-000000000006'::uuid, 'staging',
        pg_temp.gc_proof(v_op)) = 'duplicate', 'a replayed late success was not idempotent');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
  -- A proof with the wrong reference never settles it.
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.settle_goal_cancel('f3860000-0000-4000-8000-000000000006'::uuid, 'staging',
      pg_temp.gc_proof(v_op) || pg_catalog.jsonb_build_object('reference', 'pvb-cancel-' || c_goal || '-1')) = 'conflict',
    'a released attempt settled on another reference');
  v_result := pg_temp.gc_reserve(v_op, pg_temp.gc_token('exact'));
  PERFORM pg_temp.gc_assert(v_result ->> 'status' = 'conflict', 'a released id was reusable: ' || v_result::text);
  v_issue := pg_temp.gc_issue_op();
  v_op2 := v_issue ->> 'operationId';
  PERFORM pg_temp.gc_assert(v_issue ->> 'status' = 'issued' AND v_op2 <> v_op, 'no fresh attempt after release');
  PERFORM pg_temp.gc_issue('second', 'goal_cancel', 1, pg_temp.gc_key(v_op2));
  v_result := pg_temp.gc_reserve(v_op2, pg_temp.gc_token('second'));
  PERFORM pg_temp.gc_assert(v_result ->> 'status' = 'claimed', 'second attempt did not reserve');
  -- The released attempt was dispatched, so the retry takes a fresh reference.
  PERFORM pg_temp.gc_assert(v_result #>> '{reservation,reference}' = 'pvb-cancel-' || c_goal || '-1',
    'a retry after a failed transfer reused the reference: ' || v_result::text);

  -- 13. A stale reservation (nothing sent) can be released; an issued id past
  -- its expiry is dead; neither frees a proof.
  UPDATE piggyvest_primary.goal_cancel_operations SET reserved_at = pg_catalog.clock_timestamp() - interval '6 minutes'
   WHERE id = v_op2::uuid;
  PERFORM pg_temp.gc_assert(piggyvest_primary.manage_goal_cancel(v_scope, v_op2::uuid, 'cancel_stale', NULL),
    'a stale reservation was not released');
  PERFORM pg_temp.gc_assert(pg_temp.gc_state(v_op2) = 'released', 'stale release state');
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.read_dispatched_goal_cancel(
      'f3860000-0000-4000-8000-000000000006'::uuid, 'staging', v_op2::uuid) IS NULL,
    'a released attempt that was never dispatched was loadable');
  v_issue := pg_temp.gc_issue_op();
  v_op := v_issue ->> 'operationId';
  UPDATE piggyvest_primary.goal_cancel_operations SET expires_at = pg_catalog.clock_timestamp() - interval '1 second'
   WHERE id = v_op::uuid;
  PERFORM pg_temp.gc_issue('late', 'goal_cancel', 1, pg_temp.gc_key(v_op));
  v_result := pg_temp.gc_reserve(v_op, pg_temp.gc_token('late'));
  PERFORM pg_temp.gc_assert(v_result ->> 'status' = 'expired', 'expired id: ' || v_result::text);
  PERFORM pg_temp.gc_assert(NOT pg_temp.gc_spent('late') AND pg_temp.gc_state(v_op) = 'released',
    'an expired id spent a proof');

END
$behaviour$;

ROLLBACK;
