-- Preserve authored route precedence and deterministic public projections.
-- Read-only disabled integration slice. No publication/approval/write API here.
CREATE OR REPLACE FUNCTION public.experience_public_manifest(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('merchantId',m.id,'buildDigest',b.build_digest,'version',h.publication_revision,
 'hostOrigin',to_jsonb(ev)->>'host_origin','policyRevision',h.publication_revision::text,'assetsDigest',encode(pg_catalog.sha256(COALESCE(a.manifest->'assets','[]'::jsonb)::text::bytea),'hex'),
 'assets',(SELECT COALESCE(jsonb_agg(jsonb_build_object('assetId',asset->'assetId','alt',asset->'alt') ORDER BY ordinal),'[]'::jsonb) FROM jsonb_array_elements(a.manifest->'assets') WITH ORDINALITY AS items(asset, ordinal)),
 'routes',(SELECT jsonb_agg(jsonb_build_object('path',r->'path','view',r->'view') ORDER BY ordinal) FROM jsonb_array_elements(a.manifest->'routes') WITH ORDINALITY AS items(r, ordinal)),
 'capabilities',COALESCE((SELECT jsonb_agg(c ORDER BY ordinal) FROM jsonb_array_elements(a.manifest->'capabilities') WITH ORDINALITY AS items(c, ordinal) WHERE c#>>'{}' IN ('catalog.read','cart.read-public','cart.mutate','checkout.prepare','checkout.open','navigation')),'[]'::jsonb))
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
