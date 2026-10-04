-- Regression test for 20260922120000_normalize_product_key_specs_gpu.
-- Category graphics facets expose trimmed gpu values and filter predicates
-- compare trimmed request values, so padded stored rows would otherwise
-- create facet options that match nothing. Covers: trigger presence, the
-- migration's real backfill (re-applied below against seeded pre-migration
-- rows, so deleting the backfill from the migration fails this check), the
-- at-rest backfill effect, and the INSERT/UPDATE trim trigger including
-- tab/newline padding. Runs in a transaction with the service-role JWT
-- claim (merchant writes fire canonical audit triggers that require actor
-- context) and rolls back, leaving no sentinel residue.

BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $test$
DECLARE
  v_merchant_id uuid := '7e3f2e50-1111-4000-8000-000000000001';
  v_product_id uuid := '7e3f2e50-1111-4000-8000-000000000002';
  v_seed_product_id uuid := '7e3f2e50-1111-4000-8000-000000000003';
  v_tab_seed_product_id uuid := '7e3f2e50-1111-4000-8000-000000000004';
  v_trigger_enabled char;
BEGIN
  -- Arrange: sentinel merchant + products (FK chain for product_key_specs).
  INSERT INTO public.merchants (id, email, slug)
  VALUES (v_merchant_id, 'gpu-trim-test@example.com', 'gpu-trim-test-sentinel')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.products (id, merchant_id, name, price)
  VALUES (v_product_id, v_merchant_id, 'GPU Trim Sentinel', 100000)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.products (id, merchant_id, name, price)
  VALUES (v_seed_product_id, v_merchant_id, 'GPU Trim Seed Sentinel', 100000)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.products (id, merchant_id, name, price)
  VALUES (
    v_tab_seed_product_id,
    v_merchant_id,
    'GPU Trim Tab Seed Sentinel',
    100000
  )
  ON CONFLICT (id) DO NOTHING;

  DELETE FROM public.product_key_specs
  WHERE product_id IN (
    v_product_id,
    v_seed_product_id,
    v_tab_seed_product_id
  );

  -- Guard: the normalization trigger must exist and stay enabled, otherwise
  -- future writes reintroduce padded rows the facet cannot match.
  SELECT tgenabled INTO v_trigger_enabled
  FROM pg_trigger
  WHERE tgname = 'product_key_specs_trim_gpu'
    AND tgrelid = 'public.product_key_specs'::regclass;
  IF v_trigger_enabled IS NULL THEN
    RAISE EXCEPTION 'product_key_specs_trim_gpu trigger is missing';
  END IF;
  IF v_trigger_enabled <> 'O' THEN
    RAISE EXCEPTION 'product_key_specs_trim_gpu trigger is not enabled';
  END IF;

  -- Seed pre-migration rows with the trigger disabled: space-padded and
  -- tab/newline-padded values the old unrestrained writes could persist.
  ALTER TABLE public.product_key_specs DISABLE TRIGGER product_key_specs_trim_gpu;
  INSERT INTO public.product_key_specs (product_id, gpu)
  VALUES (v_seed_product_id, '  NVIDIA RTX 4070  ');
  INSERT INTO public.product_key_specs (product_id, gpu)
  VALUES (v_tab_seed_product_id, E'\tNVIDIA RTX 4070\n');
  ALTER TABLE public.product_key_specs ENABLE TRIGGER product_key_specs_trim_gpu;
END;
$test$;

-- Exercise the migration's real backfill (not a copy of its UPDATE) against
-- the seeded rows: removing the backfill from the migration leaves them
-- padded and fails the verification below.
\ir ../20260922120000_normalize_product_key_specs_gpu.sql

DO $verify$
DECLARE
  v_stored_gpu text;
  v_padded_count integer;
BEGIN
  -- Assert: the migration backfill normalized the space-padded seed.
  SELECT gpu INTO v_stored_gpu
  FROM public.product_key_specs
  WHERE product_id = '7e3f2e50-1111-4000-8000-000000000003';
  IF v_stored_gpu <> 'NVIDIA RTX 4070' THEN
    RAISE EXCEPTION 'backfill UPDATE did not normalize seeded gpu, stored %', v_stored_gpu;
  END IF;

  -- Assert: the migration backfill normalized the tab/newline-padded seed.
  SELECT gpu INTO v_stored_gpu
  FROM public.product_key_specs
  WHERE product_id = '7e3f2e50-1111-4000-8000-000000000004';
  IF v_stored_gpu <> 'NVIDIA RTX 4070' THEN
    RAISE EXCEPTION 'backfill UPDATE did not normalize tab-padded gpu, stored %', v_stored_gpu;
  END IF;

  -- Backfill, at rest: no padded gpu values may remain.
  SELECT count(*) INTO v_padded_count
  FROM public.product_key_specs
  WHERE gpu IS NOT NULL
    AND gpu <> regexp_replace(gpu, '^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$', '', 'g');
  IF v_padded_count <> 0 THEN
    RAISE EXCEPTION 'backfill incomplete: % padded gpu rows remain', v_padded_count;
  END IF;

  -- Act: insert a tab-padded value; the trigger must trim it at rest.
  INSERT INTO public.product_key_specs (product_id, gpu)
  VALUES ('7e3f2e50-1111-4000-8000-000000000002', E' \tNVIDIA RTX 4070\n ');

  SELECT gpu INTO v_stored_gpu
  FROM public.product_key_specs
  WHERE product_id = '7e3f2e50-1111-4000-8000-000000000002';
  IF v_stored_gpu <> 'NVIDIA RTX 4070' THEN
    RAISE EXCEPTION 'INSERT trigger did not trim gpu, stored %', v_stored_gpu;
  END IF;

  -- Act: update back to a padded value; the trigger must trim it again.
  UPDATE public.product_key_specs
  SET gpu = ' NVIDIA RTX 4070 '
  WHERE product_id = '7e3f2e50-1111-4000-8000-000000000002';

  SELECT gpu INTO v_stored_gpu
  FROM public.product_key_specs
  WHERE product_id = '7e3f2e50-1111-4000-8000-000000000002';
  IF v_stored_gpu <> 'NVIDIA RTX 4070' THEN
    RAISE EXCEPTION 'UPDATE trigger did not trim gpu, stored %', v_stored_gpu;
  END IF;
END;
$verify$;

ROLLBACK;
