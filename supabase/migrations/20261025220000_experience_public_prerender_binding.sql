-- Read-only identifiers for the current public build. Renderer bytes remain private.
CREATE FUNCTION public.experience_public_prerender_binding(p_slug text,p_build text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE visible jsonb;result jsonb;
BEGIN
 IF p_build !~ '^[a-f0-9]{64}$' THEN RETURN NULL;END IF;
 visible:=public.experience_public_manifest(p_slug);
 IF visible IS NULL OR visible->>'buildDigest' IS DISTINCT FROM p_build THEN RETURN NULL;END IF;
 SELECT jsonb_build_object('merchantId',b.merchant_id,'buildId',b.id,'buildDigest',b.build_digest,'sourceDigest',j.source_digest)
 INTO result FROM public.experience_published_heads h
 JOIN public.experience_builds b ON b.merchant_id=h.merchant_id AND b.id=h.build_id
 JOIN public.experience_jobs j ON j.merchant_id=b.merchant_id AND j.id=b.job_id AND j.status='finalized'
 WHERE h.merchant_id=(visible->>'merchantId')::uuid AND b.build_digest=p_build;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.experience_public_prerender_binding(text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.experience_public_prerender_binding(text,text) TO anon,authenticated;
