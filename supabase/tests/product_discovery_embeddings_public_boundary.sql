-- Public search returns only active, merchant-scoped IDs, never raw vectors.
BEGIN;
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO public.merchants (id, email, business_name, slug)
VALUES (
  'cb58d110-0000-4000-8000-000000000001',
  'discovery-test@example.test',
  'Discovery Test Merchant',
  'discovery-test-merchant'
);

INSERT INTO public.products (id, merchant_id, name, slug, price, status)
VALUES
  ('cb58d110-0000-4000-8000-000000000101', 'cb58d110-0000-4000-8000-000000000001',
   'Active Discovery Camera', 'active-discovery-camera', 50000, 'active'),
  ('cb58d110-0000-4000-8000-000000000102', 'cb58d110-0000-4000-8000-000000000001',
   'Archived Discovery Camera', 'archived-discovery-camera', 50000, 'archived');

INSERT INTO public.product_discovery_embeddings (
  product_id, merchant_id, embedding, source_updated_at
)
SELECT p.id, p.merchant_id,
  ('[' || repeat('0,', 767) || '1]')::extensions.vector(768), p.updated_at
FROM public.products p
WHERE p.id IN (
  'cb58d110-0000-4000-8000-000000000101',
  'cb58d110-0000-4000-8000-000000000102'
);

DO $boundary$
BEGIN
  IF pg_catalog.has_table_privilege('anon', 'public.product_discovery_embeddings', 'SELECT') THEN
    RAISE EXCEPTION 'anonymous callers must not read raw product embeddings';
  END IF;
END;
$boundary$;

SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'anon', true);

DO $search$
DECLARE
  result_ids uuid[];
BEGIN
  SELECT array_agg(result.product_id ORDER BY result.product_id)
  INTO result_ids
  FROM public.search_product_discovery_embeddings(
    ('[' || repeat('0,', 767) || '1]')::extensions.vector(768),
    'cb58d110-0000-4000-8000-000000000001', 20
  ) AS result;
  IF result_ids IS DISTINCT FROM ARRAY['cb58d110-0000-4000-8000-000000000101'::uuid] THEN
    RAISE EXCEPTION 'public search exposed an inactive or unrelated product: %', result_ids;
  END IF;
END;
$search$;

ROLLBACK;
