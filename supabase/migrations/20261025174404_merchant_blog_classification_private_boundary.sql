-- Preserve the private-schema boundary while allowing only the reviewed public
-- classification RPCs to delegate through postgres-owned trampolines.
BEGIN;

CREATE OR REPLACE FUNCTION public.set_merchant_blog_classification_v1(
  p_merchant_id uuid,p_post_id uuid,p_intent text,p_expected_fingerprint text,
  p_classifier_version text,p_evidence_sha256 text DEFAULT NULL,p_source text DEFAULT 'merchant_declared'
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $function$
  SELECT private.set_merchant_blog_classification_v1(p_merchant_id,p_post_id,p_intent,
    p_expected_fingerprint,p_classifier_version,p_evidence_sha256,p_source)
$function$;
ALTER FUNCTION public.set_merchant_blog_classification_v1(uuid,uuid,text,text,text,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_merchant_blog_classification_v1(uuid,uuid,text,text,text,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.set_merchant_blog_classification_v1(uuid,uuid,text,text,text,text,text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.get_merchant_blog_classification_context_v1(
  p_merchant_id uuid,p_post_ids uuid[]
) RETURNS TABLE(post_id uuid,slug text,title text,content text,category text,excerpt text,tags text[],keywords text[],
  input_fingerprint text,intent text,source text,taxonomy_version integer,classifier_version text,
  classified_at timestamptz,stale_at timestamptz,evidence_sha256 text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
  SELECT * FROM private.get_merchant_blog_classification_context_v1(p_merchant_id,p_post_ids)
$function$;
ALTER FUNCTION public.get_merchant_blog_classification_context_v1(uuid,uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_merchant_blog_classification_context_v1(uuid,uuid[])
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_merchant_blog_classification_context_v1(uuid,uuid[])
  TO authenticated;

CREATE OR REPLACE FUNCTION public.get_merchant_blog_classification_snapshot_v1(
  p_merchant_id uuid,p_post_ids uuid[]
) RETURNS TABLE(post_id uuid,intent text,source text,taxonomy_version integer,
  classifier_version text,classified_at timestamptz,stale_at timestamptz,post_updated_at timestamptz,
  post_revision uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
  SELECT * FROM private.get_merchant_blog_classification_snapshot_v1(p_merchant_id,p_post_ids)
$function$;
ALTER FUNCTION public.get_merchant_blog_classification_snapshot_v1(uuid,uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_merchant_blog_classification_snapshot_v1(uuid,uuid[])
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_merchant_blog_classification_snapshot_v1(uuid,uuid[])
  TO authenticated;

CREATE OR REPLACE FUNCTION public.get_storefront_blog_classifications_v1(
  p_merchant_id uuid,p_post_ids uuid[]
) RETURNS TABLE(post_id uuid,intent text,source text,taxonomy_version integer,
  classifier_version text,classified_at timestamptz,post_updated_at timestamptz,post_revision uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
  SELECT * FROM private.get_storefront_blog_classifications_v1(p_merchant_id,p_post_ids)
$function$;
ALTER FUNCTION public.get_storefront_blog_classifications_v1(uuid,uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_storefront_blog_classifications_v1(uuid,uuid[])
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_storefront_blog_classifications_v1(uuid,uuid[])
  TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_storefront_cluster_guide_candidates_v2(
  p_merchant_id uuid,p_category_slug text,p_cluster_rules jsonb,p_search_query text,p_limit integer DEFAULT 64
) RETURNS TABLE(slug text,title text,excerpt text,category text,tags text[],keywords text[],
  featured_image_url text,published_at timestamptz,reading_time_minutes integer,
  merchant_intent text,merchant_intent_source text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' ROWS 64 AS $function$
  SELECT * FROM private.get_storefront_cluster_guide_candidates_v2(
    p_merchant_id,p_category_slug,p_cluster_rules,p_search_query,p_limit)
$function$;
ALTER FUNCTION public.get_storefront_cluster_guide_candidates_v2(uuid,text,jsonb,text,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_storefront_cluster_guide_candidates_v2(uuid,text,jsonb,text,integer)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_storefront_cluster_guide_candidates_v2(uuid,text,jsonb,text,integer)
  TO anon,authenticated;

REVOKE EXECUTE ON FUNCTION private.set_merchant_blog_classification_v1(uuid,uuid,text,text,text,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE EXECUTE ON FUNCTION private.get_merchant_blog_classification_context_v1(uuid,uuid[])
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE EXECUTE ON FUNCTION private.get_merchant_blog_classification_snapshot_v1(uuid,uuid[])
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE EXECUTE ON FUNCTION private.get_storefront_blog_classifications_v1(uuid,uuid[])
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE EXECUTE ON FUNCTION private.get_storefront_cluster_guide_candidates_v2(uuid,text,jsonb,text,integer)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE USAGE ON SCHEMA private FROM authenticated;

COMMIT;
