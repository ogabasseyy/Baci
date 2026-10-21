-- =============================================
-- BEHAVIORAL TEST: offer orders persist offer identity and decrement offers.
--   Creates an offer order through public.create_storefront_order (which
--   routes checked -> unchecked) and asserts the stored offer_id, the live
--   offer condition binding, the snapshotted grade/notes labels, the offer
--   stock decrement, and that the parent stock is untouched. Together with
--   the storefront_order_offer_both_entrypoints shape check (checked still
--   delegates p_items), this covers both entrypoints: any redefinition that
--   drops delegation fails the shape gate, and any staging/insert breakage
--   fails the assertions below.
--
-- USAGE:
--   psql $DATABASE_URL -f supabase/migrations/tests/storefront_order_offer_entrypoints_behavior.sql
-- =============================================

BEGIN;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant_id uuid := '02e00000-0000-4000-8000-000000000001';
  v_product_id uuid := '02e00000-0000-4000-8000-000000000002';
  v_offer_id uuid := '02e00000-0000-4000-8000-000000000003';
  v_order_id uuid;
  v_line record;
  v_offer_stock integer;
  v_parent_stock integer;
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug, is_published)
  VALUES (v_merchant_id, 'offer-entrypoints@example.com',
    'Offer Entrypoints', 'offer-entrypoints', true);

  INSERT INTO public.products (id, merchant_id, name, price, status,
    stock_quantity, manage_stock, has_condition_offers, has_variants)
  VALUES (v_product_id, v_merchant_id, 'Offer entrypoints phone', 500000,
    'active', 5, false, true, false);

  INSERT INTO public.product_offers (id, product_id, merchant_id, condition,
    price, stock_quantity, status, grade, condition_notes)
  VALUES (v_offer_id, v_product_id, v_merchant_id, 'used', 400000, 5,
    'active', 'A', 'Light scratches');

  BEGIN
    SELECT o.id INTO v_order_id
    FROM public.create_storefront_order(
      p_merchant_id => v_merchant_id,
      p_customer_email => 'offer-buyer@example.com',
      p_customer_name => 'Offer Buyer',
      p_items => jsonb_build_array(jsonb_build_object(
        'product_id', v_product_id,
        'offer_id', v_offer_id,
        'condition', 'used',
        'quantity', 2
      ))
    ) AS o;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'offer order creation failed: % (%)', SQLERRM, SQLSTATE;
  END;

  SELECT offer_id, condition, offer_grade, offer_condition_notes, quantity
  INTO v_line
  FROM public.order_items
  WHERE order_id = v_order_id;

  IF v_line.offer_id IS DISTINCT FROM v_offer_id THEN
    RAISE EXCEPTION 'expected stored offer_id %, got %', v_offer_id, v_line.offer_id;
  END IF;
  IF v_line.condition IS DISTINCT FROM 'used' THEN
    RAISE EXCEPTION 'expected live offer condition used, got %', v_line.condition;
  END IF;
  IF v_line.offer_grade IS DISTINCT FROM 'A' THEN
    RAISE EXCEPTION 'expected snapshotted grade A, got %', v_line.offer_grade;
  END IF;
  IF v_line.offer_condition_notes IS DISTINCT FROM 'Light scratches' THEN
    RAISE EXCEPTION 'expected snapshotted condition notes, got %', v_line.offer_condition_notes;
  END IF;

  SELECT stock_quantity INTO v_offer_stock
  FROM public.product_offers WHERE id = v_offer_id;
  IF v_offer_stock <> 3 THEN
    RAISE EXCEPTION 'expected offer stock 3 after quantity 2, got %', v_offer_stock;
  END IF;

  SELECT stock_quantity INTO v_parent_stock
  FROM public.products WHERE id = v_product_id;
  IF v_parent_stock <> 5 THEN
    RAISE EXCEPTION 'expected untouched parent stock 5, got %', v_parent_stock;
  END IF;
END;
$$;

ROLLBACK;
