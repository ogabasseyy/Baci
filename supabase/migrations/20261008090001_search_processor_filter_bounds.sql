-- Append-only: reject unusable processor filters before the candidate search.
-- The processor-refined endpoint is anonymous-reachable; a null, blank, or
-- overlong filter previously ran the complete candidate search and
-- per-product processor extraction before returning no rows. The bound
-- mirrors the application criteria schema (trimmed, min 1, max 80).
BEGIN;

CREATE OR REPLACE FUNCTION public.search_storefront_products_processor_refined(
  search_query text, merchant_id_param uuid, brands_filter text[] DEFAULT NULL,
  category_id_filter uuid DEFAULT NULL, condition_filter text DEFAULT NULL,
  min_price_filter numeric DEFAULT NULL, max_price_filter numeric DEFAULT NULL,
  min_rating_filter double precision DEFAULT NULL, sort_by text DEFAULT 'relevance',
  result_limit integer DEFAULT 20, result_offset integer DEFAULT 0, processor_filter text DEFAULT NULL
) RETURNS TABLE(product_id uuid,relevance real,total_count bigint,effective_price numeric,matched_variant_id uuid,matched_offer_id uuid,matched_condition text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  -- Validate before invoking the candidate query, not after materialization.
  IF COALESCE(result_offset,0) > 1980 THEN
    RAISE EXCEPTION 'invalid_search_offset' USING ERRCODE = '22023';
  END IF;
  IF processor_filter IS NULL OR btrim(processor_filter) = '' OR char_length(processor_filter) > 80 THEN
    RAISE EXCEPTION 'invalid_processor_filter' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT c.product_id,c.relevance,count(*) OVER (),c.effective_price,c.matched_variant_id,c.matched_offer_id,c.matched_condition
  FROM storefront_search_private.storefront_search_refined_candidates(search_query,merchant_id_param,brands_filter,category_id_filter,condition_filter,min_price_filter,max_price_filter,min_rating_filter) c
  JOIN public.products p ON p.id=c.product_id AND p.merchant_id=merchant_id_param
  WHERE public.storefront_processor_family(p.specifications)=processor_filter
    AND EXISTS (SELECT 1 FROM public.get_storefront_search_price_options(merchant_id_param,p.id))
  ORDER BY CASE WHEN sort_by='price_asc' THEN c.effective_price END ASC NULLS LAST,
    CASE WHEN sort_by='price_desc' THEN c.effective_price END DESC NULLS LAST,
    CASE WHEN sort_by='popular' THEN c.view_count END DESC NULLS LAST,
    CASE WHEN sort_by='newest' THEN c.created_at END DESC NULLS LAST,
    c.relevance DESC,c.created_at DESC,c.product_id
  LIMIT LEAST(GREATEST(COALESCE(result_limit,20),1),100) OFFSET GREATEST(COALESCE(result_offset,0),0);
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
