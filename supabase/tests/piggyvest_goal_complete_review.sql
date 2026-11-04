-- REGRESSION TEST (behaviour): numbered references, release, late success,
-- review and its operator clearance for goal complete
-- (migration 20261103181737_piggyvest_goal_complete_purchase_request).
-- Registered in the replay registry folder
-- 20261103181737_piggyvest_goal_complete_purchase_request.
\set ON_ERROR_STOP on
\ir piggyvest_goal_complete_behaviour.fixture.inc.sql

DO $behaviour$
DECLARE
  c_goal constant text := 'f3870000-0000-4000-8000-000000000005';
  v_scope jsonb := pg_temp.gx_scope();
  v_op text;
  v_op2 text;
  v_op3 text;
  v_result jsonb;
BEGIN
  PERFORM pg_temp.gx_fund('f4', 250000);

  -- 1. Release before dispatch, then a fresh numbered reference (never reused).
  v_op := pg_temp.gx_reserved('r1');
  PERFORM pg_temp.gx_assert(NOT piggyvest_primary.manage_goal_complete(v_scope, v_op::uuid, 'cancel_stale', 0),
    'a fresh reservation was swept as stale');
  PERFORM pg_temp.gx_assert(piggyvest_primary.manage_goal_complete(v_scope, v_op::uuid, 'cancel', 0)
    AND pg_temp.gx_state(v_op) = 'released', 'release before dispatch');
  v_op2 := pg_temp.gx_dispatched('r2');
  PERFORM pg_temp.gx_assert((SELECT reference FROM piggyvest_primary.goal_complete_operations WHERE id = v_op2::uuid)
    = 'pvb-complete-' || c_goal || '-1', 'the second reference was not numbered 1');

  -- 2. Provider-reported failure releases a dispatched attempt (once).
  PERFORM pg_temp.gx_assert(pg_temp.gx_release(pg_temp.gx_proof(v_op2, 'failed')) = 'released', 'release');
  PERFORM pg_temp.gx_assert(pg_temp.gx_release(pg_temp.gx_proof(v_op2, 'failed')) = 'duplicate', 'release replay');
  v_op3 := pg_temp.gx_dispatched('r3');
  PERFORM pg_temp.gx_assert((SELECT reference FROM piggyvest_primary.goal_complete_operations WHERE id = v_op3::uuid)
    = 'pvb-complete-' || c_goal || '-2', 'the third reference was not numbered 2');
  PERFORM pg_temp.gx_assert((SELECT pg_catalog.count(DISTINCT reference) FROM piggyvest_primary.goal_complete_operations) = 3,
    'a reference was reused');

  -- 3. A late success: the released attempt settles from a verified record,
  -- only while no other attempt is live. v_op3 is live, so it conflicts.
  PERFORM pg_temp.gx_assert(pg_temp.gx_settle(pg_temp.gx_proof(v_op2)) = 'conflict'
    AND pg_temp.gx_state(v_op2) = 'released', 'a late success settled beside a live attempt');
  PERFORM pg_temp.gx_assert(piggyvest_primary.manage_goal_complete(v_scope, v_op3::uuid, 'release', 0)
    AND pg_temp.gx_state(v_op3) = 'released', 'release of the live attempt');
  BEGIN
    PERFORM pg_temp.gx_assert(pg_temp.gx_settle(pg_temp.gx_proof(v_op2)) = 'confirmed', 'late success');
    PERFORM pg_temp.gx_assert(pg_temp.gx_goal('status') = 'completed' AND pg_temp.gx_wallet() = 1000
      AND (SELECT pg_catalog.count(*) FROM piggyvest_primary.goal_purchase_requests
            WHERE complete_operation_id = v_op2::uuid) = 1, 'late success books');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;

  -- 4. A late success after the goal was funded again settles ONLY its own
  -- amount: review, goal open, refund credited, no purchase request.
  PERFORM pg_temp.gx_fund('f5', 100000);
  -- now() is the transaction start in this single-transaction test, so the
  -- funding time is set from the clock to land after the dispatch.
  UPDATE piggyvest_primary.savings_operations SET created_at = pg_catalog.clock_timestamp()
   WHERE id = 'f3870000-0000-4000-8000-0000000000f5';
  BEGIN
    PERFORM pg_temp.gx_assert(pg_temp.gx_settle(pg_temp.gx_proof(v_op2)) = 'conflict', 'late success after funding');
    PERFORM pg_temp.gx_assert(pg_temp.gx_state(v_op2) = 'needs_review' AND pg_temp.gx_goal('status') = 'active'
      AND pg_temp.gx_wallet() = 1000
      AND NOT EXISTS (SELECT 1 FROM piggyvest_primary.goal_purchase_requests), 'review books');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
  DELETE FROM piggyvest_primary.savings_operations WHERE id = 'f3870000-0000-4000-8000-0000000000f5';

  -- 5. Review blocks a new complete until an operator clears it.
  PERFORM pg_temp.gx_assert(pg_temp.gx_settle(pg_temp.gx_proof(v_op2) || '{"residualKobo":4200}'::jsonb) = 'conflict'
    AND pg_temp.gx_state(v_op2) = 'needs_review', 'residual review');
  v_result := pg_temp.gx_issue_op();
  PERFORM pg_temp.gx_assert(v_result ->> 'status' = 'needs_review', 'issue during review: ' || v_result::text);
  PERFORM pg_temp.gx_assert(piggyvest_primary.read_goal_complete_status(v_scope, v_op2::uuid) = 'needs_review',
    'status during review');
  PERFORM pg_temp.gx_assert(pg_temp.gx_settle(pg_temp.gx_proof(v_op2)) = 'duplicate', 'review replay');
  BEGIN
    PERFORM public.clear_goal_complete_review(v_op2::uuid, '   ');
    RAISE EXCEPTION 'a blank review note was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  PERFORM pg_temp.gx_assert(NOT public.clear_goal_complete_review(v_op::uuid, 'not in review'), 'cleared a released attempt');
  PERFORM pg_temp.gx_assert(public.clear_goal_complete_review(v_op2::uuid, 'checked balance at PiggyVest'), 'clearance');
  PERFORM pg_temp.gx_assert(pg_temp.gx_state(v_op2) = 'reviewed' AND NOT public.clear_goal_complete_review(v_op2::uuid, 'again'),
    'clearance state');
  PERFORM pg_temp.gx_assert(pg_temp.gx_issue_op() ->> 'status' = 'issued', 'no new complete after clearance');

  -- 6. Interest above the recorded funding settles at the provider balance;
  -- the expected balance floors at zero rather than going negative.
  v_op3 := pg_temp.gx_reserved('interest');
  PERFORM pg_temp.gx_assert(piggyvest_primary.manage_goal_complete(v_scope, v_op3::uuid, 'dispatch', 260000), 'dispatch');
  PERFORM pg_temp.gx_assert(pg_temp.gx_settle(pg_temp.gx_proof(v_op3) || '{"amountKobo":260000}'::jsonb) = 'confirmed',
    'interest settlement');
  PERFORM pg_temp.gx_assert(pg_temp.gx_wallet() = 1000 AND pg_temp.gx_goal('status') = 'completed', 'interest books');
  v_result := piggyvest_primary.read_daily_reconciliation(
    'f3870000-0000-4000-8000-000000000006'::uuid, 'staging', '{"staleAfterSeconds":60}'::jsonb);
  PERFORM pg_temp.gx_assert(v_result -> 'wallets' =
    '[{"walletId":"synthetic-goalcomplete-goal-wallet","expectedKobo":0}]'::jsonb, 'floor: ' || (v_result -> 'wallets')::text);
END
$behaviour$;

ROLLBACK;
