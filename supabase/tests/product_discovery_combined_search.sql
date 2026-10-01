BEGIN;
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
DO $$
DECLARE document tsvector;
BEGIN
  document := discovery.product_discovery_search_document('Generic item', 'Acme', 'Accessories',
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
  document := discovery.product_discovery_search_document_v2('Laptop', 'Acme', 'Laptops', '',
    '{"attributes":{"storage_gb":1024,"ram_gb":8}}'::jsonb);
  IF NOT document @@ plainto_tsquery('simple', '1TB laptop') OR
     NOT document @@ plainto_tsquery('simple', '1 TB laptop') OR
     NOT document @@ plainto_tsquery('simple', '8192MB laptop') THEN
    RAISE EXCEPTION 'Equivalent canonical capacity retrieval failed';
  END IF;
  document := discovery.product_discovery_search_document_v3('Laptop', 'Acme', 'Laptops', '',
    '{"attributes":{"storage_gb":8,"ram_gb":8}}'::jsonb);
  IF NOT document @@ plainto_tsquery('simple', 'ram8gb') OR
     NOT document @@ plainto_tsquery('simple', 'storage8gb') OR
     NOT document @@ plainto_tsquery('simple', 'ramgb') OR
     NOT document @@ plainto_tsquery('simple', 'storagegb') THEN
    RAISE EXCEPTION 'Keyed equality or range lexemes were not indexed';
  END IF;
  IF document @@ plainto_tsquery('simple', 'ram8.5gb') THEN
    RAISE EXCEPTION 'Keyed numeric lexeme was fabricated';
  END IF;
  document := discovery.product_discovery_search_document_v3('Display', 'Acme', 'Monitors', '',
    '{"attributes":{"screen_inches":6.5}}'::jsonb);
  IF NOT document @@ pg_catalog.to_tsquery('simple'::regconfig, 'screen6.5inch') THEN
    RAISE EXCEPTION 'Dotted keyed numeric lexeme did not round-trip';
  END IF;
  IF document @@ pg_catalog.to_tsquery('simple'::regconfig, 'screen6.4inch') THEN
    RAISE EXCEPTION 'Dotted keyed numeric lexeme matched a near miss';
  END IF;
  document := discovery.product_discovery_search_document_v4('Headset', 'Acme', 'Audio',
    'USB-C accessory', '{"attributes":{"connector":"  Usb-C  "}}'::jsonb);
  IF NOT document @@ plainto_tsquery('simple',
      'fact' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        'connector' || pg_catalog.chr(31) || 'usb-c', 'UTF8'), 'sha256'), 'hex')) THEN
    RAISE EXCEPTION 'Correlated text attribute lexeme missed normalized connector value';
  END IF;
  document := discovery.product_discovery_search_document_v4('Headset', 'Acme', 'Audio',
    'USB-C accessory', '{"attributes":{"connector":"Lightning"}}'::jsonb);
  IF document @@ plainto_tsquery('simple',
      'fact' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        'connector' || pg_catalog.chr(31) || 'usb-c', 'UTF8'), 'sha256'), 'hex')) THEN
    RAISE EXCEPTION 'Marketing text satisfied a verified connector constraint';
  END IF;
  document := discovery.product_discovery_search_document_v4('Headset', 'Acme', 'Audio', '',
    '{"attributes":{"color":"USB-C"}}'::jsonb);
  IF document @@ plainto_tsquery('simple',
      'fact' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        'connector' || pg_catalog.chr(31) || 'usb-c', 'UTF8'), 'sha256'), 'hex')) THEN
    RAISE EXCEPTION 'USB-C under another attribute satisfied connector constraint';
  END IF;
  document := discovery.product_discovery_search_document_v4('Headset', 'Acme', 'Audio', '',
    '{"attributes":{"connector":"Café   USB-C"}}'::jsonb);
  IF NOT document @@ plainto_tsquery('simple', 'fact' || pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to('connector' || pg_catalog.chr(31) || pg_catalog.lower(
        pg_catalog.normalize('Café USB-C', 'NFC')), 'UTF8'), 'sha256'), 'hex')) THEN
    RAISE EXCEPTION 'Correlated text lexeme normalization diverged for Unicode or whitespace';
  END IF;
  document := discovery.product_discovery_search_document_v3('Headset', 'Acme', 'Audio', '',
    '{"attributes":{"color":"black"}}'::jsonb);
  IF NOT document @@ plainto_tsquery('simple', 'black') OR
     NOT document @@ plainto_tsquery('simple', 'color') OR
     document @@ plainto_tsquery('simple', 'connector') THEN
    RAISE EXCEPTION 'Attribute key lexemes are missing or fabricated';
  END IF;
  document := discovery.product_discovery_search_document_v5('Generic handset', 'Samsung', 'Smartphones',
    'phone phone phone', '{"product_type":"phone","model":"ZX-42","compatible_with":["USB-C dock"]}'::jsonb);
  IF NOT document @@ plainto_tsquery('simple', 'typephone') OR
     NOT document @@ plainto_tsquery('simple', 'brandsamsung') OR
     NOT document @@ plainto_tsquery('simple', 'modelzx_42') OR
     NOT document @@ plainto_tsquery('simple', 'compatusb_c_dock') THEN
    RAISE EXCEPTION 'Keyed identity lexemes are missing';
  END IF;
  document := discovery.product_discovery_search_document_v5('phone phone phone', 'Acme', 'Accessories',
    'phone accessory', '{"product_type":"accessory"}'::jsonb);
  IF document @@ plainto_tsquery('simple', 'typephone') THEN
    RAISE EXCEPTION 'Marketing text satisfied a keyed identity constraint';
  END IF;
  document := discovery.product_discovery_search_document_v5('Generic', 'Acme', 'Smartphones', '',
    '{}'::jsonb);
  IF NOT document @@ plainto_tsquery('simple', 'typephone') THEN
    RAISE EXCEPTION 'Category fallback did not emit the canonical type lexeme';
  END IF;
  document := discovery.product_discovery_search_document_v5('Generic', 'Acme', 'Accessories', '',
    '{"product_type":"smartphones"}'::jsonb);
  IF NOT document @@ plainto_tsquery('simple', 'typephone') THEN
    RAISE EXCEPTION 'Type alias did not collapse to the canonical identity lexeme';
  END IF;
  document := discovery.product_discovery_search_document_v5('Generic', 'Acme', 'Accessories', '',
    '{"model":"三星手机","product_type":"手机"}'::jsonb);
  IF NOT document @@ plainto_tsquery('simple',
      'fact' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        'model' || pg_catalog.chr(31) || '三星手机', 'UTF8'), 'sha256'), 'hex')) THEN
    RAISE EXCEPTION 'Non-ASCII model digest missed the identity';
  END IF;
  IF document @@ plainto_tsquery('simple',
      'fact' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        'model' || pg_catalog.chr(31) || '华为手机', 'UTF8'), 'sha256'), 'hex')) THEN
    RAISE EXCEPTION 'Non-ASCII model digest matched a different identity';
  END IF;
  IF NOT document @@ plainto_tsquery('simple',
      'fact' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        'type' || pg_catalog.chr(31) || '手机', 'UTF8'), 'sha256'), 'hex')) THEN
    RAISE EXCEPTION 'Non-ASCII custom type digest missed the identity';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.search_product_discovery_facts(uuid,text,integer,integer,text,text)'::regprocedure) THEN
    RAISE EXCEPTION 'Fact retrieval must preserve invoker RLS';
  END IF;
END;
$$;

INSERT INTO public.merchants (id, email, business_name, slug, is_published)
VALUES (
  'cb58d110-0000-4000-8000-000000000201',
  'facts-test@example.test',
  'Facts Test Merchant',
  'facts-test-merchant',
  true
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
   '{"product_type":"camera"}'::jsonb),
  ('cb58d110-0000-4000-8000-000000000206', 'cb58d110-0000-4000-8000-000000000201',
   'Capacity fixture', 'ram-eight-storage-128', 'Acme', 50000, 'active',
   '{"attributes":{"ram_gb":8,"storage_gb":128}}'::jsonb),
  ('cb58d110-0000-4000-8000-000000000207', 'cb58d110-0000-4000-8000-000000000201',
   'Capacity fixture', 'ram-128-storage-eight', 'Acme', 50000, 'active',
   '{"attributes":{"ram_gb":128,"storage_gb":8}}'::jsonb),
  ('cb58d110-0000-4000-8000-000000000208', 'cb58d110-0000-4000-8000-000000000201',
   'USB-C accessory', 'connector-marketing-only', 'Acme', 50000, 'active',
   '{"attributes":{"connector":"Lightning"}}'::jsonb),
  ('cb58d110-0000-4000-8000-000000000209', 'cb58d110-0000-4000-8000-000000000201',
   'Accessory', 'connector-exact', 'Acme', 50000, 'active',
   '{"attributes":{"connector":"  Usb-C  "}}'::jsonb),
  ('cb58d110-0000-4000-8000-000000000210', 'cb58d110-0000-4000-8000-000000000201',
   'Accessory', 'connector-other-key', 'Acme', 50000, 'active',
   '{"attributes":{"connector":"Lightning","color":"USB-C"}}'::jsonb),
  ('cb58d110-0000-4000-8000-000000000211', 'cb58d110-0000-4000-8000-000000000201',
   'phone phone phone', 'phone-marketing-accessory', 'Acme', 50000, 'active',
   '{"product_type":"accessory"}'::jsonb),
  ('cb58d110-0000-4000-8000-000000000212', 'cb58d110-0000-4000-8000-000000000201',
   'Display fixture', 'screen-six-half', 'Acme', 50000, 'active',
   '{"attributes":{"screen_inches":6.5}}'::jsonb);

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
    'typephone & brandsamsung');
  IF or_ids IS DISTINCT FROM ARRAY['cb58d110-0000-4000-8000-000000000202']::uuid[] THEN
    RAISE EXCEPTION 'Keyed identity retrieval matched marketing prose or missed the phone';
  END IF;
END;
$$;
ROLLBACK;
