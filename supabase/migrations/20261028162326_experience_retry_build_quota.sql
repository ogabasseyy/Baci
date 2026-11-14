CREATE OR REPLACE FUNCTION public.experience_retry_build(
  p_merchant uuid,
  p_connection uuid,
  p_version bigint,
  p_job uuid
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
  PERFORM pg_advisory_xact_lock(
    hashtextextended('experience-job:' || p_merchant::text, 0)
  );

  PERFORM 1
  FROM public.experience_jobs
  WHERE merchant_id = p_merchant
    AND id = p_job
    AND (
      status IN ('failed', 'cancelled')
      OR (status = 'running' AND lease_expires_at < clock_timestamp())
    )
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BUILD_FAILED';
  END IF;

  IF (
    SELECT count(*)
    FROM public.experience_jobs
    WHERE merchant_id = p_merchant
      AND id <> p_job
      AND status IN ('queued', 'running')
      AND expires_at > clock_timestamp()
  ) >= 4 THEN
    RAISE EXCEPTION 'QUOTA_EXCEEDED';
  END IF;

  UPDATE public.experience_jobs
  SET status = 'queued',
      attempt_nonce = gen_random_uuid(),
      lease_expires_at = NULL,
      expires_at = clock_timestamp() + interval '24 hours'
  WHERE merchant_id = p_merchant
    AND id = p_job
    AND (
      status IN ('failed', 'cancelled')
      OR (status = 'running' AND lease_expires_at < clock_timestamp())
    )
  RETURNING attempt_nonce INTO result;

  IF result IS NULL THEN
    RAISE EXCEPTION 'BUILD_FAILED';
  END IF;
  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION public.experience_retry_build(uuid, uuid, bigint, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.experience_retry_build(uuid, uuid, bigint, uuid)
  TO authenticated;
