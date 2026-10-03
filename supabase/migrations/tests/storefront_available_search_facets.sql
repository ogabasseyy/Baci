-- Disposable regression assertions only. Never apply to a deployed database.
-- Run after both refinement migrations and their disposable fixtures.
SET ROLE anon;
DO $$
DECLARE f jsonb;
BEGIN
 f := public.get_storefront_search_available_facets('phone','00000000-0000-4000-8000-000000000001');
 IF f->'brands' <> '["Apple","Samsung"]'::jsonb THEN RAISE EXCEPTION 'query/stock/tenant brands: %',f; END IF;
 IF f->'conditions' <> '["new","used"]'::jsonb THEN RAISE EXCEPTION 'condition aliases: %',f; END IF;
 IF f->'categories' <> '[{"id":"00000000-0000-4000-8000-000000000020","name":"Phones"}]'::jsonb THEN RAISE EXCEPTION 'unrelated categories: %',f; END IF;
 IF (f->>'minPrice')::numeric <> 100000 OR (f->>'maxPrice')::numeric <> 500000 THEN RAISE EXCEPTION 'prices: %',f; END IF;
 f := public.get_storefront_search_available_facets('bulk tablet','00000000-0000-4000-8000-000000000001');
 IF jsonb_array_length(f->'brands') <> 130 THEN RAISE EXCEPTION 'facet pagination truncation: %',f; END IF;
 f := public.get_storefront_search_available_facets('not-in-any-product-xyz','00000000-0000-4000-8000-000000000001');
 IF f->'brands' <> '[]'::jsonb OR f->'conditions' <> '[]'::jsonb OR f->'categories' <> '[]'::jsonb OR f->>'minPrice' IS NOT NULL THEN RAISE EXCEPTION 'empty facets: %',f; END IF;
 f := public.get_storefront_search_available_facets('phone','00000000-0000-4000-8000-000000000002');
 IF f->'brands' <> '[]'::jsonb THEN RAISE EXCEPTION 'unpublished merchant: %',f; END IF;
END $$;
RESET ROLE;
