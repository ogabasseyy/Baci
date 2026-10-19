-- Optimize the bounded cluster classifier used by storefront PDP semantic
-- enrichment. The public function remains the validation, feature-gate, and
-- projection boundary; its classifier stages live in a private helper.

CREATE OR REPLACE FUNCTION public.get_storefront_cluster_guide_candidates_v1(
  p_merchant_id uuid,
  p_category_slug text,
  p_cluster_rules jsonb,
  p_search_query text,
  p_limit integer DEFAULT 64
)
RETURNS TABLE (
  slug text,
  title text,
  excerpt text,
  category text,
  tags text[],
  keywords text[],
  featured_image_url text,
  published_at timestamp with time zone,
  reading_time_minutes integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
ROWS 64
AS $function$
DECLARE
  v_indexable_query_text text;
  v_query_text text;
  v_requested_category_slug text;
  v_search_query pg_catalog.tsquery;
  v_effective_limit integer;
BEGIN
  IF p_merchant_id IS NULL
    OR p_category_slug IS NULL
    OR pg_catalog.octet_length(p_category_slug) > 64
    OR p_cluster_rules IS NULL
    OR pg_catalog.jsonb_typeof(p_cluster_rules) IS DISTINCT FROM 'array'
    OR pg_catalog.octet_length(p_cluster_rules::text) > 8192
    OR p_search_query IS NULL
    OR pg_catalog.octet_length(p_search_query) > 512
  THEN
    RETURN;
  END IF;

  v_requested_category_slug := pg_catalog.lower(
    pg_catalog.btrim(p_category_slug)
  );
  v_query_text := pg_catalog.btrim(p_search_query);
  IF v_requested_category_slug = ''
    OR v_query_text = ''
    OR pg_catalog.jsonb_array_length(p_cluster_rules) NOT BETWEEN 1 AND 32
  THEN
    RETURN;
  END IF;

  BEGIN
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_cluster_rules) AS rule(value)
      WHERE pg_catalog.jsonb_typeof(rule.value) IS DISTINCT FROM 'object'
        OR pg_catalog.jsonb_typeof(rule.value -> 'rule_order') IS DISTINCT FROM 'number'
        OR pg_catalog.octet_length(rule.value ->> 'rule_order') > 2
        OR (rule.value ->> 'rule_order') OPERATOR(pg_catalog.!~) '^[0-9]+$'
        OR (rule.value ->> 'rule_order')::integer NOT BETWEEN 0 AND 31
        OR pg_catalog.jsonb_typeof(rule.value -> 'category_slug') IS DISTINCT FROM 'string'
        OR pg_catalog.btrim(rule.value ->> 'category_slug') = ''
        OR pg_catalog.octet_length(rule.value ->> 'category_slug') > 64
        OR pg_catalog.jsonb_typeof(rule.value -> 'category_names') IS DISTINCT FROM 'array'
        OR pg_catalog.jsonb_array_length(rule.value -> 'category_names') NOT BETWEEN 1 AND 16
        OR pg_catalog.jsonb_typeof(rule.value -> 'article_tokens') IS DISTINCT FROM 'array'
        OR pg_catalog.jsonb_array_length(rule.value -> 'article_tokens') NOT BETWEEN 1 AND 32
        OR EXISTS (
          SELECT 1
          FROM pg_catalog.jsonb_array_elements(rule.value -> 'category_names') AS category_name(value)
          WHERE pg_catalog.jsonb_typeof(category_name.value) IS DISTINCT FROM 'string'
        )
        OR EXISTS (
          SELECT 1
          FROM pg_catalog.jsonb_array_elements_text(rule.value -> 'category_names') AS category_name(value)
          WHERE pg_catalog.btrim(category_name.value) = ''
            OR pg_catalog.octet_length(category_name.value) > 80
        )
        OR EXISTS (
          SELECT 1
          FROM pg_catalog.jsonb_array_elements(rule.value -> 'article_tokens') AS article_token(value)
          WHERE pg_catalog.jsonb_typeof(article_token.value) IS DISTINCT FROM 'string'
        )
        OR EXISTS (
          SELECT 1
          FROM pg_catalog.jsonb_array_elements_text(rule.value -> 'article_tokens') AS article_token(value)
          WHERE pg_catalog.btrim(article_token.value) = ''
            OR pg_catalog.octet_length(article_token.value) > 80
        )
    )
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(p_cluster_rules) AS rule(value)
        GROUP BY (rule.value ->> 'rule_order')::integer
        HAVING pg_catalog.count(*) > 1
      )
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(p_cluster_rules) AS rule(value)
        GROUP BY pg_catalog.lower(pg_catalog.btrim(rule.value ->> 'category_slug'))
        HAVING pg_catalog.count(*) > 1
      )
      OR NOT EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(p_cluster_rules) AS rule(value)
        WHERE pg_catalog.lower(pg_catalog.btrim(rule.value ->> 'category_slug')) = v_requested_category_slug
      )
    THEN
      RETURN;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN;
  END;

  BEGIN
    v_search_query := pg_catalog.websearch_to_tsquery(
      'pg_catalog.english'::pg_catalog.regconfig,
      v_query_text
    );
  EXCEPTION
    WHEN OTHERS THEN
      RETURN;
  END;

  IF v_search_query IS NULL OR pg_catalog.numnode(v_search_query) = 0 THEN
    RETURN;
  END IF;

  v_indexable_query_text := pg_catalog.querytree(v_search_query);
  IF v_indexable_query_text IS NULL
    OR v_indexable_query_text IN ('', 'T')
  THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.merchant_feature_settings AS settings
    WHERE settings.merchant_id = p_merchant_id
      AND settings.blog_enabled IS TRUE
  ) THEN
    RETURN;
  END IF;

  v_effective_limit := least(
    greatest(coalesce(p_limit, 64), 1),
    64
  );

  RETURN QUERY
  SELECT
    classified.post_slug,
    classified.post_title,
    classified.post_excerpt,
    classified.post_category,
    classified.post_tags,
    classified.post_keywords,
    classified.post_featured_image_url,
    classified.post_published_at,
    classified.post_reading_time_minutes
  FROM private.classify_storefront_cluster_guide_candidates_v1(
    p_merchant_id,
    p_cluster_rules,
    v_search_query,
    v_requested_category_slug,
    v_effective_limit
  ) AS classified;
END;
$function$;

ALTER FUNCTION public.get_storefront_cluster_guide_candidates_v1(
  uuid,
  text,
  jsonb,
  text,
  integer
) OWNER TO postgres;

COMMENT ON FUNCTION public.get_storefront_cluster_guide_candidates_v1(
  uuid,
  text,
  jsonb,
  text,
  integer
) IS
  'Returns at most 64 relevance-ranked public blog guide candidates for one merchant and requested semantic cluster. Uses exact-category hashing with a bounded substring fallback, validates the classifier payload, requires blog_enabled=true, and exposes no private settings fields.';

REVOKE ALL ON FUNCTION public.get_storefront_cluster_guide_candidates_v1(
  uuid,
  text,
  jsonb,
  text,
  integer
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_storefront_cluster_guide_candidates_v1(
  uuid,
  text,
  jsonb,
  text,
  integer
) TO anon, authenticated, service_role;

-- Retire the superseded helper overload after the public RPC uses the bounded one.
DROP FUNCTION IF EXISTS private.classify_storefront_cluster_guide_candidates_v1(uuid, jsonb, pg_catalog.tsquery);
