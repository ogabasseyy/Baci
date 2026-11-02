-- Included by piggyvest_preonboarding_savings_recovery.sql inside its transaction.
-- At most one transfer can be in flight per (intent, goal): the partial unique
-- index primary_savings_single_pending_goal_idx, plus one intent per
-- (integration, customer), mean the scoped read can never see two pending
-- transfers, so "oldest first" can never pick between them. Pin that
-- invariant: a second reserved/dispatched transfer for the same intent and
-- goal is refused, and the first is still the one recovered.
DO $oldest$
DECLARE scope jsonb:=current_setting('test.recovery_scope')::jsonb;
BEGIN
  INSERT INTO piggyvest_primary.savings_operations (
    id, integration_id, intent_id, goal_id, amount_kobo, source_wallet_id,
    destination_wallet_id, reference, state, wallet_transaction_id, created_at
  ) VALUES ('f3810000-0000-4000-8000-00000000001a', 'f3810000-0000-4000-8000-000000000006',
    'f3810000-0000-4000-8000-000000000007', 'f3810000-0000-4000-8000-000000000005',
    1100, 'synthetic-source-wallet', 'synthetic-destination-wallet',
    'synthetic-recovery-first', 'reserved', 'f3810000-0000-4000-8000-000000000009', now());
  BEGIN
    INSERT INTO piggyvest_primary.savings_operations (
      id, integration_id, intent_id, goal_id, amount_kobo, source_wallet_id,
      destination_wallet_id, reference, state, wallet_transaction_id, created_at
    ) VALUES ('f3810000-0000-4000-8000-00000000001b', 'f3810000-0000-4000-8000-000000000006',
      'f3810000-0000-4000-8000-000000000007', 'f3810000-0000-4000-8000-000000000005',
      1200, 'synthetic-source-wallet', 'synthetic-destination-wallet',
      'synthetic-recovery-second', 'dispatched', 'f3810000-0000-4000-8000-000000000009',
      now() - interval '1 hour');
    RAISE EXCEPTION 'A second in-flight transfer for the same intent and goal was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  IF piggyvest_primary.read_pending_savings(scope,'f3810000-0000-4000-8000-000000000005')->>'operationId'
    IS DISTINCT FROM 'f3810000-0000-4000-8000-00000000001a' THEN
    RAISE EXCEPTION 'The only pending transfer was not recovered';
  END IF;
  UPDATE piggyvest_primary.savings_operations SET state = 'cancelled'
    WHERE id = 'f3810000-0000-4000-8000-00000000001a';
END;
$oldest$;
