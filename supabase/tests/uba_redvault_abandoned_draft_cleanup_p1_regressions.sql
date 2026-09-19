-- Round-8 P1 regression: the abandoned-orders batch UPDATE no longer aborts
-- on a stale REDVAULT draft (narrow service_role carve-out), and
-- cancel_abandoned_uba_redvault_draft cancels stale drafts while releasing
-- their fenced serial reservations. Also covers the P2: the variant pricing
-- RPC returns attributes so the protected quote binds them.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  v_order_stale uuid := '10000000-0000-4000-8000-000000000041';
  v_order_fresh uuid := '10000000-0000-4000-8000-000000000042';
  v_order_plain uuid := '10000000-0000-4000-8000-000000000043';
  v_order_late uuid := '10000000-0000-4000-8000-000000000044';
  v_product uuid := 'b0000000-0000-4000-8000-000000000041';
  v_variant uuid := 'c0000000-0000-4000-8000-000000000041';
  v_item_stale uuid := '20000000-0000-4000-8000-000000000041';
  v_item_late uuid := '20000000-0000-4000-8000-000000000044';
  v_receipt jsonb;
  v_attrs jsonb;
  v_state text;
  v_status text;
BEGIN
  -- Orders writes must ride the protected path like production writers do.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.merchants (id, email, business_name)
  VALUES (v_merchant, 'redvault-p8b@example.com', 'Redvault P8B')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.products (id, merchant_id, name, price, has_variants, inventory_tracking_policy)
  VALUES (v_product, v_merchant, 'Redvault P8B product', 150000, true, 'serialized_strict');
  INSERT INTO public.product_variants (id, product_id, merchant_id, inventory_tracking_policy, attributes)
  VALUES (v_variant, v_product, v_merchant, 'inherit', '{"color":"red","storage":"128GB"}'::jsonb);
  INSERT INTO public.orders (id, merchant_id, order_number, total, payment_method, created_at)
  VALUES (v_order_stale, v_merchant, 'R8P2-STALE', 1500.00, 'uba_redvault', pg_catalog.now() - interval '100 hours'),
         (v_order_fresh, v_merchant, 'R8P2-FRESH', 1500.00, 'uba_redvault', pg_catalog.now()),
         (v_order_plain, v_merchant, 'R8P2-PLAIN', 1500.00, 'card', pg_catalog.now() - interval '100 hours');
  INSERT INTO public.order_items (id, order_id, product_id, variant_id, name, price, quantity)
  VALUES (v_item_stale, v_order_stale, v_product, v_variant, 'Redvault P8B item', 150000, 1);
  INSERT INTO public.variant_inventory
    (id, merchant_id, order_id, order_item_id, variant_id, status, identifier_type, identifier_value)
  VALUES
    ('a0000000-0000-4000-8000-000000000041', v_merchant, v_order_stale, v_item_stale, v_variant, 'reserved', 'serial', 'R8P2-001');

  -- P1: the base cleanup batch (no write_context, like the real worker)
  -- cancels the stale draft instead of aborting, cleans the plain stale
  -- order, and leaves the fresh draft alone.
  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
  UPDATE public.orders SET payment_status = 'cancelled', updated_at = pg_catalog.now()
  WHERE created_at < (pg_catalog.now() - interval '72 hours')
    AND payment_status = 'unpaid';
  SELECT payment_status INTO v_state FROM public.orders WHERE id = v_order_stale;
  IF v_state <> 'cancelled' THEN
    RAISE EXCEPTION 'stale draft was not cancelled, got %', v_state;
  END IF;
  SELECT payment_status INTO v_state FROM public.orders WHERE id = v_order_plain;
  IF v_state <> 'cancelled' THEN
    RAISE EXCEPTION 'plain stale order was not cleaned, got %', v_state;
  END IF;
  SELECT payment_status INTO v_state FROM public.orders WHERE id = v_order_fresh;
  IF v_state <> 'unpaid' THEN
    RAISE EXCEPTION 'fresh draft was touched, got %', v_state;
  END IF;

  -- P1: the protected path releases the fenced reservation (idempotent).
  v_receipt := public.cancel_abandoned_uba_redvault_draft(v_order_stale, 72);
  IF COALESCE((v_receipt->>'releasedUnitCount')::integer, -1) <> 1 THEN
    RAISE EXCEPTION 'fenced unit was not released: %', v_receipt;
  END IF;
  SELECT status INTO v_status FROM public.variant_inventory
  WHERE id = 'a0000000-0000-4000-8000-000000000041';
  IF v_status <> 'available' THEN
    RAISE EXCEPTION 'unit not available, got %', v_status;
  END IF;
  v_receipt := public.cancel_abandoned_uba_redvault_draft(v_order_stale, 72);
  IF COALESCE((v_receipt->>'releasedUnitCount')::integer, -1) <> 0 THEN
    RAISE EXCEPTION 'release was not idempotent: %', v_receipt;
  END IF;

  -- P1: cancelling a fresh draft outside the protected path still raises.
  BEGIN
    UPDATE public.orders SET payment_status = 'cancelled', updated_at = pg_catalog.now()
    WHERE id = v_order_fresh;
    RAISE EXCEPTION 'unprotected cancel unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_order_requires_protected_path' THEN RAISE; END IF;
  END;
  -- P1: a stale unpaid draft inserted after the batch is cancelled directly.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.orders (id, merchant_id, order_number, total, payment_method, created_at)
  VALUES (v_order_late, v_merchant, 'R8P2-LATE', 1500.00, 'uba_redvault', pg_catalog.now() - interval '100 hours');
  INSERT INTO public.order_items (id, order_id, product_id, variant_id, name, price, quantity)
  VALUES (v_item_late, v_order_late, v_product, v_variant, 'Redvault P8B late item', 150000, 1);
  v_receipt := public.cancel_abandoned_uba_redvault_draft(v_order_late, 72);
  IF COALESCE((v_receipt->>'cancelled')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'late draft was not cancelled: %', v_receipt;
  END IF;

  -- P2: the pricing RPC returns authoritative variant attributes.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'storefront_order_context', 'route',
    'storefront_order_merchant_id', '6b5cb8a4-5575-456c-b936-8cdfae30db74')::text, true);
  SELECT attributes INTO v_attrs
  FROM public.get_storefront_redvault_variant_pricing(ARRAY[v_variant]);
  IF COALESCE(v_attrs->>'color', '') <> 'red'
    OR COALESCE(v_attrs->>'storage', '') <> '128GB' THEN
    RAISE EXCEPTION 'pricing RPC did not return attributes: %', v_attrs;
  END IF;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

RESET ROLE;
ROLLBACK;
