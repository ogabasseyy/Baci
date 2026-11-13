-- REGRESSION TEST (behaviour): provider references are never reused; interest refunds
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
  v_constraint text;
BEGIN
  -- 1. References are never reused. Whatever happened to an earlier attempt
  -- (never dispatched, failed, settled into review), the next reservation takes
  -- one more than the highest suffix ever issued; the bare reference is 0.
  v_op := pg_temp.gc_reserved('ref0');
  PERFORM pg_temp.gc_assert((SELECT reference FROM piggyvest_primary.goal_cancel_operations WHERE id = v_op::uuid)
    = 'pvb-cancel-' || c_goal, 'the first reference carried a suffix');
  PERFORM pg_temp.gc_assert(piggyvest_primary.manage_goal_cancel(v_scope, v_op::uuid, 'cancel', NULL),
    'a never-dispatched attempt was not released');
  v_op2 := pg_temp.gc_reserved('ref1');
  PERFORM pg_temp.gc_assert((SELECT reference FROM piggyvest_primary.goal_cancel_operations WHERE id = v_op2::uuid)
    = 'pvb-cancel-' || c_goal || '-1',
    'a never-dispatched release made its reference reusable');
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.dispatch_goal_cancel_split(v_scope, v_op2::uuid, 250000) ->> 'status' = 'dispatched',
    'dispatch refused');
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.release_failed_goal_cancel('f3860000-0000-4000-8000-000000000006'::uuid, 'staging',
      pg_temp.gc_proof(v_op2, 'failed')) = 'released', 'failed record did not release');

  -- 2. Release, then the late success settles (into review: the goal is still
  -- funded locally), the operator clears it, and the next cancel gets a NEW suffix.
  PERFORM pg_temp.gc_assert(
    pg_temp.gc_settle(pg_temp.gc_proof(v_op2) || '{"residualKobo":700}'::jsonb) = 'conflict',
    'the late success was not settled');
  PERFORM pg_temp.gc_assert(pg_temp.gc_state(v_op2) = 'needs_review', 'late success did not reach review');
  PERFORM pg_temp.gc_assert(piggyvest_primary.clear_goal_cancel_review(v_op2::uuid, 'checked'), 'clear failed');
  -- Since 20261112190514 a cancel refunds only the recorded principal, so the
  -- operator who cleared the review records what the goal still holds first
  -- (with a principal of 0 the split dispatch answers needs_review).
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.dispatch_goal_cancel_split(v_scope, (pg_temp.gc_reserved('ref-zero'))::uuid, 700)
      ->> 'status' = 'needs_review',
    'a goal with no recorded principal was dispatched');
  UPDATE public.customer_savings_goals SET current_amount = 2500 WHERE id = c_goal::uuid;
  v_text := pg_temp.gc_dispatched('ref2');
  PERFORM pg_temp.gc_assert((SELECT reference FROM piggyvest_primary.goal_cancel_operations WHERE id = v_text::uuid)
    = 'pvb-cancel-' || c_goal || '-3',
    'a cancel after a late success reused a reference');
  PERFORM pg_temp.gc_assert(
    (SELECT pg_catalog.count(DISTINCT reference) = pg_catalog.count(reference)
       FROM piggyvest_primary.goal_cancel_operations WHERE goal_id = c_goal::uuid),
    'two attempts share a reference');

  -- 3. The database itself refuses a duplicate provider reference.
  BEGIN
    INSERT INTO piggyvest_primary.goal_cancel_operations
      (id, integration_id, intent_id, goal_id, state, reference, reserved_at, issued_at, expires_at)
    VALUES (pg_catalog.gen_random_uuid(), 'f3860000-0000-4000-8000-000000000006',
      'f3860000-0000-4000-8000-000000000007', c_goal::uuid, 'released',
      'pvb-cancel-' || c_goal || '-1', pg_catalog.clock_timestamp(),
      pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());
    RAISE EXCEPTION 'a duplicate provider reference was accepted' USING ERRCODE = 'PVT00';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    PERFORM pg_temp.gc_assert(v_constraint = 'goal_cancel_reference_key',
      'the duplicate reference was refused by another constraint: ' || v_constraint);
  END;
  -- A NULL reference is only legal for an attempt that was never reserved.
  BEGIN
    UPDATE piggyvest_primary.goal_cancel_operations SET reference = NULL
     WHERE id = v_op2::uuid;
    RAISE EXCEPTION 'a reserved attempt lost its reference' USING ERRCODE = 'PVT00';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE piggyvest_primary.goal_cancel_operations SET state = 'needs_review', provider_transaction_id = NULL
     WHERE id = v_text::uuid;
    RAISE EXCEPTION 'a review attempt without a provider transaction was accepted' USING ERRCODE = 'PVT00';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END
$behaviour$;

ROLLBACK;
