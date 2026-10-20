-- Regression: the final order and checkout-snapshot RPCs must not
-- reference variant lifecycle columns that do not exist.
DO $regression$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'private')
      AND p.proname = 'create_storefront_order_unchecked'
      AND pg_get_functiondef(p.oid) LIKE '%v.is_active%'
  ) THEN
    RAISE EXCEPTION 'order RPC still references nonexistent variant columns';
  END IF;
  IF pg_get_functiondef(
    (SELECT p.oid FROM pg_proc p
     WHERE p.pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
       AND p.proname = 'commerce_cart_build_checkout_snapshot' LIMIT 1)
  ) LIKE '%v.is_active%' THEN
    RAISE EXCEPTION 'snapshot RPC still references nonexistent variant columns';
  END IF;
END $regression$;

DO $regression$
BEGIN
  IF pg_get_functiondef(
    'public.commerce_cart_mutate_authorized_impl(uuid, text, integer, jsonb)'::regprocedure
  ) NOT LIKE '%cart_shared_clear_guard%' THEN
    RAISE EXCEPTION 'shared clear guard missing from mutate implementation';
  END IF;
END $regression$;

SELECT 'variant predicates ok' AS commerce_cart_variant_predicates;

-- Production variants have no lifecycle columns. The earlier fixture adds
-- them for historical RPCs; remove them before exercising the final writer.
ALTER TABLE public.product_variants
  DROP COLUMN IF EXISTS is_active, DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS archived_at,
  DROP COLUMN IF EXISTS is_default;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS default_variant_id uuid;

DO $regression$
DECLARE
  merchant uuid := '11111111-1111-4111-8111-111111111111';
  product uuid := '55555555-5555-4555-8555-555555555555';
  variant uuid := '77777777-0000-4000-8000-000000000001';
  foreign_variant uuid := '77777777-0000-4000-8000-000000000003';
  snapshot jsonb;
BEGIN
  INSERT INTO public.product_variants (id, product_id, merchant_id)
  VALUES (foreign_variant, product, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  -- Exercise both the repaired function and its condition-aware wrapper.
  PERFORM public.commerce_cart_require_offer(merchant, product, NULL);
  PERFORM public.commerce_cart_require_offer(merchant, product, variant);
  -- Even the no-variant branch plans the nested variant query in PostgreSQL.
  PERFORM public.commerce_cart_require_offer(merchant, product, NULL, 'new');
  PERFORM public.commerce_cart_require_offer(merchant, product, variant, 'new');
  UPDATE public.products SET has_variants = true, default_variant_id = variant
  WHERE id = product;
  PERFORM public.commerce_cart_require_offer(merchant, product, variant);
  snapshot := public.commerce_cart_build_checkout_snapshot(
    merchant, '22222222-2222-4222-8222-222222222222');
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(snapshot->'lines') line
    WHERE line->>'variantId' = variant::text AND line->>'available' = 'true'
  ) THEN
    RAISE EXCEPTION 'checkout snapshot rejected purchasable default SKU';
  END IF;
  BEGIN
    PERFORM public.commerce_cart_require_offer(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', product, variant, 'new');
    RAISE EXCEPTION 'cross-merchant offer accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'invalid_offer' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.commerce_cart_require_offer(merchant, product, foreign_variant, 'new');
    RAISE EXCEPTION 'foreign variant accepted for local product';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'invalid_offer' THEN RAISE; END IF;
  END;
  UPDATE public.product_variants SET is_inventory_anchor = true WHERE id = variant;
  snapshot := public.commerce_cart_build_checkout_snapshot(
    merchant, '22222222-2222-4222-8222-222222222222');
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(snapshot->'lines') line
    WHERE line->>'variantId' = variant::text AND line->>'available' = 'false'
  ) THEN
    RAISE EXCEPTION 'checkout snapshot accepted inventory anchor';
  END IF;
  BEGIN
    PERFORM public.commerce_cart_require_offer(merchant, product, variant, 'new');
    RAISE EXCEPTION 'inventory anchor accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'invalid_offer' THEN RAISE; END IF;
  END;
  UPDATE public.product_variants SET is_inventory_anchor = false WHERE id = variant;
END $regression$;
