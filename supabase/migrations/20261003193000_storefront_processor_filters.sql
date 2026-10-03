-- Normalize only explicit CPU/Chip metadata. Unknown and ambiguous families stay unset.
CREATE FUNCTION public.storefront_processor_family(specifications jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
WITH items AS (
 SELECT item->>'label' AS label,item->>'value' AS value
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(specifications)='array' THEN specifications ELSE '[]'::jsonb END) section
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(section->'items')='array' THEN section->'items' ELSE '[]'::jsonb END) item
 UNION ALL
 SELECT key,value FROM jsonb_each_text(CASE WHEN jsonb_typeof(specifications)='object' THEN specifications ELSE '{}'::jsonb END)
), raw AS (
 SELECT lower(value) AS value FROM items WHERE lower(label) IN ('processor','cpu','chip')
), families AS (
 SELECT DISTINCT CASE
  WHEN m[1] LIKE 'core i%' THEN 'Intel Core '||substring(m[1] FROM 6)
  WHEN m[1] LIKE 'ryzen %' THEN 'AMD '||initcap(m[1])
  WHEN m[1] LIKE 'apple m%' THEN 'Apple '||upper(substring(m[1] FROM 7))
  WHEN m[1] LIKE 'core ultra %' THEN 'Intel '||initcap(m[1])
  ELSE initcap(m[1]) END AS family
 FROM raw CROSS JOIN LATERAL regexp_matches(value,'(core ultra [579]|core i[3579]|ryzen [3579]|apple m[1-9][0-9]*|snapdragon x (?:elite|plus)|intel celeron|intel pentium)','g') m
)
SELECT CASE WHEN count(*)=1 THEN min(family) END FROM families;
$$;
REVOKE ALL ON FUNCTION public.storefront_processor_family(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storefront_processor_family(jsonb) TO anon,authenticated;

-- Reuse the established search ranking and safe, stock-aware option projection.
CREATE OR REPLACE FUNCTION public.get_storefront_search_available_facets(search_query text, merchant_id_param uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
WITH matches AS MATERIALIZED (
  SELECT c.product_id FROM public.storefront_search_refined_candidates(search_query,merchant_id_param) c
), available AS MATERIALIZED (
  SELECT p.id, p.brand, p.category_id, public.storefront_processor_family(p.specifications) AS processor, o.condition, o.effective_price
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
 'processors',COALESCE((SELECT jsonb_agg(processor ORDER BY processor) FROM (SELECT DISTINCT processor FROM available WHERE processor IS NOT NULL) processors),'[]'::jsonb),
 'brands',COALESCE((SELECT jsonb_agg(brand ORDER BY brand) FROM brands),'[]'::jsonb),
 'categories',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name) FROM categories),'[]'::jsonb),
 'conditions',COALESCE((SELECT jsonb_agg(condition ORDER BY condition) FROM conditions),'[]'::jsonb),
 'minPrice',(SELECT min(effective_price) FROM available),
 'maxPrice',(SELECT max(effective_price) FROM available)
);
$$;
REVOKE ALL ON FUNCTION public.get_storefront_search_available_facets(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_storefront_search_available_facets(text,uuid) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.search_storefront_products_processor_refined(
  search_query text, merchant_id_param uuid, brands_filter text[] DEFAULT NULL,
  category_id_filter uuid DEFAULT NULL, condition_filter text DEFAULT NULL,
  min_price_filter numeric DEFAULT NULL, max_price_filter numeric DEFAULT NULL,
  min_rating_filter double precision DEFAULT NULL, sort_by text DEFAULT 'relevance',
  result_limit integer DEFAULT 20, result_offset integer DEFAULT 0, processor_filter text DEFAULT NULL
) RETURNS TABLE(product_id uuid,relevance real,total_count bigint,effective_price numeric,matched_variant_id uuid,matched_offer_id uuid,matched_condition text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT c.product_id,c.relevance,count(*) OVER (),c.effective_price,c.matched_variant_id,c.matched_offer_id,c.matched_condition
  FROM public.storefront_search_refined_candidates(search_query,merchant_id_param,brands_filter,category_id_filter,condition_filter,min_price_filter,max_price_filter,min_rating_filter) c
  JOIN public.products p ON p.id=c.product_id AND p.merchant_id=merchant_id_param
  WHERE public.storefront_processor_family(p.specifications)=processor_filter
    AND EXISTS (SELECT 1 FROM public.get_storefront_search_price_options(merchant_id_param,p.id))
  ORDER BY CASE WHEN sort_by='price_asc' THEN c.effective_price END ASC NULLS LAST,
    CASE WHEN sort_by='price_desc' THEN c.effective_price END DESC NULLS LAST,
    CASE WHEN sort_by='popular' THEN c.view_count END DESC NULLS LAST,
    CASE WHEN sort_by='newest' THEN c.created_at END DESC NULLS LAST,
    c.relevance DESC,c.created_at DESC,c.product_id
  LIMIT LEAST(GREATEST(COALESCE(result_limit,20),1),100) OFFSET GREATEST(COALESCE(result_offset,0),0);
$$;
REVOKE ALL ON FUNCTION public.search_storefront_products_processor_refined(text,uuid,text[],uuid,text,numeric,numeric,double precision,text,integer,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_storefront_products_processor_refined(text,uuid,text[],uuid,text,numeric,numeric,double precision,text,integer,integer,text) TO anon,authenticated;
