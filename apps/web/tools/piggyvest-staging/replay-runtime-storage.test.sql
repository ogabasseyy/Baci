\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
  IF current_database() <> 'pvb_runtime_synthetic' OR current_user <> 'supabase_admin'
    OR (SELECT system_identifier::text FROM pg_control_system()) = '7686901100561231906'
    OR EXISTS (SELECT FROM public.piggyvest_staging_receipts) THEN
    RAISE EXCEPTION 'Requires empty synthetic scratch database';
  END IF;
END
$guard$;
SET LOCAL ROLE pvb_staging_ingest;
SELECT public.accept_piggyvest_staging_receipt(
  repeat('a', 64), 'YWJj', 'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA==', 'staging-v1');
RESET ROLE;
DO $test$
DECLARE lease record; second_lease record; previous_token uuid; count_claimed integer; deferred timestamptz;
BEGIN
  SET LOCAL ROLE pvb_staging_worker;
  BEGIN
    PERFORM ciphertext FROM public.piggyvest_staging_receipts;
    RAISE EXCEPTION 'Worker can read sealed receipts directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.piggyvest_staging_receipts SET status = 'processed';
    RAISE EXCEPTION 'Worker can bypass lifecycle RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM detail FROM public.piggyvest_staging_replay_quarantine;
    RAISE EXCEPTION 'Worker can read quarantine directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM public.piggyvest_staging_system_id();
  SELECT * INTO STRICT lease FROM public.claim_piggyvest_staging_receipts(10, 300);
  IF lease.attempts <> 1 THEN RAISE EXCEPTION 'Fresh ingest did not claim'; END IF;
  IF public.resolve_piggyvest_staging_receipt(lease.receipt_id, gen_random_uuid(), 'processed', NULL) THEN
    RAISE EXCEPTION 'Stale token accepted';
  END IF;
  IF NOT public.resolve_piggyvest_staging_receipt(lease.receipt_id, lease.claim_token, 'quarantined', 'worker retryable') THEN
    RAISE EXCEPTION 'Retry transition failed';
  END IF;
  FOR iteration IN 1..12 LOOP
    SELECT count(*) INTO count_claimed FROM public.claim_piggyvest_staging_receipts(10, 300);
    IF count_claimed <> 0 THEN RAISE EXCEPTION 'Immediate retry consumed attempts'; END IF;
  END LOOP;
  RESET ROLE;
  SELECT next_attempt_at INTO deferred FROM public.piggyvest_staging_receipts WHERE id = lease.receipt_id;
  IF pg_has_role('pvb_staging_worker', 'pvb_staging_replay_executor', 'MEMBER')
    OR pg_has_role('authenticator', 'pvb_staging_replay_executor', 'MEMBER') THEN
    RAISE EXCEPTION 'Executor impersonation available';
  END IF;
  IF deferred < clock_timestamp() + interval '29 minutes'
    OR (SELECT attempts FROM public.piggyvest_staging_receipts WHERE id = lease.receipt_id) <> 1 THEN
    RAISE EXCEPTION 'Retry was not deferred for 30 minutes';
  END IF;
  UPDATE public.piggyvest_staging_receipts SET next_attempt_at = clock_timestamp() - interval '1 second';
  SET LOCAL ROLE pvb_staging_worker;
  SELECT * INTO STRICT second_lease FROM public.claim_piggyvest_staging_receipts(10, 300);
  IF second_lease.attempts <> 2 OR second_lease.claim_token = lease.claim_token THEN
    RAISE EXCEPTION 'Deferred retry did not rotate token';
  END IF;
  IF NOT public.quarantine_piggyvest_staging_receipt(second_lease.receipt_id, second_lease.claim_token,
    'synthetic', 'unmapped', NULL) THEN RAISE EXCEPTION 'Unmapped transition failed'; END IF;
  RESET ROLE;
  IF (SELECT next_attempt_at FROM public.piggyvest_staging_receipts WHERE id = lease.receipt_id)
    < clock_timestamp() + interval '59 minutes' THEN RAISE EXCEPTION 'Backoff did not increase'; END IF;
  UPDATE public.piggyvest_staging_receipts SET next_attempt_at = clock_timestamp() - interval '1 second';
  SET LOCAL ROLE pvb_staging_worker;
  SELECT * INTO STRICT lease FROM public.claim_piggyvest_staging_receipts(10, 300);
  IF NOT public.quarantine_piggyvest_staging_receipt(lease.receipt_id, lease.claim_token,
    'synthetic', 'invalid-utf8', NULL) THEN RAISE EXCEPTION 'Invalid UTF-8 quarantine failed'; END IF;
  SELECT count(*) INTO count_claimed FROM public.claim_piggyvest_staging_receipts(10, 300);
  IF count_claimed <> 0 THEN RAISE EXCEPTION 'Permanent quarantine reclaimed'; END IF;
  RESET ROLE;
  IF NOT EXISTS (SELECT FROM public.piggyvest_staging_replay_quarantine WHERE receipt_id = lease.receipt_id) THEN
    RAISE EXCEPTION 'Missing atomic quarantine record';
  END IF;
  UPDATE public.piggyvest_staging_receipts SET status = 'processing',
    claim_token = gen_random_uuid(), lease_expires_at = clock_timestamp() - interval '1 second', attempts = 9
  WHERE id = lease.receipt_id RETURNING claim_token INTO previous_token;
  SET LOCAL ROLE pvb_staging_worker;
  IF public.resolve_piggyvest_staging_receipt(lease.receipt_id, previous_token, 'processed', NULL) THEN
    RAISE EXCEPTION 'Expired lease resolved';
  END IF;
  SELECT * INTO STRICT lease FROM public.claim_piggyvest_staging_receipts(10, 300);
  IF lease.attempts <> 10 OR lease.claim_token = previous_token THEN RAISE EXCEPTION 'Lease reaping failed'; END IF;
  PERFORM public.resolve_piggyvest_staging_receipt(lease.receipt_id, lease.claim_token, 'quarantined', 'worker retryable');
  SELECT count(*) INTO count_claimed FROM public.claim_piggyvest_staging_receipts(10, 300);
  IF count_claimed <> 0 THEN RAISE EXCEPTION 'Attempt limit exceeded'; END IF;
  RESET ROLE;
  IF NOT EXISTS (SELECT FROM public.piggyvest_staging_receipts WHERE id = lease.receipt_id AND status = 'dead_letter') THEN
    RAISE EXCEPTION 'Exhausted receipt not dead lettered';
  END IF;
  UPDATE public.piggyvest_staging_receipts SET status = 'processing',
    claim_token = gen_random_uuid(), lease_expires_at = clock_timestamp() - interval '1 second';
  SET LOCAL ROLE pvb_staging_worker;
  PERFORM public.claim_piggyvest_staging_receipts(10, 300);
  RESET ROLE;
  IF EXISTS (SELECT FROM public.piggyvest_staging_receipts WHERE status <> 'dead_letter') THEN
    RAISE EXCEPTION 'Exhausted expired lease not reaped';
  END IF;
  SET LOCAL ROLE pvb_staging_ingest;
  PERFORM public.accept_piggyvest_staging_receipt(
    repeat('b', 64), 'YWJj', 'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA==', 'staging-v1');
  RESET ROLE;
  SET LOCAL ROLE pvb_staging_worker;
  SELECT * INTO STRICT lease FROM public.claim_piggyvest_staging_receipts(10, 300);
  IF NOT public.resolve_piggyvest_staging_receipt(lease.receipt_id, lease.claim_token, 'processed', NULL) THEN
    RAISE EXCEPTION 'Successful completion failed';
  END IF;
  RESET ROLE;
END
$test$;
ROLLBACK;
