-- Run with psql -v ON_ERROR_STOP=1 -f this file against an EMPTY disposable database.
\ir private_search_candidates_fixture.sql
\ir ../20261002090046_storefront_search_refinements.sql
\ir ../20261003230000_storefront_search_refinement_fixes.sql
\ir ../20261004150000_search_price_options_offer_scope_null_stock.sql
\ir ../20261003193000_storefront_processor_filters.sql
\ir ../20261003194500_storefront_category_facets.sql
\ir ../20261004193000_private_purchasable_search_candidates.sql

SET ROLE anon;
DO $$
DECLARE
  merchant uuid := '11111111-1111-4111-8111-111111111111';
  category uuid := '22222222-2222-4222-8222-222222222222';
  n bigint;
  total bigint;
  facets jsonb;
BEGIN
  SELECT count(*) INTO n FROM public.get_storefront_search_price_options(merchant,'77777777-7777-4777-8777-777777777771');
  IF n<>1 THEN RAISE EXCEPTION 'NULL manage_stock must be unmanaged'; END IF;
  SELECT count(*) INTO n FROM public.get_storefront_search_price_options(merchant,'77777777-7777-4777-8777-777777777772');
  IF n<>2 THEN RAISE EXCEPTION 'Independent base disappeared when condition offer exists'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.get_storefront_search_price_options(merchant,'77777777-7777-4777-8777-777777777772') WHERE variant_id IS NULL AND offer_id IS NULL AND effective_price=100) THEN
    RAISE EXCEPTION 'Base option identity/price changed';
  END IF;
  SELECT count(*) INTO n FROM public.get_storefront_search_price_options(merchant,'77777777-7777-4777-8777-777777777773');
  IF n<>1 OR EXISTS (SELECT 1 FROM public.get_storefront_search_price_options(merchant,'77777777-7777-4777-8777-777777777773') WHERE offer_id IS NOT NULL OR variant_id IS NULL OR effective_price<>250) THEN
    RAISE EXCEPTION 'Variant product leaked an unpurchasable standalone offer';
  END IF;
  IF to_regprocedure('public.storefront_search_refined_candidates(text,uuid,text[],uuid,text,numeric,numeric,double precision)') IS NOT NULL THEN
    RAISE EXCEPTION 'Unbounded candidates must not remain in the exposed schema';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid='storefront_search_private.storefront_search_refined_candidates(text,uuid,text[],uuid,text,numeric,numeric,double precision)'::regprocedure) THEN
    RAISE EXCEPTION 'Candidate helper must preserve caller RLS';
  END IF;
  IF has_table_privilege(current_user,'public.product_variants','SELECT') OR has_table_privilege(current_user,'public.product_offers','SELECT') THEN
    RAISE EXCEPTION 'Public search must work without protected inventory grants';
  END IF;
  SELECT count(*),min(total_count) INTO n,total FROM public.search_storefront_products_refined('fixture phone',merchant,result_limit=>1000);
  IF n<>100 OR total<>145 THEN RAISE EXCEPTION 'Expected bounded 100-row page and 145 purchasable matches: %, %',n,total; END IF;
  SELECT count(*),min(total_count) INTO n,total FROM public.search_storefront_products_refined('fixture phone',merchant,result_limit=>1000,result_offset=>100);
  IF n<>45 OR total<>145 THEN RAISE EXCEPTION 'Second page/count incorrect: %, %',n,total; END IF;
  SELECT count(*) INTO n FROM public.search_storefront_products_refined('fixture phone',merchant)
    WHERE product_id IN ('33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444');
  IF n<>0 THEN RAISE EXCEPTION 'Depleted base or missing required variant leaked'; END IF;
  SELECT count(*) INTO n FROM public.search_storefront_products_refined('fixture phone','55555555-5555-4555-8555-555555555555');
  IF n<>0 THEN RAISE EXCEPTION 'Unpublished tenant leaked'; END IF;
  SELECT count(*) INTO n FROM public.get_storefront_search_brands('fixture phone',merchant) WHERE brand='Apple';
  IF n<>1 THEN RAISE EXCEPTION 'Brand wrapper lost private helper access'; END IF;
  facets:=public.get_storefront_search_available_facets('fixture phone',merchant);
  IF facets->'brands' <> '["Apple"]'::jsonb OR facets->'conditions' <> '["new"]'::jsonb OR facets->>'minPrice'<>'100' THEN
    RAISE EXCEPTION 'Available facets incorrect: %',facets;
  END IF;
  facets:=public.get_storefront_search_category_facets('fixture phone',merchant,category);
  IF jsonb_array_length(facets->'categories')<>1 OR jsonb_array_length(facets->'processors')<>1 THEN
    RAISE EXCEPTION 'Category/processor facets incorrect: %',facets;
  END IF;
  SELECT count(*),min(total_count) INTO n,total FROM public.search_storefront_products_processor_refined('fixture phone',merchant,result_limit=>1000,processor_filter=>'Apple M1');
  IF n<>100 OR total<>145 THEN RAISE EXCEPTION 'Processor wrapper pagination incorrect: %, %',n,total; END IF;
END $$;
RESET ROLE;
