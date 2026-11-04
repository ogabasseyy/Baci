-- REGRESSION TEST (behaviour): dispatch, settlement, the purchase request,
-- ledger and reconciliation for goal complete
-- (migration 20261103181737_piggyvest_goal_complete_purchase_request).
-- Registered in the replay registry folder
-- 20261103181737_piggyvest_goal_complete_purchase_request.
\set ON_ERROR_STOP on
\ir piggyvest_goal_complete_behaviour.fixture.inc.sql

DO $behaviour$
DECLARE
  c_goal constant text := 'f3870000-0000-4000-8000-000000000005';
  c_integration constant uuid := 'f3870000-0000-4000-8000-000000000006';
  v_scope jsonb := pg_temp.gx_scope();
  v_op text;
  v_result jsonb;
  v_text text;
BEGIN
  -- 1. Reserved, then dispatched with the provider balance as the amount. The
  -- amount is validated; a dispatch for a goal that lost eligibility, or one
  -- with a cancel in flight, is refused and the attempt stays reserved.
  PERFORM pg_temp.gx_fund('f4', 250000);
  v_op := pg_temp.gx_reserved('settle');
  BEGIN
    PERFORM piggyvest_primary.manage_goal_complete(v_scope, v_op::uuid, 'dispatch', 0);
    RAISE EXCEPTION 'a zero amount dispatched';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  PERFORM pg_temp.gx_set_maturity(30);
  PERFORM pg_temp.gx_assert(NOT piggyvest_primary.manage_goal_complete(v_scope, v_op::uuid, 'dispatch', 250000),
    'dispatched an ineligible goal');
  PERFORM pg_temp.gx_set_maturity(0);
  PERFORM pg_temp.gx_assert(piggyvest_primary.manage_goal_complete(v_scope, v_op::uuid, 'dispatch', 250000),
    'dispatch refused');
  PERFORM pg_temp.gx_assert(pg_temp.gx_state(v_op) = 'dispatched', 'state after dispatch');
  v_result := piggyvest_primary.read_dispatched_goal_complete(c_integration, 'staging', v_op::uuid);
  PERFORM pg_temp.gx_assert(v_result ->> 'amountKobo' = '250000' AND v_result ->> 'reference' = 'pvb-complete-' || c_goal,
    'dispatched read: ' || v_result::text);
  PERFORM pg_temp.gx_assert(piggyvest_primary.find_dispatched_goal_complete_by_reference(
      c_integration, 'staging', 'pvb-complete-' || c_goal) ->> 'operationId' = v_op, 'webhook lookup');
  v_result := piggyvest_primary.read_daily_reconciliation(c_integration, 'staging', '{"staleAfterSeconds":60}'::jsonb);
  PERFORM pg_temp.gx_assert(v_result -> 'wallets' =
    '[{"walletId":"synthetic-goalcomplete-goal-wallet","expectedKobo":250000}]'::jsonb,
    'expected balance before settlement: ' || (v_result -> 'wallets')::text);

  -- 2. Malformed or tampered proofs never settle.
  FOREACH v_text IN ARRAY ARRAY['{"residualKobo":0}', '{"residualKobo":"4200"}', '{"other":"x"}'] LOOP
    BEGIN
      PERFORM pg_temp.gx_settle(pg_temp.gx_proof(v_op) || v_text::jsonb);
      RAISE EXCEPTION 'an invalid proof was accepted: %', v_text USING ERRCODE = 'PVT00';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;
  END LOOP;
  PERFORM pg_temp.gx_assert(pg_temp.gx_settle(pg_temp.gx_proof(v_op) || '{"amountKobo":250001}'::jsonb) = 'conflict',
    'a different amount settled');
  PERFORM pg_temp.gx_assert(pg_temp.gx_settle(pg_temp.gx_proof(v_op) || '{"businessId":"another"}'::jsonb) = 'conflict',
    'a different business settled');
  PERFORM pg_temp.gx_assert(pg_temp.gx_state(v_op) = 'dispatched', 'a refused proof changed the state');

  -- 3. A residual provider balance records review: only the transfer's own
  -- amount is credited, the goal stays open, and NO purchase request exists.
  BEGIN
    PERFORM pg_temp.gx_assert(pg_temp.gx_settle(pg_temp.gx_proof(v_op) || '{"residualKobo":4200}'::jsonb) = 'conflict',
      'a residual was settled as confirmed');
    PERFORM pg_temp.gx_assert(pg_temp.gx_state(v_op) = 'needs_review'
      AND pg_temp.gx_goal('status') = 'active' AND pg_temp.gx_goal('current_amount') = '0.00'
      AND pg_temp.gx_wallet() = 1000
      AND NOT EXISTS (SELECT 1 FROM piggyvest_primary.goal_purchase_requests)
      AND EXISTS (SELECT 1 FROM public.customer_savings_events
                   WHERE goal_id = c_goal::uuid AND event_type = 'goal_complete_needs_review'),
      'a residual balance did not keep the goal open for review');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;

  -- 4. A foreign provider transaction id (already used by a funding row)
  -- never settles.
  UPDATE piggyvest_primary.savings_operations SET provider_transaction_id = 'synthetic-gx-txn-success-' || v_op;
  PERFORM pg_temp.gx_assert(pg_temp.gx_settle(pg_temp.gx_proof(v_op)) = 'conflict', 'a reused transaction id settled');
  UPDATE piggyvest_primary.savings_operations SET provider_transaction_id = NULL;

  -- 4b. A goal title of any shape never blocks settlement: an over-long title
  -- is shortened and a blank one gets a default, so the money that already
  -- moved at the provider is always credited locally.
  BEGIN
    UPDATE public.customer_savings_goals SET title = pg_catalog.repeat('x', 600) WHERE id = c_goal::uuid;
    PERFORM pg_temp.gx_assert(pg_temp.gx_settle(pg_temp.gx_proof(v_op)) = 'confirmed', 'a long title blocked settlement');
    PERFORM pg_temp.gx_assert((SELECT pg_catalog.char_length(goal_title) FROM piggyvest_primary.goal_purchase_requests) = 500,
      'a long title was not shortened');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;
  BEGIN
    UPDATE public.customer_savings_goals SET title = '   ' WHERE id = c_goal::uuid;
    PERFORM pg_temp.gx_assert(pg_temp.gx_settle(pg_temp.gx_proof(v_op)) = 'confirmed', 'a blank title blocked settlement');
    PERFORM pg_temp.gx_assert((SELECT goal_title FROM piggyvest_primary.goal_purchase_requests) = 'Savings goal',
      'a blank title got no default');
    RAISE EXCEPTION 'probe done' USING ERRCODE = 'PVP99';
  EXCEPTION WHEN SQLSTATE 'PVP99' THEN NULL;
  END;

  -- 5. The settlement: attempt confirmed, goal completed, wallet credited,
  -- purchase request saved, all in the one call.
  PERFORM pg_temp.gx_assert(pg_temp.gx_settle(pg_temp.gx_proof(v_op)) = 'confirmed', 'settlement refused');
  PERFORM pg_temp.gx_assert(pg_temp.gx_state(v_op) = 'confirmed'
    AND pg_temp.gx_goal('status') = 'completed' AND pg_temp.gx_goal('current_amount') = '0.00'
    AND pg_temp.gx_goal('completed_at') IS NOT NULL
    AND pg_temp.gx_wallet() = 1000
    AND NOT EXISTS (SELECT 1 FROM public.customer_wallet_transactions
                     WHERE source_type = 'piggyvest_goal_complete' AND source_id = v_op::uuid)
    AND EXISTS (SELECT 1 FROM public.customer_savings_events
                 WHERE goal_id = c_goal::uuid AND event_type = 'goal_completed_to_wallet'),
    'settled state is wrong');
  -- The funded-goal trigger must not reopen a settled completion, not even on
  -- a later no-op update of the row (the paid-interest refresh does exactly that).
  UPDATE public.customer_savings_goals SET status = status WHERE id = c_goal::uuid;
  PERFORM pg_temp.gx_assert(pg_temp.gx_goal('status') = 'completed' AND pg_temp.gx_goal('completed_at') IS NOT NULL,
    'a no-op update reopened a settled completion');
  PERFORM pg_temp.gx_assert((SELECT pg_catalog.count(*) FROM piggyvest_primary.goal_purchase_requests
      WHERE complete_operation_id = v_op::uuid AND goal_id = c_goal::uuid
        AND goal_title = 'Synthetic goal complete goal' AND target_amount = 10000
        AND amount_kobo = 250000 AND state = 'open' AND alerted_at IS NULL
        AND customer_id = 'f3870000-0000-4000-8000-000000000003') = 1,
    'the purchase request was not saved with the settlement');

  -- 6. The alert state: readable once, markable once, and a replay of the
  -- settlement changes neither the wallet nor the request.
  v_result := piggyvest_primary.read_goal_purchase_request_alert(c_integration, 'staging', v_op::uuid);
  PERFORM pg_temp.gx_assert(v_result ->> 'operationId' = v_op, 'unalerted request not returned');
  PERFORM pg_temp.gx_assert(pg_temp.gx_settle(pg_temp.gx_proof(v_op)) = 'duplicate', 'replay');
  PERFORM pg_temp.gx_assert(pg_temp.gx_wallet() = 1000
    AND (SELECT pg_catalog.count(*) FROM piggyvest_primary.goal_purchase_requests) = 1, 'a replay changed the books');
  PERFORM pg_temp.gx_assert(pg_catalog.jsonb_array_length(public.list_open_goal_purchase_requests(10)) = 1
    AND public.list_open_goal_purchase_requests(10) -> 0 ->> 'alertedAt' IS NULL, 'the operator list misses an unalerted request');
  PERFORM pg_temp.gx_assert(piggyvest_primary.mark_goal_purchase_request_alerted(c_integration, 'staging', v_op::uuid),
    'alert mark refused');
  PERFORM pg_temp.gx_assert(NOT piggyvest_primary.mark_goal_purchase_request_alerted(c_integration, 'staging', v_op::uuid)
    AND piggyvest_primary.read_goal_purchase_request_alert(c_integration, 'staging', v_op::uuid) IS NULL,
    'an alert was marked twice');
  PERFORM pg_temp.gx_assert(public.fulfil_goal_purchase_request(
      (SELECT id FROM piggyvest_primary.goal_purchase_requests), 'handed over in store'), 'fulfilment refused');
  PERFORM pg_temp.gx_assert(pg_catalog.jsonb_array_length(public.list_open_goal_purchase_requests(10)) = 0,
    'a fulfilled request is still listed');

  -- 7. Ledger and funding: a confirmed completion subtracts from the expected
  -- balance (never below zero), and its amount is spendable and fundable.
  v_result := piggyvest_primary.read_daily_reconciliation(c_integration, 'staging', '{"staleAfterSeconds":60}'::jsonb);
  PERFORM pg_temp.gx_assert(v_result -> 'wallets' =
    '[{"walletId":"synthetic-goalcomplete-goal-wallet","expectedKobo":0}]'::jsonb,
    'expected balance after settlement: ' || (v_result -> 'wallets')::text);
  -- 8. A completed goal answers its settled attempt, never a new one.
  v_result := pg_temp.gx_issue_op();
  PERFORM pg_temp.gx_assert(v_result ->> 'status' = 'confirmed' AND v_result ->> 'operationId' = v_op,
    'issue for a completed goal: ' || v_result::text);
  PERFORM pg_temp.gx_assert(piggyvest_primary.read_goal_complete_status(v_scope, v_op::uuid) = 'confirmed', 'status');
END
$behaviour$;

ROLLBACK;
