-- Private contract for a future bank-card order entry point. Existing REDVAULT
-- applications and all existing payment methods retain their current paths.
CREATE TABLE private.bank_card_offer_order_snapshots (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE RESTRICT,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE RESTRICT,
  payable_kobo bigint NOT NULL CHECK (payable_kobo > 0),
  customer_email text NOT NULL CHECK (customer_email <> ''),
  offer_quote jsonb NOT NULL CHECK (jsonb_typeof(offer_quote) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE private.bank_card_offer_order_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY bank_card_offer_snapshots_no_direct_access
  ON private.bank_card_offer_order_snapshots
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE private.bank_card_offer_order_snapshots FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.record_bank_card_offer_order(
  p_order_id uuid, p_merchant_id uuid, p_quote jsonb
) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_order record;
  v_saved record;
  v_line jsonb;
  v_item record;
  v_net numeric;
  v_discount numeric := 0;
  v_items uuid[] := '{}';
BEGIN
  -- The caller owns authorization and must create the order and record this
  -- snapshot in the same transaction. This function has no storefront grant.
  SELECT payment_method, payment_status, currency, customer_email, total, discount_amount
    INTO v_order FROM public.orders
   WHERE id = p_order_id AND merchant_id = p_merchant_id
   FOR UPDATE;
  IF NOT FOUND OR v_order.payment_method IS DISTINCT FROM 'bank_card_offer'
    OR v_order.currency IS DISTINCT FROM 'NGN'
    OR NULLIF(btrim(v_order.customer_email), '') IS NULL
    OR p_quote->>'merchantId' IS DISTINCT FROM p_merchant_id::text
    OR COALESCE(p_quote #>> '{paymentPolicy,bankCode}', '') NOT IN ('035', '232')
    OR COALESCE(p_quote->>'discountKobo', '') !~ '^[1-9][0-9]*$'
    OR (p_quote->>'discountKobo')::numeric <> v_order.discount_amount * 100
    OR jsonb_typeof(p_quote->'allocations') IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'bank_card_offer_order_mismatch';
  END IF;

  SELECT offer_quote, merchant_id, payable_kobo, customer_email
    INTO v_saved FROM private.bank_card_offer_order_snapshots
   WHERE order_id = p_order_id;
  IF FOUND THEN
    IF v_saved.offer_quote IS DISTINCT FROM p_quote
      OR v_saved.merchant_id IS DISTINCT FROM p_merchant_id
      OR v_saved.payable_kobo IS DISTINCT FROM v_order.total * 100
      OR v_saved.customer_email IS DISTINCT FROM lower(btrim(v_order.customer_email))
    THEN
      RAISE EXCEPTION 'bank_card_offer_snapshot_conflict';
    END IF;
    RETURN;
  END IF;
  IF v_order.payment_status IS DISTINCT FROM 'unpaid' THEN
    RAISE EXCEPTION 'bank_card_offer_order_mismatch';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_quote->'allocations')
  LOOP
    SELECT id, product_id, price, quantity INTO v_item FROM public.order_items
     WHERE order_id = p_order_id AND id = (v_line->>'itemId')::uuid FOR SHARE;
    IF NOT FOUND OR v_item.id = ANY(v_items)
      OR v_line->>'productId' IS DISTINCT FROM v_item.product_id::text
      OR (v_line->>'unitPriceKobo')::numeric IS DISTINCT FROM v_item.price * 100
      OR (v_line->>'quantity')::integer IS DISTINCT FROM v_item.quantity
      OR jsonb_typeof(v_line->'unitNetAmountsKobo') IS DISTINCT FROM 'array'
      OR jsonb_array_length(v_line->'unitNetAmountsKobo') <> v_item.quantity
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_line->'unitNetAmountsKobo') AS unit(value)
         WHERE jsonb_typeof(unit.value) <> 'number'
           OR unit.value::text !~ '^[0-9]+$'
           OR unit.value::text::numeric > v_item.price * 100
      )
    THEN
      RAISE EXCEPTION 'bank_card_offer_allocation_mismatch';
    END IF;
    SELECT sum(value::numeric) INTO v_net
      FROM jsonb_array_elements_text(v_line->'unitNetAmountsKobo');
    v_discount := v_discount + v_item.price * 100 * v_item.quantity - v_net;
    v_items := array_append(v_items, v_item.id);
  END LOOP;
  IF v_discount IS DISTINCT FROM v_order.discount_amount * 100
    OR cardinality(v_items) <> (SELECT count(*) FROM public.order_items WHERE order_id = p_order_id)
  THEN
    RAISE EXCEPTION 'bank_card_offer_allocation_mismatch';
  END IF;

  INSERT INTO private.bank_card_offer_order_snapshots (
    order_id, merchant_id, payable_kobo, customer_email, offer_quote
  ) VALUES (
    p_order_id, p_merchant_id, (v_order.total * 100)::bigint,
    lower(btrim(v_order.customer_email)), p_quote
  );
END;
$$;
REVOKE ALL ON FUNCTION private.record_bank_card_offer_order(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

-- Resolve a verification attempt from the stored order and the provider
-- transaction. Callers must still obtain and validate Paystack's evidence.
CREATE FUNCTION private.read_bank_card_offer_payment_context(
  p_order_id uuid, p_merchant_id uuid, p_transaction_id uuid
) RETURNS TABLE (quote jsonb, amount_kobo bigint, customer_email text, reference text)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT snapshot.offer_quote, snapshot.payable_kobo, snapshot.customer_email,
         attempt.gateway_reference
  FROM private.bank_card_offer_order_snapshots AS snapshot
  JOIN public.transactions AS attempt
    ON attempt.order_id = snapshot.order_id
   AND attempt.merchant_id = snapshot.merchant_id
  WHERE snapshot.order_id = p_order_id AND snapshot.merchant_id = p_merchant_id
    AND attempt.id = p_transaction_id AND attempt.gateway = 'paystack'
    AND attempt.transaction_type = 'payment' AND attempt.currency = 'NGN'
    AND attempt.amount * 100 = snapshot.payable_kobo
    AND NULLIF(btrim(attempt.gateway_reference), '') IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION private.read_bank_card_offer_payment_context(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
