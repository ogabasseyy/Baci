BEGIN;
SET LOCAL ROLE service_role;

DO $$
DECLARE
  punctuated tsvector;
  plain tsvector;
  punctuated_key text;
BEGIN
  punctuated := discovery.product_discovery_search_document_v6(
    'Punctuated type', NULL, NULL, NULL, '{"product_type":"foo/bar"}'::jsonb);
  plain := discovery.product_discovery_search_document_v6(
    'Plain type', NULL, NULL, NULL, '{"product_type":"foobar"}'::jsonb);
  punctuated_key := 'fact' || pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to('type' || pg_catalog.chr(31) || 'foo/bar', 'UTF8'), 'sha256'), 'hex');

  IF NOT (punctuated @@ pg_catalog.to_tsquery('simple'::regconfig, punctuated_key)) THEN
    RAISE EXCEPTION 'punctuated type should emit its exact digest lexeme';
  END IF;
  IF punctuated @@ pg_catalog.to_tsquery('simple'::regconfig, 'typefoobar') THEN
    RAISE EXCEPTION 'punctuated type must not collide with plain typefoobar';
  END IF;
  IF NOT (plain @@ pg_catalog.to_tsquery('simple'::regconfig, 'typefoobar'))
    OR plain @@ pg_catalog.to_tsquery('simple'::regconfig, punctuated_key) THEN
    RAISE EXCEPTION 'plain type control must retain its distinct legacy lexeme';
  END IF;
END;
$$;

ROLLBACK;
