BEGIN;

ALTER TABLE public.blog_posts
  ADD COLUMN classification_revision uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid();

CREATE FUNCTION private.set_blog_post_classification_revision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=''
AS $function$
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.classification_revision := pg_catalog.gen_random_uuid();
  ELSIF ROW(NEW.title,NEW.content,NEW.category,NEW.excerpt,NEW.tags,NEW.keywords)
      IS DISTINCT FROM ROW(OLD.title,OLD.content,OLD.category,OLD.excerpt,OLD.tags,OLD.keywords) THEN
    NEW.classification_revision := pg_catalog.gen_random_uuid();
  ELSE
    NEW.classification_revision := OLD.classification_revision;
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION private.set_blog_post_classification_revision()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER set_blog_post_classification_revision
  BEFORE INSERT OR UPDATE ON public.blog_posts
  FOR EACH ROW EXECUTE FUNCTION private.set_blog_post_classification_revision();

-- PostgreSQL cannot change the OUT row shape with CREATE OR REPLACE. Drop the
-- exposed invoker wrappers before their private implementations, then restore
-- their exact role grants with the revision added to the safe projection.
DROP FUNCTION public.get_storefront_blog_classifications_v1(uuid,uuid[]);
DROP FUNCTION private.get_storefront_blog_classifications_v1(uuid,uuid[]);
CREATE FUNCTION private.get_storefront_blog_classifications_v1(p_merchant_id uuid,p_post_ids uuid[])
RETURNS TABLE(
  post_id uuid,intent text,source text,taxonomy_version integer,classifier_version text,
  classified_at timestamptz,post_updated_at timestamptz,post_revision uuid
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$
BEGIN
  IF p_merchant_id IS NULL OR p_post_ids IS NULL OR cardinality(p_post_ids)>200 OR array_position(p_post_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Request at most 200 article classifications' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
  SELECT c.post_id,c.intent,c.source,c.taxonomy_version,c.classifier_version,
    c.classified_at,p.updated_at,p.classification_revision
  FROM public.merchant_blog_classifications c
  JOIN public.blog_posts p ON p.id=c.post_id AND p.merchant_id=c.merchant_id
  JOIN public.merchant_feature_settings s ON s.merchant_id=c.merchant_id
  WHERE c.merchant_id=p_merchant_id AND c.post_id=ANY(p_post_ids) AND c.stale_at IS NULL
    AND p.status='published' AND p.published_at<=statement_timestamp() AND p.is_platform_post IS NOT TRUE
    AND s.blog_enabled IS TRUE;
END
$function$;
REVOKE ALL ON FUNCTION private.get_storefront_blog_classifications_v1(uuid,uuid[])
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.get_storefront_blog_classifications_v1(uuid,uuid[])
  TO anon,authenticated;
CREATE FUNCTION public.get_storefront_blog_classifications_v1(p_merchant_id uuid,p_post_ids uuid[])
RETURNS TABLE(
  post_id uuid,intent text,source text,taxonomy_version integer,classifier_version text,
  classified_at timestamptz,post_updated_at timestamptz,post_revision uuid
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $function$
  SELECT * FROM private.get_storefront_blog_classifications_v1(p_merchant_id,p_post_ids)
$function$;
REVOKE ALL ON FUNCTION public.get_storefront_blog_classifications_v1(uuid,uuid[])
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_storefront_blog_classifications_v1(uuid,uuid[])
  TO anon,authenticated;

DROP FUNCTION public.get_merchant_blog_classification_snapshot_v1(uuid,uuid[]);
DROP FUNCTION private.get_merchant_blog_classification_snapshot_v1(uuid,uuid[]);
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
  post_updated_at timestamptz,
  post_revision uuid
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
    classification.classified_at,classification.stale_at,post.updated_at,post.classification_revision
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
  post_updated_at timestamptz,
  post_revision uuid
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
