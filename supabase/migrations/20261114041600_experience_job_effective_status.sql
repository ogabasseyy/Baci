-- Read the effective status atomically using the database clock and normal RLS.
CREATE FUNCTION public.experience_read_build_operation(p_merchant uuid, p_job uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object(
   'id', j.id,
   'status', CASE WHEN j.status IN ('queued', 'running') AND j.expires_at <= statement_timestamp()
                  THEN 'expired' ELSE j.status END,
   'expires_at', j.expires_at,
   'buildId', CASE WHEN j.status = 'finalized' THEN b.id END,
   'buildDigest', CASE WHEN j.status = 'finalized' THEN b.build_digest END
 ))
 FROM public.experience_jobs j
 LEFT JOIN public.experience_builds b ON b.merchant_id=j.merchant_id AND b.job_id=j.id
 WHERE j.merchant_id=p_merchant AND j.id=p_job
$$;
REVOKE ALL ON FUNCTION public.experience_read_build_operation(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.experience_read_build_operation(uuid,uuid) TO authenticated;
