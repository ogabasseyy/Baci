-- Regression test for 20260922120000_normalize_product_key_specs_gpu.
-- Category graphics facets expose trimmed gpu values and filter predicates
-- compare trimmed request values, so padded stored rows would otherwise
-- create facet options that match nothing. Covers: trigger presence, the
-- backfill UPDATE against a seeded padded row, the at-rest backfill effect,
-- and the INSERT/UPDATE trim trigger. Runs in a transaction with the
-- service-role JWT claim (merchant writes fire canonical audit triggers that
-- require actor context) and rolls back, leaving no sentinel residue.

BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $test$
DECLARE
  v_merchant_id uuid := '7e3f2e50-1111-4000-8000-000000000001';
  v_product_id uuid := '7e3f2e50-1111-4000-8000-000000000002';
  v_seed_product_id uuid := '7e3f2e50-1111-4000-8000-000000000003';
  v_stored_gpu text;
  v_padded_count integer;
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

  DELETE FROM public.product_key_specs
  WHERE product_id IN (v_product_id, v_seed_product_id);

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

  -- Backfill, seeded: insert a padded row with the trigger disabled to
  -- reproduce the pre-migration condition, then apply the migration's
  -- UPDATE and assert it normalizes the row.
  ALTER TABLE public.product_key_specs DISABLE TRIGGER product_key_specs_trim_gpu;
  INSERT INTO public.product_key_specs (product_id, gpu)
  VALUES (v_seed_product_id, '  NVIDIA RTX 4070  ');
  ALTER TABLE public.product_key_specs ENABLE TRIGGER product_key_specs_trim_gpu;

  UPDATE public.product_key_specs
  SET gpu = btrim(gpu)
  WHERE product_id = v_seed_product_id AND gpu <> btrim(gpu);

  SELECT gpu INTO v_stored_gpu
  FROM public.product_key_specs
  WHERE product_id = v_seed_product_id;
  IF v_stored_gpu <> 'NVIDIA RTX 4070' THEN
    RAISE EXCEPTION 'backfill UPDATE did not normalize seeded gpu, stored %', v_stored_gpu;
  END IF;

  -- Backfill, at rest: no padded gpu values may remain.
  SELECT count(*) INTO v_padded_count
  FROM public.product_key_specs
  WHERE gpu IS NOT NULL AND gpu <> btrim(gpu);
  IF v_padded_count <> 0 THEN
    RAISE EXCEPTION 'backfill incomplete: % padded gpu rows remain', v_padded_count;
  END IF;

  -- Act: insert a padded value; the trigger must trim it at rest.
  INSERT INTO public.product_key_specs (product_id, gpu)
  VALUES (v_product_id, '  NVIDIA RTX 4070  ');

  SELECT gpu INTO v_stored_gpu
  FROM public.product_key_specs
  WHERE product_id = v_product_id;
  IF v_stored_gpu <> 'NVIDIA RTX 4070' THEN
    RAISE EXCEPTION 'INSERT trigger did not trim gpu, stored %', v_stored_gpu;
  END IF;

  -- Act: update back to a padded value; the trigger must trim it again.
  UPDATE public.product_key_specs
  SET gpu = ' NVIDIA RTX 4070 '
  WHERE product_id = v_product_id;

  SELECT gpu INTO v_stored_gpu
  FROM public.product_key_specs
  WHERE product_id = v_product_id;
  IF v_stored_gpu <> 'NVIDIA RTX 4070' THEN
    RAISE EXCEPTION 'UPDATE trigger did not trim gpu, stored %', v_stored_gpu;
  END IF;

END;
$test$;

ROLLBACK;
