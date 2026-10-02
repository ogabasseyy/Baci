-- Search document unit pins: identity lexemes, canonical units,
-- keyed digests, and the fact-retrieval invoker check. No fixtures.
BEGIN;
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
DO $$
DECLARE document tsvector;
BEGIN
  document := discovery.product_discovery_search_document_v5('Generic item', 'Acme', 'Accessories',
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
  document := discovery.product_discovery_search_document_v5('Laptop', 'Acme', 'Laptops', '',
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
  document := discovery.product_discovery_search_document_v5('Headset', 'Acme', 'Audio', '',
    '{"attributes":{"color":"ÉBÈNE"}}'::jsonb);
  IF NOT document @@ plainto_tsquery('simple', 'fact' || pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(
        'color' || pg_catalog.chr(31) || pg_catalog.translate(
          'ÉBÈNE', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'UTF8'),
        'sha256'), 'hex')) THEN
    RAISE EXCEPTION 'ASCII-only attribute digest must preserve non-ASCII case';
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
     NOT document @@ plainto_tsquery('simple',
      'fact' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        'brand' || pg_catalog.chr(31) || 'samsung', 'UTF8'), 'sha256'), 'hex')) OR
     NOT document @@ plainto_tsquery('simple',
      'fact' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        'model' || pg_catalog.chr(31) || 'zx-42', 'UTF8'), 'sha256'), 'hex')) OR
     NOT document @@ plainto_tsquery('simple',
      'fact' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        'compat' || pg_catalog.chr(31) || 'usb-c dock', 'UTF8'), 'sha256'), 'hex')) THEN
    RAISE EXCEPTION 'Keyed identity lexemes are missing';
  END IF;
  IF document @@ plainto_tsquery('simple',
      'fact' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        'model' || pg_catalog.chr(31) || 'zx 42', 'UTF8'), 'sha256'), 'hex')) THEN
    RAISE EXCEPTION 'Model digest collided across a separator the matcher keeps';
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
    '{"product_type":"¨phone"}'::jsonb);
  IF NOT document @@ plainto_tsquery('simple', 'typephone') OR
     document @@ plainto_tsquery('simple', 'type_phone') THEN
    RAISE EXCEPTION 'Compatibility-whitespace type did not use the shared canonicalizer lexeme';
  END IF;
  document := discovery.product_discovery_search_document_v5('Generic', 'Acme', 'Accessories', '',
    '{"model":"¨phone"}'::jsonb);
  IF NOT document @@ plainto_tsquery('simple',
      'fact' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        'model' || pg_catalog.chr(31) || '¨phone', 'UTF8'), 'sha256'), 'hex')) OR
     document @@ plainto_tsquery('simple',
      'fact' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        'model' || pg_catalog.chr(31) || 'phone', 'UTF8'), 'sha256'), 'hex')) THEN
    RAISE EXCEPTION 'Model digest folded a compatibility character the matcher keeps';
  END IF;
  document := discovery.product_discovery_search_document_v5('Generic', 'Acme', 'Accessories', '',
    ('{"attributes":{"color":"black' || chr(65279) || '"}}')::jsonb);
  IF NOT document @@ plainto_tsquery('simple',
      'fact' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        'color' || pg_catalog.chr(31) || 'black', 'UTF8'), 'sha256'), 'hex')) THEN
    RAISE EXCEPTION 'BOM-suffixed attribute value did not digest to the trimmed lexeme';
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
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.search_product_discovery_facts(uuid,text,integer,integer,text,text,text,jsonb)'::regprocedure) THEN
    RAISE EXCEPTION 'Fact retrieval must preserve invoker RLS';
  END IF;
END;
$$;

ROLLBACK;
