-- Keep the expensive classifier stages in a private helper so the public RPC
-- remains a small validation, authorization, and projection boundary.

CREATE OR REPLACE FUNCTION private.classify_storefront_cluster_guide_candidates_v1(
  p_merchant_id uuid,
  p_cluster_rules jsonb,
  p_search_query pg_catalog.tsquery,
  p_requested_category_slug text,
  p_effective_limit integer
)
RETURNS TABLE (
  post_slug text,
  post_title text,
  post_excerpt text,
  post_category text,
  post_tags text[],
  post_keywords text[],
  post_featured_image_url text,
  post_published_at timestamp with time zone,
  post_reading_time_minutes integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
ROWS 64
AS $function$
WITH cluster_rules AS MATERIALIZED (
  SELECT
    rule.rule_order,
    pg_catalog.lower(pg_catalog.btrim(rule.category_slug)) AS category_slug,
    rule.category_names,
    rule.article_tokens
  FROM pg_catalog.jsonb_to_recordset(p_cluster_rules) AS rule(
    rule_order integer,
    category_slug text,
    category_names text[],
    article_tokens text[]
  )
),
requested_terms AS MATERIALIZED (
  SELECT
    'category'::text AS term_kind,
    pg_catalog.lower(pg_catalog.btrim(category_name.value)) AS term
  FROM cluster_rules AS rule
  CROSS JOIN LATERAL pg_catalog.unnest(rule.category_names)
    AS category_name(value)
  WHERE rule.category_slug = p_requested_category_slug
  UNION ALL
  SELECT
    'semantic'::text,
    pg_catalog.lower(pg_catalog.btrim(article_token.value))
  FROM cluster_rules AS rule
  CROSS JOIN LATERAL pg_catalog.unnest(rule.article_tokens)
    AS article_token(value)
  WHERE rule.category_slug = p_requested_category_slug
),
matching_posts AS MATERIALIZED (
  SELECT
    post.slug AS post_slug,
    post.title AS post_title,
    post.excerpt AS post_excerpt,
    post.category AS post_category,
    post.tags AS post_tags,
    post.keywords AS post_keywords,
    post.featured_image_url AS post_featured_image_url,
    post.published_at AS post_published_at,
    post.reading_time_minutes AS post_reading_time_minutes,
    pg_catalog.lower(
      pg_catalog.btrim(coalesce(post.category, ''))
    ) AS explicit_category,
    pg_catalog.lower(
      pg_catalog.btrim(
        coalesce(post.title, '') || ' ' ||
        coalesce(post.excerpt, '') || ' ' ||
        coalesce(post.category, '') || ' ' ||
        coalesce(pg_catalog.array_to_string(post.tags, ' '), '') || ' ' ||
        coalesce(pg_catalog.array_to_string(post.keywords, ' '), '')
      )
    ) AS semantic_haystack,
    pg_catalog.ts_rank_cd(
      post.search_vector,
      p_search_query
    ) AS search_rank
  FROM public.blog_posts AS post
  WHERE post.merchant_id = p_merchant_id
    AND post.status = 'published'
    AND post.published_at IS NOT NULL
    AND pg_catalog.btrim(post.title) <> ''
    AND pg_catalog.btrim(post.slug) <> ''
    AND post.search_vector OPERATOR(pg_catalog.@@) p_search_query
    AND EXISTS (
      SELECT 1
      FROM requested_terms AS requested
      WHERE pg_catalog.strpos(
        CASE requested.term_kind
          WHEN 'category' THEN pg_catalog.lower(
            pg_catalog.btrim(coalesce(post.category, ''))
          )
          ELSE pg_catalog.lower(
            pg_catalog.btrim(
              coalesce(post.title, '') || ' ' ||
              coalesce(post.excerpt, '') || ' ' ||
              coalesce(post.category, '') || ' ' ||
              coalesce(pg_catalog.array_to_string(post.tags, ' '), '') || ' ' ||
              coalesce(pg_catalog.array_to_string(post.keywords, ' '), '')
            )
          )
        END,
        requested.term
      ) > 0
    )
),
rule_category_names AS MATERIALIZED (
  SELECT
    rule.rule_order,
    rule.category_slug,
    pg_catalog.lower(pg_catalog.btrim(category_name.value)) AS category_name,
    category_name.name_order
  FROM cluster_rules AS rule
  CROSS JOIN LATERAL pg_catalog.unnest(rule.category_names)
    WITH ORDINALITY AS category_name(value, name_order)
),
explicit_exact_matches AS MATERIALIZED (
  SELECT
    candidate.post_slug,
    category_name.category_slug,
    pg_catalog.row_number() OVER (
      PARTITION BY candidate.post_slug
      ORDER BY
        pg_catalog.char_length(category_name.category_name) DESC,
        category_name.rule_order ASC,
        category_name.name_order ASC
    ) AS match_order
  FROM matching_posts AS candidate
  JOIN rule_category_names AS category_name
    ON candidate.explicit_category = category_name.category_name
),
explicit_exact_winners AS MATERIALIZED (
  SELECT
    match.post_slug,
    match.category_slug
  FROM explicit_exact_matches AS match
  WHERE match.match_order = 1
),
explicit_fallback_matches AS MATERIALIZED (
  SELECT
    candidate.post_slug,
    category_name.category_slug,
    pg_catalog.row_number() OVER (
      PARTITION BY candidate.post_slug
      ORDER BY
        pg_catalog.char_length(category_name.category_name) DESC,
        category_name.rule_order ASC,
        category_name.name_order ASC
    ) AS match_order
  FROM matching_posts AS candidate
  CROSS JOIN rule_category_names AS category_name
  WHERE NOT EXISTS (
    SELECT 1
    FROM explicit_exact_winners AS exact_match
    WHERE exact_match.post_slug = candidate.post_slug
  )
    AND pg_catalog.strpos(
      candidate.explicit_category,
      category_name.category_name
    ) > 0
),
explicit_winners AS MATERIALIZED (
  SELECT
    exact_match.post_slug,
    exact_match.category_slug
  FROM explicit_exact_winners AS exact_match
  UNION ALL
  SELECT
    fallback_match.post_slug,
    fallback_match.category_slug
  FROM explicit_fallback_matches AS fallback_match
  WHERE fallback_match.match_order = 1
),
unclassified_posts AS MATERIALIZED (
  SELECT
    candidate.post_slug,
    candidate.post_title,
    candidate.post_excerpt,
    candidate.post_category,
    candidate.post_tags,
    candidate.post_keywords,
    candidate.post_featured_image_url,
    candidate.post_published_at,
    candidate.post_reading_time_minutes,
    candidate.explicit_category,
    candidate.semantic_haystack,
    candidate.search_rank
  FROM matching_posts AS candidate
  WHERE NOT EXISTS (
    SELECT 1
    FROM explicit_winners AS explicit_match
    WHERE explicit_match.post_slug = candidate.post_slug
  )
),
rule_tokens AS MATERIALIZED (
  SELECT
    rule.rule_order,
    rule.category_slug,
    pg_catalog.lower(pg_catalog.btrim(token.value)) AS token
  FROM cluster_rules AS rule
  CROSS JOIN LATERAL pg_catalog.unnest(rule.article_tokens) AS token(value)
),
inferred_scores AS MATERIALIZED (
  SELECT
    candidate.post_slug,
    rule_token.category_slug,
    rule_token.rule_order,
    pg_catalog.count(*)::integer AS token_score
  FROM unclassified_posts AS candidate
  JOIN rule_tokens AS rule_token
    ON pg_catalog.strpos(
      candidate.semantic_haystack,
      rule_token.token
    ) > 0
  GROUP BY
    candidate.post_slug,
    rule_token.category_slug,
    rule_token.rule_order
),
inferred_winners AS MATERIALIZED (
  SELECT
    ranked.post_slug,
    ranked.category_slug
  FROM (
    SELECT
      inferred_score.post_slug,
      inferred_score.category_slug,
      pg_catalog.row_number() OVER (
        PARTITION BY inferred_score.post_slug
        ORDER BY
          inferred_score.token_score DESC,
          inferred_score.rule_order ASC
      ) AS match_order
    FROM inferred_scores AS inferred_score
  ) AS ranked
  WHERE ranked.match_order = 1
),
classified_posts AS (
  SELECT
    candidate.post_slug,
    candidate.post_title,
    candidate.post_excerpt,
    candidate.post_category,
    candidate.post_tags,
    candidate.post_keywords,
    candidate.post_featured_image_url,
    candidate.post_published_at,
    candidate.post_reading_time_minutes,
    candidate.search_rank,
    coalesce(
      explicit_match.category_slug,
      inferred_match.category_slug
    ) AS inferred_category_slug
  FROM matching_posts AS candidate
  LEFT JOIN explicit_winners AS explicit_match
    ON explicit_match.post_slug = candidate.post_slug
  LEFT JOIN inferred_winners AS inferred_match
    ON inferred_match.post_slug = candidate.post_slug
    AND explicit_match.post_slug IS NULL
)
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
FROM classified_posts AS classified
WHERE classified.inferred_category_slug = p_requested_category_slug
ORDER BY
  classified.search_rank DESC,
  classified.post_published_at DESC,
  classified.post_slug ASC
LIMIT least(greatest(coalesce(p_effective_limit, 64), 1), 64);
$function$;

COMMENT ON FUNCTION private.classify_storefront_cluster_guide_candidates_v1(uuid, jsonb, pg_catalog.tsquery, text, integer) IS
  'Internal bounded classifier for one storefront guide category. The requested-category candidate filter, ranking, and cap stay inside the definer boundary; exact category values use a hash join and only unmatched posts use the substring fallback.';

ALTER FUNCTION private.classify_storefront_cluster_guide_candidates_v1(uuid, jsonb, pg_catalog.tsquery, text, integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION private.classify_storefront_cluster_guide_candidates_v1(uuid, jsonb, pg_catalog.tsquery, text, integer) FROM PUBLIC;

GRANT USAGE ON SCHEMA private TO postgres, service_role;

GRANT EXECUTE ON FUNCTION private.classify_storefront_cluster_guide_candidates_v1(uuid, jsonb, pg_catalog.tsquery, text, integer) TO postgres, service_role;
