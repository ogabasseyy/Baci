-- Anon bounds for get_storefront_product_base_inventory
-- (20261008290000): batches cap at 500 IDs, anon callers see
-- published-merchant rows only, and authorized owner preview of a
-- single unpublished merchant still works.
ALTER TABLE public.merchants DISABLE TRIGGER USER;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES ('01d40000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'base-inventory-owner@example.com', 'test',
  now(), now(), now(), '{}', '{}');
INSERT INTO public.merchants (id, user_id, email, business_name, slug, is_published)
VALUES ('01d40000-0000-4000-8000-000000000001', '01d40000-0000-4000-8000-000000000002',
  'base-inventory-pub@example.com', 'Base Inventory Pub', 'base-inventory-pub', true),
  ('01d40000-0000-4000-8000-000000000003', '01d40000-0000-4000-8000-000000000002',
  'base-inventory-hidden@example.com', 'Base Inventory Hidden', 'base-inventory-hidden', false);
ALTER TABLE public.merchants ENABLE TRIGGER USER;

ALTER TABLE public.products DISABLE TRIGGER USER;
INSERT INTO public.products (id, merchant_id, name, price, manage_stock, status)
VALUES ('01d40000-0000-4000-8000-000000000011', '01d40000-0000-4000-8000-000000000001',
  'Published Widget', 1000, true, 'active'),
  ('01d40000-0000-4000-8000-000000000012', '01d40000-0000-4000-8000-000000000003',
  'Hidden Widget', 2000, true, 'active');
ALTER TABLE public.products ENABLE TRIGGER USER;

-- Batches over 500 IDs are rejected before any fan-out work.
DO $$
DECLARE
  v_ids uuid[];
BEGIN
  SELECT array_agg(g) INTO v_ids
  FROM (SELECT gen_random_uuid() AS g FROM generate_series(1, 501)) s;
  BEGIN
    PERFORM * FROM public.get_storefront_product_base_inventory(v_ids);
    RAISE EXCEPTION 'Expected 501-ID batch rejection';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT LIKE '%at most 500 product IDs%' THEN
      RAISE EXCEPTION 'Batch was not rejected by the cap: %', SQLERRM;
    END IF;
  END;
END $$;

-- The 500-ID boundary is accepted (random IDs match nothing, but the
-- call itself must not raise).
DO $$
DECLARE
  v_ids uuid[];
  n bigint;
BEGIN
  SELECT array_agg(g) INTO v_ids
  FROM (SELECT gen_random_uuid() AS g FROM generate_series(1, 500)) s;
  SELECT count(*) INTO n
  FROM public.get_storefront_product_base_inventory(v_ids);
  IF n <> 0 THEN
    RAISE EXCEPTION 'Expected zero rows for unknown IDs, got %', n;
  END IF;
END $$;

-- Anon sees the published row and none of the unpublished merchant.
SET ROLE anon;
DO $$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n
  FROM public.get_storefront_product_base_inventory(
    ARRAY['01d40000-0000-4000-8000-000000000011'::uuid]);
  IF n <> 1 THEN
    RAISE EXCEPTION 'Anon must see the published row, got %', n;
  END IF;
  SELECT count(*) INTO n
  FROM public.get_storefront_product_base_inventory(
    ARRAY['01d40000-0000-4000-8000-000000000012'::uuid]);
  IF n <> 0 THEN
    RAISE EXCEPTION 'Anon must not see unpublished rows, got %', n;
  END IF;
END $$;
RESET ROLE;

-- The owning user keeps single-merchant unpublished preview.
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '01d40000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n
  FROM public.get_storefront_product_base_inventory(
    ARRAY['01d40000-0000-4000-8000-000000000012'::uuid]);
  IF n <> 1 THEN
    RAISE EXCEPTION 'Owner must keep unpublished preview, got %', n;
  END IF;
END $$;
RESET ROLE;
