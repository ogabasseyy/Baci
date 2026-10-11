-- Scope the selected-category facet set by category before precise pruning.
-- get_storefront_search_category_facets built its facet set from UNSCOPED
-- refined candidates: when the query has an exact name/SKU match in
-- category A but only fuzzy matches in the selected category B, the
-- helper's cross-category has_precise flag pruned B's fuzzy rows before
-- the available CTE applied category_id_param, so the facet RPC reported
-- no brands, processors, conditions, or price range for results the
-- sibling results RPC (which passes the category into the helper) still
-- returned. Build available from candidates scoped by category_id_param
-- instead, while the unscoped set keeps feeding the category switcher.

CREATE OR REPLACE FUNCTION public.get_storefront_search_category_facets(search_query text, merchant_id_param uuid, category_id_param uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
WITH scoped_matches AS MATERIALIZED (
  SELECT c.product_id FROM storefront_search_private.storefront_search_refined_candidates(search_query,merchant_id_param,NULL,category_id_param) c
), matches AS MATERIALIZED (
  SELECT c.product_id FROM storefront_search_private.storefront_search_refined_candidates(search_query,merchant_id_param) c
), all_available AS MATERIALIZED (
  SELECT p.id, p.brand, p.category_id, public.storefront_processor_family(p.specifications) AS processor, o.condition, o.effective_price
  FROM matches m JOIN public.products p ON p.id=m.product_id AND p.merchant_id=merchant_id_param
  CROSS JOIN LATERAL public.get_storefront_search_price_options(merchant_id_param,p.id) o
), available AS MATERIALIZED (
  SELECT p.id, p.brand, p.category_id, public.storefront_processor_family(p.specifications) AS processor, o.condition, o.effective_price
  FROM scoped_matches m JOIN public.products p ON p.id=m.product_id AND p.merchant_id=merchant_id_param
  CROSS JOIN LATERAL public.get_storefront_search_price_options(merchant_id_param,p.id) o
  WHERE p.category_id=category_id_param
), brands AS (
  SELECT DISTINCT brand FROM available WHERE brand IS NOT NULL AND btrim(brand)<>''
), categories AS (
  SELECT DISTINCT c.id,c.name FROM all_available a JOIN public.categories c ON c.id=a.category_id AND c.merchant_id=merchant_id_param WHERE c.is_active IS TRUE
), conditions AS (
  SELECT DISTINCT CASE condition WHEN 'uk_used' THEN 'used' WHEN 'refurbished' THEN 'open_box' ELSE condition END AS condition FROM available WHERE condition IN ('new','used','uk_used','open_box','refurbished')
)
SELECT jsonb_build_object(
 'processors',COALESCE((SELECT jsonb_agg(processor ORDER BY processor) FROM (SELECT DISTINCT processor FROM available WHERE processor IS NOT NULL) processors),'[]'::jsonb),
 'brands',COALESCE((SELECT jsonb_agg(brand ORDER BY brand) FROM brands),'[]'::jsonb),
 'categories',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name) FROM categories),'[]'::jsonb),
 'conditions',COALESCE((SELECT jsonb_agg(condition ORDER BY condition) FROM conditions),'[]'::jsonb),
 'minPrice',(SELECT min(effective_price) FROM available),
 'maxPrice',(SELECT max(effective_price) FROM available)
);
$$;

NOTIFY pgrst, 'reload schema';
