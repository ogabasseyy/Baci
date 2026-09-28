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
   'Archived Discovery Camera', 'archived-discovery-camera', 50000, 'archived'),
  ('cb58d110-0000-4000-8000-000000000103', 'cb58d110-0000-4000-8000-000000000001',
   'New Discovery Camera', 'new-discovery-camera', 50000, 'active');

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

RESET ROLE;
INSERT INTO auth.users (id) VALUES ('cb58d110-0000-4000-8000-000000000201');
SET LOCAL ROLE service_role;
INSERT INTO public.staff_members (merchant_id, user_id, email, status, permissions)
VALUES ('cb58d110-0000-4000-8000-000000000001',
  'cb58d110-0000-4000-8000-000000000201', 'read-only@example.test', 'active',
  '{"products":{"edit":false}}'::jsonb);

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config('request.jwt.claim.sub', 'cb58d110-0000-4000-8000-000000000201', true);

DO $permissions$
DECLARE affected integer;
BEGIN
  IF NOT public.has_merchant_access('cb58d110-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'staff fixture must have merchant read access';
  END IF;
  UPDATE public.product_discovery_embeddings SET generated_at = now()
  WHERE product_id = 'cb58d110-0000-4000-8000-000000000101';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'read-only staff updated an embedding';
  END IF;
  BEGIN
    INSERT INTO public.product_discovery_embeddings (
      product_id, merchant_id, embedding, source_updated_at
    ) VALUES (
      'cb58d110-0000-4000-8000-000000000103',
      'cb58d110-0000-4000-8000-000000000001',
      ('[' || repeat('0,', 767) || '1]')::extensions.vector(768), now()
    );
    RAISE EXCEPTION 'read-only staff inserted an embedding';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$permissions$;

SET LOCAL ROLE service_role;
UPDATE public.staff_members SET permissions = '{"products":{"edit":true}}'::jsonb
WHERE user_id = 'cb58d110-0000-4000-8000-000000000201';
SET LOCAL ROLE authenticated;
DO $editor$
DECLARE affected integer;
BEGIN
  UPDATE public.product_discovery_embeddings SET generated_at = now()
  WHERE product_id = 'cb58d110-0000-4000-8000-000000000101';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'product editor cannot update an embedding';
  END IF;
END;
$editor$;

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
