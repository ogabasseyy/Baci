-- ================================================================
-- REGRESSION TEST: storefront variant role parity and preview access
--
-- USAGE:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/storefront_product_variants_role_parity.sql
-- ================================================================

BEGIN;

SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $setup$
DECLARE
  v_owner_id uuid := '7f9d0e12-0000-4000-8000-000000000001';
  v_allowed_staff_id uuid := '7f9d0e12-0000-4000-8000-000000000002';
  v_denied_staff_id uuid := '7f9d0e12-0000-4000-8000-000000000003';
  v_customer_id uuid := '7f9d0e12-0000-4000-8000-000000000004';
  v_platform_admin_id uuid := '7f9d0e12-0000-4000-8000-000000000005';
  v_published_merchant_id uuid := '7f9d0e12-0000-4000-8000-000000000101';
  v_unpublished_merchant_id uuid := '7f9d0e12-0000-4000-8000-000000000102';
  v_second_unpublished_merchant_id uuid := '7f9d0e12-0000-4000-8000-000000000103';
  v_published_product_id uuid := '7f9d0e12-0000-4000-8000-000000000201';
  v_inactive_product_id uuid := '7f9d0e12-0000-4000-8000-000000000202';
  v_unpublished_product_id uuid := '7f9d0e12-0000-4000-8000-000000000203';
  v_second_unpublished_product_id uuid := '7f9d0e12-0000-4000-8000-000000000204';
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid =
      'public.get_storefront_product_variants(uuid[])'::pg_catalog.regprocedure
      AND proc.prosecdef
      AND proc.provolatile = 's'
      AND proc.proowner = 'postgres'::pg_catalog.regrole
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_options_to_table(
          COALESCE(proc.proconfig, ARRAY[]::text[])
        ) AS config
        WHERE config.option_name = 'search_path'
          AND pg_catalog.btrim(config.option_value, '"') = ''
      )
  ) THEN
    RAISE EXCEPTION
      'storefront variant RPC must be STABLE SECURITY DEFINER with blank search_path';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(proc.proacl, pg_catalog.acldefault('f', proc.proowner))
    ) AS acl
    WHERE proc.oid =
      'public.get_storefront_product_variants(uuid[])'::pg_catalog.regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC unexpectedly has EXECUTE on storefront variant RPC';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'anon', 'public.get_storefront_product_variants(uuid[])', 'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'authenticated', 'public.get_storefront_product_variants(uuid[])', 'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'service_role', 'public.get_storefront_product_variants(uuid[])', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'storefront variant RPC API role grants are incomplete';
  END IF;

  IF pg_catalog.has_function_privilege(
    'anon', 'private.get_storefront_product_variants(uuid[])', 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'authenticated', 'private.get_storefront_product_variants(uuid[])', 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'service_role', 'private.get_storefront_product_variants(uuid[])', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'API role unexpectedly executes private variant helper';
  END IF;

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_owner_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'variant-owner@example.com', 'test',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_allowed_staff_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'variant-staff@example.com', 'test',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_denied_staff_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'variant-denied@example.com', 'test',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_customer_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'variant-customer@example.com', 'test',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_platform_admin_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'variant-platform-admin@example.com',
      'test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

  INSERT INTO public.merchants (
    id, user_id, email, business_name, slug, is_published, is_platform_admin
  ) VALUES
    (v_published_merchant_id, v_platform_admin_id,
      'variant-platform-admin@example.com', 'Variant Public Fixture',
      'variant-public-fixture', true, true),
    (v_unpublished_merchant_id, v_owner_id, 'variant-preview@example.com',
      'Variant Preview Fixture', 'variant-preview-fixture', false, false),
    (v_second_unpublished_merchant_id, v_customer_id,
      'variant-preview-two@example.com', 'Variant Preview Fixture Two',
      'variant-preview-fixture-two', false, false);

  INSERT INTO public.staff_members (
    merchant_id, user_id, email, name, role, permissions, status
  ) VALUES
    (v_unpublished_merchant_id, v_allowed_staff_id,
      'variant-staff@example.com', 'Allowed Variant Staff', 'accountant',
      '{"orders":{"edit":false},"products":{"view":true,"edit":false,"manage_inventory":false}}'::jsonb,
      'active'),
    (v_unpublished_merchant_id, v_denied_staff_id,
      'variant-denied@example.com', 'Denied Variant Staff', 'accountant',
      '{"orders":{"edit":false},"products":{"view":false,"edit":false,"manage_inventory":false}}'::jsonb,
      'active');

  INSERT INTO public.products (
    id, merchant_id, name, slug, price, status, has_variants, manage_stock
  ) VALUES
    (v_published_product_id, v_published_merchant_id,
      'Published Variant Product', 'published-variant-product',
      100, 'active', true, false),
    (v_inactive_product_id, v_published_merchant_id,
      'Inactive Variant Product', 'inactive-variant-product',
      100, 'archived', true, false),
    (v_unpublished_product_id, v_unpublished_merchant_id,
      'Preview Variant Product', 'preview-variant-product',
      100, 'active', true, false),
    (v_second_unpublished_product_id, v_second_unpublished_merchant_id,
      'Second Preview Variant Product', 'second-preview-variant-product',
      100, 'active', true, false);

  INSERT INTO public.product_variants (
    id, merchant_id, product_id, sku, attributes, stock_quantity,
    is_inventory_anchor, created_at
  ) VALUES
    ('7f9d0e12-0000-4000-8000-000000000301', v_published_merchant_id,
      v_published_product_id, 'ROLE-PUBLIC-1', '{"storage":"128GB"}', 1, false,
      '2026-01-01 00:00:00+00'),
    ('7f9d0e12-0000-4000-8000-000000000302', v_published_merchant_id,
      v_published_product_id, 'ROLE-PUBLIC-2', '{"storage":"256GB"}', 1, false,
      '2026-01-02 00:00:00+00'),
    ('7f9d0e12-0000-4000-8000-000000000303', v_published_merchant_id,
      v_published_product_id, 'ROLE-HIDDEN-ANCHOR', '{"anchor":true}', 1, true,
      '2026-01-03 00:00:00+00'),
    ('7f9d0e12-0000-4000-8000-000000000304', v_published_merchant_id,
      v_inactive_product_id, 'ROLE-HIDDEN-INACTIVE', '{}', 1, false,
      '2026-01-04 00:00:00+00'),
    ('7f9d0e12-0000-4000-8000-000000000305', v_unpublished_merchant_id,
      v_unpublished_product_id, 'ROLE-PREVIEW', '{}', 1, false,
      '2026-01-05 00:00:00+00'),
    ('7f9d0e12-0000-4000-8000-000000000306',
      v_second_unpublished_merchant_id, v_second_unpublished_product_id,
      'ROLE-PREVIEW-TWO', '{}', 1, false, '2026-01-06 00:00:00+00');
END;
$setup$;

\ir storefront_product_variants_role_parity.helpers.inc.sql

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role', 'anon', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.assert_storefront_variant_ids('anon', NULL, ARRAY[
  '7f9d0e12-0000-4000-8000-000000000301'::uuid,
  '7f9d0e12-0000-4000-8000-000000000302'::uuid
]);
SELECT pg_temp.assert_storefront_variant_ids(
  'anon',
  '7f9d0e12-0000-4000-8000-000000000001',
  ARRAY[
    '7f9d0e12-0000-4000-8000-000000000301'::uuid,
    '7f9d0e12-0000-4000-8000-000000000302'::uuid
  ]
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_storefront_variant_ids(
  'authenticated', '7f9d0e12-0000-4000-8000-000000000004', ARRAY[
    '7f9d0e12-0000-4000-8000-000000000301'::uuid,
    '7f9d0e12-0000-4000-8000-000000000302'::uuid
  ]
);
SELECT pg_temp.assert_storefront_variant_ids(
  'authenticated', '7f9d0e12-0000-4000-8000-000000000005', ARRAY[
    '7f9d0e12-0000-4000-8000-000000000301'::uuid,
    '7f9d0e12-0000-4000-8000-000000000302'::uuid
  ]
);
SELECT pg_temp.assert_storefront_variant_ids(
  'authenticated', '7f9d0e12-0000-4000-8000-000000000001', ARRAY[
    '7f9d0e12-0000-4000-8000-000000000301'::uuid,
    '7f9d0e12-0000-4000-8000-000000000302'::uuid,
    '7f9d0e12-0000-4000-8000-000000000305'::uuid
  ]
);
SELECT pg_temp.assert_storefront_variant_ids(
  'authenticated', '7f9d0e12-0000-4000-8000-000000000002', ARRAY[
    '7f9d0e12-0000-4000-8000-000000000301'::uuid,
    '7f9d0e12-0000-4000-8000-000000000302'::uuid,
    '7f9d0e12-0000-4000-8000-000000000305'::uuid
  ]
);
SELECT pg_temp.assert_storefront_variant_ids(
  'authenticated', '7f9d0e12-0000-4000-8000-000000000003', ARRAY[
    '7f9d0e12-0000-4000-8000-000000000301'::uuid,
    '7f9d0e12-0000-4000-8000-000000000302'::uuid
  ]
);

DO $mixed_unpublished_bound$
DECLARE
  v_actual uuid[];
BEGIN
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.role', 'authenticated', true
  );
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub',
    '7f9d0e12-0000-4000-8000-000000000001',
    true
  );

  SELECT pg_catalog.array_agg(result.id ORDER BY result.ordinality)
    INTO v_actual
  FROM public.get_storefront_product_variants(ARRAY[
    '7f9d0e12-0000-4000-8000-000000000201'::uuid,
    '7f9d0e12-0000-4000-8000-000000000203'::uuid,
    '7f9d0e12-0000-4000-8000-000000000204'::uuid
  ]) WITH ORDINALITY AS result;

  IF COALESCE(v_actual, ARRAY[]::uuid[]) IS DISTINCT FROM ARRAY[
    '7f9d0e12-0000-4000-8000-000000000301'::uuid,
    '7f9d0e12-0000-4000-8000-000000000302'::uuid
  ] THEN
    RAISE EXCEPTION
      'mixed unpublished batch must retain only published variants, got %',
      v_actual;
  END IF;
END;
$mixed_unpublished_bound$;

DO $bound$
DECLARE
  v_rejected boolean := false;
BEGIN
  BEGIN
    PERFORM 1
    FROM public.get_storefront_product_variants(
      pg_catalog.array_fill(
        '7f9d0e12-0000-4000-8000-000000000201'::uuid,
        ARRAY[10001]
      )
    );
  EXCEPTION
    WHEN SQLSTATE '22023' THEN
      IF SQLERRM NOT LIKE
        'get_storefront_product_variants supports at most 10000 product IDs%'
      THEN
        RAISE;
      END IF;
      v_rejected := true;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION
      'storefront variant RPC must reject more than 10000 ids with SQLSTATE 22023';
  END IF;
END;
$bound$;
RESET ROLE;

ROLLBACK;
