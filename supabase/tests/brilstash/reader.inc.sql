INSERT INTO private.brilstash_credentials (installation_id, bearer_digest)
VALUES ('30000000-0000-4000-8000-000000000001', sha256(convert_to(repeat('k', 43), 'UTF8')));
UPDATE private.brilstash_installations i SET intended_credential_id = c.id
FROM private.brilstash_credentials c WHERE i.id = c.installation_id
  AND i.id = '30000000-0000-4000-8000-000000000001';
SET LOCAL ROLE anon;
DO $$
DECLARE result jsonb;
BEGIN
  result := public.read_brilstash_page(repeat('k', 43), 1, 100, 0);
  IF result->>'status' IS DISTINCT FROM 'ok'
    OR result->>'totalCount' IS DISTINCT FROM '1'
    OR result->'products'->0->>'external_id' IS DISTINCT FROM 'fixture-one'
  THEN RAISE EXCEPTION 'credential did not read the expected generation: %', result; END IF;
  IF public.read_brilstash_page(repeat('z', 43), 1, 100, 0)->>'status' IS DISTINCT FROM 'unauthorized'
    OR public.read_brilstash_page(repeat('k', 43), 2, 100, 0)->>'status' IS DISTINCT FROM 'invalid_query'
    OR public.read_brilstash_page(repeat('k', 43), 1, 100, 300000)->>'status' IS DISTINCT FROM 'invalid_query'
  THEN RAISE EXCEPTION 'reader accepted incorrect auth or a partial pilot import'; END IF;
END $$;
RESET ROLE;
UPDATE private.brilstash_installations SET single_page_only = false
WHERE id = '30000000-0000-4000-8000-000000000001';
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF public.read_brilstash_page(repeat('k', 43), 1, 1, 365000)->>'totalCount' IS DISTINCT FROM '1'
    OR public.read_brilstash_page(repeat('k', 43), 2, 1, 365000)->'products' IS DISTINCT FROM '[]'::jsonb
    OR public.read_brilstash_page(repeat('k', 43), 1, 1, 365001)->>'totalPages' IS DISTINCT FROM '0'
  THEN RAISE EXCEPTION 'sandbox paging or inclusive filtering failed'; END IF;
END $$;
RESET ROLE;
UPDATE public.products SET status = 'draft' WHERE slug = 'fixture-phone';
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF public.read_brilstash_page(repeat('k', 43), 1, 100, 0)->>'status' IS DISTINCT FROM 'unavailable'
  THEN RAISE EXCEPTION 'unpublished item was still served'; END IF;
END $$;
RESET ROLE;
UPDATE public.products SET status = 'active' WHERE slug = 'fixture-phone';
