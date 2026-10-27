BEGIN;

-- Merchant-facing article list snapshot: classification status and article
-- revision only. Content, fingerprints, evidence and actor identity stay private.
CREATE FUNCTION private.get_merchant_blog_classification_snapshot_v1(
  p_merchant_id uuid,
  p_post_ids uuid[]
)
RETURNS TABLE(
  post_id uuid,
  intent text,
  source text,
  taxonomy_version integer,
  classifier_version text,
  classified_at timestamptz,
  stale_at timestamptz,
  post_updated_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$
BEGIN
  IF NOT coalesce(private.can_access_merchant_blog_classification_v1(p_merchant_id),false) THEN
    RAISE EXCEPTION 'Classification access denied' USING ERRCODE='42501';
  END IF;
  IF p_post_ids IS NULL OR cardinality(p_post_ids)>200 OR array_position(p_post_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Request at most 200 article snapshots' USING ERRCODE='22023';
  END IF;

  RETURN QUERY
  SELECT post.id,classification.intent,classification.source,
    classification.taxonomy_version,classification.classifier_version,
    classification.classified_at,classification.stale_at,post.updated_at
  FROM public.blog_posts AS post
  LEFT JOIN public.merchant_blog_classifications AS classification
    ON classification.post_id=post.id AND classification.merchant_id=post.merchant_id
  WHERE post.merchant_id=p_merchant_id
    AND post.id=ANY(p_post_ids)
    AND post.is_platform_post IS NOT TRUE;
END
$function$;
REVOKE ALL ON FUNCTION private.get_merchant_blog_classification_snapshot_v1(uuid,uuid[])
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.get_merchant_blog_classification_snapshot_v1(uuid,uuid[])
  TO authenticated;

CREATE FUNCTION public.get_merchant_blog_classification_snapshot_v1(
  p_merchant_id uuid,
  p_post_ids uuid[]
)
RETURNS TABLE(
  post_id uuid,
  intent text,
  source text,
  taxonomy_version integer,
  classifier_version text,
  classified_at timestamptz,
  stale_at timestamptz,
  post_updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $function$
  SELECT * FROM private.get_merchant_blog_classification_snapshot_v1(p_merchant_id,p_post_ids)
$function$;
REVOKE ALL ON FUNCTION public.get_merchant_blog_classification_snapshot_v1(uuid,uuid[])
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_merchant_blog_classification_snapshot_v1(uuid,uuid[])
  TO authenticated;

COMMENT ON FUNCTION public.get_merchant_blog_classification_snapshot_v1(uuid,uuid[]) IS
  'Authorized merchant metadata snapshot of requested articles and their current or stale classifications; never returns article content, fingerprints, evidence or actor identity.';

COMMIT;
