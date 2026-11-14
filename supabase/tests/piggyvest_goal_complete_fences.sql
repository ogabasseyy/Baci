-- REGRESSION TEST (behaviour): a goal is fenced against funding, redemption,
-- deletion and a competing cancel while a complete is in flight, and the
-- mixed-goal refusal
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
  v_cancel text;
  v_result jsonb;
BEGIN
  -- 1. Mixed goal: legacy money on a PiggyVest goal is never swept to the
  -- main wallet. A legacy contribution predates the primary-goal guards, so
  -- the binding is lifted around the write.
  PERFORM pg_temp.gx_unbind();
  INSERT INTO public.customer_savings_contributions (goal_id, merchant_id, customer_id, amount, source_type, status, idempotency_key)
  VALUES (c_goal::uuid, 'f3870000-0000-4000-8000-000000000002', 'f3870000-0000-4000-8000-000000000003',
    1, 'wallet', 'completed', 'synthetic-goalcomplete-legacy');
  PERFORM pg_temp.gx_bind();
  v_result := pg_temp.gx_issue_op();
  PERFORM pg_temp.gx_assert(v_result ->> 'status' = 'needs_review' AND v_result ->> 'operationId' IS NULL,
    'a mixed goal was issued: ' || v_result::text);
  PERFORM pg_temp.gx_unbind();
  DELETE FROM public.customer_savings_contributions WHERE idempotency_key = 'synthetic-goalcomplete-legacy';
  PERFORM pg_temp.gx_bind();

  -- 2. While a complete is reserved: funding, redemption and deletion fail.
  v_op := pg_temp.gx_reserved('fence');
  BEGIN
    PERFORM pg_temp.gx_fund('f6', 1000);
    RAISE EXCEPTION 'funding was reserved during a complete' USING ERRCODE = 'PVT00';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    PERFORM pg_temp.gx_assert(SQLERRM = 'savings goal is being completed', 'funding fence message: ' || SQLERRM);
  END;
  -- Redemption of a goal that is no longer bound reaches the complete fence.
  PERFORM pg_temp.gx_unbind();
  BEGIN
    INSERT INTO public.customer_savings_redemptions (goal_id, merchant_id, customer_id, order_id, amount, idempotency_key)
    VALUES (c_goal::uuid, 'f3870000-0000-4000-8000-000000000002', 'f3870000-0000-4000-8000-000000000003',
      'f3870000-0000-4000-8000-0000000000f4', 1, 'synthetic-goalcomplete-redemption');
    RAISE EXCEPTION 'a goal was redeemed during a complete' USING ERRCODE = 'PVT00';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    PERFORM pg_temp.gx_assert(SQLERRM = 'savings_goal_complete_in_progress', 'redemption fence message: ' || SQLERRM);
  END;
  PERFORM pg_temp.gx_bind();
  BEGIN
    DELETE FROM public.customer_savings_goals WHERE id = c_goal::uuid;
    RAISE EXCEPTION 'a goal was deleted during a complete' USING ERRCODE = 'PVT00';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    PERFORM pg_temp.gx_assert(SQLERRM = 'cannot delete goal with unsettled goal completions', 'deletion guard: ' || SQLERRM);
  END;

  -- 3. A cancel can be issued (S6 is unchanged) but never reserved while a
  -- complete is live: the PIN proof is not spent and the attempt stays issued.
  v_cancel := piggyvest_primary.issue_goal_cancel(v_scope, c_goal::uuid) ->> 'operationId';
  PERFORM pg_temp.gx_issue('cancel-fence', 'goal_cancel', 1, c_goal || ':cancel:' || v_cancel);
  BEGIN
    PERFORM piggyvest_primary.reserve_goal_cancel_with_pin(v_scope,
      pg_catalog.jsonb_build_object('goalId', c_goal, 'operationId', v_cancel),
      pg_temp.gx_token('cancel-fence'));
    RAISE EXCEPTION 'a cancel was reserved during a complete' USING ERRCODE = 'PVT00';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    PERFORM pg_temp.gx_assert(SQLERRM = 'savings goal is being completed', 'cancel fence message: ' || SQLERRM);
  END;
  PERFORM pg_temp.gx_assert(NOT pg_temp.gx_spent('cancel-fence'), 'the cancel proof was spent');

  -- 4. Release the complete; the fences lift (funding works again).
  PERFORM pg_temp.gx_assert(piggyvest_primary.manage_goal_complete(v_scope, v_op::uuid, 'cancel', 0), 'release');
  PERFORM pg_temp.gx_fund('f6', 1000);
  DELETE FROM piggyvest_primary.savings_operations WHERE id = 'f3870000-0000-4000-8000-0000000000f6';

  -- 5. The other direction: with a cancel reserved, a complete is busy at
  -- issue and an already-issued complete id can not be reserved.
  v_op := pg_temp.gx_issue_op() ->> 'operationId';
  v_result := piggyvest_primary.reserve_goal_cancel_with_pin(v_scope,
    pg_catalog.jsonb_build_object('goalId', c_goal, 'operationId', v_cancel), pg_temp.gx_token('cancel-fence'));
  PERFORM pg_temp.gx_assert(v_result ->> 'status' = 'claimed', 'cancel setup: ' || v_result::text);
  v_result := pg_temp.gx_issue_op();
  PERFORM pg_temp.gx_assert(v_result ->> 'status' = 'busy', 'complete issued beside a live cancel: ' || v_result::text);
  PERFORM pg_temp.gx_issue('busy-proof', 'goal_complete', 1, pg_temp.gx_key(v_op));
  v_result := pg_temp.gx_reserve(v_op, pg_temp.gx_token('busy-proof'));
  PERFORM pg_temp.gx_assert(v_result ->> 'status' = 'busy' AND NOT pg_temp.gx_spent('busy-proof'),
    'complete reserved beside a live cancel: ' || v_result::text);
END
$behaviour$;

ROLLBACK;
