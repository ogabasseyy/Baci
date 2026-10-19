-- Variant recall input bounds: over-long scalars and over-cap/count
-- payloads reject before the query; worst-case valid payloads pass.
BEGIN;
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO public.merchants (id, email, business_name, slug, is_published)
VALUES (
  'cb58d110-0000-4000-8000-000000000503',
  'condition-test@example.test',
  'Condition Test Merchant',
  'condition-test-merchant',
  true
);

SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'anon', true);

DO $$
DECLARE
  recall_ids uuid[];
BEGIN
  IF current_user <> 'anon' THEN
    RAISE EXCEPTION 'RPC regression must run as the public caller';
  END IF;
  -- Scalar filters beyond the public schema limits reject before the query.
  BEGIN
    PERFORM * FROM public.search_product_variant_recall(
      p_merchant_id => 'cb58d110-0000-4000-8000-000000000503',
      p_brand => repeat('b', 51));
    RAISE EXCEPTION 'over-long brand filters must be rejected';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.search_product_variant_recall(
      p_merchant_id => 'cb58d110-0000-4000-8000-000000000503',
      p_category => repeat('c', 51));
    RAISE EXCEPTION 'over-long category filters must be rejected';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.search_product_variant_recall(
      p_merchant_id => 'cb58d110-0000-4000-8000-000000000503',
      p_condition => repeat('n', 51));
    RAISE EXCEPTION 'over-long condition filters must be rejected';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  -- Worst-case valid payloads stay retrievable: schema-max counts with
  -- fully-escaped values (~33KB of filters, ~39KB of identity) must not
  -- trip the byte caps (a bare call raises on rejection, failing the suite).
  SELECT array_agg(product_id) INTO recall_ids
  FROM public.search_product_variant_recall(
    p_merchant_id => 'cb58d110-0000-4000-8000-000000000503',
    p_filters => (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'key', 'color', 'operator', 'eq',
        'value', repeat(chr(1), 100), 'branch', 0))
      FROM pg_catalog.generate_series(1, 50)),
    p_identity => (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'branch', branch, 'product_type', repeat(chr(2), 100),
        'brands', (SELECT pg_catalog.jsonb_agg(repeat(chr(3), 100))
          FROM pg_catalog.generate_series(1, 10)),
        'model', repeat(chr(4), 100),
        'compatible_with', repeat(chr(5), 100)))
      FROM pg_catalog.generate_series(0, 4) AS branch),
    p_limit => 10
  );
  -- Payloads beyond the caps still reject, by bytes and by element count.
  BEGIN
    PERFORM * FROM public.search_product_variant_recall(
      p_merchant_id => 'cb58d110-0000-4000-8000-000000000503',
      p_filters => pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'key', 'color', 'operator', 'eq',
        'value', repeat('a', 41000), 'branch', 0)));
    RAISE EXCEPTION 'over-cap filter payloads must be rejected';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.search_product_variant_recall(
      p_merchant_id => 'cb58d110-0000-4000-8000-000000000503',
      p_filters => (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'key', 'color', 'operator', 'eq', 'value', 'black', 'branch', 0))
        FROM pg_catalog.generate_series(1, 51)));
    RAISE EXCEPTION 'over-count filter payloads must be rejected';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.search_product_variant_recall(
      p_merchant_id => 'cb58d110-0000-4000-8000-000000000503',
      p_identity => pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'branch', 0, 'model', repeat('a', 50000))));
    RAISE EXCEPTION 'over-cap identity payloads must be rejected';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.search_product_variant_recall(
      p_merchant_id => 'cb58d110-0000-4000-8000-000000000503',
      p_identity => (SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object('branch', branch))
        FROM pg_catalog.generate_series(0, 5) AS branch));
    RAISE EXCEPTION 'over-count identity payloads must be rejected';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
END;
$$;

ROLLBACK;
