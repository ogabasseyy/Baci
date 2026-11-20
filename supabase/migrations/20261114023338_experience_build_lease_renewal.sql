-- Never revive an expired, cancelled, replaced or differently bound attempt.
CREATE FUNCTION public.experience_renew_build_lease(p_merchant uuid,p_connection uuid,p_version bigint,p_job uuid,p_attempt uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_connection IS NULL OR p_version IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 PERFORM public.experience_require_owner(p_merchant,p_connection,p_version);
 UPDATE public.experience_jobs SET lease_expires_at=least(expires_at,clock_timestamp()+interval '10 minutes')
 WHERE id=p_job AND merchant_id=p_merchant AND connection_id=p_connection AND grant_version=p_version
   AND attempt_nonce=p_attempt AND status='running' AND lease_expires_at>clock_timestamp()
   AND expires_at>clock_timestamp();
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.experience_renew_build_lease(uuid,uuid,bigint,uuid,uuid) FROM PUBLIC,anon,service_role,baci_builder_auth_storage;
GRANT EXECUTE ON FUNCTION public.experience_renew_build_lease(uuid,uuid,bigint,uuid,uuid) TO authenticated;
