-- =============================================
-- REGRESSION TEST: jumia submitted price atomic guard
--   apply_jumia_submitted_price_updates() commits the scalar sale write
--   and the per-variant price write in one transaction. Every row must
--   still carry its load-time baseline token; any miss fails with 40001
--   and rolls back every row instead of leaving the product half-claimed.
--   Per-variant rows claimed by the scalar phase match the claim token.
--   Genuinely missing targets keep the original 22023 failure, and the
--   deprecated two-argument overload keeps the exact pre-guard behavior
--   for the live route during the predeploy window.
--
-- USAGE:
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/migrations/tests/jumia_variant_price_optimistic_guard.sql
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
  v_unstamped_id uuid := '00000000-0000-4000-8000-00000000f303';
  v_third_id uuid := '00000000-0000-4000-8000-00000000f304';
  v_missing_id uuid := '00000000-0000-4000-8000-00000000f302';
  v_token_older text := '00000000-0000-4000-8000-00000000f401';
  v_token_newer text := '00000000-0000-4000-8000-00000000f402';
  v_token_claim text := '00000000-0000-4000-8000-00000000f403';
  v_price numeric;
  v_sale numeric;
  v_token text;
BEGIN
  -- Combined sale and per-variant write: the scalar phase claims the row
  -- and the price phase matches the claim token from a load-time baseline.
  PERFORM public.apply_jumia_submitted_price_updates(
    v_merchant_id,
    jsonb_build_object(
      'values', jsonb_build_object(
        'updated_at', now(), 'jumia_sale_price', 800
      ),
      'targets', jsonb_build_array(jsonb_build_object(
        'id', v_mapping_id, 'expected_token', v_token_older
      ))
    ),
    jsonb_build_array(jsonb_build_object(
      'id', v_mapping_id, 'price', 900, 'expected_token', v_token_older
    )),
    v_token_claim
  );

  SELECT jumia_price, jumia_sale_price, update_token
    INTO v_price, v_sale, v_token
  FROM public.jumia_product_mappings
  WHERE id = v_mapping_id;

  IF v_price <> 900 THEN
    RAISE EXCEPTION 'combined write did not apply the variant price';
  END IF;
  IF v_sale <> 800 THEN
    RAISE EXCEPTION 'combined write did not apply the sale price';
  END IF;
  IF v_token <> v_token_claim THEN
    RAISE EXCEPTION 'combined write did not claim the row token';
  END IF;

  -- Explicit nulls clear scalar columns.
  PERFORM public.apply_jumia_submitted_price_updates(
    v_merchant_id,
    jsonb_build_object(
      'values', jsonb_build_object(
        'updated_at', now(), 'jumia_sale_price', NULL
      ),
      'targets', jsonb_build_array(jsonb_build_object(
        'id', v_mapping_id, 'expected_token', v_token_claim
      ))
    ),
    '[]'::jsonb,
    v_token_older
  );

  SELECT jumia_sale_price INTO v_sale
  FROM public.jumia_product_mappings
  WHERE id = v_mapping_id;

  IF v_sale IS NOT NULL THEN
    RAISE EXCEPTION 'explicit null did not clear the sale price';
  END IF;

  -- Reset for the shortfall proofs.
  UPDATE public.jumia_product_mappings
  SET jumia_price = 1000, jumia_sale_price = NULL,
    update_token = v_token_older
  WHERE id = v_mapping_id;
  UPDATE public.jumia_product_mappings
  SET update_token = v_token_newer
  WHERE id = v_third_id;

  -- A stale scalar baseline rolls back the matching rows too: nothing
  -- is claimed and no sale metadata is left behind.
  BEGIN
    PERFORM public.apply_jumia_submitted_price_updates(
      v_merchant_id,
      jsonb_build_object(
        'values', jsonb_build_object(
          'updated_at', now(), 'jumia_sale_price', 700
        ),
        'targets', jsonb_build_array(
          jsonb_build_object(
            'id', v_mapping_id, 'expected_token', v_token_older
          ),
          jsonb_build_object(
            'id', v_third_id, 'expected_token', v_token_older
          )
        )
      ),
      '[]'::jsonb,
      v_token_claim
    );
    RAISE EXCEPTION 'stale scalar baseline did not raise a superseded error';
  EXCEPTION WHEN SQLSTATE '40001' THEN
    -- Expected: concurrent save wins, atomically.
  END;

  SELECT jumia_price, jumia_sale_price, update_token
    INTO v_price, v_sale, v_token
  FROM public.jumia_product_mappings
  WHERE id = v_mapping_id;

  IF v_price <> 1000 OR v_sale IS NOT NULL OR v_token <> v_token_older THEN
    RAISE EXCEPTION 'scalar shortfall left the matching row claimed';
  END IF;

  -- A stale per-variant baseline rolls back without touching any row.
  BEGIN
    PERFORM public.apply_jumia_submitted_price_updates(
      v_merchant_id,
      jsonb_build_object('values', '{}'::jsonb, 'targets', '[]'::jsonb),
      jsonb_build_array(jsonb_build_object(
        'id', v_mapping_id, 'price', 950, 'expected_token', v_token_claim
      )),
      v_token_newer
    );
    RAISE EXCEPTION 'stale price baseline did not raise a superseded error';
  EXCEPTION WHEN SQLSTATE '40001' THEN
    -- Expected: concurrent save wins.
  END;

  SELECT jumia_price, update_token INTO v_price, v_token
  FROM public.jumia_product_mappings
  WHERE id = v_mapping_id;

  IF v_price <> 1000 OR v_token <> v_token_older THEN
    RAISE EXCEPTION 'price shortfall mutated the row';
  END IF;

  -- NULL baselines match unstamped rows in both phases.
  PERFORM public.apply_jumia_submitted_price_updates(
    v_merchant_id,
    jsonb_build_object(
      'values', jsonb_build_object('updated_at', now()),
      'targets', jsonb_build_array(jsonb_build_object(
        'id', v_unstamped_id, 'expected_token', NULL
      ))
    ),
    jsonb_build_array(jsonb_build_object(
      'id', v_unstamped_id, 'price', 1900, 'expected_token', NULL
    )),
    v_token_claim
  );

  SELECT jumia_price, update_token INTO v_price, v_token
  FROM public.jumia_product_mappings
  WHERE id = v_unstamped_id;

  IF v_price <> 1900 OR v_token <> v_token_claim THEN
    RAISE EXCEPTION 'null baseline did not match the unstamped row';
  END IF;

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
