-- Preserve the authorized connection and grant version across admission and
-- claim. The native owner path remains represented by the pair (NULL, NULL).
CREATE OR REPLACE FUNCTION public.experience_queue_build(p_merchant uuid,p_connection uuid,p_version bigint,p_artifact uuid,p_retry uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.experience_artifacts; j public.experience_jobs;
BEGIN
 PERFORM public.experience_require_owner(p_merchant,p_connection,p_version);
 PERFORM pg_advisory_xact_lock(hashtextextended('experience-job:'||p_merchant::text,0));
 SELECT * INTO a FROM public.experience_artifacts WHERE id=p_artifact AND merchant_id=p_merchant;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 SELECT * INTO j FROM public.experience_jobs WHERE merchant_id=p_merchant AND retry_key=p_retry;
 IF FOUND THEN
  IF j.artifact_id IS DISTINCT FROM p_artifact
    OR j.connection_id IS DISTINCT FROM p_connection
    OR j.grant_version IS DISTINCT FROM p_version THEN
   RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
  END IF;
  RETURN j.id;
 END IF;
 IF (SELECT count(*) FROM public.experience_jobs WHERE merchant_id=p_merchant AND status IN('queued','running') AND expires_at>clock_timestamp())>=4 THEN RAISE EXCEPTION 'QUOTA_EXCEEDED'; END IF;
 INSERT INTO public.experience_jobs(merchant_id,artifact_id,retry_key,source_digest,connection_id,grant_version)
 VALUES(p_merchant,p_artifact,p_retry,a.source_digest,p_connection,p_version) RETURNING * INTO j;
 RETURN j.id;
END $$;

CREATE OR REPLACE FUNCTION public.experience_claim_build(p_merchant uuid,p_connection uuid,p_version bigint,p_job uuid,p_attempt uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.experience_require_owner(p_merchant,p_connection,p_version);
 UPDATE public.experience_jobs SET status='running',lease_expires_at=clock_timestamp()+interval '10 minutes'
 WHERE merchant_id=p_merchant AND id=p_job AND attempt_nonce=p_attempt AND status='queued'
   AND connection_id IS NOT DISTINCT FROM p_connection
   AND grant_version IS NOT DISTINCT FROM p_version
   AND expires_at>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'BUILD_FAILED';END IF;
END $$;

REVOKE ALL ON FUNCTION public.experience_queue_build(uuid,uuid,bigint,uuid,uuid),public.experience_claim_build(uuid,uuid,bigint,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.experience_queue_build(uuid,uuid,bigint,uuid,uuid),public.experience_claim_build(uuid,uuid,bigint,uuid,uuid) TO authenticated;
