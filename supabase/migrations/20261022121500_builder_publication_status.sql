CREATE OR REPLACE FUNCTION public.builder_read_storefronts(p_connection uuid,p_version bigint,p_merchant uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c builder_authorization.connections%ROWTYPE; result jsonb;
BEGIN
 PERFORM public.builder_require_private_storage();
 SELECT * INTO c FROM builder_authorization.connections WHERE id=p_connection AND actor_user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND OR c.status<>'active' OR c.revoked_at IS NOT NULL OR c.expires_at<=clock_timestamp() OR c.grant_version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'CONNECTION_REVOKED' USING ERRCODE='42501';END IF;
 IF NOT 'storefront.read'=ANY(c.scopes) THEN RAISE EXCEPTION 'INSUFFICIENT_SCOPE' USING ERRCODE='42501';END IF;
 IF p_merchant IS NOT NULL AND NOT p_merchant=ANY(c.allowed_merchant_ids) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='42501';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'business_name',m.business_name,'slug',m.slug,'template_id',m.template_id,'draft_config',d.draft_config,'version',CASE WHEN r.token IS NULL THEN NULL ELSE 'draft:'||r.token END,'is_published',coalesce(m.is_published AND p.is_published,false),'publishedVersion',CASE WHEN m.is_published AND p.is_published THEN 'published:'||v.token ELSE NULL END,'latestReceipt',(SELECT builder_authorization.publication_result(pr.id) FROM builder_authorization.publication_receipts pr WHERE pr.merchant_id=m.id AND pr.connection_id=p_connection AND pr.actor_user_id=auth.uid() ORDER BY pr.committed_at DESC LIMIT 1),'missingItems',builder_authorization.publication_missing_items(m.id),'pendingOperationIds',(SELECT coalesce(jsonb_agg(id),'[]'::jsonb) FROM (SELECT id FROM builder_authorization.builder_edit_operations WHERE merchant_id=m.id AND connection_id=p_connection AND grant_version=p_version AND status IN('pending','running','ready') AND expires_at>clock_timestamp() ORDER BY created_at LIMIT 20) pending))),'[]'::jsonb)
 INTO result FROM public.merchants m LEFT JOIN public.page_configs p ON p.merchant_id=m.id AND p.page_slug='home'
 LEFT JOIN public.builder_page_drafts d ON d.id=p.id AND d.merchant_id=m.id
 LEFT JOIN public.builder_website_revisions r ON r.merchant_id=m.id
 LEFT JOIN public.builder_published_revisions v ON v.merchant_id=m.id
 WHERE m.user_id=auth.uid() AND m.id=ANY(c.allowed_merchant_ids) AND (p_merchant IS NULL OR m.id=p_merchant);
 RETURN result;
END $$;
