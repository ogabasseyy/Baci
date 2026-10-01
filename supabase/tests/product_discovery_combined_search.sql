BEGIN;
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
DO $$
DECLARE document tsvector;
BEGIN
  document := public.product_discovery_search_document('Generic item', 'Acme', 'Accessories',
    'gaming', '{"product_type":"phone","model":"ZX-42","attributes":{"storage_gb":256,"ram_gb":16,"power_w":65}}'::jsonb);
  IF NOT document @@ plainto_tsquery('simple', 'ZX-42 gaming') THEN
    RAISE EXCEPTION 'Combined model/marketing retrieval failed';
  END IF;
  IF NOT document @@ plainto_tsquery('simple', '256GB phone') OR
     NOT document @@ plainto_tsquery('simple', '256 GB phone') OR
     NOT document @@ plainto_tsquery('simple', '65W Acme') THEN
    RAISE EXCEPTION 'Canonical unit lexeme retrieval failed';
  END IF;
  IF document @@ plainto_tsquery('simple', '512GB phone') THEN
    RAISE EXCEPTION 'Search document fabricated a numeric specification';
  END IF;
  document := public.product_discovery_search_document_v2('Laptop', 'Acme', 'Laptops', '',
    '{"attributes":{"storage_gb":1024,"ram_gb":8}}'::jsonb);
  IF NOT document @@ plainto_tsquery('simple', '1TB laptop') OR
     NOT document @@ plainto_tsquery('simple', '1 TB laptop') OR
     NOT document @@ plainto_tsquery('simple', '8192MB laptop') THEN
    RAISE EXCEPTION 'Equivalent canonical capacity retrieval failed';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.search_product_discovery_facts(uuid,text,integer,integer)'::regprocedure) THEN
    RAISE EXCEPTION 'Fact retrieval must preserve invoker RLS';
  END IF;
END;
$$;

INSERT INTO public.merchants (id, email, business_name, slug)
VALUES (
  'cb58d110-0000-4000-8000-000000000201',
  'facts-test@example.test',
  'Facts Test Merchant',
  'facts-test-merchant'
);

INSERT INTO public.products (id, merchant_id, name, slug, brand, price, status, discovery_metadata)
VALUES
  ('cb58d110-0000-4000-8000-000000000202', 'cb58d110-0000-4000-8000-000000000201',
   'Generic handset', 'generic-handset', 'Samsung', 50000, 'active',
   '{"product_type":"phone","attributes":{"storage_gb":256}}'::jsonb),
  ('cb58d110-0000-4000-8000-000000000203', 'cb58d110-0000-4000-8000-000000000201',
   'Generic handset', 'generic-handset-2', 'Google', 50000, 'active',
   '{"product_type":"phone","attributes":{"storage_gb":256}}'::jsonb),
  ('cb58d110-0000-4000-8000-000000000204', 'cb58d110-0000-4000-8000-000000000201',
   'camera camera camera', 'camera-thrice', 'Acme', 50000, 'active',
   '{"product_type":"camera"}'::jsonb),
  ('cb58d110-0000-4000-8000-000000000205', 'cb58d110-0000-4000-8000-000000000201',
   'camera', 'camera-once', 'Acme', 50000, 'active',
   '{"product_type":"camera"}'::jsonb);

DO $$
DECLARE
  or_ids uuid[];
  first_id uuid;
BEGIN
  SELECT array_agg(product_id) INTO or_ids
  FROM public.search_product_discovery_facts('cb58d110-0000-4000-8000-000000000201',
    'phone & (samsung | google) & 256gb');
  IF NOT (or_ids @> ARRAY['cb58d110-0000-4000-8000-000000000202', 'cb58d110-0000-4000-8000-000000000203']::uuid[]) THEN
    RAISE EXCEPTION 'Fact retrieval dropped an OR branch';
  END IF;
  SELECT product_id INTO first_id
  FROM (SELECT product_id, row_number() OVER () AS rn
    FROM public.search_product_discovery_facts('cb58d110-0000-4000-8000-000000000201', 'camera')) ranked
  WHERE rn = 1;
  IF first_id::text <> 'cb58d110-0000-4000-8000-000000000204' THEN
    RAISE EXCEPTION 'Fact retrieval is not relevance ordered';
  END IF;
END;
$$;
ROLLBACK;
