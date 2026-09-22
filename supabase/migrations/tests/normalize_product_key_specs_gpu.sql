-- Regression test for 20260922120000_normalize_product_key_specs_gpu.
-- Category graphics facets expose trimmed gpu values and filter predicates
-- compare trimmed request values, so padded stored rows would create facet
-- options that match nothing. Covers: backfill (no padded rows at rest),
-- INSERT trim trigger, UPDATE trim trigger. Uses sentinel UUIDs and cleans
-- up after itself.

DO $test$
DECLARE
  v_merchant_id uuid := '7e3f2e50-1111-4000-8000-000000000001';
  v_product_id uuid := '7e3f2e50-1111-4000-8000-000000000002';
  v_stored_gpu text;
  v_padded_count integer;
BEGIN
  -- Arrange: sentinel merchant + product (FK chain for product_key_specs).
  INSERT INTO public.merchants (id, email, slug)
  VALUES (v_merchant_id, 'gpu-trim-test@example.com', 'gpu-trim-test-sentinel')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.products (id, merchant_id, name, price)
  VALUES (v_product_id, v_merchant_id, 'GPU Trim Sentinel', 100000)
  ON CONFLICT (id) DO NOTHING;

  DELETE FROM public.product_key_specs WHERE product_id = v_product_id;

  -- Backfill: no padded gpu values may remain at rest.
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

  -- Cleanup: remove sentinel rows (key specs cascade from products).
  DELETE FROM public.products WHERE id = v_product_id;
  DELETE FROM public.merchants WHERE id = v_merchant_id;
END;
$test$;
