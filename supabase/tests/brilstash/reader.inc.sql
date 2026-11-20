INSERT INTO private.brilstash_credentials (installation_id, bearer_digest)
VALUES ('30000000-0000-4000-8000-000000000001', sha256(convert_to(repeat('k', 43), 'UTF8')));
UPDATE private.brilstash_installations i SET intended_credential_id = c.id
FROM private.brilstash_credentials c WHERE i.id = c.installation_id
  AND i.id = '30000000-0000-4000-8000-000000000001';
SET LOCAL ROLE anon;
DO $$
DECLARE result jsonb;
BEGIN
  IF public.read_brilstash_page(repeat('k', 43), 1, 100, 0)->>'status' IS DISTINCT FROM 'ingress_unavailable'
    OR fixture.read_brilstash_page(repeat('k', 43), 1, 100, 0, repeat('z', 43))->>'status' IS DISTINCT FROM 'ingress_unavailable'
    OR fixture.read_brilstash_page(repeat('k', 43), 1, 100, 0, NULL, 16)->>'status' IS DISTINCT FROM 'ingress_unavailable'
  THEN RAISE EXCEPTION 'the reader accepted an absent, misbound, or expired ingress proof'; END IF;
  result := fixture.read_brilstash_page(repeat('k', 43), 1, 100, 0);
  IF result->>'status' IS DISTINCT FROM 'ok'
    OR result->>'totalCount' IS DISTINCT FROM '1'
    OR result->'products'->0->>'external_id' IS DISTINCT FROM 'fixture-one'
  THEN RAISE EXCEPTION 'credential did not read the expected generation: %', result; END IF;
  IF fixture.read_brilstash_page(repeat('z', 43), 1, 100, 0)->>'status' IS DISTINCT FROM 'unauthorized'
    OR fixture.read_brilstash_page(repeat('k', 43), 2, 100, 0)->>'status' IS DISTINCT FROM 'invalid_query'
    OR fixture.read_brilstash_page(repeat('k', 43), 1, 100, 300000)->>'status' IS DISTINCT FROM 'invalid_query'
  THEN RAISE EXCEPTION 'reader accepted incorrect auth or a partial pilot import'; END IF;
END $$;
RESET ROLE;
UPDATE private.brilstash_installations SET single_page_only = false
WHERE id = '30000000-0000-4000-8000-000000000001';
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF fixture.read_brilstash_page(repeat('k', 43), 1, 1, 365000)->>'totalCount' IS DISTINCT FROM '1'
    OR fixture.read_brilstash_page(repeat('k', 43), 2, 1, 365000)->'products' IS DISTINCT FROM '[]'::jsonb
    OR fixture.read_brilstash_page(repeat('k', 43), 1, 1, 365001)->>'totalPages' IS DISTINCT FROM '0'
  THEN RAISE EXCEPTION 'sandbox paging or inclusive filtering failed'; END IF;
END $$;
RESET ROLE;
UPDATE public.products SET status = 'draft' WHERE slug = 'fixture-phone';
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF fixture.read_brilstash_page(repeat('k', 43), 1, 100, 0)->>'status' IS DISTINCT FROM 'unavailable'
  THEN RAISE EXCEPTION 'unpublished item was still served'; END IF;
END $$;
RESET ROLE;
UPDATE public.products SET status = 'active' WHERE slug = 'fixture-phone';

SAVEPOINT reassigned_domain;
UPDATE public.domains SET merchant_id = '20000000-0000-4000-8000-000000000002'
WHERE domain = 'shop.example.invalid';
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF fixture.read_brilstash_page(repeat('k', 43), 1, 100, 0)->>'status' IS DISTINCT FROM 'unavailable'
  THEN RAISE EXCEPTION 'an active generation served a storefront reassigned to another merchant'; END IF;
END $$;
ROLLBACK TO SAVEPOINT reassigned_domain;
RELEASE SAVEPOINT reassigned_domain;

SAVEPOINT serialized_stock;
UPDATE public.products SET inventory_tracking_policy = 'serialized_strict' WHERE slug = 'fixture-phone';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '10000000-0000-4000-8000-000000000001';
DO $$
DECLARE installation uuid := '30000000-0000-4000-8000-000000000001';
BEGIN
  IF public.load_brilstash_catalogue_sources(installation)->'rows'->0->'inventory'
    IS DISTINCT FROM '{"kind":"serialized","units":0}'::jsonb
  THEN RAISE EXCEPTION 'empty serialized count did not report zero'; END IF;
  PERFORM set_config('fixture.serialized_count_error', 'true', true);
  BEGIN
    PERFORM public.load_brilstash_catalogue_sources(installation);
    RAISE EXCEPTION 'a failed serialized count was reported as successful';
  EXCEPTION WHEN SQLSTATE '22000' THEN NULL;
  END;
END $$;
RESET ROLE;
ROLLBACK TO SAVEPOINT serialized_stock;
RELEASE SAVEPOINT serialized_stock;

SAVEPOINT variant_visibility;
DELETE FROM public.product_variants WHERE id = '40000000-0000-4000-8000-000000000011';
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF fixture.read_brilstash_page(repeat('k', 43), 1, 100, 0)->>'status' IS DISTINCT FROM 'unavailable'
  THEN RAISE EXCEPTION 'a deleted variant was still served'; END IF;
END $$;
RESET ROLE;
ROLLBACK TO SAVEPOINT variant_visibility;
RELEASE SAVEPOINT variant_visibility;
