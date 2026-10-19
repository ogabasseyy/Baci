\set ON_ERROR_STOP on
-- =============================================
-- REGRESSION TEST: staging replay lifecycle
--
-- USAGE (isolated staging database only, superuser):
--   psql $ISOLATED_DB_URL -v ON_ERROR_STOP=1 \
--     -f apps/web/tools/piggyvest-staging/replay-storage.test.sql
--
-- Mutates inside a transaction and rolls back. Never run against the
-- application database: the receipt tables do not exist there.
-- =============================================

BEGIN;
SET LOCAL ROLE pvb_staging_worker;

DO $test$
DECLARE
  claimed record;
  claimed_receipt_id uuid;
  claimed_token uuid;
  claim_count integer;
  stale_token uuid := gen_random_uuid();
  system_id text;
BEGIN
  -- Seed three receipts through the ingest path as the ingest role.
  SET LOCAL ROLE pvb_staging_ingest;
  PERFORM public.accept_piggyvest_staging_receipt(
    repeat('a', 64), 'YWJj', 'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA==', 'staging-v1');
  PERFORM public.accept_piggyvest_staging_receipt(
    repeat('b', 64), 'ZGVm', 'BBBBBBBBBBBBBBBB', 'BBBBBBBBBBBBBBBBBBBBBA==', 'staging-v1');
  PERFORM public.accept_piggyvest_staging_receipt(
    repeat('c', 64), 'aGk=', 'CCCCCCCCCCCCCCCC', 'CCCCCCCCCCCCCCCCCCCCCA==', 'staging-v1');
  RESET ROLE;
  SET LOCAL ROLE pvb_staging_worker;

  -- Claim returns sealed material with rotating tokens, oldest first.
  SELECT count(*) INTO claim_count
  FROM public.claim_piggyvest_staging_receipts(2, 300);
  IF claim_count <> 2 THEN
    RAISE EXCEPTION 'Claim did not return two leases, got %', claim_count;
  END IF;
  SELECT * INTO claimed
  FROM public.claim_piggyvest_staging_receipts(2, 300) LIMIT 1;
  IF claimed.payload_sha256 <> repeat('c', 64)
    OR claimed.claim_token IS NULL
    OR claimed.attempts <> 1 THEN
    RAISE EXCEPTION 'Claim did not return the oldest receipt with a fresh token';
  END IF;

  -- Invalid claim windows are rejected.
  BEGIN
    PERFORM public.claim_piggyvest_staging_receipts(0, 300);
    RAISE EXCEPTION 'Zero claim limit accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.claim_piggyvest_staging_receipts(2, 5);
    RAISE EXCEPTION 'Short lease accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- Stale token resolves nothing.
  IF public.resolve_piggyvest_staging_receipt(
    claimed.receipt_id, stale_token, 'processed', NULL) THEN
    RAISE EXCEPTION 'Stale claim token resolved a receipt';
  END IF;

  -- Stale token quarantines nothing and leaves no quarantine row.
  IF public.quarantine_piggyvest_staging_receipt(
    claimed.receipt_id, stale_token, 'evt-001', 'poison', NULL) THEN
    RAISE EXCEPTION 'Stale claim token quarantined a receipt';
  END IF;
  PERFORM 1 FROM public.piggyvest_staging_replay_quarantine;
  IF FOUND THEN
    RAISE EXCEPTION 'Stale quarantine left a row';
  END IF;

  -- Valid quarantine is atomic: row present and receipt fenced out.
  IF NOT public.quarantine_piggyvest_staging_receipt(
    claimed.receipt_id, claimed.claim_token, 'evt-001', 'poison',
    '{"observed": "synthetic"}'::jsonb) THEN
    RAISE EXCEPTION 'Valid quarantine reported stale';
  END IF;
  PERFORM 1 FROM public.piggyvest_staging_replay_quarantine
  WHERE receipt_id = claimed.receipt_id AND reason = 'poison';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quarantine row missing after fenced quarantine';
  END IF;
  PERFORM 1 FROM public.piggyvest_staging_receipts
  WHERE id = claimed.receipt_id AND status = 'quarantined' AND claim_token IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt not fenced out after quarantine';
  END IF;

  -- Invalid quarantine reasons are rejected, not stored.
  BEGIN
    PERFORM public.quarantine_piggyvest_staging_receipt(
      claimed.receipt_id, claimed.claim_token, 'evt-001', 'made-up', NULL);
    RAISE EXCEPTION 'Invalid quarantine reason accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- Invalid resolve statuses are rejected.
  BEGIN
    PERFORM public.resolve_piggyvest_staging_receipt(
      claimed.receipt_id, claimed.claim_token, 'done', NULL);
    RAISE EXCEPTION 'Invalid resolve status accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- Double-quarantine of the same receipt collapses on receipt_id.
  UPDATE public.piggyvest_staging_receipts
  SET status = 'quarantined', claim_token = NULL, lease_expires_at = NULL
  WHERE id = claimed.receipt_id;
  SELECT lease.receipt_id, lease.claim_token INTO claimed_receipt_id, claimed_token
  FROM public.claim_piggyvest_staging_receipts(5, 300) AS lease
  WHERE lease.receipt_id = claimed.receipt_id;
  IF claimed_receipt_id IS NULL THEN
    RAISE EXCEPTION 'Re-claim after quarantine returned nothing';
  END IF;
  PERFORM public.quarantine_piggyvest_staging_receipt(
    claimed_receipt_id, claimed_token, 'evt-001', 'conflict', NULL);
  SELECT count(*) INTO claim_count
  FROM public.piggyvest_staging_replay_quarantine
  WHERE receipt_id = claimed_receipt_id;
  IF claim_count <> 1 THEN
    RAISE EXCEPTION 'Duplicate quarantine row, count=%', claim_count;
  END IF;

  -- Expired processing leases are reaped: a crashed worker cannot wedge
  -- a receipt below the dead-letter ceiling.
  UPDATE public.piggyvest_staging_receipts
  SET lease_expires_at = clock_timestamp() - interval '1 second'
  WHERE payload_sha256 = repeat('a', 64);
  SELECT lease.receipt_id, lease.claim_token, lease.attempts
  INTO claimed_receipt_id, claimed_token, claim_count
  FROM public.claim_piggyvest_staging_receipts(5, 300) AS lease
  WHERE lease.payload_sha256 = repeat('a', 64);
  IF claimed_receipt_id IS NULL THEN
    RAISE EXCEPTION 'Expired processing lease was not reaped';
  END IF;
  IF claim_count <> 2 THEN
    RAISE EXCEPTION 'Reaped lease did not bump attempts, got %', claim_count;
  END IF;
  IF public.resolve_piggyvest_staging_receipt(
    claimed_receipt_id, stale_token, 'processed', NULL) THEN
    RAISE EXCEPTION 'Pre-reap claim token still resolves after reap';
  END IF;

  -- Exhausted receipts dead-letter instead of leasing forever.
  UPDATE public.piggyvest_staging_receipts
  SET status = 'quarantined', claim_token = NULL, lease_expires_at = NULL, attempts = 10
  WHERE payload_sha256 = repeat('b', 64);
  SELECT count(*) INTO claim_count
  FROM public.claim_piggyvest_staging_receipts(5, 300)
  WHERE payload_sha256 = repeat('b', 64);
  IF claim_count <> 0 THEN
    RAISE EXCEPTION 'Exhausted receipt was leased';
  END IF;
  PERFORM 1 FROM public.piggyvest_staging_receipts
  WHERE payload_sha256 = repeat('b', 64) AND status = 'dead_letter';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exhausted receipt was not dead-lettered';
  END IF;

  -- Identity pin returns the cluster identifier to the worker role.
  SELECT public.piggyvest_staging_system_id() INTO system_id;
  IF system_id IS DISTINCT FROM
    (SELECT system_identifier::text FROM pg_control_system()) THEN
    RAISE EXCEPTION 'Identity pin mismatch';
  END IF;

  -- Worker role holds no receipt INSERT/DELETE and no quarantine DELETE.
  BEGIN
    INSERT INTO public.piggyvest_staging_receipts
      (payload_sha256, ciphertext, nonce, auth_tag, key_version)
    VALUES (repeat('d', 64), 'YWJj', 'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA==', 'staging-v1');
    RAISE EXCEPTION 'Worker role can insert receipts';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.piggyvest_staging_receipts;
    RAISE EXCEPTION 'Worker role can delete receipts';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.piggyvest_staging_replay_quarantine;
    RAISE EXCEPTION 'Worker role can delete quarantine rows';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$test$;

ROLLBACK;
