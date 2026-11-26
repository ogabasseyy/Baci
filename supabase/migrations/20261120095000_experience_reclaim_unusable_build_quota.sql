-- Called only from authorized queue/retry RPCs while holding the merchant job lock.
-- Keep old jobs and evidence for reconciliation, but rotate the execution fence.
CREATE FUNCTION experience_authorization.require_available_build_slot(
  p_merchant uuid,
  p_exclude_job uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  checked_at timestamptz := clock_timestamp();
BEGIN
  UPDATE public.experience_jobs AS j
  SET status = 'cancelled',
      attempt_nonce = gen_random_uuid(),
      lease_expires_at = NULL
  WHERE j.merchant_id = p_merchant
    AND j.status IN ('queued', 'running')
    AND j.expires_at > checked_at
    AND j.connection_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM builder_authorization.connections AS c
      JOIN public.merchants AS m ON m.id = j.merchant_id
      WHERE c.id = j.connection_id
        AND c.actor_user_id = m.user_id
        AND c.grant_version = j.grant_version
        AND c.status = 'active'
        AND c.revoked_at IS NULL
        AND c.expires_at > checked_at
        AND 'storefront.write' = ANY(c.scopes)
        AND j.merchant_id = ANY(c.allowed_merchant_ids)
    );

  IF (SELECT count(*) FROM public.experience_jobs AS j
      WHERE j.merchant_id = p_merchant
        AND j.id IS DISTINCT FROM p_exclude_job
        AND j.status IN ('queued', 'running')
        AND j.expires_at > checked_at) >= 4 THEN
    RAISE EXCEPTION 'QUOTA_EXCEEDED';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION experience_authorization.require_available_build_slot(uuid, uuid)
FROM PUBLIC, anon, authenticated, service_role, baci_builder_auth_storage;

CREATE OR REPLACE FUNCTION public.experience_queue_build(
  p_merchant uuid, p_connection uuid, p_version bigint, p_artifact uuid, p_retry uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  artifact_digest text;
  j record;
  job_id uuid;
BEGIN
  PERFORM public.experience_require_owner(p_merchant, p_connection, p_version);
  PERFORM pg_advisory_xact_lock(hashtextextended('experience-job:' || p_merchant::text, 0));

  SELECT source_digest INTO artifact_digest
  FROM public.experience_artifacts
  WHERE id = p_artifact AND merchant_id = p_merchant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  SELECT id, artifact_id, connection_id, grant_version INTO j
  FROM public.experience_jobs
  WHERE merchant_id = p_merchant AND retry_key = p_retry;
  IF FOUND THEN
    IF j.artifact_id IS DISTINCT FROM p_artifact
      OR j.connection_id IS DISTINCT FROM p_connection
      OR j.grant_version IS DISTINCT FROM p_version THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN j.id;
  END IF;

  PERFORM experience_authorization.require_available_build_slot(p_merchant, NULL);
  INSERT INTO public.experience_jobs (
    merchant_id, artifact_id, retry_key, source_digest, connection_id, grant_version
  )
  VALUES (p_merchant, p_artifact, p_retry, artifact_digest, p_connection, p_version)
  RETURNING id INTO job_id;
  RETURN job_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.experience_retry_build(
  p_merchant uuid, p_connection uuid, p_version bigint, p_job uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result uuid;
BEGIN
  PERFORM public.experience_require_owner(p_merchant, p_connection, p_version);
  PERFORM pg_advisory_xact_lock(hashtextextended('experience-job:' || p_merchant::text, 0));

  PERFORM 1 FROM public.experience_jobs
  WHERE merchant_id = p_merchant AND id = p_job
    AND connection_id IS NOT DISTINCT FROM p_connection
    AND grant_version IS NOT DISTINCT FROM p_version
    AND (status IN ('failed', 'cancelled')
      OR (status = 'running' AND lease_expires_at < clock_timestamp()))
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BUILD_FAILED';
  END IF;

  PERFORM experience_authorization.require_available_build_slot(p_merchant, p_job);
  UPDATE public.experience_jobs
  SET status = 'queued',
      attempt_nonce = gen_random_uuid(),
      lease_expires_at = NULL,
      expires_at = clock_timestamp() + interval '24 hours'
  WHERE merchant_id = p_merchant AND id = p_job
    AND connection_id IS NOT DISTINCT FROM p_connection
    AND grant_version IS NOT DISTINCT FROM p_version
    AND (status IN ('failed', 'cancelled')
      OR (status = 'running' AND lease_expires_at < clock_timestamp()))
  RETURNING attempt_nonce INTO result;
  IF result IS NULL THEN
    RAISE EXCEPTION 'BUILD_FAILED';
  END IF;
  RETURN result;
END;
$$;
