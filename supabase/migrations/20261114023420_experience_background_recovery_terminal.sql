-- Discover exhausted stale leases once more so preparation can mark them failed.
CREATE OR REPLACE FUNCTION public.experience_list_due_builds(p_merchant uuid,p_connection uuid,p_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_connection IS NULL OR p_version IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 PERFORM public.experience_require_owner(p_merchant,p_connection,p_version);
 RETURN (SELECT coalesce(jsonb_agg(id ORDER BY created_at,id),'[]'::jsonb)
 FROM (SELECT id,created_at FROM public.experience_jobs
       WHERE merchant_id=p_merchant AND connection_id=p_connection AND grant_version=p_version
         AND expires_at>clock_timestamp()
         AND (status='queued' OR (status='running' AND lease_expires_at<clock_timestamp()))
       ORDER BY created_at,id LIMIT 20) due);
END $$;

CREATE OR REPLACE FUNCTION public.experience_prepare_background_build(p_merchant uuid,p_connection uuid,p_version bigint,p_job uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.experience_jobs;
BEGIN
 IF p_connection IS NULL OR p_version IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 PERFORM public.experience_require_owner(p_merchant,p_connection,p_version);
 SELECT * INTO j FROM public.experience_jobs WHERE id=p_job AND merchant_id=p_merchant
   AND connection_id=p_connection AND grant_version=p_version FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF j.expires_at<=clock_timestamp() THEN RETURN 'unavailable'; END IF;
 IF j.status='queued' THEN RETURN 'ready'; END IF;
 IF j.status='running' AND j.lease_expires_at<clock_timestamp() THEN
  IF j.background_recoveries>=3 THEN
   UPDATE public.experience_jobs SET status='failed',attempt_nonce=gen_random_uuid(),lease_expires_at=NULL WHERE id=p_job;
   RETURN 'unavailable';
  END IF;
  UPDATE public.experience_jobs SET status='queued',attempt_nonce=gen_random_uuid(),lease_expires_at=NULL,background_recoveries=background_recoveries+1 WHERE id=p_job;
  RETURN 'ready';
 END IF;
 RETURN 'unavailable';
END $$;
