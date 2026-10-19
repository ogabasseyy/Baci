-- Disposable fixture assertions; never apply to a deployed database.
-- Requires the search fixture, a specifications jsonb column, and processor migration.
UPDATE public.products SET specifications='[{"items":[{"label":"Processor","value":"Intel Core i7-14650HX up to 5.2GHz"}]}]'::jsonb WHERE brand='Apple';
UPDATE public.products SET specifications='{"processor":"AMD Ryzen 5 5600H"}'::jsonb WHERE brand='Samsung';
UPDATE public.products SET specifications='{"processor":"Intel Core i9"}'::jsonb WHERE brand='Sold';
UPDATE public.products SET specifications='{"processor":"Intel Core i5"}'::jsonb WHERE name LIKE 'bulk tablet%';
SET ROLE anon;
DO $$
DECLARE f jsonb; n integer; total bigint;
BEGIN
 IF public.storefront_processor_family('[{"items":[{"label":"Chip","value":"Apple M5 Pro"}]}]') <> 'Apple M5' THEN RAISE EXCEPTION 'Apple chip'; END IF;
 IF public.storefront_processor_family('{"cpu":"Intel Core i5 or Core i7"}') IS NOT NULL THEN RAISE EXCEPTION 'ambiguous CPU'; END IF;
 IF public.storefront_processor_family('[{"items":"bad"}]') IS NOT NULL THEN RAISE EXCEPTION 'malformed specs'; END IF;
 f:=public.get_storefront_search_available_facets('phone','00000000-0000-4000-8000-000000000001');
 IF f->'processors' <> '["AMD Ryzen 5","Intel Core i7"]'::jsonb THEN RAISE EXCEPTION 'available processors: %',f; END IF;
 SELECT count(*),max(total_count) INTO n,total FROM public.search_storefront_products_processor_refined('phone','00000000-0000-4000-8000-000000000001',processor_filter=>'Intel Core i7');
 IF n<>1 OR total<>1 THEN RAISE EXCEPTION 'processor filtering/count'; END IF;
 SELECT count(*),max(total_count) INTO n,total FROM public.search_storefront_products_processor_refined('bulk tablet','00000000-0000-4000-8000-000000000001',processor_filter=>'Intel Core i5',result_limit=>20,result_offset=>100,sort_by=>'price_asc');
 IF n<>20 OR total<>130 THEN RAISE EXCEPTION 'processor global pagination'; END IF;
 SELECT count(*) INTO n FROM public.search_storefront_products_processor_refined('phone','00000000-0000-4000-8000-000000000002',processor_filter=>'Intel Core i7');
 IF n<>0 THEN RAISE EXCEPTION 'unpublished merchant'; END IF;
END $$;
RESET ROLE;
