-- Regression test for archived filtering with legacy NULL product statuses.
-- The included migration is intentionally replayed to prove that a retry is a
-- no-op before the runtime behavior is exercised.

BEGIN;

\ir ../migrations/20260827100000_fix_search_products_not_archived_nulls.sql

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO public.merchants (id, email, business_name, slug)
VALUES (
  'a07f0000-0000-4000-8000-000000000101',
  'search-null-status@example.com',
  'Search NULL Status Fixture',
  'search-null-status-fixture'
);

INSERT INTO public.products (id, merchant_id, name, slug, price, status)
VALUES
  (
    'a07f0000-0000-4000-8000-000000000201',
    'a07f0000-0000-4000-8000-000000000101',
    'Legacy NULL Status Samsung Galaxy A07 4GB 128GB',
    'search-null-status-product',
    150800,
    NULL
  ),
  (
    'a07f0000-0000-4000-8000-000000000202',
    'a07f0000-0000-4000-8000-000000000101',
    'Archived Samsung Galaxy A07 4GB 128GB',
    'search-archived-product',
    150800,
    'archived'
  );

DO $regression$
DECLARE
  v_product_ids uuid[];
  v_total_count bigint;
BEGIN
  SELECT
    array_agg(result.product_id ORDER BY result.product_id),
    max(result.total_count)
  INTO v_product_ids, v_total_count
  FROM public.search_products_v2(
    search_query => 'Samsung Galaxy A07 4GB 128GB',
    merchant_id_param => 'a07f0000-0000-4000-8000-000000000101',
    result_limit => 20,
    result_offset => 0,
    status_filter => 'not_archived'
  ) AS result;

  IF v_product_ids IS DISTINCT FROM ARRAY[
    'a07f0000-0000-4000-8000-000000000201'::uuid
  ] OR v_total_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'not_archived search must retain NULL status and exclude archived rows: ids=%, total=%',
      v_product_ids, v_total_count;
  END IF;
END;
$regression$;

ROLLBACK;
