-- Fact excluded types: the type-less row drops with the phone under a
-- nonempty exclusion list; over-count lists narrow to no rows.
BEGIN;
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO public.merchants (id, email, business_name, slug, is_published)
VALUES (
  'cb58d110-0000-4000-8000-000000000605',
  'fact-exclusion-test@example.test',
  'Fact Exclusion Test Merchant',
  'fact-exclusion-test-merchant',
  true
);

-- Exclusion fixtures live on their own merchant: a phone, a tablet, and a
-- type-less row that drops with the phone under a nonempty exclusion list.
INSERT INTO public.products
  (id, merchant_id, name, slug, brand, price, status, has_variants, condition,
   manage_stock, discovery_metadata)
VALUES
  ('cb58d110-0000-4000-8000-000000000637', 'cb58d110-0000-4000-8000-000000000605',
   'Black exclusion phone', 'black-exclusion-phone', 'Excl', 50000, 'active', false, 'new', false,
   '{"product_type":"phone"}'),
  ('cb58d110-0000-4000-8000-000000000638', 'cb58d110-0000-4000-8000-000000000605',
   'Black exclusion tablet', 'black-exclusion-tablet', 'Excl', 50000, 'active', false, 'new', false,
   '{"product_type":"tablet"}'),
  ('cb58d110-0000-4000-8000-000000000639', 'cb58d110-0000-4000-8000-000000000605',
   'Black exclusion typeless', 'black-exclusion-typeless', 'Excl', 50000, 'active', false, 'new', false,
   '{}');

SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'anon', true);

DO $$
DECLARE
  fact_ids uuid[];
BEGIN
  IF current_user <> 'anon' THEN
    RAISE EXCEPTION 'RPC regression must run as the public caller';
  END IF;
  -- Intent-level excluded types filter before ranking; the type-less row
  -- drops with the phone under a nonempty exclusion list.
  SELECT array_agg(product_id) INTO fact_ids
  FROM public.search_product_discovery_facts(
    merchant_id_param => 'cb58d110-0000-4000-8000-000000000605',
    query_text => 'black',
    excluded_types_filter => '["phone"]'::jsonb
  );
  IF cardinality(fact_ids) IS DISTINCT FROM 1
    OR fact_ids[1] IS DISTINCT FROM 'cb58d110-0000-4000-8000-000000000638'::uuid THEN
    RAISE EXCEPTION 'excluded facts must keep the tablet only, got %', fact_ids;
  END IF;
  SELECT array_agg(product_id) INTO fact_ids
  FROM public.search_product_discovery_facts(
    merchant_id_param => 'cb58d110-0000-4000-8000-000000000605',
    query_text => 'black'
  );
  IF cardinality(fact_ids) IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'unexcluded facts must keep all three rows, got %', fact_ids;
  END IF;
  SELECT array_agg(product_id) INTO fact_ids
  FROM public.search_product_discovery_facts(
    merchant_id_param => 'cb58d110-0000-4000-8000-000000000605',
    query_text => 'black',
    excluded_types_filter => (SELECT pg_catalog.jsonb_agg('phone'::text)
      FROM pg_catalog.generate_series(1, 11))
  );
  IF fact_ids IS NOT NULL THEN
    RAISE EXCEPTION 'over-count excluded types must narrow to no rows, got %', fact_ids;
  END IF;
END;
$$;

ROLLBACK;
