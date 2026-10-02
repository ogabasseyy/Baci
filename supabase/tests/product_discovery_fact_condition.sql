-- Requested conditions narrow fact retrieval before the ranking cap with
-- the live variant/offer/base semantics, so other-condition rows cannot
-- crowd out the only matching option.
BEGIN;
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO public.merchants (id, email, business_name, slug, is_published)
VALUES (
  'cb58d110-0000-4000-8000-000000000604',
  'fact-condition-test@example.test',
  'Fact Condition Test Merchant',
  'fact-condition-test-merchant',
  true
);

INSERT INTO public.products
  (id, merchant_id, name, slug, brand, price, status, has_variants, condition, discovery_metadata)
VALUES
  ('cb58d110-0000-4000-8000-000000000621', 'cb58d110-0000-4000-8000-000000000604',
   'Black new widget', 'black-new-widget', 'Acme', 50000, 'active', false, 'new',
   '{"product_type":"phone","attributes":{"color":"black"}}'),
  ('cb58d110-0000-4000-8000-000000000622', 'cb58d110-0000-4000-8000-000000000604',
   'Black new gadget', 'black-new-gadget', 'Acme', 50000, 'active', false, 'new',
   '{"product_type":"phone","attributes":{"color":"black"}}'),
  ('cb58d110-0000-4000-8000-000000000623', 'cb58d110-0000-4000-8000-000000000604',
   'Black widget', 'black-widget', 'Acme', 50000, 'active', true, 'new',
   '{"product_type":"phone","attributes":{"color":"black"}}');

INSERT INTO public.product_variants (id, product_id, merchant_id, attributes, stock_quantity, condition)
VALUES (
  'cb58d110-0000-4000-8000-000000000624', 'cb58d110-0000-4000-8000-000000000623',
  'cb58d110-0000-4000-8000-000000000604', '{"storage_gb":256}', 5, 'used'
);

SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'anon', true);

DO $$
DECLARE
  fact_ids uuid[];
BEGIN
  IF current_user <> 'anon' THEN
    RAISE EXCEPTION 'RPC regression must run as the public caller';
  END IF;
  SELECT array_agg(product_id) INTO fact_ids
  FROM public.search_product_discovery_facts(
    merchant_id_param => 'cb58d110-0000-4000-8000-000000000604',
    query_text => 'black',
    condition_filter => 'used'
  );
  IF cardinality(fact_ids) IS DISTINCT FROM 1
    OR fact_ids[1] IS DISTINCT FROM 'cb58d110-0000-4000-8000-000000000623'::uuid THEN
    RAISE EXCEPTION 'used facts must keep the used-variant product only, got %', fact_ids;
  END IF;
  SELECT array_agg(product_id) INTO fact_ids
  FROM public.search_product_discovery_facts(
    merchant_id_param => 'cb58d110-0000-4000-8000-000000000604',
    query_text => 'black',
    condition_filter => 'new'
  );
  IF cardinality(fact_ids) IS DISTINCT FROM 2
    OR fact_ids @> ARRAY['cb58d110-0000-4000-8000-000000000623'::uuid] THEN
    RAISE EXCEPTION 'new facts must drop the used-variant product, got %', fact_ids;
  END IF;
  SELECT array_agg(product_id) INTO fact_ids
  FROM public.search_product_discovery_facts(
    'cb58d110-0000-4000-8000-000000000604', 'black'
  );
  IF cardinality(fact_ids) IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'unconditioned facts must stay fail-open, got %', fact_ids;
  END IF;
  -- Scalar filters beyond the public schema limits narrow to no rows.
  SELECT array_agg(product_id) INTO fact_ids
  FROM public.search_product_discovery_facts(
    merchant_id_param => 'cb58d110-0000-4000-8000-000000000604',
    query_text => 'black',
    brand_filter => repeat('b', 51)
  );
  IF fact_ids IS NOT NULL THEN
    RAISE EXCEPTION 'over-long brand filters must narrow to no rows, got %', fact_ids;
  END IF;
  SELECT array_agg(product_id) INTO fact_ids
  FROM public.search_product_discovery_facts(
    merchant_id_param => 'cb58d110-0000-4000-8000-000000000604',
    query_text => 'black',
    category_filter => repeat('c', 51)
  );
  IF fact_ids IS NOT NULL THEN
    RAISE EXCEPTION 'over-long category filters must narrow to no rows, got %', fact_ids;
  END IF;
  SELECT array_agg(product_id) INTO fact_ids
  FROM public.search_product_discovery_facts(
    merchant_id_param => 'cb58d110-0000-4000-8000-000000000604',
    query_text => 'black',
    condition_filter => repeat('n', 51)
  );
  IF fact_ids IS NOT NULL THEN
    RAISE EXCEPTION 'over-long condition filters must narrow to no rows, got %', fact_ids;
  END IF;
END;
$$;

ROLLBACK;
