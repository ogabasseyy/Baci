-- Reuse the established search ranking and safe, stock-aware option projection.
CREATE FUNCTION public.get_storefront_search_available_facets(search_query text, merchant_id_param uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
WITH matches AS MATERIALIZED (
  SELECT c.product_id FROM public.storefront_search_refined_candidates(search_query,merchant_id_param) c
), available AS MATERIALIZED (
  SELECT p.id, p.brand, p.category_id, o.condition, o.effective_price
  FROM matches m JOIN public.products p ON p.id=m.product_id AND p.merchant_id=merchant_id_param
  CROSS JOIN LATERAL public.get_storefront_search_price_options(merchant_id_param,p.id) o
), brands AS (
  SELECT DISTINCT brand FROM available WHERE brand IS NOT NULL AND btrim(brand)<>''
), categories AS (
  SELECT DISTINCT c.id,c.name FROM available a JOIN public.categories c ON c.id=a.category_id AND c.merchant_id=merchant_id_param WHERE c.is_active IS TRUE
), conditions AS (
  SELECT DISTINCT CASE condition WHEN 'uk_used' THEN 'used' WHEN 'refurbished' THEN 'open_box' ELSE condition END AS condition FROM available WHERE condition IN ('new','used','uk_used','open_box','refurbished')
)
SELECT jsonb_build_object(
 'brands',COALESCE((SELECT jsonb_agg(brand ORDER BY brand) FROM brands),'[]'::jsonb),
 'categories',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name) FROM categories),'[]'::jsonb),
 'conditions',COALESCE((SELECT jsonb_agg(condition ORDER BY condition) FROM conditions),'[]'::jsonb),
 'minPrice',(SELECT min(effective_price) FROM available),
 'maxPrice',(SELECT max(effective_price) FROM available)
);
$$;
REVOKE ALL ON FUNCTION public.get_storefront_search_available_facets(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_storefront_search_available_facets(text,uuid) TO anon,authenticated;
