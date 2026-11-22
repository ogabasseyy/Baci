-- An operator may approve an independently reconciled order's funding, including
-- historical or mixed payment methods. This adds no pilot configuration or
-- approvals. A paid status alone never establishes a captured payment.
CREATE TABLE private.paid_order_verified_funding (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id),
  capture_ids uuid[] NOT NULL CHECK (cardinality(capture_ids) BETWEEN 1 AND 16),
  capture_digest text NOT NULL CHECK (capture_digest ~ '^[a-f0-9]{32}$'),
  approval_reference text NOT NULL CHECK (length(btrim(approval_reference)) BETWEEN 8 AND 160),
  approved_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.paid_order_verified_funding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.paid_order_verified_funding FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.paid_order_verified_capture_digest(
  p_order_id uuid, p_merchant_id uuid, p_capture_ids uuid[], p_amount numeric
) RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN count(*) = cardinality(p_capture_ids)
      AND count(*) FILTER (WHERE t.id = ANY(p_capture_ids) AND t.merchant_id = p_merchant_id
        AND t.status IN ('completed','success') AND t.currency = 'NGN'
        AND t.amount > 0 AND t.amount * 100 = trunc(t.amount * 100)) = cardinality(p_capture_ids)
      AND sum(t.amount) = p_amount
    THEN md5(jsonb_agg(jsonb_build_array(t.id,t.gateway,t.gateway_reference,t.amount,t.currency,t.status)
      ORDER BY t.id)::text)
  END
  FROM public.transactions t
  WHERE t.order_id = p_order_id
    AND t.transaction_type = 'payment' AND t.status IN ('completed','success','refund_pending','refunded');
$$;
REVOKE ALL ON FUNCTION private.paid_order_verified_capture_digest(uuid,uuid,uuid[],numeric)
FROM PUBLIC, anon, authenticated, service_role;

-- Do not kick off ordinary cancellation for a tender whose reversal workflow
-- has not been qualified. Fulfilment of a settled amendment remains available.
CREATE FUNCTION private.guard_verified_funding_amendment_cancellation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF ((NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at AND NEW.cancelled_at IS NOT NULL)
       OR (NEW.shipping_status IS DISTINCT FROM OLD.shipping_status
         AND NEW.shipping_status IN ('cancelled','canceled')))
    AND EXISTS (SELECT 1 FROM private.paid_order_amendments a
      WHERE a.order_id = OLD.id AND a.settlement_route = 'verified_funds') THEN
    RAISE EXCEPTION 'verified_funding_refund_review_required';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_verified_funding_amendment_cancellation()
FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER paid_order_verified_funding_cancellation
BEFORE UPDATE OF shipping_status, cancelled_at ON public.orders
FOR EACH ROW EXECUTE FUNCTION private.guard_verified_funding_amendment_cancellation();

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
  IF funding.order_id IS NOT NULL AND v_delta < 0 THEN
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
      'captureDigest',funding.capture_digest,'approvedAt',funding.approved_at),
    'bankEvidence', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',e.id,'amountMinor',e.amount_minor,'occurredAt',e.occurred_at) ORDER BY e.occurred_at,e.id)
      FROM (SELECT id,amount_minor,occurred_at FROM private.paid_order_bank_evidence
        WHERE merchant_id = o.merchant_id AND account_id = config.bank_account_id
          AND bound_order_id = o.id AND direction = 'incoming' AND currency = 'NGN'
          AND allocation IS NULL AND amount_minor = v_delta
        ORDER BY occurred_at,id LIMIT 30) e), '[]'::jsonb)
  ) ELSE '{}'::jsonb END;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_paid_order_amendment(p_order_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  o public.orders%ROWTYPE;
  existing private.paid_order_amendments%ROWTYPE;
  p private.paid_order_amendment_previews%ROWTYPE;
  v_config_version bigint;
  v_config_enabled boolean;
  v_key text := btrim(p_payload->>'idempotencyKey');
  v_reason text := btrim(p_payload->>'reason');
  v_quote jsonb;
  v_next jsonb;
  v_offer uuid;
  v_snapshot jsonb;
  v_fulfillment jsonb;
  v_total numeric;
  v_delta bigint;
  v_id uuid;
  v_verified boolean;
  v_bank_evidence uuid;
  v_amendment private.paid_order_amendments%ROWTYPE;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
    OR p_payload->'customerAgreed' IS DISTINCT FROM 'true'::jsonb
    OR v_key IS NULL OR length(v_key) NOT BETWEEN 8 AND 128
    OR v_reason IS NULL OR length(v_reason) NOT BETWEEN 1 AND 500
    OR length(COALESCE(p_payload->>'supportReference', '')) > 200
    OR (p_payload ? 'bankEvidenceId' AND jsonb_typeof(p_payload->'bankEvidenceId') <> 'string')
    OR (p_payload - ARRAY['customerAgreed','idempotencyKey','reason','supportReference','previewId','bankEvidenceId']) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid_amendment_confirmation' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO o FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND OR NOT private.can_access_paid_order_amendment(o.merchant_id, 'edit') THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT version, enabled INTO v_config_version, v_config_enabled
    FROM private.paid_order_amendment_config WHERE merchant_id = o.merchant_id FOR SHARE;
  PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || p_order_id::text, 0));
  SELECT * INTO o FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR NOT private.can_access_paid_order_amendment(o.merchant_id, 'edit') THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO existing FROM private.paid_order_amendments WHERE order_id = p_order_id;
  IF FOUND THEN
    IF existing.idempotency_key <> v_key
      OR (existing.settlement_route = 'verified_funds' AND existing.actor_id <> auth.uid())
      THEN RAISE EXCEPTION 'already_amended'; END IF;
    IF existing.request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
    RETURN private.paid_order_amendment_summary(o.id);
  END IF;
  IF v_config_enabled IS DISTINCT FROM true THEN RAISE EXCEPTION 'scenario_disabled'; END IF;

  SELECT * INTO p FROM private.paid_order_amendment_previews
  WHERE id = (p_payload->>'previewId')::uuid AND order_id = p_order_id AND actor_id = auth.uid();
  IF NOT FOUND OR p.expires_at <= clock_timestamp()
      OR (p.quote->>'configVersion')::bigint IS DISTINCT FROM v_config_version THEN
    RAISE EXCEPTION 'preview_stale';
  END IF;

  v_quote := private.add_paid_order_amendment_quote_options(
    private.quote_paid_order_amendment(p_order_id, p.selection, true),p_order_id);
  IF v_quote IS DISTINCT FROM p.quote THEN RAISE EXCEPTION 'preview_stale'; END IF;
  v_delta := (v_quote->>'adjustmentMinor')::bigint;
  v_verified := v_quote ? 'funding';
  IF v_verified AND v_delta > 0 THEN
    v_bank_evidence := (p_payload->>'bankEvidenceId')::uuid;
    IF v_bank_evidence IS NULL OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_quote->'bankEvidence') entry
      WHERE entry->>'id' = v_bank_evidence::text
    ) THEN RAISE EXCEPTION 'bank_evidence_required'; END IF;
  ELSIF p_payload ? 'bankEvidenceId' THEN
    RAISE EXCEPTION 'invalid_amendment_confirmation' USING ERRCODE = '22023';
  END IF;
  IF v_delta < 0 AND NOT private.can_access_paid_order_amendment(o.merchant_id, 'refund') THEN
    RAISE EXCEPTION 'amendment_forbidden' USING ERRCODE = '42501';
  END IF;

  v_snapshot := private.paid_order_document_inputs(o.id);
  v_next := v_quote->'afterLine';
  v_offer := (v_next->>'offerId')::uuid;
  v_total := (v_quote->>'afterTotalMinor')::numeric / 100;
  v_fulfillment := private.swap_paid_order_amendment_inventory(o.id, o.merchant_id, o.branch_id, v_quote);
  IF v_offer IS NOT NULL THEN
    INSERT INTO private.paid_order_offer_amendment_writes(item_id, order_id, target)
    VALUES ((v_next->>'id')::uuid, o.id, jsonb_build_array((v_next->>'productId')::uuid,
      v_offer, v_offer, v_offer, true, v_next->>'offerGrade', v_next->>'offerConditionNotes', true));
  END IF;
  UPDATE public.order_items SET
    product_id = (v_next->>'productId')::uuid, variant_id = (v_next->>'variantId')::uuid,
    offer_id = CASE WHEN v_offer IS NOT NULL THEN v_offer ELSE offer_id END,
    offer_id_snapshot = CASE WHEN v_offer IS NOT NULL THEN v_offer ELSE offer_id_snapshot END,
    offer_line = CASE WHEN v_offer IS NOT NULL THEN true ELSE offer_line END,
    offer_grade = CASE WHEN v_offer IS NOT NULL THEN v_next->>'offerGrade' ELSE offer_grade END,
    offer_condition_notes = CASE WHEN v_offer IS NOT NULL THEN v_next->>'offerConditionNotes' ELSE offer_condition_notes END,
    offer_labels_snapshotted = CASE WHEN v_offer IS NOT NULL THEN true ELSE offer_labels_snapshotted END,
    product_offer_id = v_offer, name = v_next->>'name', condition = v_next->>'condition',
    variant_name = v_next->>'variantName', item_description = NULL, sellers_item_id = NULL,
    image_url = (
      SELECT COALESCE(NULLIF(btrim(v.primary_image), ''),
        public.extract_primary_image_from_jsonb(v.images),
        public.extract_primary_image_from_jsonb(offer.images),
        public.extract_primary_image_from_jsonb(replacement_product.images))
      FROM public.products replacement_product
      LEFT JOIN public.product_variants v ON v.id = (v_next->>'variantId')::uuid
        AND v.product_id = replacement_product.id AND v.merchant_id = replacement_product.merchant_id
      LEFT JOIN public.product_offers offer ON offer.id = (v_next->>'offerId')::uuid
        AND offer.product_id = replacement_product.id AND offer.merchant_id = replacement_product.merchant_id
      WHERE replacement_product.id = (v_next->>'productId')::uuid AND replacement_product.merchant_id = o.merchant_id
    ),
    price = (v_next->>'unitPriceMinor')::numeric / 100,
    line_extension_amount = (v_next->>'unitPriceMinor')::numeric * quantity / 100,
    fulfillment_data = v_fulfillment
    WHERE id = (v_next->>'id')::uuid AND order_id = o.id;
  IF EXISTS (SELECT 1 FROM private.paid_order_offer_amendment_writes WHERE item_id = (v_next->>'id')::uuid)
  THEN RAISE EXCEPTION 'preview_stale'; END IF;
  -- The inventory audit validates the variant against the current order line.
  -- Record the release against the old line and the new hold after the swap.
  IF v_quote->>'pool' = 'serialized_variant' THEN
    PERFORM private.record_variant_inventory_event(
      vi.id, o.merchant_id, (v_next->>'productId')::uuid, vi.variant_id, 'hold_confirmed',
      'available', 'reserved', o.id, vi.order_item_id, vi.branch_id, auth.uid()
    )
    FROM public.variant_inventory vi
    WHERE vi.order_id = o.id AND vi.order_item_id = (v_next->>'id')::uuid
    ORDER BY vi.id;
  END IF;
  UPDATE public.orders SET
    subtotal = v_total, total = v_total, tax_exclusive_amount = v_total, tax_inclusive_amount = v_total,
    payment_status = CASE WHEN v_delta > 0 THEN 'partially_paid' ELSE 'paid' END,
    fulfillment_details = CASE WHEN (SELECT count(*) FROM public.order_items WHERE order_id = o.id) = 1
      THEN v_fulfillment ELSE NULL END, updated_at = clock_timestamp()
    WHERE id = o.id;
  IF (SELECT total FROM public.orders WHERE id = o.id) IS DISTINCT FROM v_total THEN
    RAISE EXCEPTION 'preview_stale';
  END IF;

  INSERT INTO private.paid_order_amendments(
    merchant_id, order_id, actor_id, idempotency_key, request_payload, config_version,
    settlement_route, state, hold_fulfillment, balance_due_minor, refund_owed_minor
  ) VALUES (o.merchant_id, o.id, auth.uid(), v_key, p_payload, v_config_version,
    CASE WHEN v_verified THEN 'verified_funds' ELSE 'paystack_integration_wallet' END,
    CASE WHEN v_delta = 0 THEN 'settled'
      WHEN v_delta > 0 THEN 'awaiting_payment' ELSE 'awaiting_refund' END,
    v_delta <> 0, greatest(v_delta, 0), greatest(-v_delta, 0)
  ) RETURNING id INTO v_id;
  INSERT INTO private.paid_order_amendment_revisions(
    amendment_id, revision, original_document_inputs, revised_order_inputs
  ) VALUES (v_id, 1, v_snapshot, private.paid_order_document_inputs(o.id));
  INSERT INTO private.paid_order_amendment_events(amendment_id, actor_id, event_type, details)
    VALUES (v_id, auth.uid(), 'confirmed', v_quote || jsonb_build_object(
      'reason', v_reason, 'supportReference', p_payload->>'supportReference', 'customerAgreed', true
    ));
  IF v_bank_evidence IS NOT NULL THEN
    SELECT * INTO STRICT v_amendment FROM private.paid_order_amendments WHERE id = v_id;
    PERFORM private.apply_paid_order_top_up(v_amendment,v_bank_evidence);
    IF (SELECT state FROM private.paid_order_amendments WHERE id = v_id) <> 'settled' THEN
      RAISE EXCEPTION 'bank_evidence_conflict';
    END IF;
  END IF;
  RETURN private.paid_order_amendment_summary(o.id);
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
  -- The document shows customer net paid. The compatibility ledger retains gross.
  snapshot_inputs := jsonb_set(snapshot_inputs,'{order,amount_paid}',to_jsonb((snapshot_inputs#>>'{order,amount_paid}')::numeric - net_refunded));
  INSERT INTO private.paid_order_amendment_documents(amendment_id,event_id,revision_id,document_number,inputs)
  SELECT a.id,NEW.id,active_revision,COALESCE(max(d.document_number),0)+1,snapshot_inputs
  FROM private.paid_order_amendment_documents d WHERE d.amendment_id = a.id RETURNING id INTO document;
  INSERT INTO private.paid_order_amendment_updates(event_id,document_id) VALUES (NEW.id,document);
  RETURN NEW;
END;
$$;

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
  PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || p_order_id,0));
  PERFORM 1 FROM public.orders WHERE id = p_order_id AND merchant_id = a.merchant_id FOR UPDATE;
  SELECT * INTO a FROM private.paid_order_amendments WHERE id = p_amendment_id;
  IF a.settlement_route = 'verified_funds' THEN
    RAISE EXCEPTION 'verified_funding_refund_review_required';
  END IF;
  IF NOT private.can_access_paid_order_amendment(a.merchant_id,'edit')
    OR (action IN ('claim_offline_disbursement','record_offline_refund','retry_merchant_adjustment',
          'refresh_refund_status','retry_failed_refund','reverse','cancel_for_recovery')
      AND NOT private.can_access_paid_order_amendment(a.merchant_id,'refund')) THEN
    RAISE EXCEPTION 'amendment_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO prior FROM private.paid_order_amendment_operations
    WHERE amendment_id = a.id AND idempotency_key = key;
  IF FOUND THEN
    IF prior.request IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
    RETURN prior.result;
  END IF;
  CASE action
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

CREATE FUNCTION private.guard_verified_funding_amendment_transactions()
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
  IF TG_OP = 'UPDATE' AND
    (to_jsonb(NEW) - 'updated_at') = (to_jsonb(OLD) - 'updated_at') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'verified_funding_refund_review_required';
END;
$$;
REVOKE ALL ON FUNCTION private.guard_verified_funding_amendment_transactions()
FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER paid_order_verified_funding_transactions
BEFORE INSERT OR UPDATE OR DELETE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION private.guard_verified_funding_amendment_transactions();
