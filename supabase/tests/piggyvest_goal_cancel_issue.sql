-- REGRESSION TEST (behaviour): issuing the attempt and the legacy-money guards
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

  -- 0. The key text digest matches the literal asserted by the web tests
  -- (goal-pin-binding.test.ts), so the two sides cannot drift.
  PERFORM pg_temp.gc_assert(
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:cancel:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'UTF8')), 'hex')
      = '2caa79006f7f847e307e48c9d4a52d49b96fc8d0b7d761b8adb79888e42c5143',
    'cancel key digest drifted from the web binding');

  -- 1. The server issues the operation id; a double tap gets the same one.
  v_issue := pg_temp.gc_issue_op();
  PERFORM pg_temp.gc_assert(v_issue ->> 'status' = 'issued', 'issue: ' || v_issue::text);
  v_op := v_issue ->> 'operationId';
  v_issue2 := pg_temp.gc_issue_op();
  PERFORM pg_temp.gc_assert(v_issue2 ->> 'operationId' = v_op, 'a second issue minted a new id');
  PERFORM pg_temp.gc_assert(
    (SELECT pg_catalog.count(*) FROM piggyvest_primary.goal_cancel_operations) = 1,
    'a second issue created a second row');

  -- 1b. The PIN verify route pre-check: only a live issued id for this goal.
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.check_goal_cancel_issued(v_scope, c_goal::uuid, v_op::uuid),
    'a live issued id was not recognised');
  PERFORM pg_temp.gc_assert(
    NOT piggyvest_primary.check_goal_cancel_issued(v_scope, c_goal::uuid, c_invented::uuid)
    AND NOT piggyvest_primary.check_goal_cancel_issued(v_scope, c_invented::uuid, v_op::uuid),
    'an invented operation or goal id was recognised');

  -- 1c. A goal bound to a PiggyVest goal wallet refuses new legacy money and
  -- order redemptions outright, and a goal that ALREADY holds either is sent
  -- to review instead of having the whole provider balance refunded.
  BEGIN
    INSERT INTO public.customer_savings_contributions
      (goal_id, merchant_id, customer_id, amount, source_type, status, idempotency_key)
    VALUES (c_goal::uuid, 'f3860000-0000-4000-8000-000000000002', 'f3860000-0000-4000-8000-000000000003',
      10, 'wallet', 'completed', 'synthetic-goalcancel-legacy-new');
    RAISE EXCEPTION 'a legacy contribution reached a primary goal' USING ERRCODE = 'PVT00';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    PERFORM pg_temp.gc_assert(SQLERRM = 'savings_goal_primary_not_allocatable',
      'legacy contribution guard raised another error: ' || SQLERRM);
  END;
  -- PiggyVest's own settlement contribution is marked and stays allowed.
  INSERT INTO public.customer_savings_contributions
    (goal_id, merchant_id, customer_id, amount, source_type, status, idempotency_key, metadata)
  VALUES (c_goal::uuid, 'f3860000-0000-4000-8000-000000000002', 'f3860000-0000-4000-8000-000000000003',
    10, 'wallet', 'completed', 'synthetic-goalcancel-primary-settlement',
    '{"provider": "piggyvest"}'::jsonb);
  PERFORM pg_temp.gc_assert(NOT piggyvest_primary.goal_cancel_needs_review(c_goal::uuid),
    'a PiggyVest settlement contribution was treated as legacy money');
  DELETE FROM public.customer_savings_contributions
   WHERE idempotency_key = 'synthetic-goalcancel-primary-settlement';
  BEGIN
    INSERT INTO public.customer_savings_redemptions
      (goal_id, merchant_id, customer_id, order_id, amount, idempotency_key)
    VALUES (c_goal::uuid, 'f3860000-0000-4000-8000-000000000002', 'f3860000-0000-4000-8000-000000000003',
      'f3860000-0000-4000-8000-0000000000f4', 1, 'synthetic-goalcancel-redemption-primary');
    RAISE EXCEPTION 'a primary goal was redeemed' USING ERRCODE = 'PVT00';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    PERFORM pg_temp.gc_assert(SQLERRM = 'savings_goal_primary_not_redeemable',
      'redemption guard raised another error for a primary goal: ' || SQLERRM);
  END;
  -- Data that predates the guards: written while the goal is not yet bound.
  PERFORM pg_temp.gc_unbind();
  INSERT INTO public.customer_savings_contributions
    (goal_id, merchant_id, customer_id, amount, source_type, status, idempotency_key)
  VALUES (c_goal::uuid, 'f3860000-0000-4000-8000-000000000002', 'f3860000-0000-4000-8000-000000000003',
    10, 'wallet', 'completed', 'synthetic-goalcancel-legacy-old');
  PERFORM pg_temp.gc_bind();
  PERFORM pg_temp.gc_assert(piggyvest_primary.goal_cancel_needs_review(c_goal::uuid),
    'a legacy contribution did not need review');
  PERFORM pg_temp.gc_issue('review', 'goal_cancel', 1, pg_temp.gc_key(v_op));
  v_result := pg_temp.gc_reserve(v_op, pg_temp.gc_token('review'));
  PERFORM pg_temp.gc_assert(v_result ->> 'status' = 'needs_review',
    'a mixed goal was reserved: ' || v_result::text);
  PERFORM pg_temp.gc_assert(NOT pg_temp.gc_spent('review') AND pg_temp.gc_state(v_op) = 'issued',
    'a needs-review refusal spent the proof or moved the attempt');
  PERFORM pg_temp.gc_unbind();
  DELETE FROM public.customer_savings_contributions WHERE idempotency_key = 'synthetic-goalcancel-legacy-old';
  PERFORM pg_temp.gc_bind();
  PERFORM pg_temp.gc_assert(NOT piggyvest_primary.goal_cancel_needs_review(c_goal::uuid),
    'the legacy contribution was still counted after removal');
  -- An unreversed redemption needs review at issue (no new row is created); a
  -- reversed one does not.
  PERFORM pg_temp.gc_unbind();
  INSERT INTO public.customer_savings_redemptions
    (goal_id, merchant_id, customer_id, order_id, amount, idempotency_key)
  VALUES (c_goal::uuid, 'f3860000-0000-4000-8000-000000000002', 'f3860000-0000-4000-8000-000000000003',
    'f3860000-0000-4000-8000-0000000000f5', 1, 'synthetic-goalcancel-redemption-old');
  PERFORM pg_temp.gc_bind();
  PERFORM pg_temp.gc_assert(piggyvest_primary.goal_cancel_needs_review(c_goal::uuid),
    'an unreversed redemption did not need review');
  v_issue2 := pg_temp.gc_issue_op();
  PERFORM pg_temp.gc_assert(v_issue2 ->> 'status' = 'needs_review' AND v_issue2 ->> 'operationId' IS NULL,
    'issue for a goal with an unreversed redemption: ' || v_issue2::text);
  UPDATE public.customer_savings_redemptions
     SET metadata = metadata || '{"reversed_at": "2026-01-01T00:00:00Z"}'::jsonb
   WHERE idempotency_key = 'synthetic-goalcancel-redemption-old';
  PERFORM pg_temp.gc_assert(NOT piggyvest_primary.goal_cancel_needs_review(c_goal::uuid),
    'a reversed redemption still needed review');
  PERFORM pg_temp.gc_unbind();
  DELETE FROM public.customer_savings_redemptions WHERE idempotency_key = 'synthetic-goalcancel-redemption-old';
  PERFORM pg_temp.gc_bind();
  v_issue2 := pg_temp.gc_issue_op();
  PERFORM pg_temp.gc_assert(v_issue2 ->> 'status' = 'issued' AND v_issue2 ->> 'operationId' = v_op,
    'a clean goal did not return its issued id again: ' || v_issue2::text);

  -- 1d. A live issued attempt is reused only under the same integration AND
  -- customer intent. One that belongs to another integration or intent is not
  -- handed back (its id could not be reserved under this scope anyway), so the
  -- caller gets a fresh id of its own.
  INSERT INTO piggyvest_primary.integrations
    (id, merchant_id, business_id, environment, executor_login, enabled)
  VALUES ('f3860000-0000-4000-8000-0000000000a1', 'f3860000-0000-4000-8000-000000000002',
    'synthetic-goalcancel-business-other', 'staging', 'retired-other-integration', false);
  UPDATE piggyvest_primary.goal_cancel_operations
     SET integration_id = 'f3860000-0000-4000-8000-0000000000a1' WHERE id = v_op::uuid;
  v_issue2 := pg_temp.gc_issue_op();
  PERFORM pg_temp.gc_assert(v_issue2 ->> 'status' = 'issued' AND v_issue2 ->> 'operationId' <> v_op,
    'an issued attempt of another integration was reused: ' || v_issue2::text);
  PERFORM pg_temp.gc_assert(
    (SELECT integration_id FROM piggyvest_primary.goal_cancel_operations
      WHERE id = (v_issue2 ->> 'operationId')::uuid) = 'f3860000-0000-4000-8000-000000000006',
    'the fresh attempt was not issued under this integration');
  DELETE FROM piggyvest_primary.goal_cancel_operations WHERE id = (v_issue2 ->> 'operationId')::uuid;
  UPDATE piggyvest_primary.goal_cancel_operations
     SET integration_id = 'f3860000-0000-4000-8000-000000000006' WHERE id = v_op::uuid;
  INSERT INTO piggyvest_primary.onboarding_intents (
    id, integration_id, merchant_id, customer_id, user_id, request_fingerprint, state,
    provider_customer_id, provider_wallet_id
  ) VALUES (
    'f3860000-0000-4000-8000-0000000000a2', 'f3860000-0000-4000-8000-0000000000a1',
    'f3860000-0000-4000-8000-000000000002', 'f3860000-0000-4000-8000-000000000003',
    'f3860000-0000-4000-8000-000000000001', repeat('e', 64), 'rejected',
    'synthetic-goalcancel-customer-other', 'synthetic-goalcancel-main-other');
  UPDATE piggyvest_primary.goal_cancel_operations
     SET intent_id = 'f3860000-0000-4000-8000-0000000000a2' WHERE id = v_op::uuid;
  v_issue2 := pg_temp.gc_issue_op();
  PERFORM pg_temp.gc_assert(v_issue2 ->> 'status' = 'issued' AND v_issue2 ->> 'operationId' <> v_op,
    'an issued attempt of another intent was reused: ' || v_issue2::text);
  PERFORM pg_temp.gc_assert(
    (SELECT intent_id FROM piggyvest_primary.goal_cancel_operations
      WHERE id = (v_issue2 ->> 'operationId')::uuid) = 'f3860000-0000-4000-8000-000000000007',
    'the fresh attempt was not issued under this intent');

END
$behaviour$;

ROLLBACK;
