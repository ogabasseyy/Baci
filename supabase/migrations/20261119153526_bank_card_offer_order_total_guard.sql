CREATE INDEX bank_card_offer_order_snapshots_merchant_id_idx
  ON private.bank_card_offer_order_snapshots (merchant_id);

CREATE FUNCTION private.validate_bank_card_offer_order_total()
RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_order record;
  v_subtotal numeric;
  v_expected_total numeric;
BEGIN
  SELECT total, shipping_fee, gift_wrapping_fee, tax_basis, tax_amount, discount_amount
    INTO STRICT v_order
    FROM public.orders
   WHERE id = NEW.order_id AND merchant_id = NEW.merchant_id
   FOR UPDATE;

  SELECT sum(price * quantity + COALESCE(assurance_fee, 0))
    INTO v_subtotal
    FROM public.order_items
   WHERE order_id = NEW.order_id;

  IF v_order.tax_basis IS DISTINCT FROM 'exclusive'
    AND v_order.tax_basis IS DISTINCT FROM 'inclusive'
  THEN
    RAISE EXCEPTION 'bank_card_offer_order_total_mismatch';
  END IF;

  v_expected_total := v_subtotal + COALESCE(v_order.shipping_fee, 0)
    + COALESCE(v_order.gift_wrapping_fee, 0) - v_order.discount_amount;
  IF v_order.tax_basis = 'exclusive' THEN
    v_expected_total := v_expected_total + COALESCE(v_order.tax_amount, 0);
  END IF;

  IF v_expected_total IS DISTINCT FROM v_order.total
    OR v_expected_total * 100 IS DISTINCT FROM NEW.payable_kobo
  THEN
    RAISE EXCEPTION 'bank_card_offer_order_total_mismatch';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_bank_card_offer_order_total()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER validate_bank_card_offer_order_total
  BEFORE INSERT ON private.bank_card_offer_order_snapshots
  FOR EACH ROW EXECUTE FUNCTION private.validate_bank_card_offer_order_total();

CREATE OR REPLACE FUNCTION private.read_bank_card_offer_payment_context(
  p_order_id uuid, p_merchant_id uuid, p_transaction_id uuid
) RETURNS TABLE (quote jsonb, amount_kobo bigint, customer_email text, reference text)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT snapshot.offer_quote, snapshot.payable_kobo, snapshot.customer_email,
         attempt.gateway_reference
  FROM private.bank_card_offer_order_snapshots AS snapshot
  JOIN public.orders AS storefront_order
    ON storefront_order.id = snapshot.order_id
   AND storefront_order.merchant_id = snapshot.merchant_id
  JOIN public.transactions AS attempt
    ON attempt.order_id = snapshot.order_id
   AND attempt.merchant_id = snapshot.merchant_id
  WHERE snapshot.order_id = p_order_id AND snapshot.merchant_id = p_merchant_id
    AND storefront_order.payment_method = 'bank_card_offer'
    AND storefront_order.currency = 'NGN'
    AND storefront_order.total * 100 = snapshot.payable_kobo
    AND lower(btrim(storefront_order.customer_email)) = snapshot.customer_email
    AND attempt.id = p_transaction_id AND attempt.gateway = 'paystack'
    AND attempt.transaction_type = 'payment' AND attempt.currency = 'NGN'
    AND attempt.amount * 100 = snapshot.payable_kobo
    AND NULLIF(btrim(attempt.gateway_reference), '') IS NOT NULL;
$$;
