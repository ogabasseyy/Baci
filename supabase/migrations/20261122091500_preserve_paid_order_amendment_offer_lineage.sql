-- Permit a validated offer replacement or reversal to update the live
-- inventory identity and labels. The original line stays in revision history.
CREATE TABLE private.paid_order_offer_amendment_writes (
  item_id uuid PRIMARY KEY,
  order_id uuid NOT NULL,
  target jsonb NOT NULL
);
ALTER TABLE private.paid_order_offer_amendment_writes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.paid_order_offer_amendment_writes FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.guard_order_items_offer_id_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_offer_product_id uuid;
  v_offer_merchant_id uuid;
  v_order_merchant_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Derive, never trust: any caller-supplied snapshot or
    -- discriminator is overwritten from the live offer identity.
    -- Either identity marks an offer line: condition-only lines have
    -- no exact id but still decremented the resolved offer's
    -- allocation at creation.
    NEW.offer_id_snapshot := NEW.offer_id;
    NEW.offer_line := NEW.offer_id IS NOT NULL OR NEW.product_offer_id IS NOT NULL;
    IF NEW.offer_id IS NOT NULL THEN
      -- The FK proves the offer exists but says nothing about whose
      -- it is: bind it to this line's product and this order's
      -- merchant before the row can reference a foreign offer.
      SELECT po.product_id, po.merchant_id
        INTO v_offer_product_id, v_offer_merchant_id
        FROM public.product_offers AS po
       WHERE po.id = NEW.offer_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'order_items.offer_id does not exist (order %, item %)',
          NEW.order_id, NEW.id;
      END IF;
      IF v_offer_product_id IS DISTINCT FROM NEW.product_id THEN
        RAISE EXCEPTION 'order_items.offer_id does not belong to the line product (order %, item %)',
          NEW.order_id, NEW.id;
      END IF;
      SELECT o.merchant_id
        INTO v_order_merchant_id
        FROM public.orders AS o
       WHERE o.id = NEW.order_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'order_items.order_id does not exist (order %, item %)',
          NEW.order_id, NEW.id;
      END IF;
      IF v_offer_merchant_id IS DISTINCT FROM v_order_merchant_id THEN
        RAISE EXCEPTION 'order_items.offer_id belongs to another merchant (order %, item %)',
          NEW.order_id, NEW.id;
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  -- A trusted amendment supplies an exact one-use authorization after moving
  -- offer inventory. An ordinary writer cannot create or consume a permit.
  IF OLD.id = NEW.id AND OLD.order_id = NEW.order_id
     AND OLD.product_offer_id IS DISTINCT FROM NEW.product_offer_id
     AND current_user = pg_catalog.pg_get_userbyid(
       (SELECT relowner FROM pg_catalog.pg_class
        WHERE oid = 'private.paid_order_offer_amendment_writes'::regclass)
     ) THEN
    DELETE FROM private.paid_order_offer_amendment_writes
    WHERE item_id = OLD.id AND order_id = OLD.order_id
      AND target = jsonb_build_array(NEW.product_id, NEW.product_offer_id,
        NEW.offer_id, NEW.offer_id_snapshot, NEW.offer_line, NEW.offer_grade,
        NEW.offer_condition_notes, NEW.offer_labels_snapshotted);
    IF FOUND THEN RETURN NEW; END IF;
  END IF;

  -- UPDATE: the snapshot is immutable once stamped. The only exception
  -- is stamping pre-hardening rows whose snapshot is still NULL — and
  -- even then the value must equal the live FK, never an arbitrary
  -- writer-supplied UUID. (FK ON DELETE SET NULL only nulls offer_id,
  -- leaving both guarded fields untouched, so deletes still pass.)
  IF OLD.offer_id_snapshot IS NULL AND NEW.offer_id_snapshot IS NOT NULL THEN
    IF NEW.offer_id_snapshot IS DISTINCT FROM NEW.offer_id THEN
      RAISE EXCEPTION 'order_items.offer_id_snapshot must match offer_id (order %, item %)',
        NEW.order_id, NEW.id;
    END IF;
  ELSIF OLD.offer_id_snapshot IS NOT NULL
     AND NEW.offer_id_snapshot IS DISTINCT FROM OLD.offer_id_snapshot THEN
    RAISE EXCEPTION 'order_items.offer_id_snapshot is immutable (order %, item %)',
      NEW.order_id, NEW.id;
  END IF;
  IF NEW.offer_line IS DISTINCT FROM OLD.offer_line THEN
    RAISE EXCEPTION 'order_items.offer_line is immutable (order %, item %)',
      NEW.order_id, NEW.id;
  END IF;
  -- The live offer id may only ever transition to NULL (catalog
  -- deletion via the FK). Any reassignment to a different offer —
  -- same tenant or cross-tenant — fails closed, so restock can never
  -- credit an offer checkout never decremented.
  IF NEW.offer_id IS DISTINCT FROM OLD.offer_id
     AND NEW.offer_id IS NOT NULL THEN
    RAISE EXCEPTION 'order_items.offer_id reassignment is forbidden (order %, item %)',
      NEW.order_id, NEW.id;
  END IF;
  -- Purchased labels are creation-time snapshots: any post-insert
  -- change, including filling a NULL, fails closed.
  IF NEW.offer_grade IS DISTINCT FROM OLD.offer_grade THEN
    RAISE EXCEPTION 'order_items.offer_grade is immutable (order %, item %)',
      NEW.order_id, NEW.id;
  END IF;
  IF NEW.offer_condition_notes IS DISTINCT FROM OLD.offer_condition_notes THEN
    RAISE EXCEPTION 'order_items.offer_condition_notes is immutable (order %, item %)',
      NEW.order_id, NEW.id;
  END IF;
  -- The snapshot marker is part of the frozen creation-time truth:
  -- flipping it would re-expose mutable live labels on a snapshotted
  -- line. Stamped at INSERT by the order RPCs; no legitimate UPDATE
  -- flow touches it.
  IF NEW.offer_labels_snapshotted IS DISTINCT FROM OLD.offer_labels_snapshotted THEN
    RAISE EXCEPTION 'order_items.offer_labels_snapshotted is immutable (order %, item %)',
      NEW.order_id, NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

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
  IF COALESCE(o.source, '') <> 'online_store' OR COALESCE(o.currency, '') <> 'NGN'
     OR o.payment_status <> 'paid' OR COALESCE(o.payment_method, '') NOT IN ('card', 'paystack')
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
  v_scenario := 'paystack_integration_wallet:' || v_pool || ':' ||
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
  );
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
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
    OR p_payload->'customerAgreed' IS DISTINCT FROM 'true'::jsonb
    OR v_key IS NULL OR length(v_key) NOT BETWEEN 8 AND 128
    OR v_reason IS NULL OR length(v_reason) NOT BETWEEN 1 AND 500
    OR length(COALESCE(p_payload->>'supportReference', '')) > 200
    OR (p_payload - ARRAY['customerAgreed','idempotencyKey','reason','supportReference','previewId']) <> '{}'::jsonb THEN
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
    IF existing.idempotency_key <> v_key THEN RAISE EXCEPTION 'already_amended'; END IF;
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
    'paystack_integration_wallet', CASE WHEN v_delta = 0 THEN 'settled'
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
  RETURN private.paid_order_amendment_summary(o.id);
END;
$$;

CREATE OR REPLACE FUNCTION private.reverse_paid_order_amendment(a private.paid_order_amendments,p_reason text)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  confirmed jsonb;
  document jsonb;
  old_line public.order_items%ROWTYPE;
  v_original_total numeric;
  branch uuid;
  fulfillment jsonb;
  before_revision jsonb;
BEGIN
  SELECT details INTO STRICT confirmed FROM private.paid_order_amendment_events WHERE amendment_id = a.id AND event_type = 'confirmed';
  SELECT original_document_inputs INTO STRICT document FROM private.paid_order_amendment_revisions
  WHERE amendment_id = a.id AND revision = 1;
  SELECT (jsonb_populate_record(NULL::public.order_items, item)).* INTO STRICT old_line
  FROM jsonb_array_elements(document->'items') item WHERE item->>'id' = confirmed#>>'{beforeLine,id}';
  v_original_total := (document#>>'{order,total}')::numeric;
  SELECT branch_id INTO branch FROM public.orders WHERE id = a.order_id;
  PERFORM 1 FROM public.products WHERE merchant_id = a.merchant_id
    AND id IN (old_line.product_id,(confirmed#>>'{afterLine,productId}')::uuid) ORDER BY id FOR UPDATE;
  before_revision := private.paid_order_document_inputs(a.order_id);
  UPDATE private.paid_order_amendments SET state = 'reversed',hold_fulfillment = false,
    refund_owed_minor = 0,balance_due_minor = 0 WHERE id = a.id;
  fulfillment := private.swap_paid_order_amendment_inventory(a.order_id,a.merchant_id,branch,
    confirmed || jsonb_build_object('beforeLine',confirmed->'afterLine','afterLine',confirmed->'beforeLine'));
  IF confirmed->>'pool' = 'condition_offer' THEN
    INSERT INTO private.paid_order_offer_amendment_writes(item_id, order_id, target)
    VALUES (old_line.id, a.order_id, jsonb_build_array(old_line.product_id, old_line.product_offer_id,
      old_line.offer_id, old_line.offer_id_snapshot, old_line.offer_line, old_line.offer_grade,
      old_line.offer_condition_notes, old_line.offer_labels_snapshotted));
  END IF;
  UPDATE public.order_items SET product_id = old_line.product_id, variant_id = old_line.variant_id,
    offer_id = old_line.offer_id, offer_id_snapshot = old_line.offer_id_snapshot,
    offer_line = old_line.offer_line, offer_grade = old_line.offer_grade,
    offer_condition_notes = old_line.offer_condition_notes,
    offer_labels_snapshotted = old_line.offer_labels_snapshotted,
    product_offer_id = old_line.product_offer_id, name = old_line.name, condition = old_line.condition,
    price = old_line.price, variant_name = old_line.variant_name, item_description = old_line.item_description,
    sellers_item_id = old_line.sellers_item_id, image_url = old_line.image_url, line_extension_amount = old_line.line_extension_amount,
    fulfillment_data = fulfillment WHERE id = old_line.id AND order_id = a.order_id;
  IF EXISTS (SELECT 1 FROM private.paid_order_offer_amendment_writes WHERE item_id = old_line.id)
  THEN RAISE EXCEPTION 'preview_stale'; END IF;
  IF confirmed->>'pool' = 'serialized_variant' THEN
    PERFORM private.record_variant_inventory_event(vi.id,a.merchant_id,old_line.product_id,vi.variant_id,
      'hold_confirmed','available','reserved',a.order_id,old_line.id,vi.branch_id,auth.uid())
    FROM public.variant_inventory vi WHERE vi.order_id = a.order_id AND vi.order_item_id = old_line.id ORDER BY vi.id;
  END IF;
  UPDATE public.orders SET total = v_original_total, subtotal = v_original_total, tax_exclusive_amount = v_original_total,
    tax_inclusive_amount = v_original_total, payment_status = 'paid',
    fulfillment_details = CASE WHEN (SELECT count(*) FROM public.order_items WHERE order_id = a.order_id) = 1
      THEN fulfillment ELSE NULL END
  WHERE id = a.order_id;
  IF (SELECT o.total FROM public.orders o WHERE o.id = a.order_id) IS DISTINCT FROM v_original_total THEN
    RAISE EXCEPTION 'preview_stale';
  END IF;
  INSERT INTO private.paid_order_amendment_revisions(amendment_id,revision,original_document_inputs,revised_order_inputs)
  VALUES (a.id,2,before_revision,private.paid_order_document_inputs(a.order_id));
  INSERT INTO private.paid_order_amendment_events(amendment_id,actor_id,event_type,details)
  VALUES (a.id,auth.uid(),'reversed',jsonb_build_object('reason',p_reason));
END;
$$;

CREATE OR REPLACE FUNCTION public.search_paid_order_amendment_replacements(p_order_id uuid,p_line_id uuid,p_search text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  merchant uuid;
  line public.order_items%ROWTYPE;
  search text := lower(btrim(p_search));
BEGIN
  SELECT o.merchant_id INTO merchant FROM public.orders o WHERE o.id = p_order_id;
  IF NOT FOUND OR NOT private.can_access_paid_order_amendment(merchant,'edit') THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF search IS NULL OR length(search) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'invalid_amendment_selection' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO line FROM public.order_items WHERE id = p_line_id AND order_id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002'; END IF;
  IF line.product_offer_id IS NULL
    AND (line.offer_line IS TRUE OR line.offer_id IS NOT NULL OR line.offer_id_snapshot IS NOT NULL)
  THEN RETURN '[]'::jsonb; END IF;
  RETURN (
    WITH matching AS (
      SELECT p.* FROM public.products p WHERE p.merchant_id = merchant AND p.status = 'active'
        AND p.taxable = false AND (strpos(lower(p.name),search)>0 OR strpos(lower(COALESCE(p.sku,'')),search)>0)
      ORDER BY p.name,p.id LIMIT 30
    ), candidates AS (
      SELECT p.id,'product' kind,p.name label FROM matching p
      WHERE line.variant_id IS NULL AND line.product_offer_id IS NULL AND p.id <> line.product_id
        AND p.manage_stock AND NOT p.has_variants AND p.stock_quantity >= line.quantity
      UNION ALL
      SELECT v.id,'variant',p.name || COALESCE(' · ' || (
        SELECT string_agg(value,' / ' ORDER BY key) FROM jsonb_each_text(
          CASE WHEN jsonb_typeof(v.attributes) = 'object' THEN v.attributes ELSE '{}'::jsonb END)
      ),'') FROM matching p JOIN public.product_variants v ON v.product_id = p.id AND v.merchant_id = merchant
      WHERE line.variant_id IS NOT NULL AND line.product_offer_id IS NULL AND v.id <> line.variant_id
        AND NOT v.is_inventory_anchor
      UNION ALL
      SELECT v.id,'condition_offer',p.name || ' · ' || v.condition
      FROM matching p JOIN public.product_offers v ON v.product_id = p.id AND v.merchant_id = merchant
      WHERE line.product_offer_id IS NOT NULL AND v.id <> line.product_offer_id
        AND v.status = 'active' AND v.stock_quantity >= line.quantity
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(candidate) ORDER BY label,id),'[]'::jsonb)
    FROM (SELECT * FROM candidates ORDER BY label,id LIMIT 30) candidate
  );
END;
$$;
