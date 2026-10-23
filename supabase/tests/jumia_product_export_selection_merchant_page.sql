-- Merchant-bound page RPC authorization and delegation contract.
-- Fixtures are disposable; no provider calls or hosted data are involved.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(3);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role","sub":"00000000-0000-0000-0000-000000000000"}', true);
SELECT pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data,
  raw_user_meta_data
) VALUES
  ('11111111-1111-4111-8111-111111111101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jumia-page-owner@example.test', 'test', now(), now(), now(), '{}', '{}'),
  ('11111111-1111-4111-8111-111111111102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jumia-page-other@example.test', 'test', now(), now(), now(), '{}', '{}'),
  ('11111111-1111-4111-8111-111111111103', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jumia-page-staff@example.test', 'test', now(), now(), now(), '{}', '{}');

INSERT INTO public.merchants (
  id, user_id, email, business_name, slug, plan_tier, premium_features
) VALUES
  ('22222222-2222-4222-8222-222222222201', '11111111-1111-4111-8111-111111111101', 'jumia-page-owner@example.test', 'Page Merchant', 'jumia-page-merchant', 'pro', '[]'),
  ('22222222-2222-4222-8222-222222222202', '11111111-1111-4111-8111-111111111102', 'jumia-page-other@example.test', 'Other Page Merchant', 'jumia-page-other', 'pro', '[]');

INSERT INTO public.staff_members (
  merchant_id, user_id, email, name, role, permissions, status
) VALUES
  ('22222222-2222-4222-8222-222222222201', '11111111-1111-4111-8111-111111111103', 'jumia-page-staff@example.test', 'Page Staff', 'manager', '{"integrations":{"manage":true}}', 'active'),
  ('22222222-2222-4222-8222-222222222202', '11111111-1111-4111-8111-111111111103', 'jumia-page-staff@example.test', 'Page Staff', 'manager', '{"integrations":{"manage":true}}', 'active');

INSERT INTO public.categories (id, merchant_id, name, slug, is_active) VALUES
  ('33333333-3333-4333-8333-333333333301', '22222222-2222-4222-8222-222222222201', 'Gaming', 'gaming', true);
INSERT INTO public.products (
  id, merchant_id, name, description, price, status, sku, stock,
  stock_quantity, manage_stock, has_variants, category, category_id, images
) VALUES (
  '44444444-4444-4444-8444-444444444401', '22222222-2222-4222-8222-222222222201',
  'Page test controller', 'Controller', 12000, 'active', 'PAGE-1', 5, 5, true,
  false, 'Gaming', '33333333-3333-4333-8333-333333333301', '[]'::jsonb
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.get_jumia_product_export_selection_page_for_merchant(uuid,uuid,integer,integer)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.get_jumia_product_export_selection_page_for_merchant(uuid,uuid,integer,integer)', 'EXECUTE'),
  'only authenticated callers can invoke the merchant-bound page RPC'
);

SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated","sub":"11111111-1111-4111-8111-111111111101"}', true);
SELECT pg_catalog.set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111101', true);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'test.jumia_merchant_page_selection_id',
  (SELECT selection_id::text FROM public.create_jumia_product_export_selection(
    '22222222-2222-4222-8222-222222222201',
    '33333333-3333-4333-8333-333333333301'
  )),
  true
);
SELECT ok(
  (public.get_jumia_product_export_selection_page_for_merchant(
    pg_catalog.current_setting('test.jumia_merchant_page_selection_id')::uuid,
    '22222222-2222-4222-8222-222222222201', 1, 50
  )->>'total') = '1',
  'the matching merchant context delegates to the canonical page RPC'
);

SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated","sub":"11111111-1111-4111-8111-111111111103"}', true);
SELECT pg_catalog.set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111103', true);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT throws_ok(
  format(
    'SELECT public.get_jumia_product_export_selection_page_for_merchant(%L::uuid, %L::uuid, 1, 50)',
    pg_catalog.current_setting('test.jumia_merchant_page_selection_id'),
    '22222222-2222-4222-8222-222222222202'
  ),
  '42501', 'Jumia selection not found',
  'staff authorized for both merchants cannot read a selection under the wrong merchant context'
);
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
