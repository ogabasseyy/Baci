-- Disposable fixture only; requires the processor fixture assertions.
UPDATE public.products SET category_id='00000000-0000-4000-8000-000000000021' WHERE brand='Samsung';
SET ROLE anon;
DO $$ DECLARE f jsonb; BEGIN
 f:=public.get_storefront_search_category_facets('phone','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000020');
 IF f->'processors' <> '["Intel Core i7"]'::jsonb OR f->'brands' <> '["Apple"]'::jsonb THEN RAISE EXCEPTION 'category facets leaked other type: %',f; END IF;
 IF jsonb_array_length(f->'categories') <> 2 THEN RAISE EXCEPTION 'category switch choices lost: %',f; END IF;
END $$;
RESET ROLE;
