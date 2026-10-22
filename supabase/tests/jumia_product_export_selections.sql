-- Disposable chronological-replay pgTAP contract for Jumia selection snapshots.
-- No provider calls or hosted data are involved.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(9);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role","sub":"00000000-0000-0000-0000-000000000000"}',
  true
);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true
);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT ok(
  auth.uid() = '00000000-0000-0000-0000-000000000000'::uuid
  AND auth.jwt()->>'role' = 'service_role',
  'fixture writes start with a deterministic service-role JWT context'
);

-- Keep fixture writes as separate statements so replay failures identify the
-- exact audited table operation instead of only the end of a large DO block.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data,
  raw_user_meta_data
) VALUES
  ('11111111-1111-4111-8111-111111111101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jumia-selection-owner@example.test', 'test', now(), now(), now(), '{}', '{}'),
  ('11111111-1111-4111-8111-111111111102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jumia-selection-stranger@example.test', 'test', now(), now(), now(), '{}', '{}'),
  ('11111111-1111-4111-8111-111111111103', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jumia-selection-staff@example.test', 'test', now(), now(), now(), '{}', '{}'),
  ('11111111-1111-4111-8111-111111111104', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jumia-selection-limited-staff@example.test', 'test', now(), now(), now(), '{}', '{}');

INSERT INTO public.merchants (
  id, user_id, email, business_name, slug, plan_tier, premium_features
) VALUES
  ('22222222-2222-4222-8222-222222222201', '11111111-1111-4111-8111-111111111101', 'jumia-selection-merchant@example.test', 'Selection Merchant', 'jumia-selection-merchant', 'pro', '[]'),
  ('22222222-2222-4222-8222-222222222202', '11111111-1111-4111-8111-111111111102', 'jumia-selection-other@example.test', 'Other Merchant', 'jumia-selection-other', 'free', '[]');

INSERT INTO public.staff_members (
  merchant_id, user_id, email, name, role, permissions, status
) VALUES (
  '22222222-2222-4222-8222-222222222201', '11111111-1111-4111-8111-111111111103', 'jumia-selection-staff@example.test', 'Selection Staff',
  'manager', '{"integrations":{"manage":true}}', 'active'
);
INSERT INTO public.staff_members (
  merchant_id, user_id, email, name, role, permissions, status
) VALUES (
  '22222222-2222-4222-8222-222222222201', '11111111-1111-4111-8111-111111111104', 'jumia-selection-limited-staff@example.test',
  'Limited Staff', 'sales_rep', '{"catalog":{"read":true}}', 'active'
);

INSERT INTO public.categories (id, merchant_id, name, slug, is_active) VALUES
  ('33333333-3333-4333-8333-333333333301', '22222222-2222-4222-8222-222222222201', 'Gaming', 'gaming', true),
  ('33333333-3333-4333-8333-333333333302', '22222222-2222-4222-8222-222222222201', 'Electronics', 'electronics', true),
  ('33333333-3333-4333-8333-333333333303', '22222222-2222-4222-8222-222222222202', 'Gaming', 'gaming', true);

INSERT INTO public.products (
  id, merchant_id, name, description, price, status, sku, stock,
  stock_quantity, manage_stock, has_variants, category, category_id, images
) VALUES
  ('44444444-4444-4444-8444-444444444401', '22222222-2222-4222-8222-222222222201', 'Direct controller', 'Controller', 12000, 'active', 'CTRL-1', 5, 5, true, false, 'Gaming', '33333333-3333-4333-8333-333333333301', '[]'::jsonb),
  ('44444444-4444-4444-8444-444444444402', '22222222-2222-4222-8222-222222222201', 'Linked headset', 'Headset', 22000, 'active', 'HEAD-1', 7, 7, true, false, 'Audio', NULL, '[]'::jsonb),
  ('44444444-4444-4444-8444-444444444403', '22222222-2222-4222-8222-222222222201', 'Dual listed console', 'Console', 90000, 'active', 'CONSOLE-1', 3, 3, true, true, 'Gaming', '33333333-3333-4333-8333-333333333301', '["https://assets.example.test/export.jpg"]'::jsonb),
  ('44444444-4444-4444-8444-444444444404', '22222222-2222-4222-8222-222222222201', 'Draft console', 'Draft', 50000, 'draft', 'DRAFT-1', 1, 1, true, false, 'Gaming', '33333333-3333-4333-8333-333333333301', '[]'::jsonb),
  ('44444444-4444-4444-8444-444444444405', '22222222-2222-4222-8222-222222222201', 'Legacy label only', 'Legacy', 5000, 'active', 'LEGACY-1', 1, 1, true, false, 'Gaming', NULL, '[]'::jsonb);

INSERT INTO public.product_categories (id, product_id, category_id, is_primary) VALUES
  ('55555555-5555-4555-8555-555555555501', '44444444-4444-4444-8444-444444444402', '33333333-3333-4333-8333-333333333301', true),
  ('55555555-5555-4555-8555-555555555502', '44444444-4444-4444-8444-444444444403', '33333333-3333-4333-8333-333333333301', false);

INSERT INTO public.product_variants (
  id, product_id, merchant_id, attributes, sku, stock_quantity, price_override,
  is_inventory_anchor
) VALUES (
  '66666666-6666-4666-8666-666666666601',
  '44444444-4444-4444-8444-444444444403', '22222222-2222-4222-8222-222222222201',
  '{"color":"black"}', 'CONSOLE-BLK', 3, 95000, true
);

INSERT INTO public.product_feed_images (
  id, merchant_id, product_id, source_url, verified_url, verified_format,
  status, is_primary, position
) VALUES (
  '77777777-7777-4777-8777-777777777701', '22222222-2222-4222-8222-222222222201',
  '44444444-4444-4444-8444-444444444403',
  'https://assets.example.test/source.jpg', 'https://assets.example.test/verified.jpg',
  'jpeg', 'verified', true, 0
);

SELECT ok(
  has_table_privilege('authenticated', 'public.jumia_product_export_selections', 'SELECT')
  AND has_table_privilege('authenticated', 'public.jumia_product_export_selection_items', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.jumia_product_export_selections', 'INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('authenticated', 'public.jumia_product_export_selection_items', 'INSERT,UPDATE,DELETE'),
  'authenticated callers can read but cannot directly mutate selection snapshots'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.create_jumia_product_export_selection(uuid,uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.create_jumia_product_export_selection(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'private.jumia_product_export_source_projection_v1(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'private.jumia_product_export_source_version_v1(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'private.merchant_has_marketplace_sync_v1(uuid,timestamp with time zone)', 'EXECUTE'),
  'only authenticated callers can invoke the guarded snapshot RPC, not private helpers'
);

SELECT is(
  private.merchant_has_marketplace_sync_v1('22222222-2222-4222-8222-222222222201', '2026-10-22 12:00:00+00'::timestamptz),
  true,
  'Pro tier is entitled when the expiry is in the future'
);
SELECT is(
  private.merchant_has_marketplace_sync_v1('22222222-2222-4222-8222-222222222202', '2026-10-22 12:00:00+00'::timestamptz),
  false,
  'free tier without an explicit override is not entitled'
);

DO $entitlement_fixtures$
BEGIN
  UPDATE public.merchants SET plan_tier = 'enterprise', plan_expires_at = '2026-10-22 12:00:00+00'
  WHERE id = '22222222-2222-4222-8222-222222222201';
  IF private.merchant_has_marketplace_sync_v1('22222222-2222-4222-8222-222222222201', '2026-10-22 12:00:00+00') THEN
    RAISE EXCEPTION 'expiry equality must be denied';
  END IF;
  UPDATE public.merchants SET premium_features = '[" Marketplace_Sync "]', plan_expires_at = '2020-01-01 00:00:00+00'
  WHERE id = '22222222-2222-4222-8222-222222222201';
  IF NOT private.merchant_has_marketplace_sync_v1('22222222-2222-4222-8222-222222222201', '2026-10-22 12:00:00+00') THEN
    RAISE EXCEPTION 'normalized explicit marketplace_sync override must take precedence over expiry';
  END IF;
  UPDATE public.merchants SET premium_features = '[" ALL_FEATURES "]'
  WHERE id = '22222222-2222-4222-8222-222222222201';
  IF NOT private.merchant_has_marketplace_sync_v1('22222222-2222-4222-8222-222222222201', '2026-10-22 12:00:00+00') THEN
    RAISE EXCEPTION 'normalized all_features override must be honored';
  END IF;
  UPDATE public.merchants
  SET plan_tier = 'free', premium_features = jsonb_build_array(E'\tMarketplace_Sync\n'),
      plan_expires_at = '2020-01-01 00:00:00+00'
  WHERE id = '22222222-2222-4222-8222-222222222201';
  IF NOT private.merchant_has_marketplace_sync_v1('22222222-2222-4222-8222-222222222201', '2026-10-22 12:00:00+00') THEN
    RAISE EXCEPTION 'JavaScript-trimmed tab/newline feature override must be honored';
  END IF;
  UPDATE public.merchants SET plan_tier = 'pro', premium_features = '[]', plan_expires_at = NULL
  WHERE id = '22222222-2222-4222-8222-222222222201';
END;
$entitlement_fixtures$;
SELECT ok(true, 'SQL entitlement matches normalized explicit overrides and strict expiry boundaries');

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'sub', '11111111-1111-4111-8111-111111111101'
)::text, true);
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111101', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
DO $capture$
DECLARE
  v_selection record;
  v_version text;
BEGIN
  IF auth.uid() IS DISTINCT FROM '11111111-1111-4111-8111-111111111101'::uuid
    OR auth.jwt()->>'role' IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'owner capture fixture has inconsistent JWT claim settings';
  END IF;
  SELECT * INTO v_selection FROM public.create_jumia_product_export_selection(
    '22222222-2222-4222-8222-222222222201',
    '33333333-3333-4333-8333-333333333301'
  );
  IF v_selection.selection_id IS NULL OR v_selection.total <> 3 THEN
    RAISE EXCEPTION 'Gaming snapshot expected three active direct/junction products, got %', row_to_json(v_selection);
  END IF;
  IF v_selection.expires_at <= v_selection.captured_at THEN
    RAISE EXCEPTION 'snapshot expiry must follow capture';
  END IF;
  BEGIN
    PERFORM public.create_jumia_product_export_selection(
      '22222222-2222-4222-8222-222222222201',
      '33333333-3333-4333-8333-333333333302'
    );
    RAISE EXCEPTION 'non-Gaming category was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  IF (SELECT count(*) FROM public.jumia_product_export_selections
      WHERE merchant_id = '22222222-2222-4222-8222-222222222201') <> 1 THEN
    RAISE EXCEPTION 'invalid category request persisted a selection';
  END IF;
  PERFORM pg_catalog.set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'sub', '11111111-1111-4111-8111-111111111103'
  )::text, true);
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111103', true);
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  IF auth.uid() IS DISTINCT FROM '11111111-1111-4111-8111-111111111103'::uuid
    OR auth.jwt()->>'role' IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'manager capture fixture has inconsistent JWT claim settings';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.create_jumia_product_export_selection(
      '22222222-2222-4222-8222-222222222201',
      '33333333-3333-4333-8333-333333333301'
    ) WHERE total = 3
  ) THEN
    RAISE EXCEPTION 'active integrations.manage staff could not capture a snapshot';
  END IF;
  PERFORM pg_catalog.set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'sub', '11111111-1111-4111-8111-111111111101'
  )::text, true);
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111101', true);
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  IF auth.uid() IS DISTINCT FROM '11111111-1111-4111-8111-111111111101'::uuid
    OR auth.jwt()->>'role' IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'restored owner fixture has inconsistent JWT claim settings';
  END IF;
  SELECT source_version INTO v_version FROM public.jumia_product_export_selection_items
  WHERE selection_id = v_selection.selection_id AND product_id = '44444444-4444-4444-8444-444444444403';
  IF v_version !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'snapshot did not persist the canonical SHA-256 source version';
  END IF;
  PERFORM pg_catalog.set_config('test.jumia_selection_id', v_selection.selection_id::text, true);
  PERFORM pg_catalog.set_config('test.jumia_selection_source_version', v_version, true);
END;
$capture$;
RESET ROLE;

DO $source_versions$
DECLARE
  v_selection_id uuid := pg_catalog.current_setting('test.jumia_selection_id')::uuid;
  v_source_version text := pg_catalog.current_setting('test.jumia_selection_source_version');
  v_projection jsonb;
  v_version text;
BEGIN
  SELECT private.jumia_product_export_source_projection_v1(
    '22222222-2222-4222-8222-222222222201',
    '44444444-4444-4444-8444-444444444403'
  ) INTO v_projection;
  IF v_projection->'variants'->0->>'isInventoryAnchor' IS DISTINCT FROM 'true'
    OR v_projection->'product'->>'inventoryAnchorVariantId' IS NOT NULL
    OR v_projection->'product'->'exportImages' IS DISTINCT FROM '["https://assets.example.test/export.jpg"]'::jsonb
    OR v_projection->'images'->0->>'verifiedUrl' IS DISTINCT FROM 'https://assets.example.test/verified.jpg' THEN
    RAISE EXCEPTION 'source projection omitted the canonical variant anchor flag, pointer, product export images, or verified image input';
  END IF;
  UPDATE public.product_variants SET is_inventory_anchor = false
  WHERE id = '66666666-6666-4666-8666-666666666601';
  IF private.jumia_product_export_source_version_v1(
    '22222222-2222-4222-8222-222222222201',
    '44444444-4444-4444-8444-444444444403'
  ) = v_source_version THEN
    RAISE EXCEPTION 'canonical variant anchor flag change did not alter source version';
  END IF;
  UPDATE public.product_variants SET is_inventory_anchor = true
  WHERE id = '66666666-6666-4666-8666-666666666601';
  DELETE FROM public.product_categories WHERE product_id = '44444444-4444-4444-8444-444444444403';
  UPDATE public.products SET category_id = '33333333-3333-4333-8333-333333333302'
  WHERE id = '44444444-4444-4444-8444-444444444403';
  v_version := private.jumia_product_export_source_version_v1(
    '22222222-2222-4222-8222-222222222201',
    '44444444-4444-4444-8444-444444444403'
  );
  IF v_version = v_source_version THEN
    RAISE EXCEPTION 'category membership change did not alter source version';
  END IF;
  UPDATE public.product_variants SET price_override = 96000
  WHERE id = '66666666-6666-4666-8666-666666666601';
  IF private.jumia_product_export_source_version_v1(
    '22222222-2222-4222-8222-222222222201',
    '44444444-4444-4444-8444-444444444403'
  ) = v_version THEN
    RAISE EXCEPTION 'variant change did not alter source version';
  END IF;
  v_version := private.jumia_product_export_source_version_v1(
    '22222222-2222-4222-8222-222222222201',
    '44444444-4444-4444-8444-444444444403'
  );
  UPDATE public.product_feed_images SET verified_url = 'https://assets.example.test/verified-v2.jpg'
  WHERE id = '77777777-7777-4777-8777-777777777701';
  IF private.jumia_product_export_source_version_v1(
    '22222222-2222-4222-8222-222222222201',
    '44444444-4444-4444-8444-444444444403'
  ) = v_version THEN
    RAISE EXCEPTION 'verified image change did not alter source version';
  END IF;
  v_version := private.jumia_product_export_source_version_v1(
    '22222222-2222-4222-8222-222222222201',
    '44444444-4444-4444-8444-444444444403'
  );
  UPDATE public.products
  SET images = '["https://assets.example.test/export-v2.jpg"]'::jsonb
  WHERE id = '44444444-4444-4444-8444-444444444403';
  IF private.jumia_product_export_source_version_v1(
    '22222222-2222-4222-8222-222222222201',
    '44444444-4444-4444-8444-444444444403'
  ) = v_version THEN
    RAISE EXCEPTION 'product export image change did not alter source version';
  END IF;
  INSERT INTO public.products (
    id, merchant_id, name, description, price, status, sku, stock,
    stock_quantity, manage_stock, has_variants, category, category_id
  ) VALUES (
    '44444444-4444-4444-8444-444444444406',
    '22222222-2222-4222-8222-222222222201', 'Later gaming product',
    'Added after capture', 3000, 'active', 'LATER-1', 1, 1, true, false,
    'Gaming', '33333333-3333-4333-8333-333333333301'
  );
  DELETE FROM public.products WHERE id = '44444444-4444-4444-8444-444444444401';
  IF (SELECT count(*) FROM public.jumia_product_export_selection_items WHERE selection_id = v_selection_id) <> 3 THEN
    RAISE EXCEPTION 'snapshot membership/count changed after catalog edit or delete';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.jumia_product_export_selection_items
    WHERE selection_id = v_selection_id AND product_id = '44444444-4444-4444-8444-444444444401'
  ) THEN
    RAISE EXCEPTION 'deleted snapshot product identity was not retained';
  END IF;
END;
$source_versions$;
SELECT ok(true, 'capture freezes exact membership and source versions while later catalog changes remain detectable');

SELECT set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'sub', '11111111-1111-4111-8111-111111111102'
)::text, true);
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111102', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::integer FROM public.jumia_product_export_selections)
    + (SELECT count(*)::integer FROM public.jumia_product_export_selection_items),
  0,
  'another merchant cannot read selection headers or item snapshots'
);
DO $denials$
BEGIN
  IF auth.uid() IS DISTINCT FROM '11111111-1111-4111-8111-111111111102'::uuid
    OR auth.jwt()->>'role' IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'stranger fixture has inconsistent JWT claim settings';
  END IF;
  BEGIN
    PERFORM public.create_jumia_product_export_selection(
      '22222222-2222-4222-8222-222222222201',
      '33333333-3333-4333-8333-333333333301'
    );
    RAISE EXCEPTION 'cross-merchant selection creation was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.create_jumia_product_export_selection(
      '22222222-2222-4222-8222-222222222202',
      '33333333-3333-4333-8333-333333333303'
    );
    RAISE EXCEPTION 'free merchant selection creation was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM pg_catalog.set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'sub', '11111111-1111-4111-8111-111111111104'
  )::text, true);
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111104', true);
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  IF auth.uid() IS DISTINCT FROM '11111111-1111-4111-8111-111111111104'::uuid
    OR auth.jwt()->>'role' IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'limited staff fixture has inconsistent JWT claim settings';
  END IF;
  BEGIN
    PERFORM public.create_jumia_product_export_selection(
      '22222222-2222-4222-8222-222222222201',
      '33333333-3333-4333-8333-333333333301'
    );
    RAISE EXCEPTION 'staff without integrations.manage was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$denials$;
RESET ROLE;
SELECT ok(true, 'cross-merchant and non-entitled snapshot requests fail closed');

SELECT * FROM finish();
ROLLBACK;
