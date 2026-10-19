
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100
    OR p_lease_seconds IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid claim bounds';
  END IF;
  PERFORM set_config('synchronous_commit', 'on', true);
  WITH exhausted AS (
    SELECT candidate.id FROM public.piggyvest_staging_receipts AS candidate
    WHERE candidate.attempts >= 10
      AND ((candidate.status = 'quarantined' AND
        (candidate.last_error IS NULL OR candidate.last_error = 'worker retryable'))
        OR (candidate.status = 'processing' AND
          (candidate.lease_expires_at IS NULL OR candidate.lease_expires_at <= clock_timestamp())))
    ORDER BY candidate.received_at, candidate.id LIMIT p_limit FOR UPDATE SKIP LOCKED
  )
  UPDATE public.piggyvest_staging_receipts AS receipt
  SET status = 'dead_letter', claim_token = NULL, lease_expires_at = NULL,
    next_attempt_at = NULL, last_error = 'attempts exhausted'
  FROM exhausted WHERE receipt.id = exhausted.id;
  RETURN QUERY
  WITH eligible AS (
    SELECT candidate.id FROM public.piggyvest_staging_receipts AS candidate
    WHERE candidate.attempts < 10 AND (
      (candidate.status = 'quarantined'
        AND (candidate.last_error IS NULL OR candidate.last_error = 'worker retryable')
        AND (candidate.next_attempt_at IS NULL OR candidate.next_attempt_at <= clock_timestamp()))
      OR (candidate.status = 'processing'
        AND (candidate.lease_expires_at IS NULL OR candidate.lease_expires_at <= clock_timestamp())))
    ORDER BY candidate.received_at, candidate.id LIMIT p_limit FOR UPDATE SKIP LOCKED
  )
  UPDATE public.piggyvest_staging_receipts AS receipt
  SET status = 'processing', claim_token = gen_random_uuid(),
    lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
    attempts = receipt.attempts + 1, next_attempt_at = NULL, last_error = NULL
  FROM eligible WHERE receipt.id = eligible.id
  RETURNING receipt.id, receipt.payload_sha256, receipt.ciphertext, receipt.nonce,
    receipt.auth_tag, receipt.key_version, receipt.claim_token, receipt.attempts;
END
