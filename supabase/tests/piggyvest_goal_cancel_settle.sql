-- REGRESSION TEST (behaviour): settlement of the final attempt, ledger, reconciliation and replay
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
  -- 14. The final attempt settles: attempt confirmed, goal cancelled, event written.
  v_issue := pg_temp.gc_issue_op();
  v_op := v_issue ->> 'operationId';
  -- The goal wallet holds 250000 kobo of confirmed funding at the provider.
  INSERT INTO piggyvest_primary.savings_operations (
    id, integration_id, intent_id, goal_id, amount_kobo, source_wallet_id,
    destination_wallet_id, reference, state, wallet_transaction_id)
  VALUES ('f3860000-0000-4000-8000-0000000000f4', 'f3860000-0000-4000-8000-000000000006',
    'f3860000-0000-4000-8000-000000000007', c_goal::uuid, 250000, 'synthetic-goalcancel-main',
    'synthetic-goalcancel-goal-wallet', 'pvb-save-f3860000-0000-4000-8000-0000000000f4', 'confirmed',
    'f3860000-0000-4000-8000-000000000009');
  v_result := piggyvest_primary.read_daily_reconciliation(
    'f3860000-0000-4000-8000-000000000006'::uuid, 'staging', '{"staleAfterSeconds":60}'::jsonb);
  PERFORM pg_temp.gc_assert(v_result -> 'wallets' =
    '[{"walletId":"synthetic-goalcancel-goal-wallet","expectedKobo":250000}]'::jsonb,
    'funded goal expected balance wrong before the cancel: ' || (v_result -> 'wallets')::text);
  PERFORM pg_temp.gc_issue('final', 'goal_cancel', 1, pg_temp.gc_key(v_op));
  v_result := pg_temp.gc_reserve(v_op, pg_temp.gc_token('final'));
  PERFORM pg_temp.gc_assert(v_result ->> 'status' = 'claimed', 'final reserve');
  -- The first attempt for a goal uses the bare reference.
  PERFORM pg_temp.gc_assert(v_result #>> '{reservation,reference}' = 'pvb-cancel-' || c_goal,
    'the first reference carried a suffix: ' || v_result::text);
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.dispatch_goal_cancel_split(v_scope, v_op::uuid, 250000) ->> 'status' = 'dispatched',
    'final dispatch');
  -- A residual provider balance after the transfer (a credit landed between
  -- the snapshot and the transfer) is never settled as cancelled-at-zero: the
  -- refund is credited, the goal stays open with the residual recorded, a
  -- review marker is written and the answer is 'conflict'. Rolled back.
  -- Only a positive integer residual (and no other extra key) is a valid proof.
  FOREACH v_text IN ARRAY ARRAY['{"residualKobo":0}', '{"residualKobo":"4200"}', '{"other":"x"}'] LOOP
    BEGIN
      PERFORM piggyvest_primary.settle_goal_cancel('f3860000-0000-4000-8000-000000000006'::uuid, 'staging',
        pg_temp.gc_proof(v_op) || v_text::jsonb);
      RAISE EXCEPTION 'an invalid residual proof was accepted: %', v_text USING ERRCODE = 'PVT00';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;
  END LOOP;
  BEGIN
    PERFORM pg_temp.gc_assert(
      piggyvest_primary.settle_goal_cancel('f3860000-0000-4000-8000-000000000006'::uuid, 'staging',
        pg_temp.gc_proof(v_op) || '{"residualKobo":4200}'::jsonb) = 'conflict',
      'a residual provider balance was settled as cancelled-at-zero or confirmed');
    PERFORM pg_temp.gc_assert(pg_temp.gc_state(v_op) = 'needs_review'
      AND (SELECT status FROM public.customer_savings_goals WHERE id = c_goal::uuid) = 'active'
      AND (SELECT current_amount FROM public.customer_savings_goals WHERE id = c_goal::uuid) = 0
      AND (SELECT available_balance FROM public.customer_wallets
            WHERE id = 'f3860000-0000-4000-8000-000000000008') = 1000
      AND EXISTS (SELECT 1 FROM public.customer_savings_events
                   WHERE goal_id = c_goal::uuid AND event_type = 'goal_cancel_needs_review'),
      'a residual balance did not keep the goal open for review');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.settle_goal_cancel('f3860000-0000-4000-8000-000000000006'::uuid, 'staging',
      pg_temp.gc_proof(v_op)) = 'confirmed', 'settlement refused');
  PERFORM pg_temp.gc_assert(pg_temp.gc_state(v_op) = 'confirmed'
    AND (SELECT status FROM public.customer_savings_goals WHERE id = c_goal::uuid) = 'cancelled'
    AND (SELECT current_amount FROM public.customer_savings_goals WHERE id = c_goal::uuid) = 0
    AND (SELECT cancelled_at IS NOT NULL FROM public.customer_savings_goals WHERE id = c_goal::uuid)
    AND EXISTS (SELECT 1 FROM public.customer_savings_events WHERE goal_id = c_goal::uuid AND event_type = 'goal_cancelled_refunded'),
    'settlement did not confirm the attempt and cancel the goal together');
  PERFORM pg_temp.gc_assert(
    (SELECT available_balance FROM public.customer_wallets
      WHERE id = 'f3860000-0000-4000-8000-000000000008') = 1000
    AND NOT EXISTS (SELECT 1 FROM public.customer_wallet_transactions
          WHERE source_type = 'piggyvest_goal_cancel' AND source_id = v_op::uuid),
    'settlement credited the legacy wallet: the refund returns to the PiggyVest main wallet');
  -- A confirmed refund lowers the expected provider balance: a fully
  -- cancelled goal expects 0, so a legitimate cancel never reads as a shortfall.
  v_result := piggyvest_primary.read_daily_reconciliation(
    'f3860000-0000-4000-8000-000000000006'::uuid, 'staging', '{"staleAfterSeconds":60}'::jsonb);
  PERFORM pg_temp.gc_assert(v_result -> 'wallets' =
    '[{"walletId":"synthetic-goalcancel-goal-wallet","expectedKobo":0}]'::jsonb,
    'a cancelled goal still expects its principal: ' || (v_result -> 'wallets')::text);
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.settle_goal_cancel('f3860000-0000-4000-8000-000000000006'::uuid, 'staging',
      pg_temp.gc_proof(v_op)) = 'duplicate', 'a replayed settlement was not idempotent');
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.settle_goal_cancel('f3860000-0000-4000-8000-000000000006'::uuid, 'staging',
      pg_temp.gc_proof(v_op) || '{"providerTransactionId":"another-transaction"}'::jsonb) = 'conflict',
    'a different provider transaction settled a confirmed attempt');
  PERFORM pg_temp.gc_assert(
    (SELECT pg_catalog.count(*) FROM public.customer_savings_events WHERE goal_id = c_goal::uuid AND event_type = 'goal_cancelled_refunded') = 1,
    'a replay wrote a second event');
  PERFORM pg_temp.gc_assert(
    (SELECT available_balance FROM public.customer_wallets
      WHERE id = 'f3860000-0000-4000-8000-000000000008') = 1000
    AND NOT EXISTS (SELECT 1 FROM public.customer_wallet_transactions
          WHERE source_type = 'piggyvest_goal_cancel' AND source_id = v_op::uuid),
    'a replayed settlement credited the legacy wallet');

  -- 15. After a confirmed cancel: the same id reads confirmed, a new cancel
  -- is refused, and funding stays fenced off.
  PERFORM pg_temp.gc_assert(pg_temp.gc_reserve(v_op, NULL) ->> 'status' = 'confirmed', 'confirmed replay');
  BEGIN
    PERFORM pg_temp.gc_issue_op();
    RAISE EXCEPTION 'a cancelled goal issued a new cancel';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    INSERT INTO piggyvest_primary.savings_operations (
      id, integration_id, intent_id, goal_id, amount_kobo, source_wallet_id,
      destination_wallet_id, reference, state, wallet_transaction_id)
    VALUES ('f3860000-0000-4000-8000-0000000000f2', 'f3860000-0000-4000-8000-000000000006',
      'f3860000-0000-4000-8000-000000000007', c_goal::uuid, 100, 'synthetic-goalcancel-main',
      'synthetic-goalcancel-goal-wallet', 'pvb-save-f3860000-0000-4000-8000-0000000000f2', 'reserved',
      'f3860000-0000-4000-8000-000000000009');
    RAISE EXCEPTION 'funding was reserved after a cancel' USING ERRCODE = 'PVT00';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    PERFORM pg_temp.gc_assert(SQLERRM = 'savings goal is being cancelled',
      'funding fence raised another error after a cancel: ' || SQLERRM);
  END;
END
$behaviour$;

ROLLBACK;
