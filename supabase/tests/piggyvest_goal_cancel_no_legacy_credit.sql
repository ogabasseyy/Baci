-- REGRESSION TEST (behaviour): settling a goal cancel for a primary-rail goal
-- never credits the legacy in-house balance (public.customer_wallets) and never
-- writes a spendable customer_wallet_transactions row, because the money returns
-- to the PiggyVest main wallet at PiggyVest. Funding no longer debits the legacy
-- balance, so a credit here would be an unbacked double spend
-- (migrations 20261104130500 to 20261104130800, piggyvest_goal_funding_*). The goal is
-- funded by a hold-free operation (wallet_transaction_id NULL), as the new
-- reservation records it. Registered in the replay registry folder
-- 20261104130800_piggyvest_goal_funding_reserve.
\set ON_ERROR_STOP on
\ir piggyvest_goal_cancel_behaviour.fixture.inc.sql

DO $behaviour$
DECLARE
  v_op text;
  v_before numeric := pg_temp.gc_wallet();
  v_role text;
BEGIN
  INSERT INTO piggyvest_primary.savings_operations (
    id, integration_id, intent_id, goal_id, amount_kobo, source_wallet_id,
    destination_wallet_id, reference, state, wallet_transaction_id)
  VALUES ('f3860000-0000-4000-8000-0000000000f4', 'f3860000-0000-4000-8000-000000000006',
    'f3860000-0000-4000-8000-000000000007', 'f3860000-0000-4000-8000-000000000005', 250000,
    'synthetic-goalcancel-main', 'synthetic-goalcancel-goal-wallet',
    'pvb-save-f3860000-0000-4000-8000-0000000000f4', 'confirmed', NULL);
  v_op := pg_temp.gc_dispatched('nocredit');
  PERFORM pg_temp.gc_assert(pg_temp.gc_settle(pg_temp.gc_proof(v_op)) = 'confirmed',
    'the primary-rail cancel was not settled');
  PERFORM pg_temp.gc_assert(pg_temp.gc_state(v_op) = 'confirmed'
    AND pg_temp.gc_goal('status') = 'cancelled' AND pg_temp.gc_goal('current_amount')::numeric = 0,
    'settlement did not confirm the attempt and cancelled the goal');
  PERFORM pg_temp.gc_assert(pg_temp.gc_wallet() = v_before
    AND NOT EXISTS (SELECT 1 FROM public.customer_wallet_transactions
                     WHERE source_type IN ('piggyvest_goal_cancel', 'piggyvest_goal_complete')
                       AND source_id = v_op::uuid),
    'fund then cancel minted legacy wallet balance out of PiggyVest money');
  -- A replayed settlement is idempotent and still credits nothing.
  PERFORM pg_temp.gc_assert(pg_temp.gc_settle(pg_temp.gc_proof(v_op)) = 'duplicate',
    'a replayed settlement was not idempotent');
  PERFORM pg_temp.gc_assert(pg_temp.gc_wallet() = v_before
    AND (SELECT pg_catalog.count(*) FROM public.customer_savings_events
          WHERE goal_id = 'f3860000-0000-4000-8000-000000000005' AND event_type = 'goal_cancelled_refunded') = 1,
    'a replay changed the wallet or wrote a second event');
  -- Grants are asserted via the catalog: denied EXECUTE is never call-and-catch.
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF pg_catalog.has_function_privilege(v_role,
         'piggyvest_primary.settle_goal_cancel(uuid,text,jsonb)'::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'settle_goal_cancel must not be executable by %', v_role;
    END IF;
  END LOOP;
END
$behaviour$;

ROLLBACK;
