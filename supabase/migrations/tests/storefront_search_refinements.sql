-- Run in a disposable database after the refinement migration and fixture setup.
DO $$
DECLARE n bigint; p numeric; v uuid;
BEGIN
  IF current_user NOT IN ('anon','authenticated') THEN RAISE EXCEPTION 'Run fixtures under anon or authenticated to exercise public RLS'; END IF;
  SELECT count(*) INTO n FROM public.search_storefront_products_refined('phone','00000000-0000-4000-8000-000000000001',ARRAY['Apple','Samsung']);
  IF n <> 2 THEN RAISE EXCEPTION 'two brands should return two products, got %',n; END IF;
  SELECT count(*) INTO n FROM public.search_storefront_products_refined('phone','00000000-0000-4000-8000-000000000001',NULL,NULL,'new',NULL,250000);
  IF n <> 1 THEN RAISE EXCEPTION 'condition and price must match the same variant, got %',n; END IF;
  SELECT effective_price,matched_variant_id INTO p,v FROM public.search_storefront_products_refined('phone','00000000-0000-4000-8000-000000000001',ARRAY['Apple'],NULL,'used',NULL,250000);
  IF p <> 200000 OR v <> '00000000-0000-4000-8000-000000000011' THEN RAISE EXCEPTION 'matching variant projection incorrect'; END IF;
  SELECT count(*) INTO n FROM public.search_storefront_products_refined('phone','00000000-0000-4000-8000-000000000002');
  IF n <> 0 THEN RAISE EXCEPTION 'unpublished merchant leaked'; END IF;
  SELECT count(*) INTO n FROM public.search_storefront_products_refined('phone','00000000-0000-4000-8000-000000000001',NULL,NULL,NULL,NULL,0);
  IF n <> 0 THEN RAISE EXCEPTION 'explicit zero bound must not be dropped'; END IF;
  SELECT count(*) INTO n FROM public.get_storefront_search_brands('phone','00000000-0000-4000-8000-000000000001');
  IF n <> 2 THEN RAISE EXCEPTION 'facet brands incorrect'; END IF;
  SELECT count(*) INTO n FROM public.search_storefront_products_refined('sold phone','00000000-0000-4000-8000-000000000001',ARRAY['Sold']);
  IF n <> 0 THEN RAISE EXCEPTION 'unrefined sold-out product must be excluded'; END IF;
  SELECT count(*) INTO n FROM public.search_storefront_products_refined('sold phone','00000000-0000-4000-8000-000000000001',ARRAY['Sold'],NULL,NULL,1,500000);
  IF n <> 0 THEN RAISE EXCEPTION 'sold-out product has no purchasable matching price'; END IF;
END $$;
DO $$
DECLARE n bigint; p numeric; total bigint;
BEGIN
  SELECT count(*) INTO n FROM public.get_storefront_search_brands('bulk tablet','00000000-0000-4000-8000-000000000001');
  IF n <> 130 THEN RAISE EXCEPTION 'facets must include brands after first 100 results'; END IF;
  SELECT effective_price,total_count INTO p,total FROM public.search_storefront_products_refined('bulk tablet','00000000-0000-4000-8000-000000000001',NULL,NULL,'new',0,NULL,NULL,'price_asc',1,100);
  IF p <> 101000 OR total <> 130 THEN RAISE EXCEPTION 'global price sort, stock drift, or pagination incorrect: %, %',p,total; END IF;
  SELECT effective_price INTO p FROM public.search_storefront_products_refined('bulk tablet','00000000-0000-4000-8000-000000000001',NULL,NULL,NULL,NULL,NULL,NULL,'price_desc',1,0);
  IF p <> 130000 THEN RAISE EXCEPTION 'descending price sort incorrect'; END IF;
  SELECT count(*) INTO n FROM public.search_storefront_products_refined('bulk tablet','00000000-0000-4000-8000-000000000001',ARRAY['Brand 1','Brand 130']);
  IF n <> 2 THEN RAISE EXCEPTION 'multi-brand OR across pages incorrect'; END IF;
  IF has_table_privilege(current_user,'public.product_variants','SELECT') OR has_table_privilege(current_user,'public.product_offers','SELECT') THEN RAISE EXCEPTION 'fixture must test without protected table grants'; END IF;
END $$;
DO $$
DECLARE p numeric; n bigint;
BEGIN
  SELECT effective_price INTO p FROM public.search_storefront_products_refined('serial device','00000000-0000-4000-8000-000000000001',ARRAY['Serial'],NULL,'used',NULL,250);
  IF p IS DISTINCT FROM 200 THEN RAISE EXCEPTION 'serialized purchasable unit missing'; END IF;
  SELECT count(*) INTO n FROM public.search_storefront_products_refined('serial device','00000000-0000-4000-8000-000000000001',ARRAY['Serial'],NULL,'new',NULL,250);
  IF n <> 0 THEN RAISE EXCEPTION 'stale serialized stock must not produce a purchasable match'; END IF;
END $$;
