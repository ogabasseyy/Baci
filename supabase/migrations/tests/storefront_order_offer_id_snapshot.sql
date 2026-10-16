-- =============================================
-- BEHAVIORAL TEST: the immutable offer-id snapshot survives catalog
-- deletion and rejects later mutation.
--   Creates an offer order through public.create_storefront_order and
--   asserts the trigger stamped offer_id_snapshot at insert; deletes
--   the offer row (which cascades the product delete path) and asserts
--   the live FK nulled while the snapshot kept the exact purchased id;
--   then asserts rewriting the snapshot fails closed. Both order entry
--   points are covered by construction: the stamp lives in a
--   BEFORE INSERT trigger, not in either function definition.
--
-- USAGE:
--   psql $DATABASE_URL -f supabase/migrations/tests/storefront_order_offer_id_snapshot.sql
-- =============================================

BEGIN;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant_id uuid := '0be00000-0000-4000-8000-000000000001';
  v_product_id uuid := '0be00000-0000-4000-8000-000000000002';
  v_offer_id uuid := '0be00000-0000-4000-8000-000000000003';
  v_order_id uuid;
  v_line record;
  v_forged record;
  v_projected jsonb;
  v_mutation_blocked boolean := false;
  v_line_flip_blocked boolean := false;
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug, is_published)
  VALUES (v_merchant_id, 'offer-snapshot@example.com',
    'Offer Snapshot', 'offer-snapshot', true);

  INSERT INTO public.products (id, merchant_id, name, price, status,
    stock_quantity, manage_stock, has_condition_offers, has_variants)
  VALUES (v_product_id, v_merchant_id, 'Offer snapshot phone', 500000,
    'active', 5, false, true, false);

  INSERT INTO public.product_offers (id, product_id, merchant_id, condition,
    price, stock_quantity, status, grade, condition_notes)
  VALUES (v_offer_id, v_product_id, v_merchant_id, 'used', 400000, 5,
    'active', 'A', 'Light scratches');

  BEGIN
    SELECT o.id INTO v_order_id
    FROM public.create_storefront_order(
      p_merchant_id => v_merchant_id,
      p_customer_email => 'offer-snapshot-buyer@example.com',
      p_customer_name => 'Offer Snapshot Buyer',
      p_items => jsonb_build_array(jsonb_build_object(
        'product_id', v_product_id,
        'offer_id', v_offer_id,
        'condition', 'used',
        'quantity', 1
      ))
    ) AS o;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'offer order creation failed: % (%)', SQLERRM, SQLSTATE;
  END;

  SELECT offer_id, offer_id_snapshot INTO v_line
  FROM public.order_items
  WHERE order_id = v_order_id;
  IF v_line.offer_id IS DISTINCT FROM v_offer_id THEN
    RAISE EXCEPTION 'expected stored offer_id %, got %', v_offer_id, v_line.offer_id;
  END IF;
  IF v_line.offer_id_snapshot IS DISTINCT FROM v_offer_id THEN
    RAISE EXCEPTION 'expected stamped offer_id_snapshot %, got %', v_offer_id, v_line.offer_id_snapshot;
  END IF;

  -- Hardening: a caller-supplied snapshot is derived, never trusted,
  -- and the restock discriminator follows the live offer identity.
  INSERT INTO public.order_items (order_id, product_id, name, price,
    quantity, offer_id, offer_id_snapshot, offer_line)
  VALUES (v_order_id, v_product_id, 'Forged line', 100, 1, v_offer_id,
    '0be00000-0000-4000-8000-000000000009', false)
  RETURNING offer_id_snapshot, offer_line INTO v_forged;
  IF v_forged.offer_id_snapshot IS DISTINCT FROM v_offer_id THEN
    RAISE EXCEPTION 'expected derived snapshot %, got %', v_offer_id, v_forged.offer_id_snapshot;
  END IF;
  IF v_forged.offer_line IS NOT TRUE THEN
    RAISE EXCEPTION 'expected derived offer_line true, got %', v_forged.offer_line;
  END IF;
  DELETE FROM public.order_items
  WHERE order_id = v_order_id AND name = 'Forged line';

  -- Deleting the offer nulls the live FK (ON DELETE SET NULL) while the
  -- snapshot keeps the exact purchased identity for fulfillment.
  DELETE FROM public.product_offers WHERE id = v_offer_id;

  SELECT offer_id, offer_id_snapshot INTO v_line
  FROM public.order_items
  WHERE order_id = v_order_id;
  IF v_line.offer_id IS NOT NULL THEN
    RAISE EXCEPTION 'expected nulled offer_id after offer delete, got %', v_line.offer_id;
  END IF;
  IF v_line.offer_id_snapshot IS DISTINCT FROM v_offer_id THEN
    RAISE EXCEPTION 'expected surviving offer_id_snapshot %, got %', v_offer_id, v_line.offer_id_snapshot;
  END IF;

  -- The snapshot is immutable: rewriting a stamped value fails closed.
  BEGIN
    UPDATE public.order_items
    SET offer_id_snapshot = '0be00000-0000-4000-8000-000000000009'
    WHERE order_id = v_order_id;
  EXCEPTION WHEN raise_exception THEN
    v_mutation_blocked := true;
  END;
  IF NOT v_mutation_blocked THEN
    RAISE EXCEPTION 'expected snapshot rewrite to fail, but it succeeded';
  END IF;

  -- The restock discriminator is immutable: flipping an offer line into
  -- the parent branch fails closed.
  BEGIN
    UPDATE public.order_items
    SET offer_line = false
    WHERE order_id = v_order_id;
  EXCEPTION WHEN raise_exception THEN
    v_line_flip_blocked := true;
  END;
  IF NOT v_line_flip_blocked THEN
    RAISE EXCEPTION 'expected offer_line flip to fail, but it succeeded';
  END IF;

  -- The replay-economics projection falls back to the snapshot, so the
  -- deleted offer's line keeps distinct identity instead of queuing
  -- as offerless.
  UPDATE public.orders
  SET checkout_idempotency_key = 'snapshot-projection-key-001'
  WHERE id = v_order_id;
  SELECT e.items INTO v_projected
  FROM public.get_storefront_order_replay_economics(
    v_merchant_id, 'snapshot-projection-key-001') AS e;
  IF v_projected->0->>'offer_id' IS DISTINCT FROM v_offer_id::text THEN
    RAISE EXCEPTION 'expected projected offer_id %, got %', v_offer_id, v_projected->0->>'offer_id';
  END IF;
END;
$$;

ROLLBACK;
