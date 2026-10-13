-- =============================================
-- REGRESSION TEST: jumia submitted price fault paths
--   Companion to jumia_variant_price_optimistic_guard.sql (split for the
--   300-line modularity rule): unknown targets fail closed with 22023 in
--   both RPC phases, malformed scalar payloads fail closed, and the
--   deprecated two-argument overload keeps pre-guard behavior for the
--   live route during the predeploy window.
--
-- USAGE:
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/migrations/tests/jumia_submitted_price_update_faults.sql
--
-- This script intentionally mutates inside a transaction and rolls back.
-- =============================================

BEGIN;

-- Seed the owner row as the session superuser (service_role cannot write
-- the auth schema).
INSERT INTO auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data
) VALUES (
  '00000000-0000-4000-8000-00000000f100',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'jumia-guard-owner@example.com',
  'test',
  now(),
  now(),
  now(),
  '{}'::jsonb,
  '{}'::jsonb
);

-- merchants writes fire the identity-audit trigger, whose canonical writer
-- requires an audit actor (raises audit_actor_required/28000 without one):
-- run fixtures as service_role like the other merchants-seeding replay
-- checks (e.g. repair_booking_rpc, santa_catalog_projection).
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_owner_user_id uuid := '00000000-0000-4000-8000-00000000f100';
  v_merchant_id uuid := '00000000-0000-4000-8000-00000000f101';
  v_product_id uuid := '00000000-0000-4000-8000-00000000f201';
  v_mapping_id uuid := '00000000-0000-4000-8000-00000000f301';
  v_unstamped_id uuid := '00000000-0000-4000-8000-00000000f303';
  v_third_id uuid := '00000000-0000-4000-8000-00000000f304';
  v_token_older text := '00000000-0000-4000-8000-00000000f401';
BEGIN
  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES (
    v_merchant_id,
    v_owner_user_id,
    'jumia-guard@example.com',
    'Jumia Guard Test',
    'jumia-guard-test'
  );

  INSERT INTO public.products (id, merchant_id, name, price)
  VALUES (v_product_id, v_merchant_id, 'Guard Widget', 1000);

  INSERT INTO public.jumia_product_mappings (
    id,
    merchant_id,
    product_id,
    jumia_sku,
    jumia_shop_id,
    jumia_price,
    update_token
  ) VALUES (
    v_mapping_id,
    v_merchant_id,
    v_product_id,
    'GUARD-SKU-1',
    'shop-guard',
    1000,
    v_token_older
  ), (
    v_unstamped_id,
    v_merchant_id,
    v_product_id,
    'GUARD-SKU-2',
    'shop-guard-2',
    2000,
    NULL
  ), (
    v_third_id,
    v_merchant_id,
    v_product_id,
    'GUARD-SKU-3',
    'shop-guard-3',
    3000,
    v_token_older
  );
END $$;

-- The owner session authorizes the guarded RPC and reads back its own
-- mapping rows through the merchant RLS policies.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', '00000000-0000-4000-8000-00000000f100', true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'role', 'authenticated', 'sub', '00000000-0000-4000-8000-00000000f100'
  )::text,
  true
);

DO $$
DECLARE
  v_merchant_id uuid := '00000000-0000-4000-8000-00000000f101';
  v_mapping_id uuid := '00000000-0000-4000-8000-00000000f301';
  v_missing_id uuid := '00000000-0000-4000-8000-00000000f302';
  v_token_older text := '00000000-0000-4000-8000-00000000f401';
  v_token_claim text := '00000000-0000-4000-8000-00000000f403';
  v_price numeric;
BEGIN
  -- Unknown targets keep the original 22023 failure in both phases.
  BEGIN
    PERFORM public.apply_jumia_submitted_price_updates(
      v_merchant_id,
      jsonb_build_object(
        'values', jsonb_build_object('updated_at', now()),
        'targets', jsonb_build_array(jsonb_build_object(
          'id', v_missing_id, 'expected_token', v_token_older
        ))
      ),
      '[]'::jsonb,
      v_token_claim
    );
    RAISE EXCEPTION 'missing scalar target did not raise a not-found error';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    -- Expected: fail closed on unknown targets.
  END;

  BEGIN
    PERFORM public.apply_jumia_submitted_price_updates(
      v_merchant_id,
      jsonb_build_object('values', '{}'::jsonb, 'targets', '[]'::jsonb),
      jsonb_build_array(jsonb_build_object(
        'id', v_missing_id, 'price', 700, 'expected_token', v_token_older
      )),
      v_token_claim
    );
    RAISE EXCEPTION 'missing price target did not raise a not-found error';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    -- Expected: fail closed on unknown targets.
  END;

  -- Malformed scalar payloads fail closed.
  BEGIN
    PERFORM public.apply_jumia_submitted_price_updates(
      v_merchant_id,
      jsonb_build_object(
        'values', '{}'::jsonb,
        'targets', jsonb_build_array(jsonb_build_object(
          'id', v_mapping_id, 'expected_token', v_token_older
        ))
      ),
      '[]'::jsonb,
      v_token_claim
    );
    RAISE EXCEPTION 'scalar write without updated_at did not fail';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    -- Expected: updated_at is required for scalar writes.
  END;

  BEGIN
    PERFORM public.apply_jumia_submitted_price_updates(
      v_merchant_id,
      jsonb_build_object(
        'values', jsonb_build_object('updated_at', now(), 'bogus', 1),
        'targets', jsonb_build_array(jsonb_build_object(
          'id', v_mapping_id, 'expected_token', v_token_older
        ))
      ),
      '[]'::jsonb,
      v_token_claim
    );
    RAISE EXCEPTION 'scalar write with unknown key did not fail';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    -- Expected: scalar columns are whitelisted.
  END;

  -- Deprecated two-argument overload: pre-guard behavior is preserved for
  -- the live route during the predeploy window.
  PERFORM public.apply_jumia_variant_price_updates(
    v_merchant_id,
    jsonb_build_array(jsonb_build_object('id', v_mapping_id, 'price', 750))
  );

  SELECT jumia_price INTO v_price
  FROM public.jumia_product_mappings
  WHERE id = v_mapping_id;

  IF v_price <> 750 THEN
    RAISE EXCEPTION 'compatibility overload did not apply the price update';
  END IF;
END $$;

ROLLBACK;
