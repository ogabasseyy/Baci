\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
DO $operator$
DECLARE
  receipt record;
  previous public.piggyvest_staging_replay_quarantine%ROWTYPE;
  classification constant jsonb := '{"classification":"business-main-wallet","provenance":"piggyvest-business-wallet-receipt-2026-09-19.md","transactionId":"e0687d34-8092-4677-8fe7-6bb5e14746b9","walletShortId":"01M238","amountKobo":10000}'::jsonb;
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Operator quarantine database refused';
  END IF;
  IF current_user <> 'supabase_admin'
    OR NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = current_user AND rolsuper)
    OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) <> '7686901100561231906' THEN
    RAISE EXCEPTION 'Operator quarantine target refused';
  END IF;
  PERFORM set_config('synchronous_commit', 'on', true);
  SELECT id, payload_sha256, status, claim_token, lease_expires_at, processed_at, last_error, next_attempt_at
  INTO receipt FROM public.piggyvest_staging_receipts
  WHERE id = '2472e4bb-e500-4ed0-a7b8-b8d02178a4d1'::uuid FOR UPDATE;
  IF NOT FOUND OR receipt.payload_sha256 IS DISTINCT FROM
    'ff600d090aa2ac42893171eed1a2c2f7322516bab8288346ad67194b4b0fa7cd' THEN
    RAISE EXCEPTION 'Operator quarantine receipt refused';
  END IF;
  IF receipt.status <> 'quarantined' OR receipt.claim_token IS NOT NULL
    OR receipt.lease_expires_at IS NOT NULL OR receipt.processed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Operator quarantine lifecycle refused';
  END IF;
  SELECT id, receipt_id, event_id, reason, detail, attempts, quarantined_at, resolved_at, resolution
  INTO previous FROM public.piggyvest_staging_replay_quarantine
  WHERE receipt_id = receipt.id FOR UPDATE;
  IF receipt.last_error = 'unsupported' AND receipt.next_attempt_at IS NULL
    AND previous.reason = 'unsupported' AND previous.detail->'operatorClassification' = classification THEN
    RETURN;
  END IF;
  IF receipt.last_error IS DISTINCT FROM 'worker retryable'
    OR (previous.receipt_id IS NOT NULL AND previous.reason <> 'unmapped') THEN
    RAISE EXCEPTION 'Operator quarantine prior state refused';
  END IF;
  IF previous.receipt_id IS NULL THEN
    INSERT INTO public.piggyvest_staging_replay_quarantine(receipt_id, reason, detail)
    VALUES (receipt.id, 'unsupported', jsonb_build_object(
      'operatorClassification', classification,
      'previousReceiptLifecycle', jsonb_build_object('lastError', receipt.last_error, 'nextAttemptAt', receipt.next_attempt_at)));
  ELSE
    UPDATE public.piggyvest_staging_replay_quarantine
    SET reason = 'unsupported', detail = jsonb_build_object(
      'operatorClassification', classification,
      'previousQuarantine', to_jsonb(previous),
      'previousReceiptLifecycle', jsonb_build_object('lastError', receipt.last_error, 'nextAttemptAt', receipt.next_attempt_at))
    WHERE receipt_id = receipt.id;
  END IF;
  UPDATE public.piggyvest_staging_receipts
  SET last_error = 'unsupported', next_attempt_at = NULL
  WHERE id = receipt.id;
END
$operator$;
COMMIT;
