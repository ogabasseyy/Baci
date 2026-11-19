BEGIN;
CREATE FUNCTION private.get_merchant_blog_classification_context_v1(p_merchant_id uuid,p_post_ids uuid[])
RETURNS TABLE(post_id uuid,slug text,title text,content text,category text,excerpt text,tags text[],keywords text[],
  input_fingerprint text,intent text,source text,taxonomy_version integer,classifier_version text,
  classified_at timestamptz,stale_at timestamptz,evidence_sha256 text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT coalesce(private.can_access_merchant_blog_classification_v1(p_merchant_id),false) THEN
    RAISE EXCEPTION 'Classification access denied' USING ERRCODE='42501';
  END IF;
  IF p_post_ids IS NULL OR cardinality(p_post_ids)>20 OR array_position(p_post_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Request at most 20 article contexts' USING ERRCODE='22023';
  END IF;
  RETURN QUERY SELECT p.id,p.slug,p.title,p.content,p.category,p.excerpt,p.tags,p.keywords,
    private.merchant_blog_input_fingerprint_v1(p),c.intent,c.source,c.taxonomy_version,
    c.classifier_version,c.classified_at,c.stale_at,c.evidence_sha256
  FROM public.blog_posts p LEFT JOIN public.merchant_blog_classifications c ON c.post_id=p.id AND c.merchant_id=p.merchant_id
  WHERE p.merchant_id=p_merchant_id AND p.id=ANY(p_post_ids) AND p.is_platform_post IS NOT TRUE;
END $$;
REVOKE ALL ON FUNCTION private.get_merchant_blog_classification_context_v1(uuid,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.get_merchant_blog_classification_context_v1(uuid,uuid[]) TO authenticated;
CREATE FUNCTION public.get_merchant_blog_classification_context_v1(p_merchant_id uuid,p_post_ids uuid[])
RETURNS TABLE(post_id uuid,slug text,title text,content text,category text,excerpt text,tags text[],keywords text[],
  input_fingerprint text,intent text,source text,taxonomy_version integer,classifier_version text,
  classified_at timestamptz,stale_at timestamptz,evidence_sha256 text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT * FROM private.get_merchant_blog_classification_context_v1(p_merchant_id,p_post_ids)
$$;
REVOKE ALL ON FUNCTION public.get_merchant_blog_classification_context_v1(uuid,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_merchant_blog_classification_context_v1(uuid,uuid[]) TO authenticated;

-- Public reads explicitly allow anonymous callers, but expose only the safe
-- classification projection of published posts on enabled merchant blogs.
CREATE FUNCTION private.get_storefront_blog_classifications_v1(p_merchant_id uuid,p_post_ids uuid[])
RETURNS TABLE(post_id uuid,intent text,source text,taxonomy_version integer,classifier_version text,classified_at timestamptz,post_updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_merchant_id IS NULL OR p_post_ids IS NULL OR cardinality(p_post_ids)>200 OR array_position(p_post_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Request at most 200 article classifications' USING ERRCODE='22023';
  END IF;
  RETURN QUERY SELECT c.post_id,c.intent,c.source,c.taxonomy_version,c.classifier_version,c.classified_at,p.updated_at
  FROM public.merchant_blog_classifications c
  JOIN public.blog_posts p ON p.id=c.post_id AND p.merchant_id=c.merchant_id
  JOIN public.merchant_feature_settings s ON s.merchant_id=c.merchant_id
  WHERE c.merchant_id=p_merchant_id AND c.post_id=ANY(p_post_ids) AND c.stale_at IS NULL
    AND p.status='published' AND p.published_at<=statement_timestamp() AND p.is_platform_post IS NOT TRUE
    AND s.blog_enabled IS TRUE;
END $$;
REVOKE ALL ON FUNCTION private.get_storefront_blog_classifications_v1(uuid,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.get_storefront_blog_classifications_v1(uuid,uuid[]) TO anon,authenticated;
CREATE FUNCTION public.get_storefront_blog_classifications_v1(p_merchant_id uuid,p_post_ids uuid[])
RETURNS TABLE(post_id uuid,intent text,source text,taxonomy_version integer,classifier_version text,classified_at timestamptz,post_updated_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT * FROM private.get_storefront_blog_classifications_v1(p_merchant_id,p_post_ids)
$$;
REVOKE ALL ON FUNCTION public.get_storefront_blog_classifications_v1(uuid,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_storefront_blog_classifications_v1(uuid,uuid[]) TO anon,authenticated;
COMMIT;
