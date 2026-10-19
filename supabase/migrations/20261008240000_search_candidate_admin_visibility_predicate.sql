-- Append-only: stop reading the anon-revoked merchants.is_platform_admin column
-- from the SECURITY INVOKER refined-candidates function.
--
-- Anon containment (20260713150000 + 20260713160000) explicitly withholds
-- SELECT on merchants.is_platform_admin ("do NOT grant"). The refined-search
-- chain (search_storefront_products_refined + facet wrappers, all SECURITY
-- INVOKER under caller RLS) therefore raised 42501 for anonymous shoppers
-- once 20261008150000 inlined the published-or-platform-admin predicate here,
-- even for ordinary published merchants.
--
-- Fix: encapsulate the one-bit visibility check in a STABLE SECURITY DEFINER
-- predicate with an empty search_path, granted only to anon/authenticated.
-- The bit is already publicly inferable (established DEFINER projections
-- expose unpublished platform-admin stores' products; is_published itself is
-- anon-readable), so this discloses nothing new. Caller RLS is otherwise
-- preserved: only the predicate runs as the owner.
BEGIN;

CREATE OR REPLACE FUNCTION storefront_search_private.is_search_visible_merchant(p_merchant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(m.is_published, FALSE) IS TRUE OR COALESCE(m.is_platform_admin, FALSE) IS TRUE
  FROM public.merchants m WHERE m.id = p_merchant_id;
$$;

REVOKE ALL ON FUNCTION storefront_search_private.is_search_visible_merchant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION storefront_search_private.is_search_visible_merchant(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION storefront_search_private.storefront_search_refined_candidates(
  search_query text, merchant_id_param uuid, brands_filter text[] DEFAULT NULL,
  category_id_filter uuid DEFAULT NULL, condition_filter text DEFAULT NULL,
  min_price_filter numeric DEFAULT NULL, max_price_filter numeric DEFAULT NULL,
  min_rating_filter double precision DEFAULT NULL
) RETURNS TABLE(product_id uuid, relevance real, effective_price numeric, matched_variant_id uuid,
  matched_offer_id uuid, matched_condition text, brand text, created_at timestamptz, view_count bigint)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, extensions AS $$
DECLARE
  raw_query text;
  normalized_query text;
  compact_query text;
  search_terms tsquery;
BEGIN
  IF length(search_query) > 200 THEN
    RAISE EXCEPTION 'invalid_search_filters' USING ERRCODE = '22023';
  END IF;
  raw_query := lower(trim(COALESCE(search_query, '')));
  normalized_query := public.normalize_product_search_text(search_query);
  compact_query := public.compact_product_search_text(search_query);
  IF normalized_query = '' OR compact_query = '' THEN RETURN; END IF;
  IF COALESCE(cardinality(brands_filter),0) > 50
    OR min_price_filter < 0 OR max_price_filter < 0 OR min_price_filter > max_price_filter
    OR min_price_filter::text IN ('NaN','Infinity','-Infinity') OR max_price_filter::text IN ('NaN','Infinity','-Infinity')
    OR min_rating_filter < 0 OR min_rating_filter > 5 OR min_rating_filter::text IN ('NaN','Infinity','-Infinity')
    OR (condition_filter IS NOT NULL AND condition_filter NOT IN ('new','used','open_box'))
    OR EXISTS (SELECT 1 FROM unnest(brands_filter) b WHERE b IS NULL OR length(btrim(b)) = 0 OR length(b) > 160)
  THEN RAISE EXCEPTION 'invalid_search_filters' USING ERRCODE = '22023'; END IF;
  search_terms := websearch_to_tsquery('simple', normalized_query);
  PERFORM set_config('pg_trgm.similarity_threshold','0.15',true);
  RETURN QUERY
  WITH filtered_products AS MATERIALIZED (
    SELECT p.id, p.brand, p.category, matched.effective_price AS price,
      matched.variant_id, matched.offer_id, matched.condition AS matched_condition,
      p.manage_stock, p.stock_quantity, p.view_count, p.created_at,
      p.search_name_norm AS normalized_name, p.search_name_compact AS compact_name,
      p.search_doc_vector AS search_vector, lower(COALESCE(p.sku,'')) AS normalized_sku,
      (p.search_name_norm LIKE '%' || normalized_query || '%' OR p.search_name_compact LIKE '%' || compact_query || '%'
        OR p.search_identify_vector @@ search_terms) AS is_precise
    FROM public.products p JOIN public.merchants m ON m.id = p.merchant_id
    LEFT JOIN LATERAL (
      SELECT opt.variant_id, opt.offer_id, opt.condition, opt.effective_price
      FROM public.get_storefront_search_price_options(p.merchant_id, p.id) opt
      WHERE (condition_filter IS NULL OR opt.condition = ANY(CASE condition_filter WHEN 'used' THEN ARRAY['used','uk_used'] WHEN 'open_box' THEN ARRAY['open_box','refurbished'] ELSE ARRAY[condition_filter] END))
        AND (min_price_filter IS NULL OR opt.effective_price >= min_price_filter)
        AND (max_price_filter IS NULL OR opt.effective_price <= max_price_filter)
      ORDER BY opt.effective_price ASC NULLS LAST, opt.variant_id NULLS LAST, opt.offer_id NULLS LAST LIMIT 1
    ) matched ON true
    WHERE p.merchant_id = merchant_id_param AND p.status = 'active' AND storefront_search_private.is_search_visible_merchant(m.id)
      AND matched.effective_price IS NOT NULL
      AND (COALESCE(cardinality(brands_filter),0) = 0 OR EXISTS (
        SELECT 1 FROM unnest(brands_filter) AS filter_brand
        WHERE lower(btrim(filter_brand)) = lower(btrim(COALESCE(p.brand, '')))
      ))
      AND (category_id_filter IS NULL OR p.category_id = category_id_filter)
      AND (min_rating_filter IS NULL OR COALESCE(p.average_rating,0) >= min_rating_filter)
      AND (p.search_name_norm LIKE '%' || normalized_query || '%' OR p.search_name_compact LIKE '%' || compact_query || '%'
        OR p.search_doc_vector @@ search_terms
        OR (p.search_name_norm % normalized_query AND similarity(p.search_name_norm,normalized_query) >= CASE WHEN char_length(compact_query) >= 10 THEN 0.18 ELSE 0.28 END)
        OR (p.search_name_compact % compact_query AND similarity(p.search_name_compact,compact_query) >= CASE WHEN char_length(compact_query) >= 10 THEN 0.20 ELSE 0.30 END)
        OR (lower(COALESCE(p.sku,'')) <> '' AND lower(COALESCE(p.sku,'')) % raw_query AND similarity(lower(COALESCE(p.sku,'')),raw_query) >= 0.25))
  ), has_precise AS (SELECT EXISTS (SELECT 1 FROM filtered_products WHERE is_precise) AS flag),
  ranked AS (
    SELECT fp.id AS product_id,
      (
        CASE
          WHEN fp.normalized_sku <> '' AND fp.normalized_sku = raw_query THEN 10
          ELSE 0
        END
        + CASE
          WHEN fp.normalized_name = normalized_query OR fp.compact_name = compact_query THEN 8
          ELSE 0
        END
        + CASE
          WHEN fp.normalized_name LIKE normalized_query || '%'
            OR fp.compact_name LIKE compact_query || '%' THEN 3.5
          ELSE 0
        END
        + CASE
          WHEN fp.normalized_name LIKE '%' || normalized_query || '%'
            OR fp.compact_name LIKE '%' || compact_query || '%' THEN 1.8
          ELSE 0
        END
        + CASE
          WHEN fp.brand IS NOT NULL
            AND public.normalize_product_search_text(fp.brand) = normalized_query THEN 1.6
          ELSE 0
        END
        + CASE
          WHEN fp.category IS NOT NULL
            AND public.normalize_product_search_text(fp.category) = normalized_query THEN 1.2
          ELSE 0
        END
        + GREATEST(
          similarity(fp.normalized_name, normalized_query),
          similarity(fp.compact_name, compact_query)
        ) * 3.2
        + CASE
          WHEN fp.normalized_sku <> '' THEN similarity(fp.normalized_sku, raw_query) * 2.2
          ELSE 0
        END
        + coalesce(ts_rank_cd(fp.search_vector, search_terms), 0) * 4.0
        + CASE
          WHEN fp.manage_stock IS FALSE
            OR coalesce(fp.stock_quantity, 0) > 0 THEN 0.12
          ELSE 0
        END
        + LN(GREATEST(coalesce(fp.view_count, 0), 0) + 1) * 0.05
      )::REAL AS relevance,
      fp.price, fp.variant_id, fp.offer_id, fp.matched_condition, fp.brand, fp.created_at, COALESCE(fp.view_count,0)::bigint AS view_count
    FROM filtered_products fp CROSS JOIN has_precise hp WHERE fp.is_precise OR NOT hp.flag
  )
  SELECT r.product_id, r.relevance, r.price, r.variant_id, r.offer_id, r.matched_condition, r.brand, r.created_at, r.view_count
  FROM ranked r WHERE r.relevance > 0.2;
END;
$$;

COMMIT;
