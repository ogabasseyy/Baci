-- Included by piggyvest_preonboarding_savings_recovery.sql inside its transaction.
-- Mixed in-flight set: the caller's own integration has an attributable
-- transfer, but an older in-flight one on the same goal belongs to the first
-- integration. The scoped read must refuse rather than hand back only the
-- attributable one; once the older one settles, the attributable one returns.
DO $mixed$
DECLARE scope jsonb:=current_setting('test.recovery_scope')::jsonb
  || '{"integrationId":"f3810000-0000-4000-8000-000000000018","environment":"production"}';
BEGIN
  INSERT INTO piggyvest_primary.onboarding_intents (
    id, integration_id, merchant_id, customer_id, user_id, request_fingerprint, state,
    provider_customer_id, provider_wallet_id
  ) VALUES ('f3810000-0000-4000-8000-00000000001d', 'f3810000-0000-4000-8000-000000000018',
    'f3810000-0000-4000-8000-000000000002', 'f3810000-0000-4000-8000-000000000003',
    'f3810000-0000-4000-8000-000000000001', repeat('b', 64), 'unknown', NULL, NULL);
  INSERT INTO piggyvest_primary.savings_operations (
    id, integration_id, intent_id, goal_id, amount_kobo, source_wallet_id,
    destination_wallet_id, reference, state, wallet_transaction_id, created_at
  ) VALUES ('f3810000-0000-4000-8000-00000000001e', 'f3810000-0000-4000-8000-000000000018',
    'f3810000-0000-4000-8000-00000000001d', 'f3810000-0000-4000-8000-000000000005',
    1400, 'synthetic-source-wallet', 'synthetic-destination-wallet',
    'synthetic-recovery-mixed-own', 'dispatched', 'f3810000-0000-4000-8000-000000000009', now());
  UPDATE piggyvest_primary.savings_operations
    SET state = 'dispatched', created_at = now() - interval '1 day'
    WHERE id = 'f3810000-0000-4000-8000-000000000019';
  BEGIN
    PERFORM piggyvest_primary.read_pending_savings(scope,'f3810000-0000-4000-8000-000000000005');
    RAISE EXCEPTION 'An older unattributed in-flight transfer was hidden by an attributable one';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE piggyvest_primary.savings_operations SET state = 'confirmed'
    WHERE id = 'f3810000-0000-4000-8000-000000000019';
  IF piggyvest_primary.read_pending_savings(scope,'f3810000-0000-4000-8000-000000000005')->>'operationId'
    IS DISTINCT FROM 'f3810000-0000-4000-8000-00000000001e' THEN
    RAISE EXCEPTION 'Attributable transfer was not recovered once the other settled';
  END IF;
END;
$mixed$;
