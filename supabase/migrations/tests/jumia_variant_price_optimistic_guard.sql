-- =============================================
-- REGRESSION TEST: jumia variant price optimistic guard
--   apply_jumia_variant_price_updates() only overwrites rows still
--   carrying the caller-observed baseline token, restamping them with the
--   caller's claim token. Rows claimed by a newer save fail with 40001
--   and keep the newer prices instead of regressing. The deprecated
--   two-argument overload keeps the exact pre-guard behavior for the live
--   route during the predeploy window.
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
  v_unstamped_id uuid := '00000000-0000-4000-8000-00000000f303';
  v_missing_id uuid := '00000000-0000-4000-8000-00000000f302';
  v_token_older text := '00000000-0000-4000-8000-00000000f401';
  v_token_newer text := '00000000-0000-4000-8000-00000000f402';
  v_token_claim text := '00000000-0000-4000-8000-00000000f403';
  v_price numeric;
  v_token text;
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
    'shop-guard',
    2000,
    NULL
  );

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner_user_id, 'role', 'authenticated')::text,
    true
  );

  -- Matching baseline: the price update applies and claims the row.
  PERFORM public.apply_jumia_variant_price_updates(
    v_merchant_id,
    jsonb_build_array(jsonb_build_object(
      'id', v_mapping_id, 'price', 900, 'expected_token', v_token_older
    )),
    v_token_claim
  );

  SELECT jumia_price, update_token INTO v_price, v_token
  FROM public.jumia_product_mappings
  WHERE id = v_mapping_id;

  IF v_price <> 900 THEN
    RAISE EXCEPTION 'matching baseline did not apply the price update';
  END IF;
  IF v_token <> v_token_claim THEN
    RAISE EXCEPTION 'applied update did not claim the row token';
  END IF;

  -- NULL baselines match unstamped rows.
  PERFORM public.apply_jumia_variant_price_updates(
    v_merchant_id,
    jsonb_build_array(jsonb_build_object(
      'id', v_unstamped_id, 'price', 1900, 'expected_token', NULL
    )),
    v_token_claim
  );

  SELECT jumia_price INTO v_price
  FROM public.jumia_product_mappings
  WHERE id = v_unstamped_id;

  IF v_price <> 1900 THEN
    RAISE EXCEPTION 'null baseline did not match the unstamped row';
  END IF;

  -- A newer claim won the race: the stale call fails with 40001 and the
  -- newer price survives.
  UPDATE public.jumia_product_mappings
  SET jumia_price = 850, update_token = v_token_newer
  WHERE id = v_mapping_id;

  BEGIN
    PERFORM public.apply_jumia_variant_price_updates(
      v_merchant_id,
      jsonb_build_array(jsonb_build_object(
        'id', v_mapping_id, 'price', 800, 'expected_token', v_token_claim
      )),
      v_token_older
    );
    RAISE EXCEPTION 'stale baseline did not raise a superseded error';
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
      jsonb_build_array(jsonb_build_object(
        'id', v_missing_id, 'price', 700, 'expected_token', v_token_older
      )),
      v_token_claim
    );
    RAISE EXCEPTION 'missing target did not raise a not-found error';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    -- Expected: fail closed on unknown targets.
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
