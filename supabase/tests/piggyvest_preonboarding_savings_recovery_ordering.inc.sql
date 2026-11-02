-- Included by piggyvest_preonboarding_savings_recovery.sql inside its transaction.
-- Several transfers in flight on one goal: the OLDEST is returned, by
-- created_at first (the older row has the larger id here: 1c vs 1a) and by id when
-- created_at is equal (the later-inserted row has the larger id).
DO $oldest$
DECLARE scope jsonb:=current_setting('test.recovery_scope')::jsonb; stamp timestamptz:=now() - interval '30 minutes';
BEGIN
  INSERT INTO piggyvest_primary.savings_operations (
    id, integration_id, intent_id, goal_id, amount_kobo, source_wallet_id,
    destination_wallet_id, reference, state, wallet_transaction_id, created_at
  ) VALUES
    ('f3810000-0000-4000-8000-00000000001a', 'f3810000-0000-4000-8000-000000000006',
     'f3810000-0000-4000-8000-000000000007', 'f3810000-0000-4000-8000-000000000005',
     1100, 'synthetic-source-wallet', 'synthetic-destination-wallet',
     'synthetic-recovery-newer', 'reserved', 'f3810000-0000-4000-8000-000000000009', stamp),
    ('f3810000-0000-4000-8000-00000000001c', 'f3810000-0000-4000-8000-000000000006',
     'f3810000-0000-4000-8000-000000000007', 'f3810000-0000-4000-8000-000000000005',
     1300, 'synthetic-source-wallet', 'synthetic-destination-wallet',
     'synthetic-recovery-older', 'dispatched', 'f3810000-0000-4000-8000-000000000009',
     stamp - interval '1 hour');
  IF piggyvest_primary.read_pending_savings(scope,'f3810000-0000-4000-8000-000000000005')->>'operationId'
    IS DISTINCT FROM 'f3810000-0000-4000-8000-00000000001c' THEN
    RAISE EXCEPTION 'The newest pending transfer was returned instead of the oldest';
  END IF;
  UPDATE piggyvest_primary.savings_operations SET state = 'cancelled'
    WHERE id = 'f3810000-0000-4000-8000-00000000001c';
  INSERT INTO piggyvest_primary.savings_operations (
    id, integration_id, intent_id, goal_id, amount_kobo, source_wallet_id,
    destination_wallet_id, reference, state, wallet_transaction_id, created_at
  ) VALUES ('f3810000-0000-4000-8000-00000000001b', 'f3810000-0000-4000-8000-000000000006',
    'f3810000-0000-4000-8000-000000000007', 'f3810000-0000-4000-8000-000000000005',
    1200, 'synthetic-source-wallet', 'synthetic-destination-wallet',
    'synthetic-recovery-tie', 'dispatched', 'f3810000-0000-4000-8000-000000000009', stamp);
  -- 1a and 1b share created_at; the id tiebreak picks 1a even though 1b was
  -- inserted later.
  IF piggyvest_primary.read_pending_savings(scope,'f3810000-0000-4000-8000-000000000005')->>'operationId'
    IS DISTINCT FROM 'f3810000-0000-4000-8000-00000000001a' THEN
    RAISE EXCEPTION 'Equal created_at did not fall back to the lowest id';
  END IF;
  UPDATE piggyvest_primary.savings_operations SET state = 'cancelled'
    WHERE id IN ('f3810000-0000-4000-8000-00000000001a','f3810000-0000-4000-8000-00000000001b');
END;
$oldest$;
