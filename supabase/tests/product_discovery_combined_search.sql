BEGIN;
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO public.merchants (id, email, business_name, slug, is_published)
VALUES (
  'cb58d110-0000-4000-8000-000000000201',
  'facts-test@example.test',
  'Facts Test Merchant',
  'facts-test-merchant',
  true
);

INSERT INTO public.products (id, merchant_id, name, slug, brand, price, status, manage_stock, discovery_metadata)
VALUES
  ('cb58d110-0000-4000-8000-000000000202', 'cb58d110-0000-4000-8000-000000000201',
   'Generic handset', 'generic-handset', 'Samsung', 50000, 'active', false,
   '{"product_type":"phone","attributes":{"storage_gb":256}}'::jsonb),
  ('cb58d110-0000-4000-8000-000000000203', 'cb58d110-0000-4000-8000-000000000201',
   'Generic handset', 'generic-handset-2', 'Google', 50000, 'active', false,
   '{"product_type":"phone","attributes":{"storage_gb":256}}'::jsonb),
  ('cb58d110-0000-4000-8000-000000000204', 'cb58d110-0000-4000-8000-000000000201',
   'camera camera camera', 'camera-thrice', 'Acme', 50000, 'active', false,
   '{"product_type":"camera"}'::jsonb),
  ('cb58d110-0000-4000-8000-000000000205', 'cb58d110-0000-4000-8000-000000000201',
   'camera', 'camera-once', 'Acme', 50000, 'active', false,
   '{"product_type":"camera"}'::jsonb),
  ('cb58d110-0000-4000-8000-000000000206', 'cb58d110-0000-4000-8000-000000000201',
   'Capacity fixture', 'ram-eight-storage-128', 'Acme', 50000, 'active', false,
   '{"attributes":{"ram_gb":8,"storage_gb":128}}'::jsonb),
  ('cb58d110-0000-4000-8000-000000000207', 'cb58d110-0000-4000-8000-000000000201',
   'Capacity fixture', 'ram-128-storage-eight', 'Acme', 50000, 'active', false,
   '{"attributes":{"ram_gb":128,"storage_gb":8}}'::jsonb),
  ('cb58d110-0000-4000-8000-000000000208', 'cb58d110-0000-4000-8000-000000000201',
   'USB-C accessory', 'connector-marketing-only', 'Acme', 50000, 'active', false,
   '{"attributes":{"connector":"Lightning"}}'::jsonb),
  ('cb58d110-0000-4000-8000-000000000209', 'cb58d110-0000-4000-8000-000000000201',
   'Accessory', 'connector-exact', 'Acme', 50000, 'active', false,
   '{"attributes":{"connector":"  Usb-C  "}}'::jsonb),
  ('cb58d110-0000-4000-8000-000000000210', 'cb58d110-0000-4000-8000-000000000201',
   'Accessory', 'connector-other-key', 'Acme', 50000, 'active', false,
   '{"attributes":{"connector":"Lightning","color":"USB-C"}}'::jsonb),
  ('cb58d110-0000-4000-8000-000000000211', 'cb58d110-0000-4000-8000-000000000201',
   'phone phone phone', 'phone-marketing-accessory', 'Acme', 50000, 'active', false,
   '{"product_type":"accessory"}'::jsonb),
  ('cb58d110-0000-4000-8000-000000000212', 'cb58d110-0000-4000-8000-000000000201',
   'Display fixture', 'screen-six-half', 'Acme', 50000, 'active', false,
   '{"attributes":{"screen_inches":6.5}}'::jsonb);

INSERT INTO public.products
  (id, merchant_id, name, slug, price, status, has_variants, manage_stock, discovery_metadata)
VALUES
  ('cb58d110-0000-4000-8000-000000000213', 'cb58d110-0000-4000-8000-000000000201',
   'Metadata only color', 'metadata-only-color', 50000, 'active', false, false,
   '{"attributes":{"color":"ÉBÈNE"}}'::jsonb);

-- Exercise the RPC as its public storefront caller, under publication RLS.
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'anon', true);

DO $$
DECLARE
  or_ids uuid[];
  first_id uuid;
BEGIN
  IF current_user <> 'anon' THEN
    RAISE EXCEPTION 'RPC regression must run as the public caller';
  END IF;
  IF NOT pg_catalog.to_tsvector('simple'::regconfig, 'ram8gb')
      @@ pg_catalog.plainto_tsquery('simple'::regconfig, 'ram8gb') OR
     pg_catalog.to_tsvector('simple'::regconfig, 'ram8gb')
      @@ pg_catalog.plainto_tsquery('simple'::regconfig, 'storage8gb') THEN
    RAISE EXCEPTION 'PostgreSQL tokenizer merged distinct keyed numeric lexemes';
  END IF;
  SELECT array_agg(product_id) INTO or_ids
  FROM public.search_product_discovery_facts('cb58d110-0000-4000-8000-000000000201',
    'phone & (samsung | google) & 256gb');
  IF NOT (coalesce(or_ids, ARRAY[]::uuid[]) @> ARRAY['cb58d110-0000-4000-8000-000000000202', 'cb58d110-0000-4000-8000-000000000203']::uuid[]) THEN
    RAISE EXCEPTION 'Fact retrieval dropped an OR branch';
  END IF;
  SELECT product_id INTO first_id
  FROM (SELECT product_id, row_number() OVER () AS rn
    FROM public.search_product_discovery_facts('cb58d110-0000-4000-8000-000000000201', 'camera')) ranked
  WHERE rn = 1;
  IF first_id::text IS DISTINCT FROM 'cb58d110-0000-4000-8000-000000000204' THEN
    RAISE EXCEPTION 'Fact retrieval is not relevance ordered';
  END IF;
  SELECT array_agg(product_id) INTO or_ids
  FROM public.search_product_discovery_facts('cb58d110-0000-4000-8000-000000000201',
    'phone & 256gb', 100, 0, 'sams');
  IF or_ids IS DISTINCT FROM ARRAY['cb58d110-0000-4000-8000-000000000202']::uuid[] THEN
    RAISE EXCEPTION 'Fact retrieval brand filter must narrow before the cap';
  END IF;
  SELECT array_agg(product_id) INTO or_ids
  FROM public.search_product_discovery_facts('cb58d110-0000-4000-8000-000000000201',
    'storage8gb');
  IF or_ids IS DISTINCT FROM ARRAY['cb58d110-0000-4000-8000-000000000207']::uuid[] THEN
    RAISE EXCEPTION 'Storage equality retrieved a product matching only on RAM';
  END IF;
  SELECT array_agg(product_id) INTO or_ids
  FROM public.search_product_discovery_facts('cb58d110-0000-4000-8000-000000000201',
    'ram8gb');
  IF or_ids IS DISTINCT FROM ARRAY['cb58d110-0000-4000-8000-000000000206']::uuid[] THEN
    RAISE EXCEPTION 'RAM equality retrieved a product matching only on storage';
  END IF;
  SELECT array_agg(product_id) INTO or_ids
  FROM public.search_product_discovery_facts('cb58d110-0000-4000-8000-000000000201',
    'screen6.5inch');
  IF or_ids IS DISTINCT FROM ARRAY['cb58d110-0000-4000-8000-000000000212']::uuid[] THEN
    RAISE EXCEPTION 'Dotted keyed numeric lexeme did not round-trip through retrieval';
  END IF;
  SELECT array_agg(product_id) INTO or_ids
  FROM public.search_product_discovery_facts('cb58d110-0000-4000-8000-000000000201',
    'fact' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      'connector' || pg_catalog.chr(31) || 'usb-c', 'UTF8'), 'sha256'), 'hex'));
  IF or_ids IS DISTINCT FROM ARRAY['cb58d110-0000-4000-8000-000000000209']::uuid[] THEN
    RAISE EXCEPTION 'Text equality matched marketing prose or a different attribute';
  END IF;
  SELECT array_agg(product_id) INTO or_ids
  FROM public.search_product_discovery_facts('cb58d110-0000-4000-8000-000000000201',
    'fact' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      'color' || pg_catalog.chr(31) || pg_catalog.translate(
        'ÉBÈNE', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'UTF8'), 'sha256'), 'hex'));
  IF or_ids IS DISTINCT FROM ARRAY['cb58d110-0000-4000-8000-000000000213']::uuid[] THEN
    RAISE EXCEPTION 'ASCII-only attribute digest did not recall its metadata-only product';
  END IF;
  SELECT array_agg(product_id) INTO or_ids
  FROM public.search_product_discovery_facts('cb58d110-0000-4000-8000-000000000201',
    'typephone & fact' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      'brand' || pg_catalog.chr(31) || 'samsung', 'UTF8'), 'sha256'), 'hex'));
  IF or_ids IS DISTINCT FROM ARRAY['cb58d110-0000-4000-8000-000000000202']::uuid[] THEN
    RAISE EXCEPTION 'Keyed identity retrieval matched marketing prose or missed the phone';
  END IF;
END;
$$;
ROLLBACK;
