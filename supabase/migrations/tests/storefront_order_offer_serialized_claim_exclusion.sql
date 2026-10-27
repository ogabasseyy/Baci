-- =============================================
-- REGRESSION TEST (issue #3734): serialized-claim exclusion must match
-- the persisted condition shape.
--   An offer_id-only line (no client condition) stages t.condition from
--   the product fallback while t.offer_condition carries the offer's
--   live condition; the persisted oi.condition is the COALESCE of both.
--   The serialized-unit claim loop must exclude that line, otherwise it
--   reserves base-product units after the offer stock decrement.
--
-- USAGE:
--   psql $DATABASE_URL -f supabase/migrations/tests/storefront_order_offer_serialized_claim_exclusion.sql
-- =============================================

BEGIN;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant_id uuid := '03d00000-0000-4000-8000-000000000001';
  v_product_id uuid := '03d00000-0000-4000-8000-000000000002';
  v_offer_id uuid := '03d00000-0000-4000-8000-000000000003';
  v_anchor_id uuid := '03d00000-0000-4000-8000-000000000004';
  v_unit_id uuid := '03d00000-0000-4000-8000-000000000005';
  v_order_id uuid;
  v_item_id uuid;
  v_condition text;
  v_offer_stock integer;
  v_claimed integer;
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug, is_published)
  VALUES (v_merchant_id, 'claim-exclusion@example.com',
    'Claim Exclusion', 'claim-exclusion', true);

  -- Product condition ('new') deliberately differs from the offer's
  -- live condition ('used'): the client submits offer_id only.
  INSERT INTO public.products (id, merchant_id, name, price, status,
    condition, stock_quantity, manage_stock, has_condition_offers,
    has_variants, inventory_tracking_policy)
  VALUES (v_product_id, v_merchant_id, 'Claim exclusion phone', 500000,
    'active', 'new', 5, false, true, false, 'serialized_strict');

  INSERT INTO public.product_variants (
    id, product_id, merchant_id, attributes, price_override,
    inventory_tracking_policy, is_inventory_anchor
  )
  VALUES (v_anchor_id, v_product_id, v_merchant_id,
    '{"is_anchor": true}'::jsonb, 0, 'inherit', true);

  UPDATE public.products
  SET inventory_anchor_variant_id = v_anchor_id
  WHERE id = v_product_id;

  INSERT INTO public.product_offers (id, product_id, merchant_id, condition,
    price, stock_quantity, status, grade, condition_notes)
  VALUES (v_offer_id, v_product_id, v_merchant_id, 'used', 400000, 5,
    'active', 'A', 'Light scratches');

  INSERT INTO public.variant_inventory (
    id, variant_id, merchant_id, identifier_type, identifier_value, status
  )
  VALUES (v_unit_id, v_anchor_id, v_merchant_id, 'imei', '933730000000001',
    'available');

  BEGIN
    SELECT o.id INTO v_order_id
    FROM public.create_storefront_order(
      p_merchant_id => v_merchant_id,
      p_customer_email => 'claim-exclusion-buyer@example.com',
      p_customer_name => 'Claim Buyer',
      p_items => jsonb_build_array(jsonb_build_object(
        'product_id', v_product_id,
        'offer_id', v_offer_id,
        'quantity', 1
      ))
    ) AS o;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'offer-only order creation failed: % (%)', SQLERRM, SQLSTATE;
  END;

  SELECT id, condition INTO v_item_id, v_condition
  FROM public.order_items
  WHERE order_id = v_order_id;
  IF v_condition IS DISTINCT FROM 'used' THEN
    RAISE EXCEPTION 'expected live offer condition used, got %', v_condition;
  END IF;

  SELECT stock_quantity INTO v_offer_stock
  FROM public.product_offers WHERE id = v_offer_id;
  IF v_offer_stock <> 4 THEN
    RAISE EXCEPTION 'expected offer stock 4 after quantity 1, got %', v_offer_stock;
  END IF;

  -- The serialized claim loop must skip the condition-offer line: no
  -- base-product unit may be reserved for it.
  SELECT count(*) INTO v_claimed
  FROM public.variant_inventory
  WHERE order_item_id = v_item_id;
  IF v_claimed <> 0 THEN
    RAISE EXCEPTION 'expected no serialized units claimed for the offer line, got %', v_claimed;
  END IF;
END;
$$;

ROLLBACK;
