-- psql -v ON_ERROR_STOP=1 -f this file against an EMPTY disposable database.
\ir private_search_candidates.sql
\ir ../20261004210000_bounded_refined_search_offsets.sql
SET ROLE anon;
DO $$
DECLARE
  merchant uuid := '11111111-1111-4111-8111-111111111111';
  invalid_offset integer;
  n bigint;
BEGIN
  FOREACH invalid_offset IN ARRAY ARRAY[1981,2147483647] LOOP
    BEGIN
      -- The bad query would fail differently if candidates were invoked first.
      PERFORM * FROM public.search_storefront_products_refined(repeat('x',201),merchant,result_offset=>invalid_offset);
      RAISE EXCEPTION 'Expected standard RPC offset rejection';
    EXCEPTION WHEN invalid_parameter_value THEN
      IF SQLERRM<>'invalid_search_offset' THEN RAISE EXCEPTION 'Offset was not rejected before candidate work: %',SQLERRM; END IF;
    END;
    BEGIN
      PERFORM * FROM public.search_storefront_products_processor_refined(repeat('x',201),merchant,result_offset=>invalid_offset,processor_filter=>'Apple M1');
      RAISE EXCEPTION 'Expected processor RPC offset rejection';
    EXCEPTION WHEN invalid_parameter_value THEN
      IF SQLERRM<>'invalid_search_offset' THEN RAISE EXCEPTION 'Processor offset was not rejected before candidate work: %',SQLERRM; END IF;
    END;
  END LOOP;
  -- Boundary is accepted, even when this small fixture has no rows that deep.
  PERFORM * FROM public.search_storefront_products_refined('fixture phone',merchant,result_offset=>1980);
  PERFORM * FROM public.search_storefront_products_processor_refined('fixture phone',merchant,result_offset=>1980,processor_filter=>'Apple M1');
  SELECT count(*) INTO n FROM public.search_storefront_products_refined('fixture phone',merchant,result_limit=>5,result_offset=>NULL);
  IF n<>5 THEN RAISE EXCEPTION 'NULL offset must preserve the first page'; END IF;
  SELECT count(*) INTO n FROM public.search_storefront_products_processor_refined('fixture phone',merchant,result_limit=>5,result_offset=>-1,processor_filter=>'Apple M1');
  IF n<>5 THEN RAISE EXCEPTION 'Negative offset must preserve first-page clamping'; END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid='public.search_storefront_products_refined(text,uuid,text[],uuid,text,numeric,numeric,double precision,text,integer,integer)'::regprocedure) THEN
    RAISE EXCEPTION 'Bounded search must remain SECURITY INVOKER';
  END IF;
END $$;
RESET ROLE;
