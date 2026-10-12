\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
  IF current_database() <> 'pvb_operator_synthetic' OR current_user <> 'supabase_admin'
    OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) IN ('7686901100561231906', '7685292944002592802')
    OR EXISTS (SELECT FROM public.piggyvest_staging_receipts) THEN
    RAISE EXCEPTION 'Requires empty local synthetic scratch database';
  END IF;
END
$guard$;
SELECT set_config('pvb_test.operator_source', pg_read_file(:'operator_sql_path'), true) IS NOT NULL AS source_loaded;
DO $test$
DECLARE
  operation text := 'DO $operator$' || split_part(current_setting('pvb_test.operator_source'), '$operator$', 2) || '$operator$;';
  receipt_id constant uuid := '2472e4bb-e500-4ed0-a7b8-b8d02178a4d1';
  digest constant text := 'ff600d090aa2ac42893171eed1a2c2f7322516bab8288346ad67194b4b0fa7cd';
  original_receipt jsonb;
  original_quarantine jsonb;
  final_receipt jsonb;
  final_quarantine jsonb;
  claimed integer;
BEGIN
  BEGIN
    EXECUTE operation;
    RAISE EXCEPTION 'Expected database rejection';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Operator quarantine database refused' THEN RAISE; END IF;
  END;
  operation := replace(operation, 'current_database() <> ''postgres''',
    'current_database() <> ''pvb_operator_synthetic''');
  BEGIN
    EXECUTE operation;
    RAISE EXCEPTION 'Expected cluster rejection';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Operator quarantine target refused' THEN RAISE; END IF;
  END;
  operation := replace(operation, '7686901100561231906',
    (SELECT system_identifier::text FROM pg_catalog.pg_control_system()));
  INSERT INTO public.piggyvest_staging_receipts(id, payload_sha256, ciphertext, nonce, auth_tag, key_version, last_error, attempts)
  VALUES (gen_random_uuid(), digest, 'YWJj', 'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA==', 'staging-v1', 'worker retryable', 3);
  BEGIN
    EXECUTE operation;
    RAISE EXCEPTION 'Expected receipt ID rejection';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Operator quarantine receipt refused' THEN RAISE; END IF;
  END;
  UPDATE public.piggyvest_staging_receipts SET id = receipt_id, payload_sha256 = repeat('a',64);
  BEGIN
    EXECUTE operation;
    RAISE EXCEPTION 'Expected digest rejection';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Operator quarantine receipt refused' THEN RAISE; END IF;
  END;
  UPDATE public.piggyvest_staging_receipts SET payload_sha256 = digest, status = 'processing',
    claim_token = gen_random_uuid(), lease_expires_at = clock_timestamp() + interval '5 minutes';
  BEGIN
    EXECUTE operation;
    RAISE EXCEPTION 'Expected active lease rejection';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Operator quarantine lifecycle refused' THEN RAISE; END IF;
  END;
  UPDATE public.piggyvest_staging_receipts SET lease_expires_at = clock_timestamp() - interval '5 minutes';
  BEGIN
    EXECUTE operation;
    RAISE EXCEPTION 'Expected expired processing lease rejection';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Operator quarantine lifecycle refused' THEN RAISE; END IF;
  END;
  UPDATE public.piggyvest_staging_receipts SET status = 'quarantined', claim_token = NULL,
    lease_expires_at = NULL, next_attempt_at = clock_timestamp() - interval '1 minute';
  INSERT INTO public.piggyvest_staging_replay_quarantine(receipt_id, event_id, reason, detail, attempts)
  VALUES (receipt_id, 'synthetic-event', 'unmapped', '{"syntheticHistory":true}', 4);
  SELECT to_jsonb(receipt) INTO original_receipt FROM public.piggyvest_staging_receipts receipt;
  SELECT to_jsonb(quarantine) INTO original_quarantine FROM public.piggyvest_staging_replay_quarantine quarantine;
  EXECUTE operation;
  SELECT to_jsonb(receipt) INTO final_receipt FROM public.piggyvest_staging_receipts receipt;
  SELECT to_jsonb(quarantine) INTO final_quarantine FROM public.piggyvest_staging_replay_quarantine quarantine;
  IF final_receipt - ARRAY['last_error','next_attempt_at'] <> original_receipt - ARRAY['last_error','next_attempt_at']
    OR final_receipt->>'last_error' <> 'unsupported' OR final_receipt->>'next_attempt_at' IS NOT NULL
    OR final_quarantine - ARRAY['reason','detail'] <> original_quarantine - ARRAY['reason','detail']
    OR final_quarantine->>'reason' <> 'unsupported'
    OR final_quarantine->'detail'->'previousQuarantine' <> original_quarantine
    OR final_quarantine->'detail'->'operatorClassification'->>'classification' <> 'business-main-wallet' THEN
    RAISE EXCEPTION 'Classification or history preservation failed';
  END IF;
  EXECUTE operation;
  IF (SELECT to_jsonb(receipt) FROM public.piggyvest_staging_receipts receipt) <> final_receipt
    OR (SELECT to_jsonb(quarantine) FROM public.piggyvest_staging_replay_quarantine quarantine) <> final_quarantine THEN
    RAISE EXCEPTION 'Rerun changed history';
  END IF;
  SET LOCAL ROLE pvb_staging_worker;
  SELECT count(*) INTO claimed FROM public.claim_piggyvest_staging_receipts(10,300);
  RESET ROLE;
  IF claimed <> 0 THEN RAISE EXCEPTION 'Permanent quarantine was claimed'; END IF;
  DELETE FROM public.piggyvest_staging_replay_quarantine;
  UPDATE public.piggyvest_staging_receipts SET last_error = 'worker retryable', next_attempt_at = clock_timestamp();
  EXECUTE operation;
  SELECT to_jsonb(quarantine) INTO final_quarantine FROM public.piggyvest_staging_replay_quarantine quarantine;
  IF final_quarantine->>'reason' <> 'unsupported'
    OR final_quarantine->'detail'->'operatorClassification'->>'classification' <> 'business-main-wallet'
    OR final_quarantine->'detail'->'previousReceiptLifecycle'->>'lastError' <> 'worker retryable' THEN
    RAISE EXCEPTION 'New quarantine classification missing';
  END IF;
  EXECUTE operation;
  IF (SELECT to_jsonb(quarantine) FROM public.piggyvest_staging_replay_quarantine quarantine) <> final_quarantine THEN
    RAISE EXCEPTION 'New quarantine rerun changed history';
  END IF;
  INSERT INTO public.piggyvest_staging_receipts(payload_sha256, ciphertext, nonce, auth_tag, key_version, last_error)
  VALUES (repeat('b',64), 'YWJj', 'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA==', 'staging-v1', 'worker retryable');
  EXECUTE operation;
  SET LOCAL ROLE pvb_staging_worker;
  SELECT count(*) INTO claimed FROM public.claim_piggyvest_staging_receipts(10,300);
  RESET ROLE;
  IF claimed <> 1 OR NOT EXISTS (
    SELECT FROM public.piggyvest_staging_receipts WHERE payload_sha256 = repeat('b',64) AND status = 'processing'
  ) OR NOT EXISTS (
    SELECT FROM public.piggyvest_staging_receipts WHERE id = receipt_id AND status = 'quarantined' AND last_error = 'unsupported'
  ) THEN
    RAISE EXCEPTION 'Operator quarantine affected unrelated receipt eligibility';
  END IF;
END
$test$;
ROLLBACK;
