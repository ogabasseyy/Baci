-- REGRESSION TEST (behaviour): review state, operator clearance and the re-cancel
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
  v_cleared boolean;
BEGIN
  -- Funding the books know about: 250000 kobo at the provider.
  PERFORM pg_temp.gc_fund('f4', 250000);
  v_op := pg_temp.gc_dispatched('rev');

  -- 1. A residual provider balance after the transfer: the attempt becomes
  -- needs_review (NOT confirmed), the refund's own amount is credited, the
  -- goal stays open with the residual, a marker is written, answer 'conflict'.
  PERFORM pg_temp.gc_assert(
    pg_temp.gc_settle(pg_temp.gc_proof(v_op) || '{"residualKobo":4200}'::jsonb) = 'conflict',
    'a residual provider balance was not routed to review');
  PERFORM pg_temp.gc_assert(pg_temp.gc_state(v_op) = 'needs_review'
    AND pg_temp.gc_goal('status') = 'active' AND pg_temp.gc_goal('current_amount')::numeric = 0
    AND pg_temp.gc_goal('cancelled_at') IS NULL AND pg_temp.gc_goal('future_debits_cancelled_at') IS NULL,
    'review did not keep the goal open and unfenced');
  PERFORM pg_temp.gc_assert(pg_temp.gc_wallet() = 1000
    AND NOT EXISTS (SELECT 1 FROM public.customer_wallet_transactions
          WHERE source_type = 'piggyvest_goal_cancel' AND source_id = v_op::uuid),
    'review credited the legacy wallet');
  PERFORM pg_temp.gc_assert(
    EXISTS (SELECT 1 FROM public.customer_savings_events WHERE goal_id = c_goal::uuid AND event_type = 'goal_cancel_needs_review')
    AND NOT EXISTS (SELECT 1 FROM public.customer_savings_events WHERE goal_id = c_goal::uuid AND event_type = 'goal_cancelled_refunded'),
    'review wrote the wrong marker');

  -- 2. Every status read says needs_review, whichever path settled first; a
  -- replay (webhook after poll or poll after webhook) is a duplicate and credits nothing.
  PERFORM pg_temp.gc_assert(piggyvest_primary.read_goal_cancel_status(v_scope, v_op::uuid) = 'needs_review'
    AND piggyvest_primary.read_goal_cancel_status(v_scope, v_op::uuid) = 'needs_review',
    'a review attempt did not keep reading needs_review');
  PERFORM pg_temp.gc_assert(
    pg_temp.gc_settle(pg_temp.gc_proof(v_op) || '{"residualKobo":4200}'::jsonb) = 'duplicate'
    AND pg_temp.gc_settle(pg_temp.gc_proof(v_op)) = 'duplicate',
    'a replayed settlement of a review attempt was not idempotent');
  PERFORM pg_temp.gc_assert(
    pg_temp.gc_settle(pg_temp.gc_proof(v_op) || '{"providerTransactionId":"another-transaction"}'::jsonb) = 'conflict',
    'another provider transaction settled a review attempt');
  PERFORM pg_temp.gc_assert(pg_temp.gc_wallet() = 1000, 'a replay changed the legacy wallet');
  v_result := pg_temp.gc_reserve(v_op, NULL);
  PERFORM pg_temp.gc_assert(v_result ->> 'status' = 'needs_review', 'reserve on a review attempt: ' || v_result::text);

  -- 3. The goal can still be funded while the review waits (review does not
  -- fence funding), but a NEW cancel is blocked until an operator clears it.
  BEGIN
    INSERT INTO piggyvest_primary.savings_operations (
      id, integration_id, intent_id, goal_id, amount_kobo, source_wallet_id,
      destination_wallet_id, reference, state, wallet_transaction_id)
    VALUES ('f3860000-0000-4000-8000-0000000000f1', 'f3860000-0000-4000-8000-000000000006',
      'f3860000-0000-4000-8000-000000000007', c_goal::uuid, 100, 'synthetic-goalcancel-main',
      'synthetic-goalcancel-goal-wallet', 'pvb-save-f3860000-0000-4000-8000-0000000000f1', 'confirmed',
      'f3860000-0000-4000-8000-000000000009');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
  v_issue2 := pg_temp.gc_issue_op();
  PERFORM pg_temp.gc_assert(v_issue2 ->> 'status' = 'needs_review' AND v_issue2 ->> 'operationId' IS NULL,
    'a new cancel was issued while a review waited: ' || v_issue2::text);
  PERFORM pg_temp.gc_assert(
    NOT EXISTS (SELECT 1 FROM piggyvest_primary.goal_cancel_operations
                 WHERE goal_id = c_goal::uuid AND state = 'issued'),
    'a blocked issue still wrote a row');
  v_result := piggyvest_primary.read_daily_reconciliation(
    'f3860000-0000-4000-8000-000000000006'::uuid, 'staging', '{"staleAfterSeconds":60}'::jsonb);
  PERFORM pg_temp.gc_assert(v_result -> 'wallets' =
    '[{"walletId":"synthetic-goalcancel-goal-wallet","expectedKobo":0}]'::jsonb,
    'a settled refund did not lower the expected balance: ' || (v_result -> 'wallets')::text);

  -- 4. The clearance is the only way out: validated, idempotent, recorded.
  FOREACH v_text IN ARRAY ARRAY['null-op', 'null-note', 'blank-note', 'long-note'] LOOP
    BEGIN
      PERFORM piggyvest_primary.clear_goal_cancel_review(
        CASE WHEN v_text = 'null-op' THEN NULL ELSE v_op::uuid END,
        CASE v_text WHEN 'null-note' THEN NULL WHEN 'blank-note' THEN '   '
                    WHEN 'long-note' THEN pg_catalog.repeat('x', 1001) ELSE 'ok' END);
      RAISE EXCEPTION 'an invalid clearance (%) was accepted', v_text USING ERRCODE = 'PVT00';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;
  END LOOP;
  PERFORM pg_temp.gc_assert(pg_temp.gc_state(v_op) = 'needs_review', 'an invalid clearance changed the state');
  PERFORM pg_temp.gc_assert(
    NOT piggyvest_primary.clear_goal_cancel_review('f3860000-0000-4000-8000-0000000000ee'::uuid, 'unknown'),
    'an unknown attempt was cleared');
  -- The ops path: service_role (no schema usage) clears it through the wrapper.
  SET LOCAL ROLE service_role;
  v_cleared := public.clear_goal_cancel_review(v_op::uuid, '  operator checked the residual  ');
  RESET ROLE;
  PERFORM pg_temp.gc_assert(v_cleared, 'the review attempt was not cleared through the public wrapper');
  PERFORM pg_temp.gc_assert(pg_temp.gc_state(v_op) = 'reviewed'
    AND (SELECT review_note FROM piggyvest_primary.goal_cancel_operations WHERE id = v_op::uuid) = 'operator checked the residual'
    AND (SELECT reviewed_at IS NOT NULL FROM piggyvest_primary.goal_cancel_operations WHERE id = v_op::uuid)
    AND EXISTS (SELECT 1 FROM public.customer_savings_events
                 WHERE goal_id = c_goal::uuid AND event_type = 'goal_cancel_review_cleared'),
    'the clearance was not recorded');
  PERFORM pg_temp.gc_assert(NOT piggyvest_primary.clear_goal_cancel_review(v_op::uuid, 'again'),
    'a cleared attempt was cleared twice');
  PERFORM pg_temp.gc_assert(piggyvest_primary.read_goal_cancel_status(v_scope, v_op::uuid) = 'reviewed',
    'a cleared attempt did not read reviewed');
  v_result := pg_temp.gc_reserve(v_op, NULL);
  PERFORM pg_temp.gc_assert(v_result ->> 'status' = 'conflict', 'a reviewed attempt was reusable: ' || v_result::text);

  -- 5. After the clearance the customer cancels again: a NEW numbered
  -- reference, and the second refund sweeps the residual. Since
  -- 20261112190514 only the recorded principal is refunded, so the operator
  -- records the residual as the goal's principal when clearing it.
  UPDATE public.customer_savings_goals SET current_amount = 2500 WHERE id = c_goal::uuid;
  v_op2 := pg_temp.gc_dispatched('rev2');
  PERFORM pg_temp.gc_assert((SELECT reference FROM piggyvest_primary.goal_cancel_operations WHERE id = v_op2::uuid)
    = 'pvb-cancel-' || c_goal || '-1', 'the re-cancel did not take the next suffix');
  PERFORM pg_temp.gc_assert(pg_temp.gc_settle(pg_temp.gc_proof(v_op2)) = 'confirmed',
    'the re-cancel did not settle cleanly');
  PERFORM pg_temp.gc_assert(pg_temp.gc_goal('status') = 'cancelled' AND pg_temp.gc_wallet() = 1000,
    'the re-cancel did not cancel the goal, or changed the legacy wallet');
  -- Refunds above the funding (interest) never make the expectation negative.
  v_result := piggyvest_primary.read_daily_reconciliation(
    'f3860000-0000-4000-8000-000000000006'::uuid, 'staging', '{"staleAfterSeconds":60}'::jsonb);
  PERFORM pg_temp.gc_assert(v_result -> 'wallets' =
    '[{"walletId":"synthetic-goalcancel-goal-wallet","expectedKobo":0}]'::jsonb,
    'refunds above funding made the expectation wrong: ' || (v_result -> 'wallets')::text);

  -- 6. The legacy auto-debit classification names only goals bound to a
  -- PiggyVest goal wallet, and tolerates NULL and unknown ids.
  PERFORM pg_temp.gc_assert(
    (SELECT pg_catalog.array_agg(bound) FROM public.savings_goal_ids_bound_to_primary(
       ARRAY[c_goal::uuid, c_invented::uuid]) AS bound) = ARRAY[c_goal::uuid]
    AND NOT EXISTS (SELECT 1 FROM public.savings_goal_ids_bound_to_primary(NULL))
    AND NOT EXISTS (SELECT 1 FROM public.savings_goal_ids_bound_to_primary(ARRAY[c_invented::uuid])),
    'the primary goal classification is wrong');
END
$behaviour$;

ROLLBACK;
