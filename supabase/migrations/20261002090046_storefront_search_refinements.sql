-- Additive public refinement contract. Existing search_products_v2 callers remain supported.
-- Ranking is SECURITY INVOKER under product RLS. Only published active products
-- have public offer-price projections; protected inventory/cost columns never leave SQL.
CREATE OR REPLACE FUNCTION public.get_storefront_search_price_options(p_merchant_id uuid, p_product_id uuid)
RETURNS TABLE(variant_id uuid, offer_id uuid, condition text, effective_price numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH parent AS MATERIALIZED (
    SELECT p.id, p.merchant_id, p.price, p.condition, p.manage_stock,
      p.stock, p.stock_quantity, p.inventory_tracking_policy, p.has_condition_offers, p.has_variants
    FROM public.products p JOIN public.merchants m ON m.id = p.merchant_id
    WHERE p.id = p_product_id AND p.merchant_id = p_merchant_id
      AND p.status = 'active' AND m.is_published IS TRUE
  ), variants AS MATERIALIZED (
    SELECT v.id, v.product_id, v.condition, v.price_override, v.stock_quantity,
      COALESCE(v.inventory_tracking_policy, p.inventory_tracking_policy, 'legacy') AS tracking
    FROM parent p JOIN public.product_variants v ON v.product_id = p.id AND v.merchant_id = p.merchant_id
    WHERE v.is_inventory_anchor IS NOT TRUE AND p.has_variants IS TRUE
  ), anchor_policy AS MATERIALIZED (
    SELECT p.id AS product_id,
      COALESCE(
        (SELECT CASE
           WHEN av.inventory_tracking_policy IN ('off', 'serialized_strict', 'serialized_then_unlimited')
           THEN av.inventory_tracking_policy END
         FROM public.product_variants av
         WHERE av.product_id = p.id AND av.merchant_id = p.merchant_id
           AND av.is_inventory_anchor IS TRUE
         ORDER BY av.id LIMIT 1),
        p.inventory_tracking_policy, 'legacy') AS effective_policy
    FROM parent p
  ), serialized AS MATERIALIZED (
    SELECT s.variant_id, s.public_available_units FROM parent p
    CROSS JOIN LATERAL public.get_public_serialized_variant_availability_counts(p.merchant_id, ARRAY[p.id]) s
    WHERE p.inventory_tracking_policy IN ('serialized_strict', 'serialized_then_unlimited')
       OR EXISTS (SELECT 1 FROM variants v WHERE v.tracking IN ('serialized_strict', 'serialized_then_unlimited'))
       OR EXISTS (SELECT 1 FROM anchor_policy a WHERE a.product_id = p.id AND a.effective_policy IN ('serialized_strict', 'serialized_then_unlimited'))
  ), offers AS MATERIALIZED (
    SELECT o.id, o.condition, o.price, o.stock_quantity
    FROM parent p JOIN public.product_offers o ON o.product_id = p.id AND o.merchant_id = p.merchant_id
    WHERE p.has_condition_offers IS TRUE AND o.status = 'active'
  )
  SELECT v.id, NULL::uuid, COALESCE(v.condition, p.condition, 'new'), COALESCE(v.price_override, p.price)
  FROM parent p CROSS JOIN variants v
  WHERE v.tracking = 'serialized_then_unlimited'
     OR (v.tracking = 'serialized_strict' AND EXISTS (SELECT 1 FROM serialized s WHERE s.variant_id = v.id AND s.public_available_units > 0))
     OR (v.tracking NOT IN ('serialized_strict', 'serialized_then_unlimited')
         AND (p.manage_stock IS FALSE OR COALESCE(v.stock_quantity, CASE WHEN COALESCE(p.stock_quantity,0)=0 AND COALESCE(p.stock,0)>0 THEN p.stock ELSE COALESCE(p.stock_quantity,p.stock,0) END) > 0))
  UNION ALL
  SELECT NULL::uuid, o.id, o.condition, o.price FROM parent p CROSS JOIN offers o
  WHERE NOT EXISTS (SELECT 1 FROM variants) AND (p.manage_stock IS FALSE OR COALESCE(o.stock_quantity, 0) > 0)
  UNION ALL
  SELECT NULL::uuid, NULL::uuid, COALESCE(p.condition, 'new'), p.price FROM parent p JOIN anchor_policy a ON a.product_id = p.id
  WHERE NOT EXISTS (SELECT 1 FROM variants) AND p.has_condition_offers IS NOT TRUE
    AND (a.effective_policy = 'serialized_then_unlimited'
      OR (a.effective_policy = 'serialized_strict' AND EXISTS (SELECT 1 FROM serialized s WHERE s.variant_id IS NULL AND s.public_available_units > 0))
      OR (a.effective_policy NOT IN ('serialized_strict', 'serialized_then_unlimited')
        AND (p.manage_stock IS FALSE OR CASE WHEN COALESCE(p.stock_quantity,0)=0 AND COALESCE(p.stock,0)>0 THEN p.stock ELSE COALESCE(p.stock_quantity,p.stock,0) END > 0)));
$$;
REVOKE ALL ON FUNCTION public.get_storefront_search_price_options(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_storefront_search_price_options(uuid, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.storefront_search_refined_candidates(
  search_query text, merchant_id_param uuid, brands_filter text[] DEFAULT NULL,
  category_id_filter uuid DEFAULT NULL, condition_filter text DEFAULT NULL,
  min_price_filter numeric DEFAULT NULL, max_price_filter numeric DEFAULT NULL,
  min_rating_filter double precision DEFAULT NULL
) RETURNS TABLE(product_id uuid, relevance real, effective_price numeric, matched_variant_id uuid,
  matched_offer_id uuid, matched_condition text, brand text, created_at timestamptz, view_count bigint)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, extensions AS $$
DECLARE
  raw_query text := lower(trim(COALESCE(search_query, '')));
  normalized_query text := public.normalize_product_search_text(search_query);
  compact_query text := public.compact_product_search_text(search_query);
  search_terms tsquery;
BEGIN
  IF normalized_query = '' OR compact_query = '' THEN RETURN; END IF;
  IF length(search_query) > 200 OR COALESCE(cardinality(brands_filter),0) > 50
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
    WHERE p.merchant_id = merchant_id_param AND p.status = 'active' AND m.is_published IS TRUE
      AND ((condition_filter IS NULL AND min_price_filter IS NULL AND max_price_filter IS NULL) OR matched.effective_price IS NOT NULL)
      AND (COALESCE(cardinality(brands_filter),0) = 0 OR p.brand = ANY(brands_filter))
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
REVOKE ALL ON FUNCTION public.storefront_search_refined_candidates(text,uuid,text[],uuid,text,numeric,numeric,double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storefront_search_refined_candidates(text,uuid,text[],uuid,text,numeric,numeric,double precision) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.search_storefront_products_refined(
  search_query text, merchant_id_param uuid, brands_filter text[] DEFAULT NULL,
  category_id_filter uuid DEFAULT NULL, condition_filter text DEFAULT NULL,
  min_price_filter numeric DEFAULT NULL, max_price_filter numeric DEFAULT NULL,
  min_rating_filter double precision DEFAULT NULL, sort_by text DEFAULT 'relevance',
  result_limit integer DEFAULT 20, result_offset integer DEFAULT 0
) RETURNS TABLE(product_id uuid,relevance real,total_count bigint,effective_price numeric,matched_variant_id uuid,matched_offer_id uuid,matched_condition text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT c.product_id,c.relevance,count(*) OVER (),c.effective_price,c.matched_variant_id,c.matched_offer_id,c.matched_condition
  FROM public.storefront_search_refined_candidates(search_query,merchant_id_param,brands_filter,category_id_filter,condition_filter,min_price_filter,max_price_filter,min_rating_filter) c
  ORDER BY CASE WHEN sort_by='price_asc' THEN c.effective_price END ASC NULLS LAST,
    CASE WHEN sort_by='price_desc' THEN c.effective_price END DESC NULLS LAST,
    CASE WHEN sort_by='popular' THEN c.view_count END DESC NULLS LAST,
    CASE WHEN sort_by='newest' THEN c.created_at END DESC NULLS LAST,
    c.relevance DESC,c.created_at DESC,c.product_id
  LIMIT LEAST(GREATEST(COALESCE(result_limit,20),1),100) OFFSET GREATEST(COALESCE(result_offset,0),0);
$$;
REVOKE ALL ON FUNCTION public.search_storefront_products_refined(text,uuid,text[],uuid,text,numeric,numeric,double precision,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_storefront_products_refined(text,uuid,text[],uuid,text,numeric,numeric,double precision,text,integer,integer) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_storefront_search_brands(
  search_query text, merchant_id_param uuid, category_id_filter uuid DEFAULT NULL,
  condition_filter text DEFAULT NULL, min_price_filter numeric DEFAULT NULL,
  max_price_filter numeric DEFAULT NULL, min_rating_filter double precision DEFAULT NULL
) RETURNS TABLE(brand text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT DISTINCT c.brand FROM public.storefront_search_refined_candidates(search_query,merchant_id_param,NULL,category_id_filter,condition_filter,min_price_filter,max_price_filter,min_rating_filter) c
  WHERE c.brand IS NOT NULL AND btrim(c.brand) <> '' ORDER BY c.brand;
$$;
REVOKE ALL ON FUNCTION public.get_storefront_search_brands(text,uuid,uuid,text,numeric,numeric,double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_storefront_search_brands(text,uuid,uuid,text,numeric,numeric,double precision) TO anon,authenticated;
