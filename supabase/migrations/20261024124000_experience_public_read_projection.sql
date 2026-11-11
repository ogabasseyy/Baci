-- Read-only disabled integration slice. No publication/approval/write API here.
CREATE FUNCTION public.experience_public_manifest(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('merchantId',m.id,'buildDigest',b.build_digest,'version',h.publication_revision,
 'hostOrigin',to_jsonb(ev)->>'host_origin','policyRevision',h.publication_revision::text,'assetsDigest',encode(pg_catalog.sha256(COALESCE(a.manifest->'assets','[]'::jsonb)::text::bytea),'hex'),
 'assets',(SELECT COALESCE(jsonb_agg(jsonb_build_object('assetId',asset->'assetId','alt',asset->'alt')),'[]'::jsonb) FROM jsonb_array_elements(a.manifest->'assets') asset),
 'routes',(SELECT jsonb_agg(jsonb_build_object('path',r->'path','view',r->'view')) FROM jsonb_array_elements(a.manifest->'routes') r),
 'capabilities',COALESCE((SELECT jsonb_agg(c) FROM jsonb_array_elements(a.manifest->'capabilities') c WHERE c#>>'{}' IN ('catalog.read','cart.read-public','cart.mutate','checkout.prepare','checkout.open','navigation')),'[]'::jsonb))
 FROM public.merchants m
 JOIN public.experience_published_heads h ON h.merchant_id=m.id
 JOIN public.experience_builds b ON b.merchant_id=m.id AND b.id=h.build_id
 JOIN public.experience_approvals approval ON approval.merchant_id=m.id AND approval.id=h.approval_id AND approval.build_id=b.id
 JOIN public.experience_jobs j ON j.merchant_id=m.id AND j.id=b.job_id AND j.status='finalized'
 JOIN public.experience_evidence ev ON ev.merchant_id=m.id AND ev.job_id=j.id AND ev.attempt_nonce=j.attempt_nonce AND ev.build_digest=b.build_digest
 JOIN public.experience_artifacts a ON a.merchant_id=m.id AND a.id=j.artifact_id
 WHERE m.slug=p_slug AND p_slug ~ '^[a-z0-9][a-z0-9-]{0,99}$' AND m.is_published IS TRUE LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.experience_public_manifest(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.experience_public_manifest(text) TO anon,authenticated;
CREATE FUNCTION public.experience_public_file(p_slug text,p_build text,p_path text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE manifest jsonb;mid uuid;bid uuid; result jsonb;
BEGIN
 IF p_path !~ '^(app\.(js|css)|assets/[a-z0-9-]{1,80})$' OR p_build !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;
 manifest:=public.experience_public_manifest(p_slug);
 IF manifest IS NULL OR manifest->>'buildDigest' IS DISTINCT FROM p_build THEN RETURN NULL; END IF;
 mid:=(manifest->>'merchantId')::uuid;
 SELECT build_id INTO bid FROM public.experience_published_heads WHERE merchant_id=mid;
 IF p_path IN ('app.js','app.css') THEN
 SELECT jsonb_build_object('path',f.path,'digest',f.digest,'mime',f.mime,'hex',encode(f.bytes,'hex')) INTO result
 FROM public.experience_build_files f WHERE f.merchant_id=mid AND f.build_id=bid AND f.path=p_path
 AND f.digest=encode(pg_catalog.sha256(f.bytes),'hex') AND octet_length(f.bytes)<=16777216;
 ELSE
 SELECT jsonb_build_object('path',p_path,'digest',asset.digest,'mime',asset.mime,'hex',encode(asset.bytes,'hex')) INTO result
 FROM public.experience_assets asset
 JOIN public.experience_jobs j ON j.merchant_id=mid
 JOIN public.experience_builds b ON b.job_id=j.id AND b.merchant_id=mid AND b.id=bid
 JOIN public.experience_artifacts a ON a.id=j.artifact_id AND a.merchant_id=mid
 WHERE asset.merchant_id=mid AND asset.asset_id=substring(p_path FROM 8) AND asset.purpose='design'
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(a.manifest->'assets') ref WHERE ref->>'assetId'=asset.asset_id)
 AND asset.digest=encode(pg_catalog.sha256(asset.bytes),'hex') LIMIT 1;
 END IF;
 RETURN result;
END;$$;
REVOKE ALL ON FUNCTION public.experience_public_file(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.experience_public_file(text,text,text) TO anon,authenticated;
