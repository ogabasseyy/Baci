-- Disposable fixture only. Never apply to a deployed database.
-- Run after storefront_search_refinements_fixture.sql, before the available-facets migration.
CREATE TABLE public.categories(id uuid PRIMARY KEY, merchant_id uuid, name text, is_active boolean);
GRANT SELECT ON public.categories TO anon, authenticated;
INSERT INTO public.categories VALUES
 ('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000001','Phones',true),
 ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001','Unrelated',true);
UPDATE public.products SET category_id='00000000-0000-4000-8000-000000000020' WHERE name LIKE '%phone%';
UPDATE public.product_variants SET condition='uk_used' WHERE condition='used';
