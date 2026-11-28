-- Credit Direct is the only verified-funding refund route admitted by this pilot.
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
    IF private.verified_credit_direct_capture(o.id) IS NULL THEN
      RAISE EXCEPTION 'scenario_disabled';
    END IF;
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
  v_scenario := CASE WHEN funding.order_id IS NOT NULL THEN 'verified_funds:credit_direct:'
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
REVOKE ALL ON FUNCTION private.quote_paid_order_amendment(uuid,jsonb,boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.quote_paid_order_amendment(uuid,jsonb,boolean) TO authenticated, service_role;
