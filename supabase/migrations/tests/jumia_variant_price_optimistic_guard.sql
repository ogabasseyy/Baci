-- =============================================
-- REGRESSION TEST: jumia variant price optimistic guard
--   apply_jumia_variant_price_updates() must only overwrite rows still
--   stamped with the caller's expected updated_at. A newer stamp means a
--   concurrent save landed first: the call fails with 40001 and leaves the
--   newer prices untouched instead of regressing them.
--
-- USAGE:
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/migrations/tests/jumia_variant_price_optimistic_guard.sql
--
-- This script intentionally mutates inside a transaction and rolls back.
-- =============================================

BEGIN;

DO $$
DECLARE
  v_owner_user_id uuid := '00000000-0000-4000-8000-00000000f100';
  v_merchant_id uuid := '00000000-0000-4000-8000-00000000f101';
  v_product_id uuid := '00000000-0000-4000-8000-00000000f201';
  v_mapping_id uuid := '00000000-0000-4000-8000-00000000f301';
  v_missing_id uuid := '00000000-0000-4000-8000-00000000f302';
  v_stamp_old timestamptz := '2026-09-25T10:00:00Z';
  v_stamp_new timestamptz := '2026-09-25T10:00:01Z';
  v_price numeric;
BEGIN
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
    v_owner_user_id,
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
    updated_at
  ) VALUES (
    v_mapping_id,
    v_merchant_id,
    v_product_id,
    'GUARD-SKU-1',
    'shop-guard',
    1000,
    v_stamp_old
  );

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner_user_id, 'role', 'authenticated')::text,
    true
  );

  -- Matching stamp: the price update applies.
  PERFORM public.apply_jumia_variant_price_updates(
    v_merchant_id,
    jsonb_build_array(jsonb_build_object('id', v_mapping_id, 'price', 900)),
    v_stamp_old
  );

  SELECT jumia_price INTO v_price
  FROM public.jumia_product_mappings
  WHERE id = v_mapping_id;

  IF v_price <> 900 THEN
    RAISE EXCEPTION 'matching stamp did not apply the price update';
  END IF;

  -- A newer stamp won the race: the stale call fails with 40001 and the
  -- newer price survives.
  UPDATE public.jumia_product_mappings
  SET jumia_price = 850, updated_at = v_stamp_new
  WHERE id = v_mapping_id;

  BEGIN
    PERFORM public.apply_jumia_variant_price_updates(
      v_merchant_id,
      jsonb_build_array(jsonb_build_object('id', v_mapping_id, 'price', 800)),
      v_stamp_old
    );
    RAISE EXCEPTION 'stale stamp did not raise a superseded error';
  EXCEPTION WHEN SQLSTATE '40001' THEN
    -- Expected: concurrent save wins.
  END;

  SELECT jumia_price INTO v_price
  FROM public.jumia_product_mappings
  WHERE id = v_mapping_id;

  IF v_price <> 850 THEN
    RAISE EXCEPTION 'superseded call regressed the newer price';
  END IF;

  -- Unknown targets keep the original 22023 failure.
  BEGIN
    PERFORM public.apply_jumia_variant_price_updates(
      v_merchant_id,
      jsonb_build_array(jsonb_build_object('id', v_missing_id, 'price', 700)),
      v_stamp_old
    );
    RAISE EXCEPTION 'missing target did not raise a not-found error';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    -- Expected: fail closed on unknown targets.
  END;
END $$;

ROLLBACK;
