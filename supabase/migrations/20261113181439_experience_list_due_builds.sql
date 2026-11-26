-- User-scoped discovery only. Claims remain a separate atomic, fenced operation.
CREATE FUNCTION public.experience_list_due_builds(p_merchant uuid,p_connection uuid,p_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_connection IS NULL OR p_version IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 PERFORM public.experience_require_owner(p_merchant,p_connection,p_version);
 RETURN (SELECT coalesce(jsonb_agg(id ORDER BY created_at,id),'[]'::jsonb)
 FROM (SELECT id,created_at FROM public.experience_jobs
       WHERE merchant_id=p_merchant AND connection_id=p_connection AND grant_version=p_version
         AND status='queued' AND expires_at>clock_timestamp()
       ORDER BY created_at,id LIMIT 20) due);
END $$;
REVOKE ALL ON FUNCTION public.experience_list_due_builds(uuid,uuid,bigint) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.experience_list_due_builds(uuid,uuid,bigint) TO authenticated;
