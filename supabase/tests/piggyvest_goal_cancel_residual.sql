-- REGRESSION TEST (behaviour): a late refund success never books the provider residual
-- (migration 20261103085004_piggyvest_goal_cancel_refund). Fixture and
-- helpers live in the included part; registered in the replay registry folder
-- 20261103085004_piggyvest_goal_cancel_refund.
\set ON_ERROR_STOP on
\ir piggyvest_goal_cancel_behaviour.fixture.inc.sql

DO $behaviour$
DECLARE
  c_goal constant text := 'f3860000-0000-4000-8000-000000000005';
  v_op text;
BEGIN
  -- 1. A late refund success never books the provider residual. Funding the
  -- provider completed but that is not settled locally stays out of
  -- current_amount until it settles, so it is booked exactly once.
  v_op := pg_temp.gc_dispatched('late1');
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.release_failed_goal_cancel('f3860000-0000-4000-8000-000000000006'::uuid, 'staging',
      pg_temp.gc_proof(v_op, 'failed')) = 'released', 'fixture release');
  INSERT INTO public.customer_wallet_transactions (
    id, wallet_id, customer_id, merchant_id, type, amount, balance_after, status, source_type, source_id)
  VALUES ('f3860000-0000-4000-8000-0000000000b1', 'f3860000-0000-4000-8000-000000000008',
    'f3860000-0000-4000-8000-000000000003', 'f3860000-0000-4000-8000-000000000002',
    'redemption', 1250, 0, 'pending', 'piggyvest_primary_savings',
    'f3860000-0000-4000-8000-0000000000b2');
  INSERT INTO piggyvest_primary.savings_operations (
    id, integration_id, intent_id, goal_id, amount_kobo, source_wallet_id,
    destination_wallet_id, reference, state, wallet_transaction_id)
  VALUES ('f3860000-0000-4000-8000-0000000000b2', 'f3860000-0000-4000-8000-000000000006',
    'f3860000-0000-4000-8000-000000000007', c_goal::uuid, 125000, 'synthetic-goalcancel-main',
    'synthetic-goalcancel-goal-wallet', 'pvb-save-f3860000-0000-4000-8000-0000000000b2', 'dispatched',
    'f3860000-0000-4000-8000-0000000000b1');
  PERFORM pg_temp.gc_assert(
    pg_temp.gc_settle(pg_temp.gc_proof(v_op) || '{"residualKobo":125000}'::jsonb) = 'conflict',
    'the late success with a residual was not routed to review');
  PERFORM pg_temp.gc_assert(pg_temp.gc_state(v_op) = 'needs_review'
    AND pg_temp.gc_goal('current_amount')::numeric = 0 AND pg_temp.gc_goal('status') = 'active',
    'a late success booked the provider residual into current_amount: ' || pg_temp.gc_goal('current_amount'));
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.settle_savings('f3860000-0000-4000-8000-000000000006'::uuid, 'staging',
      pg_catalog.jsonb_build_object('operationId', 'f3860000-0000-4000-8000-0000000000b2',
        'providerTransactionId', 'synthetic-gc-funding-txn', 'reference', 'pvb-save-f3860000-0000-4000-8000-0000000000b2',
        'amountKobo', 125000, 'sourceWalletId', 'synthetic-goalcancel-main',
        'destinationWalletId', 'synthetic-goalcancel-goal-wallet', 'businessId', 'synthetic-goalcancel-business'))
      = 'confirmed', 'the pending funding did not settle after the late refund');
  PERFORM pg_temp.gc_assert(pg_temp.gc_goal('current_amount')::numeric = 1250,
    'the funding was not booked exactly once: ' || pg_temp.gc_goal('current_amount'));

END
$behaviour$;

ROLLBACK;
