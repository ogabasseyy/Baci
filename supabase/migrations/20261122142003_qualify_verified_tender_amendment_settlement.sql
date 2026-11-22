-- The evidence importers attest independently reconciled receipts and
-- completed disbursements. These commands never initiate an external payout.
ALTER TABLE private.paid_order_amendment_config
  ADD COLUMN verified_cash_pos_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN verified_credit_direct_refunds_enabled boolean NOT NULL DEFAULT false;

-- Credit Direct's public contract documents full cancellation. A downgrade
-- additionally needs an order-specific exception confirmed by the lender.
ALTER TABLE private.paid_order_verified_funding
  ADD COLUMN lender_amendment_approval_reference text
    CHECK (length(btrim(lender_amendment_approval_reference)) BETWEEN 8 AND 160);

ALTER TABLE private.paid_order_bank_evidence
  ADD COLUMN collection_method text NOT NULL DEFAULT 'bank_transfer'
    CHECK (collection_method IN ('bank_transfer','cash','pos')),
  ADD CONSTRAINT paid_order_offline_receipt_scope
    CHECK (collection_method = 'bank_transfer' OR
      (direction = 'incoming' AND bound_order_id IS NOT NULL AND
       (allocation IS NULL OR allocation = 'top_up')));

CREATE TABLE private.paid_order_verified_refund_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders,
  payment_id uuid NOT NULL REFERENCES public.transactions,
  purpose text NOT NULL CHECK (purpose IN ('downgrade','cancellation')),
  method text NOT NULL CHECK (method IN ('credit_direct','bank_transfer','cash','pos')),
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 9999999999),
  reference text NOT NULL CHECK (length(reference) BETWEEN 8 AND 128),
  reconciliation_reference text NOT NULL CHECK (length(reconciliation_reference) BETWEEN 8 AND 160),
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  transaction_id uuid UNIQUE,
  UNIQUE (method,reference),
  UNIQUE (payment_id,purpose)
);
ALTER TABLE private.paid_order_verified_refund_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.paid_order_verified_refund_evidence FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.register_paid_order_tender_receipt(
  p_order_id uuid,p_method text,p_receipt_reference text,p_reconciliation_reference text,
  p_amount_minor bigint,p_occurred_at timestamptz
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  o public.orders%ROWTYPE;
  c private.paid_order_amendment_config%ROWTYPE;
  e private.paid_order_bank_evidence%ROWTYPE;
  receipt_key text := 'tender:' || p_method || ':' || upper(p_receipt_reference);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'bank_evidence_worker_required' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_method,'') NOT IN ('cash','pos')
    OR COALESCE(p_receipt_reference,'') !~ '^[A-Za-z0-9_.:/-]{8,100}$'
    OR length(COALESCE(p_reconciliation_reference,'')) NOT BETWEEN 8 AND 160
    OR p_occurred_at IS NULL OR p_occurred_at > clock_timestamp()
    OR p_amount_minor IS NULL OR p_amount_minor NOT BETWEEN 1 AND 9999999999 THEN
    RAISE EXCEPTION 'tender_evidence_required';
  END IF;
  SELECT * INTO o FROM public.orders WHERE id = p_order_id;
  SELECT * INTO c FROM private.paid_order_amendment_config WHERE merchant_id = o.merchant_id FOR SHARE;
  IF NOT FOUND OR c.bank_account_id IS NULL OR p_occurred_at < c.bank_evidence_cutover THEN
    RAISE EXCEPTION 'tender_evidence_required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || p_order_id::text,0));
  SELECT * INTO STRICT o FROM public.orders WHERE id = p_order_id FOR UPDATE;
  SELECT * INTO e FROM private.paid_order_bank_evidence
  WHERE account_id = c.bank_account_id AND bank_transaction_id = receipt_key;
  IF FOUND THEN
    IF ROW(e.bound_order_id,e.collection_method,e.amount_minor,e.occurred_at,e.statement_entry)
      IS DISTINCT FROM ROW(o.id,p_method,p_amount_minor,p_occurred_at,p_reconciliation_reference) THEN
      RAISE EXCEPTION 'bank_evidence_conflict';
    END IF;
    RETURN e.id;
  END IF;
  IF NOT c.enabled OR NOT c.verified_cash_pos_enabled OR o.payment_status <> 'paid'
    OR o.cancelled_at IS NOT NULL OR o.shipping_status NOT IN ('pending','processing')
    OR NOT EXISTS (SELECT 1 FROM private.paid_order_verified_funding WHERE order_id = o.id)
    OR EXISTS (SELECT 1 FROM private.paid_order_amendments WHERE order_id = o.id) THEN
    RAISE EXCEPTION 'scenario_disabled';
  END IF;
  INSERT INTO private.paid_order_bank_evidence(merchant_id,account_id,bank_transaction_id,
    direction,amount_minor,currency,occurred_at,statement_entry,bound_order_id,collection_method)
  VALUES (o.merchant_id,c.bank_account_id,receipt_key,
    'incoming',p_amount_minor,'NGN',p_occurred_at,p_reconciliation_reference,o.id,p_method)
  RETURNING id INTO e.id;
  RETURN e.id;
END;
$$;
REVOKE ALL ON FUNCTION public.register_paid_order_tender_receipt(uuid,text,text,text,bigint,timestamptz)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_paid_order_tender_receipt(uuid,text,text,text,bigint,timestamptz) TO service_role;

CREATE FUNCTION private.verified_credit_direct_capture(p_order_id uuid)
RETURNS uuid LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT t.id FROM private.paid_order_verified_funding f
  JOIN public.orders o ON o.id = f.order_id
  JOIN public.transactions t ON t.id = f.capture_ids[1] AND t.order_id = o.id AND t.merchant_id = o.merchant_id
  WHERE f.order_id = p_order_id AND cardinality(f.capture_ids) = 1
    AND o.payment_method = 'credit_direct' AND t.transaction_type = 'payment'
    AND t.gateway = 'credit_direct' AND t.status = 'completed' AND t.currency = 'NGN'
    AND NULLIF(btrim(t.gateway_reference),'') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.merchant_settlements s
      WHERE s.source_type = 'order' AND s.source_id = o.id);
$$;
REVOKE ALL ON FUNCTION private.verified_credit_direct_capture(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.register_paid_order_verified_refund(
  p_order_id uuid,p_payment_id uuid,p_capture_reference text,p_purpose text,p_reference text,
  p_reconciliation_reference text,p_amount_minor bigint
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a private.paid_order_amendments%ROWTYPE;
  o public.orders%ROWTYPE;
  p public.transactions%ROWTYPE;
  e private.paid_order_verified_refund_evidence%ROWTYPE;
  method text;
  expected bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'refund_evidence_worker_required' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_purpose,'') NOT IN ('downgrade','cancellation')
    OR COALESCE(p_reference,'') !~ '^[A-Za-z0-9_.:/-]{8,128}$'
    OR length(COALESCE(p_reconciliation_reference,'')) NOT BETWEEN 8 AND 160
    OR p_amount_minor IS NULL OR p_amount_minor NOT BETWEEN 1 AND 9999999999 THEN
    RAISE EXCEPTION 'refund_evidence_required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || p_order_id::text,0));
  SELECT * INTO o FROM public.orders WHERE id = p_order_id FOR UPDATE;
  SELECT * INTO a FROM private.paid_order_amendments WHERE order_id = o.id AND settlement_route = 'verified_funds';
  IF NOT FOUND OR private.verified_credit_direct_capture(o.id) IS NULL THEN
    RAISE EXCEPTION 'refund_evidence_required';
  END IF;
  SELECT * INTO p FROM public.transactions WHERE id = p_payment_id AND order_id = o.id
    AND merchant_id = o.merchant_id AND transaction_type = 'payment' AND status = 'completed' AND currency = 'NGN';
  IF NOT FOUND OR p_capture_reference IS NULL OR p.gateway_reference IS DISTINCT FROM p_capture_reference THEN
    RAISE EXCEPTION 'refund_evidence_required';
  END IF;
  IF p.id = private.verified_credit_direct_capture(o.id) THEN
    method := 'credit_direct';
  ELSE
    SELECT collection_method INTO method FROM private.paid_order_bank_evidence
    WHERE order_id = o.id AND transaction_id = p.id AND allocation = 'top_up';
  END IF;
  IF method IS NULL THEN RAISE EXCEPTION 'refund_evidence_required'; END IF;
  SELECT * INTO e FROM private.paid_order_verified_refund_evidence WHERE payment_id = p.id AND purpose = p_purpose;
  IF FOUND THEN
    IF ROW(e.reference,e.reconciliation_reference,e.amount_minor)
      IS DISTINCT FROM ROW(p_reference,p_reconciliation_reference,p_amount_minor) THEN
      RAISE EXCEPTION 'refund_evidence_required';
    END IF;
    RETURN e.id;
  END IF;
  IF o.cancelled_at IS NOT NULL OR o.shipping_status NOT IN ('pending','processing')
    OR o.shipment_id IS NOT NULL OR o.tracking_number IS NOT NULL
    OR o.shipment_booking_lock_token IS NOT NULL THEN RAISE EXCEPTION 'amendment_fulfillment_open'; END IF;
  IF p_purpose = 'downgrade' AND method = 'credit_direct' AND a.state = 'awaiting_refund' THEN
    expected := a.refund_owed_minor;
  ELSIF p_purpose = 'cancellation' AND a.state = 'settled' AND a.hold_fulfillment
    AND EXISTS (SELECT 1 FROM private.paid_order_amendment_events WHERE amendment_id = a.id
      AND event_type = 'verified_cancellation_opened') THEN
    SELECT (p.amount * 100)::bigint - COALESCE(sum(amount_minor),0) INTO expected
    FROM private.paid_order_verified_refund_evidence WHERE payment_id = p.id
      AND purpose = 'downgrade' AND transaction_id IS NOT NULL;
  END IF;
  IF expected IS DISTINCT FROM p_amount_minor THEN RAISE EXCEPTION 'refund_evidence_required'; END IF;
  INSERT INTO private.paid_order_verified_refund_evidence(order_id,payment_id,purpose,method,amount_minor,
    reference,reconciliation_reference)
  VALUES (o.id,p.id,p_purpose,method,p_amount_minor,p_reference,p_reconciliation_reference)
  RETURNING id INTO e.id;
  RETURN e.id;
END;
$$;
REVOKE ALL ON FUNCTION public.register_paid_order_verified_refund(uuid,uuid,text,text,text,text,bigint)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_paid_order_verified_refund(uuid,uuid,text,text,text,text,bigint) TO service_role;

CREATE FUNCTION private.post_paid_order_verified_refund(e private.paid_order_verified_refund_evidence)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  refund_id uuid := gen_random_uuid();
  p public.transactions%ROWTYPE;
BEGIN
  IF e.transaction_id IS NOT NULL THEN RAISE EXCEPTION 'refund_evidence_required'; END IF;
  SELECT * INTO STRICT p FROM public.transactions WHERE id = e.payment_id;
  UPDATE private.paid_order_verified_refund_evidence SET transaction_id = refund_id WHERE id = e.id;
  INSERT INTO public.transactions(id,merchant_id,order_id,transaction_type,amount,currency,status,
    gateway,gateway_reference,metadata)
  VALUES (refund_id,p.merchant_id,e.order_id,'refund',e.amount_minor::numeric / 100,'NGN','completed',
    p.gateway,'verified-refund:' || e.id,jsonb_build_object(
      'payment_transaction_id',p.id,'method',e.method,'verified_refund_evidence_id',e.id));
END;
$$;

CREATE FUNCTION private.apply_paid_order_verified_refund(a private.paid_order_amendments, p_purpose text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  o public.orders%ROWTYPE;
  e private.paid_order_verified_refund_evidence%ROWTYPE;
  capture uuid;
  refund_total bigint;
BEGIN
  SELECT * INTO STRICT o FROM public.orders WHERE id = a.order_id FOR UPDATE;
  capture := private.verified_credit_direct_capture(o.id);
  IF capture IS NULL OR o.cancelled_at IS NOT NULL OR o.shipping_status NOT IN ('pending','processing')
    OR o.shipment_id IS NOT NULL OR o.tracking_number IS NOT NULL OR o.shipment_booking_lock_token IS NOT NULL THEN
    RAISE EXCEPTION 'verified_funding_refund_review_required';
  END IF;
  IF p_purpose = 'downgrade' THEN
    SELECT * INTO e FROM private.paid_order_verified_refund_evidence
    WHERE order_id = o.id AND payment_id = capture AND purpose = 'downgrade' FOR UPDATE;
    IF NOT FOUND OR a.state <> 'awaiting_refund' OR e.amount_minor <> a.refund_owed_minor THEN
      RAISE EXCEPTION 'refund_evidence_required';
    END IF;
    UPDATE private.paid_order_amendments SET state = 'settled',hold_fulfillment = false,refund_owed_minor = 0 WHERE id = a.id;
    PERFORM private.post_paid_order_verified_refund(e);
    INSERT INTO private.paid_order_amendment_events(amendment_id,actor_id,event_type,details)
    VALUES (a.id,auth.uid(),'customer_refund_verified',jsonb_build_object('evidenceId',e.id,
      'amountMinor',e.amount_minor,'method','credit_direct'));
  ELSE
    IF a.state <> 'settled' OR NOT a.hold_fulfillment OR length(COALESCE(p_reason,'')) NOT BETWEEN 1 AND 500
      OR EXISTS (SELECT 1 FROM private.paid_order_bank_evidence WHERE
        (order_id = o.id AND allocation = 'unapplied') OR (bound_order_id = o.id AND allocation IS NULL))
      OR EXISTS (SELECT 1 FROM private.paid_order_checkout_capture_exceptions WHERE order_id = o.id AND returned_at IS NULL)
    THEN RAISE EXCEPTION 'refund_evidence_required'; END IF;
    SELECT COALESCE(sum(amount_minor),0) INTO refund_total
    FROM private.paid_order_verified_refund_evidence WHERE order_id = o.id AND purpose = 'cancellation' AND transaction_id IS NULL;
    IF refund_total <> (o.total * 100)::bigint OR EXISTS (
      SELECT 1 FROM public.transactions t WHERE t.order_id = o.id AND t.transaction_type = 'payment'
        AND t.status IN ('completed','success','refund_pending','refunded')
        AND NOT EXISTS (SELECT 1 FROM private.paid_order_verified_refund_evidence r
          WHERE r.payment_id = t.id AND r.purpose = 'cancellation' AND r.transaction_id IS NULL)
    ) THEN RAISE EXCEPTION 'refund_evidence_required'; END IF;
    UPDATE private.paid_order_amendments SET state = 'cancelled_for_recovery',hold_fulfillment = false WHERE id = a.id;
    IF NOT public.cancel_order_as_merchant(o.id,p_reason,'manual') THEN
      RAISE EXCEPTION 'verified_funding_refund_review_required';
    END IF;
    FOR e IN SELECT * FROM private.paid_order_verified_refund_evidence WHERE order_id = o.id AND purpose = 'cancellation'
      ORDER BY payment_id FOR UPDATE LOOP
      PERFORM private.post_paid_order_verified_refund(e);
    END LOOP;
    UPDATE public.orders SET payment_status = 'refunded' WHERE id = o.id;
    UPDATE public.order_cancellation_side_effects SET status = 'completed'
      WHERE order_id = o.id AND step = 'refund';
    INSERT INTO private.paid_order_amendment_events(amendment_id,actor_id,event_type,details)
    VALUES (a.id,auth.uid(),'cancelled_for_recovery',jsonb_build_object('reason',p_reason,'amountMinor',refund_total));
  END IF;
  RETURN private.paid_order_amendment_summary(o.id);
END;
$$;
REVOKE ALL ON FUNCTION private.post_paid_order_verified_refund(private.paid_order_verified_refund_evidence),
  private.apply_paid_order_verified_refund(private.paid_order_amendments,text,text)
FROM PUBLIC, anon, authenticated, service_role;


CREATE OR REPLACE FUNCTION private.quote_paid_order_amendment(
  p_order_id uuid, p_selection jsonb, p_lock boolean
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  o public.orders%ROWTYPE;
  item public.order_items%ROWTYPE;
  original public.products%ROWTYPE;
  replacement public.products%ROWTYPE;
  variant public.product_variants%ROWTYPE;
  offer public.product_offers%ROWTYPE;
  payment public.transactions%ROWTYPE;
  config private.paid_order_amendment_config%ROWTYPE;
  funding private.paid_order_verified_funding%ROWTYPE;
  v_kind text := p_selection#>>'{replacement,kind}';
  v_target uuid := (p_selection#>>'{replacement,id}')::uuid;
  v_product uuid;
  v_price numeric;
  v_total numeric;
  v_delta bigint;
  v_scenario text;
  v_pool text;
  v_condition text;
  v_available integer;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND OR NOT private.can_access_paid_order_amendment(o.merchant_id, 'edit') THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO config FROM private.paid_order_amendment_config WHERE merchant_id = o.merchant_id;
  IF NOT FOUND OR NOT config.enabled THEN RAISE EXCEPTION 'scenario_disabled'; END IF;

  IF o.shipment_id IS NOT NULL OR o.tracking_number IS NOT NULL
     OR o.shipment_booking_lock_token IS NOT NULL
     OR o.cancelled_at IS NOT NULL OR o.shipping_status NOT IN ('pending', 'processing') THEN
    RAISE EXCEPTION 'amendment_fulfillment_open';
  END IF;
  IF p_lock THEN
    SELECT * INTO funding FROM private.paid_order_verified_funding WHERE order_id = o.id FOR SHARE;
  ELSE
    SELECT * INTO funding FROM private.paid_order_verified_funding WHERE order_id = o.id;
  END IF;
  IF (funding.order_id IS NULL AND (COALESCE(o.source, '') <> 'online_store'
        OR COALESCE(o.payment_method, '') NOT IN ('card', 'paystack')))
     OR COALESCE(o.currency, '') <> 'NGN' OR o.payment_status <> 'paid'
     OR o.total <= 0 OR o.amount_paid IS DISTINCT FROM o.total
     OR COALESCE(o.wallet_amount_used, 0) <> 0 OR COALESCE(o.discount_amount, 0) <> 0
     OR COALESCE(o.tax_amount, 0) <> 0 OR COALESCE(o.shipping_fee, 0) <> 0
     OR COALESCE(o.gift_wrapping_fee, 0) <> 0 OR o.selected_quote_id IS NOT NULL
     OR o.firs_irn IS NOT NULL OR o.firs_csid IS NOT NULL OR o.invoice_pdf_url IS NOT NULL
     OR o.subtotal IS DISTINCT FROM o.total THEN
    RAISE EXCEPTION 'amendment_ineligible';
  END IF;

  IF EXISTS (SELECT 1 FROM private.paid_order_checkout_claims WHERE order_id = o.id)
    OR EXISTS (SELECT 1 FROM public.transactions t WHERE t.order_id = o.id
    AND t.transaction_type = 'payment' AND t.status IN ('pending', 'processing')) THEN
    RAISE EXCEPTION 'amendment_payment_open';
  END IF;
  IF funding.order_id IS NOT NULL THEN
    IF p_lock THEN
      PERFORM 1 FROM public.transactions WHERE id = ANY(funding.capture_ids) ORDER BY id FOR SHARE;
    END IF;
    IF private.paid_order_verified_capture_digest(o.id,o.merchant_id,funding.capture_ids,o.total)
         IS DISTINCT FROM funding.capture_digest
      OR EXISTS (SELECT 1 FROM public.transactions
        WHERE order_id = o.id AND transaction_type = 'refund') THEN
      RAISE EXCEPTION 'amendment_ineligible';
    END IF;
    IF EXISTS (SELECT 1 FROM private.paid_order_checkout_capture_exceptions
      WHERE order_id = o.id AND returned_at IS NULL) OR EXISTS (
      SELECT 1 FROM private.paid_order_bank_evidence WHERE order_id = o.id AND allocation = 'unapplied'
    ) THEN RAISE EXCEPTION 'amendment_payment_open'; END IF;
  ELSE
    IF (SELECT count(*) FROM public.transactions t WHERE t.order_id = o.id
      AND (t.transaction_type = 'refund' OR (t.transaction_type = 'payment'
        AND t.status IN ('success', 'completed', 'refund_pending', 'refunded')))) <> 1 THEN
      RAISE EXCEPTION 'amendment_ineligible';
    END IF;
    SELECT * INTO payment FROM public.transactions t
    WHERE t.order_id = o.id AND t.merchant_id = o.merchant_id
      AND t.transaction_type = 'payment' AND t.status = 'completed'
      AND t.currency = 'NGN' AND t.amount = o.total AND t.gateway = 'paystack'
      AND t.gateway_reference IS NOT NULL AND t.gateway_response->>'channel' = 'card';
    IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.merchant_settlements s
      WHERE s.source_type = 'order' AND s.source_id = o.id AND s.merchant_id = o.merchant_id
        AND s.gateway = 'paystack' AND s.gateway_reference = payment.gateway_reference
        AND s.gross_amount = payment.amount AND s.metadata->>'paystack_collection' = 'integration'
        AND s.status IN ('pending', 'processing', 'settled')) THEN
      RAISE EXCEPTION 'amendment_ineligible';
    END IF;
  END IF;

  IF p_lock THEN
    PERFORM 1 FROM public.order_items
      WHERE id = (p_selection->>'lineId')::uuid AND order_id = o.id FOR UPDATE NOWAIT;
  END IF;
  SELECT * INTO item FROM public.order_items
    WHERE id = (p_selection->>'lineId')::uuid AND order_id = o.id;
  IF NOT FOUND OR item.quantity <= 0 OR item.product_id IS NULL THEN
    RAISE EXCEPTION 'amendment_ineligible';
  END IF;
  -- Admit only orders whose current line arithmetic can be reproduced without
  -- changing tax, discounts, insurance or delivery economics.
  IF EXISTS (SELECT 1 FROM public.order_items i WHERE i.order_id = o.id
    AND (COALESCE(i.has_assurance, false) OR COALESCE(i.assurance_fee, 0) <> 0
      OR COALESCE(i.vat_amount, 0) <> 0 OR COALESCE(i.vat_rate, 0) <> 0
      OR (i.line_extension_amount IS NOT NULL AND i.line_extension_amount <> i.price * i.quantity)))
    OR (SELECT sum(i.price * i.quantity) FROM public.order_items i WHERE i.order_id = o.id)
      IS DISTINCT FROM o.total THEN
    RAISE EXCEPTION 'amendment_ineligible';
  END IF;

  CASE v_kind
    WHEN 'product' THEN v_product := v_target;
    WHEN 'variant' THEN SELECT product_id INTO v_product FROM public.product_variants
      WHERE id = v_target AND merchant_id = o.merchant_id;
    WHEN 'condition_offer' THEN SELECT product_id INTO v_product FROM public.product_offers
      WHERE id = v_target AND merchant_id = o.merchant_id;
    ELSE RAISE EXCEPTION 'invalid_amendment_selection' USING ERRCODE = '22023';
  END CASE;
  IF v_product IS NULL THEN RAISE EXCEPTION 'replacement_unavailable'; END IF;

  -- Checkout and serialized stock sync take product locks before adjusting pools.
  IF p_lock THEN
    PERFORM 1 FROM public.products WHERE merchant_id = o.merchant_id
      AND id IN (item.product_id, v_product) ORDER BY id FOR UPDATE;
  END IF;
  SELECT * INTO replacement FROM public.products WHERE id = v_product
    AND merchant_id = o.merchant_id AND status = 'active';
  IF NOT FOUND OR replacement.taxable IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'replacement_unavailable';
  END IF;
  SELECT * INTO original FROM public.products WHERE id = item.product_id AND merchant_id = o.merchant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'amendment_ineligible'; END IF;

  IF v_kind = 'variant' AND item.variant_id IS NOT NULL AND item.product_offer_id IS NULL
      AND item.offer_line IS NOT TRUE AND item.offer_id IS NULL AND item.offer_id_snapshot IS NULL THEN
    IF p_lock THEN
      PERFORM 1 FROM public.product_variants WHERE merchant_id = o.merchant_id
        AND id IN (v_target, item.variant_id) ORDER BY id FOR UPDATE;
    END IF;
    SELECT * INTO variant FROM public.product_variants WHERE id = v_target
      AND merchant_id = o.merchant_id AND product_id = v_product AND NOT is_inventory_anchor;
    IF NOT FOUND OR v_target = item.variant_id THEN RAISE EXCEPTION 'replacement_unavailable'; END IF;
    v_price := COALESCE(variant.price_override, replacement.price);
    v_condition := COALESCE(variant.condition, replacement.condition);
    IF COALESCE(NULLIF(variant.inventory_tracking_policy, 'inherit'), replacement.inventory_tracking_policy, 'off')
       <> 'serialized_strict'
       OR (SELECT COALESCE(NULLIF(v.inventory_tracking_policy, 'inherit'), original.inventory_tracking_policy, 'off')
           FROM public.product_variants v WHERE v.id = item.variant_id
             AND v.merchant_id = o.merchant_id AND v.product_id = item.product_id)
          IS DISTINCT FROM 'serialized_strict' THEN
      RAISE EXCEPTION 'amendment_ineligible';
    END IF;
    IF (SELECT count(*) FROM public.variant_inventory vi WHERE vi.order_item_id = item.id)
       <> item.quantity
       OR (SELECT count(*) FROM public.variant_inventory vi WHERE vi.order_item_id = item.id
        AND vi.order_id = o.id AND vi.merchant_id = o.merchant_id AND vi.variant_id = item.variant_id
        AND vi.status = 'reserved' AND vi.reservation_expires_at IS NULL AND vi.sold_at IS NULL
        AND vi.branch_id IS NOT DISTINCT FROM o.branch_id) <> item.quantity THEN
      RAISE EXCEPTION 'amendment_ineligible';
    END IF;
    SELECT count(*) INTO v_available FROM public.variant_inventory vi WHERE vi.variant_id = v_target
      AND vi.merchant_id = o.merchant_id AND vi.status = 'available'
      AND vi.order_id IS NULL AND vi.order_item_id IS NULL AND vi.sold_at IS NULL
      AND vi.branch_id IS NOT DISTINCT FROM o.branch_id;
    v_pool := 'serialized_variant';
  ELSIF v_kind = 'condition_offer' AND item.product_offer_id IS NOT NULL
      AND item.variant_id IS NULL THEN
    IF p_lock THEN
      PERFORM 1 FROM public.product_offers WHERE merchant_id = o.merchant_id
        AND id IN (v_target, item.product_offer_id) ORDER BY id FOR UPDATE;
    END IF;
    SELECT * INTO offer FROM public.product_offers WHERE id = v_target AND merchant_id = o.merchant_id
      AND product_id = replacement.id AND status = 'active';
    IF NOT FOUND OR v_target = item.product_offer_id OR NOT EXISTS (
      SELECT 1 FROM public.product_offers old_offer WHERE old_offer.id = item.product_offer_id
        AND old_offer.merchant_id = o.merchant_id AND old_offer.product_id = original.id
        AND old_offer.condition IS NOT DISTINCT FROM item.condition
    ) OR NOT public.commerce_cart_condition_pool_is_quantity_managed(o.merchant_id, original.id)
      OR NOT public.commerce_cart_condition_pool_is_quantity_managed(o.merchant_id, replacement.id) THEN
      RAISE EXCEPTION 'amendment_ineligible';
    END IF;
    v_price := offer.price;
    v_condition := offer.condition;
    v_available := offer.stock_quantity;
    v_pool := 'condition_offer';
  ELSIF v_kind = 'product' AND item.variant_id IS NULL AND item.product_offer_id IS NULL
      AND item.offer_line IS NOT TRUE AND item.offer_id IS NULL AND item.offer_id_snapshot IS NULL
      AND original.id <> replacement.id AND original.manage_stock IS TRUE
      AND replacement.manage_stock IS TRUE AND original.has_variants IS NOT TRUE
      AND replacement.has_variants IS NOT TRUE AND original.inventory_anchor_variant_id IS NULL
      AND replacement.inventory_anchor_variant_id IS NULL
      AND COALESCE(original.inventory_tracking_policy, 'off') = 'off'
      AND COALESCE(replacement.inventory_tracking_policy, 'off') = 'off' THEN
    v_price := replacement.price;
    v_condition := replacement.condition;
    v_available := replacement.stock_quantity;
    v_pool := 'product_scalar';
  ELSE
    RAISE EXCEPTION 'amendment_ineligible';
  END IF;
  IF COALESCE(v_available, 0) < item.quantity THEN RAISE EXCEPTION 'replacement_unavailable'; END IF;
  v_total := o.total + (v_price - item.price) * item.quantity;
  IF v_price < 0 OR v_total <= 0 OR v_total >= 100000000 THEN RAISE EXCEPTION 'amendment_ineligible'; END IF;
  v_delta := ((v_total - o.total) * 100)::bigint;
  IF funding.order_id IS NOT NULL AND v_delta < 0 AND (
    NOT config.verified_credit_direct_refunds_enabled
    OR funding.lender_amendment_approval_reference IS NULL
    OR private.verified_credit_direct_capture(o.id) IS NULL
  ) THEN
    RAISE EXCEPTION 'verified_funding_refund_review_required';
  END IF;
  IF funding.order_id IS NOT NULL AND (
    SELECT count(*) FROM private.paid_order_bank_evidence
    WHERE bound_order_id = o.id AND direction = 'incoming' AND allocation IS NULL
  ) > (CASE WHEN v_delta > 0 THEN 1 ELSE 0 END) THEN
    RAISE EXCEPTION 'amendment_payment_open';
  END IF;
  v_scenario := CASE WHEN funding.order_id IS NOT NULL THEN 'verified_funds:'
    ELSE 'paystack_integration_wallet:' END || v_pool || ':' ||
    CASE WHEN v_delta = 0 THEN 'equal' WHEN v_delta > 0 THEN 'upgrade' ELSE 'downgrade' END;
  IF (v_scenario = ANY(config.scenarios)) IS DISTINCT FROM true THEN RAISE EXCEPTION 'scenario_disabled'; END IF;

  RETURN jsonb_build_object(
    'orderVersion', md5(to_jsonb(o)::text || to_jsonb(item)::text),
    'configVersion', config.version, 'scenario', v_scenario, 'pool', v_pool,
    'captureId', payment.id, 'adjustmentMinor', v_delta,
    'beforeTotalMinor', (o.total * 100)::bigint, 'afterTotalMinor', (v_total * 100)::bigint,
    'beforeLine', jsonb_build_object('id', item.id, 'productId', item.product_id, 'name', item.name,
      'unitPriceMinor', (item.price * 100)::bigint, 'quantity', item.quantity,
      'variantId', item.variant_id, 'offerId', item.product_offer_id, 'condition', item.condition),
    'afterLine', jsonb_build_object('id', item.id, 'productId', replacement.id, 'name', replacement.name,
      'unitPriceMinor', (v_price * 100)::bigint, 'quantity', item.quantity,
      'variantId', variant.id, 'offerId', offer.id, 'condition', v_condition)
      || CASE WHEN v_pool = 'condition_offer' THEN jsonb_build_object(
        'offerGrade', offer.grade, 'offerConditionNotes', offer.condition_notes) ELSE '{}'::jsonb END
  ) || CASE WHEN funding.order_id IS NOT NULL THEN jsonb_build_object(
    'funding', jsonb_build_object('captureIds',funding.capture_ids,
      'captureDigest',funding.capture_digest,'approvedAt',funding.approved_at,
      'lenderApprovalPinned',CASE WHEN v_delta < 0 THEN md5(funding.lender_amendment_approval_reference) END),
    'bankEvidence', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',e.id,'amountMinor',e.amount_minor,'occurredAt',e.occurred_at,'method',e.collection_method) ORDER BY e.occurred_at,e.id)
      FROM (SELECT id,amount_minor,occurred_at,collection_method FROM private.paid_order_bank_evidence
        WHERE merchant_id = o.merchant_id AND account_id = config.bank_account_id
          AND bound_order_id = o.id AND direction = 'incoming' AND currency = 'NGN'
          AND allocation IS NULL AND amount_minor = v_delta
          AND (collection_method = 'bank_transfer' OR config.verified_cash_pos_enabled)
        ORDER BY occurred_at,id LIMIT 30) e), '[]'::jsonb)
  ) ELSE '{}'::jsonb END;
END;
$$;

CREATE OR REPLACE FUNCTION private.apply_paid_order_top_up(a private.paid_order_amendments, p_evidence_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  entry private.paid_order_bank_evidence%ROWTYPE;
  payment_id uuid := gen_random_uuid();
BEGIN
  SELECT e.* INTO entry FROM private.paid_order_bank_evidence e
  JOIN private.paid_order_amendment_config c ON c.merchant_id = e.merchant_id AND c.bank_account_id = e.account_id
  WHERE e.id = p_evidence_id AND e.merchant_id = a.merchant_id AND e.direction = 'incoming'
    AND (e.bound_order_id IS NULL OR e.bound_order_id = a.order_id) FOR UPDATE OF e;
  IF NOT FOUND THEN RAISE EXCEPTION 'bank_evidence_required'; END IF;
  IF entry.allocation IS NOT NULL THEN RAISE EXCEPTION 'bank_evidence_conflict'; END IF;
  IF entry.collection_method <> 'bank_transfer' AND (
    a.settlement_route <> 'verified_funds' OR a.state <> 'awaiting_payment'
    OR a.balance_due_minor <> entry.amount_minor OR entry.bound_order_id IS DISTINCT FROM a.order_id
  ) THEN RAISE EXCEPTION 'tender_evidence_required'; END IF;
  IF a.state = 'awaiting_payment' AND a.balance_due_minor = entry.amount_minor AND (
    EXISTS (SELECT 1 FROM private.paid_order_bank_evidence e WHERE e.id <> entry.id AND (
      (e.order_id = a.order_id AND e.allocation = 'unapplied')
      OR (e.bound_order_id = a.order_id AND e.allocation IS NULL AND e.amount_minor <> a.balance_due_minor)
    ))
    OR EXISTS (SELECT 1 FROM private.paid_order_checkout_capture_exceptions
      WHERE order_id = a.order_id AND returned_at IS NULL)
  ) THEN RAISE EXCEPTION 'amendment_payment_open'; END IF;
  IF a.state <> 'awaiting_payment' OR a.balance_due_minor <> entry.amount_minor THEN
    UPDATE private.paid_order_bank_evidence SET order_id = a.order_id, allocation = 'unapplied' WHERE id = entry.id;
    INSERT INTO private.paid_order_amendment_events(amendment_id,actor_id,event_type,details)
    VALUES (a.id,auth.uid(),'bank_funds_unapplied',jsonb_build_object('evidenceId',entry.id,'amountMinor',entry.amount_minor));
    RETURN jsonb_build_object('outcome','unapplied','evidenceId',entry.id);
  END IF;

  UPDATE private.paid_order_bank_evidence SET order_id = a.order_id, allocation = 'top_up',
    transaction_id = payment_id WHERE id = entry.id;
  INSERT INTO public.transactions(id,merchant_id,order_id,transaction_type,amount,currency,status,gateway,gateway_reference,metadata)
  VALUES (payment_id,a.merchant_id,a.order_id,'payment',entry.amount_minor::numeric/100,'NGN','completed',
    'manual',entry.id::text,jsonb_build_object('payment_method',entry.collection_method,'paid_order_amendment_id',a.id));
  UPDATE private.paid_order_amendments SET state = 'settled', balance_due_minor = 0, hold_fulfillment = false WHERE id = a.id;
  UPDATE public.orders SET amount_paid = amount_paid + entry.amount_minor::numeric/100, payment_status = 'paid'
  WHERE id = a.order_id;
  INSERT INTO private.paid_order_amendment_events(amendment_id,actor_id,event_type,details)
  VALUES (a.id,auth.uid(),'top_up_recorded',jsonb_build_object('evidenceId',entry.id,'transactionId',payment_id,
    'amountMinor',entry.amount_minor,'method',entry.collection_method));
  RETURN private.paid_order_amendment_summary(a.order_id);
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_paid_order_bank_allocation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  entry private.paid_order_bank_evidence%ROWTYPE;
  account uuid;
  method text;
BEGIN
  IF TG_OP <> 'INSERT' AND EXISTS (
    SELECT 1 FROM private.paid_order_bank_evidence WHERE transaction_id = OLD.id
  ) THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'bank_evidence_conflict'; END IF;
    IF ROW(NEW.id,NEW.order_id,NEW.merchant_id,NEW.gateway_reference,NEW.amount,NEW.currency,NEW.gateway,NEW.transaction_type)
       IS DISTINCT FROM ROW(OLD.id,OLD.order_id,OLD.merchant_id,OLD.gateway_reference,OLD.amount,OLD.currency,OLD.gateway,OLD.transaction_type)
       OR (OLD.transaction_type = 'refund' AND ROW(NEW.metadata->>'payment_transaction_id',NEW.metadata->>'method')
         IS DISTINCT FROM ROW(OLD.metadata->>'payment_transaction_id',OLD.metadata->>'method'))
       OR (NEW.status IS DISTINCT FROM OLD.status AND NOT (
         OLD.transaction_type = 'payment' AND OLD.status IN ('completed','refund_pending')
         AND NEW.status IN ('refund_pending','refunded')
       )) THEN
      RAISE EXCEPTION 'bank_evidence_conflict';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.order_id IS NULL OR NEW.gateway IS DISTINCT FROM 'manual' THEN RETURN NEW; END IF;
  IF NEW.transaction_type = 'refund' THEN
    IF EXISTS (SELECT 1 FROM private.paid_order_verified_refund_evidence r
      WHERE transaction_id = NEW.id AND order_id = NEW.order_id
        AND payment_id::text = NEW.metadata->>'payment_transaction_id'
        AND purpose = 'cancellation' AND r.method = NEW.metadata->>'method'
        AND amount_minor = NEW.amount * 100 AND NEW.status = 'completed' AND NEW.currency = 'NGN'
        AND NEW.gateway_reference = 'verified-refund:' || id) THEN RETURN NEW; END IF;
    IF EXISTS (SELECT 1 FROM private.paid_order_bank_evidence
      WHERE transaction_id::text = NEW.metadata->>'payment_transaction_id' AND allocation = 'top_up')
      AND NOT EXISTS (SELECT 1 FROM private.paid_order_bank_evidence
        WHERE transaction_id = NEW.id AND allocation = 'cancellation_refund' AND order_id = NEW.order_id) THEN
      RAISE EXCEPTION 'bank_disbursement_evidence_required';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.transaction_type <> 'payment' OR NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND ROW(NEW.id,NEW.order_id,NEW.merchant_id,NEW.gateway,NEW.gateway_reference,
      NEW.transaction_type,NEW.status,NEW.amount,NEW.currency,NEW.metadata->>'payment_method')
    IS NOT DISTINCT FROM ROW(OLD.id,OLD.order_id,OLD.merchant_id,OLD.gateway,OLD.gateway_reference,
      OLD.transaction_type,OLD.status,OLD.amount,OLD.currency,OLD.metadata->>'payment_method') THEN RETURN NEW; END IF;
  SELECT bank_account_id INTO account FROM private.paid_order_amendment_config WHERE merchant_id = NEW.merchant_id;
  IF account IS NULL THEN RETURN NEW; END IF;
  method := lower(COALESCE(NEW.metadata->>'payment_method',''));
  IF method IN ('cash','pos') AND NOT EXISTS (
    SELECT 1 FROM private.paid_order_amendments WHERE order_id = NEW.order_id
  ) THEN RETURN NEW; END IF;
  IF COALESCE(NEW.gateway_reference,'') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'bank_evidence_required';
  END IF;
  PERFORM 1 FROM public.orders WHERE id = NEW.order_id FOR UPDATE;
  SELECT * INTO entry FROM private.paid_order_bank_evidence
  WHERE id = NEW.gateway_reference::uuid AND merchant_id = NEW.merchant_id AND account_id = account
    AND (bound_order_id IS NULL OR bound_order_id = NEW.order_id)
    AND direction = 'incoming' AND currency = NEW.currency AND amount_minor = NEW.amount * 100 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'bank_evidence_required'; END IF;
  IF entry.allocation = 'top_up' AND entry.order_id = NEW.order_id AND entry.transaction_id = NEW.id
    AND entry.collection_method = method THEN
    RETURN NEW;
  END IF;
  IF entry.collection_method <> 'bank_transfer' OR entry.allocation IS NOT NULL OR EXISTS (
    SELECT 1 FROM private.paid_order_amendments WHERE order_id = NEW.order_id
  ) THEN RAISE EXCEPTION 'bank_evidence_conflict'; END IF;
  UPDATE private.paid_order_bank_evidence SET allocation = 'ordinary', order_id = NEW.order_id,
    transaction_id = NEW.id WHERE id = entry.id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_verified_funding_amendment_transactions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  prior_order uuid;
  next_order uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN prior_order := OLD.order_id; END IF;
  IF TG_OP <> 'DELETE' THEN next_order := NEW.order_id; END IF;
  -- Serialize ledger changes for approved orders with preview confirmation, even
  -- when a provider writer has not adopted the payment advisory lock.
  PERFORM 1 FROM public.orders o JOIN private.paid_order_verified_funding f ON f.order_id = o.id
  WHERE o.id IN (prior_order,next_order) ORDER BY o.id FOR UPDATE OF o;
  IF NOT EXISTS (SELECT 1 FROM private.paid_order_amendments
    WHERE order_id IN (prior_order,next_order) AND settlement_route = 'verified_funds') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  -- The existing evidence allocator pins the top-up transaction before insertion.
  -- No other transaction mutation can silently change the verified funding set.
  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1 FROM private.paid_order_bank_evidence e
    WHERE e.order_id = NEW.order_id AND e.transaction_id = NEW.id AND e.allocation = 'top_up'
  ) THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NEW.transaction_type = 'refund' AND EXISTS (
    SELECT 1 FROM private.paid_order_verified_refund_evidence r
    JOIN public.transactions p ON p.id = r.payment_id AND p.order_id = r.order_id
    WHERE r.order_id = NEW.order_id AND r.transaction_id = NEW.id AND p.merchant_id = NEW.merchant_id
      AND p.gateway = NEW.gateway AND NEW.gateway_reference = 'verified-refund:' || r.id
      AND r.id::text = NEW.metadata->>'verified_refund_evidence_id'
      AND r.payment_id::text = NEW.metadata->>'payment_transaction_id'
      AND r.method = NEW.metadata->>'method' AND r.amount_minor = NEW.amount * 100
      AND NEW.currency = 'NGN' AND NEW.status = 'completed'
  ) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND
    (to_jsonb(NEW) - 'updated_at') = (to_jsonb(OLD) - 'updated_at') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'verified_funding_refund_review_required';
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_verified_funding_amendment_cancellation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF ((NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at AND NEW.cancelled_at IS NOT NULL)
       OR (NEW.shipping_status IS DISTINCT FROM OLD.shipping_status
         AND NEW.shipping_status IN ('cancelled','canceled')))
    AND EXISTS (SELECT 1 FROM private.paid_order_amendments a
      WHERE a.order_id = OLD.id AND a.settlement_route = 'verified_funds'
        AND (a.state <> 'cancelled_for_recovery' OR NEW.cancellation_refund_mode IS DISTINCT FROM 'manual')) THEN
    RAISE EXCEPTION 'verified_funding_refund_review_required';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.enqueue_paid_order_amendment_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a private.paid_order_amendments%ROWTYPE;
  active_revision uuid;
  document uuid;
  snapshot_inputs jsonb;
  net_refunded numeric;
BEGIN
  IF NEW.event_type NOT IN ('confirmed','top_up_recorded','customer_refund_verified',
    'merchant_adjustment_applied','reversed','cancelled_for_recovery') THEN RETURN NEW; END IF;
  SELECT * INTO STRICT a FROM private.paid_order_amendments WHERE id = NEW.amendment_id;
  -- Verified-funds upgrades consume their bank evidence in the same command.
  -- Only the settled event publishes a revised invoice and customer update.
  IF a.settlement_route = 'verified_funds' AND a.state = 'awaiting_payment'
    AND NEW.event_type = 'confirmed' THEN RETURN NEW; END IF;
  SELECT id INTO STRICT active_revision FROM private.paid_order_amendment_revisions
    WHERE amendment_id = a.id ORDER BY revision DESC LIMIT 1;
  snapshot_inputs := private.paid_order_invoice_snapshot(a.order_id);
  SELECT private.pin_paid_order_revised_tax(snapshot_inputs,r.original_document_inputs->'invoice')
    INTO STRICT snapshot_inputs
    FROM private.paid_order_amendment_revisions r WHERE r.amendment_id = a.id AND r.revision = 1;
  SELECT COALESCE(sum(amount_minor),0)/100 INTO net_refunded FROM private.paid_order_amendment_refunds
    WHERE amendment_id = a.id AND state = 'processed';
  IF a.settlement_route = 'verified_funds' THEN
    SELECT COALESCE(sum(amount_minor),0)/100 INTO net_refunded FROM private.paid_order_verified_refund_evidence
    WHERE order_id = a.order_id AND transaction_id IS NOT NULL;
  END IF;
  -- The document shows customer net paid. The compatibility ledger retains gross.
  snapshot_inputs := jsonb_set(snapshot_inputs,'{order,amount_paid}',to_jsonb((snapshot_inputs#>>'{order,amount_paid}')::numeric - net_refunded));
  INSERT INTO private.paid_order_amendment_documents(amendment_id,event_id,revision_id,document_number,inputs)
  SELECT a.id,NEW.id,active_revision,COALESCE(max(d.document_number),0)+1,snapshot_inputs
  FROM private.paid_order_amendment_documents d WHERE d.amendment_id = a.id RETURNING id INTO document;
  INSERT INTO private.paid_order_amendment_updates(event_id,document_id) VALUES (NEW.id,document);
  RETURN NEW;
END;
$$;

CREATE FUNCTION private.open_paid_order_verified_cancellation(a private.paid_order_amendments,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  o public.orders%ROWTYPE;
BEGIN
  SELECT * INTO STRICT o FROM public.orders WHERE id = a.order_id FOR UPDATE;
  IF length(COALESCE(p_reason,'')) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_amendment_action' USING ERRCODE = '22023';
  END IF;
  IF a.state <> 'settled' OR a.hold_fulfillment
    OR private.verified_credit_direct_capture(o.id) IS NULL
    OR NOT EXISTS (SELECT 1 FROM private.paid_order_amendment_config WHERE merchant_id = o.merchant_id
      AND enabled AND verified_credit_direct_refunds_enabled)
    OR (o.cancelled_at IS NOT NULL OR o.shipping_status NOT IN ('pending','processing')
      OR o.shipment_id IS NOT NULL OR o.tracking_number IS NOT NULL OR o.shipment_booking_lock_token IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.transactions t WHERE t.order_id = o.id
      AND t.status IN ('pending','processing','refund_pending'))
    OR EXISTS (SELECT 1 FROM private.paid_order_checkout_capture_exceptions WHERE order_id = o.id AND returned_at IS NULL)
    OR EXISTS (SELECT 1 FROM private.paid_order_bank_evidence WHERE
      (order_id = o.id AND allocation = 'unapplied') OR (bound_order_id = o.id AND allocation IS NULL))
  THEN RAISE EXCEPTION 'verified_funding_refund_review_required'; END IF;
  UPDATE private.paid_order_amendments SET hold_fulfillment = true WHERE id = a.id;
  INSERT INTO private.paid_order_amendment_events(amendment_id,actor_id,event_type,details)
  VALUES (a.id,auth.uid(),'verified_cancellation_opened',jsonb_build_object('reason',p_reason));
  RETURN private.paid_order_amendment_summary(a.order_id);
END;
$$;
REVOKE ALL ON FUNCTION private.open_paid_order_verified_cancellation(private.paid_order_amendments,text)
FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.run_paid_order_amendment_action(p_order_id uuid,p_amendment_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a private.paid_order_amendments%ROWTYPE;
  prior private.paid_order_amendment_operations%ROWTYPE;
  action text := p_payload->>'action';
  key text := p_payload->>'idempotencyKey';
  reason text := btrim(p_payload->>'reason');
  result jsonb;
  fields text[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'amendment_forbidden' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR key IS NULL OR key <> btrim(key)
    OR length(key) NOT BETWEEN 8 AND 128 THEN
    RAISE EXCEPTION 'invalid_amendment_action' USING ERRCODE = '22023';
  END IF;
  fields := CASE action
    WHEN 'record_top_up' THEN ARRAY['evidenceId']
    WHEN 'claim_offline_disbursement' THEN ARRAY['sourceKind','sourceId']
    WHEN 'record_offline_refund' THEN ARRAY['claimId','evidenceId']
    WHEN 'retry_merchant_adjustment' THEN ARRAY['operationId']
    WHEN 'refresh_refund_status' THEN ARRAY['operationId']
    WHEN 'retry_failed_refund' THEN ARRAY['operationId']
    WHEN 'record_verified_lender_refund' THEN ARRAY[]::text[]
    WHEN 'open_verified_cancellation' THEN ARRAY['reason']
    WHEN 'cancel_with_verified_refunds' THEN ARRAY['reason']
    WHEN 'reverse' THEN ARRAY['reason']
    WHEN 'cancel_for_recovery' THEN ARRAY['reason']
  END;
  IF fields IS NULL OR NOT (p_payload ?& fields) OR
    (p_payload - (fields || ARRAY['action','idempotencyKey'])) <> '{}'::jsonb
    OR EXISTS (SELECT 1 FROM jsonb_each(p_payload) f WHERE jsonb_typeof(f.value) <> 'string') THEN
    RAISE EXCEPTION 'invalid_amendment_action' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO a FROM private.paid_order_amendments WHERE id = p_amendment_id AND order_id = p_order_id;
  IF NOT FOUND OR NOT private.can_access_paid_order_amendment(a.merchant_id,'edit') THEN
    RAISE EXCEPTION 'amendment_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF action = 'open_verified_cancellation' THEN
    PERFORM 1 FROM private.paid_order_amendment_config WHERE merchant_id = a.merchant_id FOR SHARE;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || p_order_id,0));
  PERFORM 1 FROM public.orders WHERE id = p_order_id AND merchant_id = a.merchant_id FOR UPDATE;
  SELECT * INTO a FROM private.paid_order_amendments WHERE id = p_amendment_id;
  IF NOT private.can_access_paid_order_amendment(a.merchant_id,'edit')
    OR (action IN ('claim_offline_disbursement','record_offline_refund','retry_merchant_adjustment',
          'refresh_refund_status','retry_failed_refund','reverse','cancel_for_recovery','record_verified_lender_refund',
          'open_verified_cancellation','cancel_with_verified_refunds')
      AND NOT private.can_access_paid_order_amendment(a.merchant_id,'refund')) THEN
    RAISE EXCEPTION 'amendment_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO prior FROM private.paid_order_amendment_operations
    WHERE amendment_id = a.id AND idempotency_key = key;
  IF FOUND THEN
    IF prior.request IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
    RETURN prior.result;
  END IF;
  IF a.settlement_route = 'verified_funds' AND action NOT IN
    ('record_verified_lender_refund','open_verified_cancellation','cancel_with_verified_refunds')
  THEN RAISE EXCEPTION 'verified_funding_refund_review_required'; END IF;
  IF a.settlement_route <> 'verified_funds' AND action IN
    ('record_verified_lender_refund','open_verified_cancellation','cancel_with_verified_refunds')
  THEN RAISE EXCEPTION 'amendment_ineligible'; END IF;
  CASE action
    WHEN 'open_verified_cancellation' THEN result := private.open_paid_order_verified_cancellation(a,reason);
    WHEN 'record_verified_lender_refund' THEN result := private.apply_paid_order_verified_refund(a,'downgrade',NULL);
    WHEN 'cancel_with_verified_refunds' THEN result := private.apply_paid_order_verified_refund(a,'cancellation',reason);
    WHEN 'record_top_up' THEN result := private.apply_paid_order_top_up(a,(p_payload->>'evidenceId')::uuid);
    WHEN 'claim_offline_disbursement','record_offline_refund' THEN result := private.apply_paid_order_disbursement(a,p_payload);
    WHEN 'refresh_refund_status','retry_failed_refund','retry_merchant_adjustment' THEN
      result := private.apply_paid_order_refund_operator_action(a,p_payload);
    WHEN 'reverse','cancel_for_recovery' THEN
      IF reason IS NULL OR length(reason) NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION 'invalid_amendment_action' USING ERRCODE = '22023';
      END IF;
      IF a.state NOT IN ('awaiting_payment','awaiting_refund') THEN RAISE EXCEPTION 'amendment_ineligible'; END IF;
      IF EXISTS (SELECT 1 FROM private.paid_order_amendment_refunds
        WHERE amendment_id = a.id AND state NOT IN ('queued','failed','void'))
        OR EXISTS (SELECT 1 FROM private.paid_order_bank_evidence WHERE
          (order_id = a.order_id AND allocation = 'unapplied') OR (bound_order_id = a.order_id AND allocation IS NULL))
        OR EXISTS (SELECT 1 FROM private.paid_order_offline_disbursements WHERE order_id = a.order_id AND evidence_id IS NULL)
        OR EXISTS (SELECT 1 FROM private.paid_order_checkout_capture_exceptions WHERE order_id = a.order_id AND returned_at IS NULL) THEN
        RAISE EXCEPTION 'amendment_payment_open';
      END IF;
      UPDATE private.paid_order_amendment_refunds SET state = 'void' WHERE amendment_id = a.id AND state = 'queued';
      IF action = 'reverse' THEN
        PERFORM private.reverse_paid_order_amendment(a,reason);
      ELSE
        UPDATE private.paid_order_amendments SET state = 'cancelled_for_recovery',hold_fulfillment = false,
          refund_owed_minor = 0,balance_due_minor = 0 WHERE id = a.id;
        IF NOT public.cancel_order_as_merchant(a.order_id,reason,'automatic') THEN
          RAISE EXCEPTION 'amendment_ineligible';
        END IF;
        INSERT INTO private.paid_order_amendment_events(amendment_id,actor_id,event_type,details)
        VALUES (a.id,auth.uid(),'cancelled_for_recovery',jsonb_build_object('reason',reason));
      END IF;
      result := private.paid_order_amendment_summary(a.order_id);
  END CASE;
  INSERT INTO private.paid_order_amendment_operations(amendment_id,idempotency_key,request,result)
  VALUES (a.id,key,p_payload,result);
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.read_paid_order_amendment_workspace(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  o public.orders%ROWTYPE;
  result jsonb;
  edit_allowed boolean;
  refund_allowed boolean;
  a private.paid_order_amendments%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002'; END IF;
  result := public.read_paid_order_amendment(p_order_id);
  edit_allowed := private.can_access_paid_order_amendment(o.merchant_id,'edit');
  refund_allowed := edit_allowed AND private.can_access_paid_order_amendment(o.merchant_id,'refund');
  SELECT * INTO a FROM private.paid_order_amendments WHERE order_id = o.id;
  RETURN result || jsonb_build_object(
    'canStart',edit_allowed AND a.id IS NULL AND (
      o.source = 'online_store'
      OR EXISTS (SELECT 1 FROM private.paid_order_verified_funding WHERE order_id = o.id)
    )
      AND o.payment_status = 'paid' AND o.shipping_status IN ('pending','processing')
      AND o.cancelled_at IS NULL AND o.shipment_id IS NULL AND o.shipment_booking_lock_token IS NULL
      AND EXISTS (SELECT 1 FROM private.paid_order_amendment_config
        WHERE merchant_id = o.merchant_id AND enabled AND cardinality(scenarios) > 0),
    'canEdit',edit_allowed,'canRefund',refund_allowed,
    'isVerifiedFunding', COALESCE(a.settlement_route = 'verified_funds',false),
    'verifiedCreditDirectRefund', refund_allowed AND a.settlement_route = 'verified_funds'
      AND a.state = 'awaiting_refund' AND private.verified_credit_direct_capture(o.id) IS NOT NULL
      AND EXISTS (SELECT 1 FROM private.paid_order_verified_refund_evidence
        WHERE order_id = o.id AND purpose = 'downgrade' AND transaction_id IS NULL),
    'canOpenVerifiedCancellation', refund_allowed AND a.settlement_route = 'verified_funds'
      AND a.state = 'settled' AND NOT a.hold_fulfillment AND o.cancelled_at IS NULL
      AND private.verified_credit_direct_capture(o.id) IS NOT NULL
      AND EXISTS (SELECT 1 FROM private.paid_order_amendment_config WHERE merchant_id = o.merchant_id
        AND enabled AND verified_credit_direct_refunds_enabled),
    'verifiedCancellationPending', refund_allowed AND a.settlement_route = 'verified_funds'
      AND a.state = 'settled' AND a.hold_fulfillment AND EXISTS (
        SELECT 1 FROM private.paid_order_amendment_events WHERE amendment_id = a.id AND event_type = 'verified_cancellation_opened'),
    'verifiedCancellationReady', refund_allowed AND a.settlement_route = 'verified_funds'
      AND a.state = 'settled' AND a.hold_fulfillment AND (o.total * 100)::bigint = (
        SELECT COALESCE(sum(amount_minor),0) FROM private.paid_order_verified_refund_evidence
        WHERE order_id = o.id AND purpose = 'cancellation' AND transaction_id IS NULL),
    'confirmationKey',CASE WHEN edit_allowed AND a.actor_id = auth.uid() THEN a.idempotency_key END,
    'customer',private.paid_order_amendment_customer_status(o.id),
    'refunds',CASE WHEN refund_allowed THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',r.id,'state',r.state,'amountMinor',r.amount_minor,
        'preflightReview',r.preflight_review)
        ORDER BY r.created_at DESC,r.id DESC)
      FROM private.paid_order_amendment_refunds r WHERE r.amendment_id = a.id
    ),'[]'::jsonb) ELSE '[]'::jsonb END,
    'bankEvidence',CASE WHEN edit_allowed AND a.id IS NOT NULL THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',q.id,'amountMinor',q.amount_minor,'status',q.allocation,
        'transactionId',q.transaction_id,'occurredAt',q.occurred_at))
      FROM (SELECT e.* FROM private.paid_order_bank_evidence e
        WHERE e.merchant_id = o.merchant_id AND e.direction = 'incoming' AND (
          (e.order_id = o.id AND e.allocation IN ('unapplied','top_up'))
          OR (e.allocation IS NULL AND e.bound_order_id = o.id)
        ) ORDER BY e.occurred_at DESC,e.id LIMIT 30) q
    ),'[]'::jsonb) ELSE '[]'::jsonb END
  );
END;
$$;
