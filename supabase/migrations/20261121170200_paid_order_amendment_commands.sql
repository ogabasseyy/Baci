CREATE FUNCTION private.swap_paid_order_amendment_inventory(
  p_order_id uuid, p_merchant uuid, p_branch uuid, p_quote jsonb
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_old jsonb := p_quote->'beforeLine';
  v_new jsonb := p_quote->'afterLine';
  v_item uuid := (v_old->>'id')::uuid;
  v_from uuid := (v_old->>'productId')::uuid;
  v_to uuid := (v_new->>'productId')::uuid;
  v_qty integer := (v_old->>'quantity')::integer;
  v_old_variant uuid := (v_old->>'variantId')::uuid;
  v_new_variant uuid := (v_new->>'variantId')::uuid;
  v_unit public.variant_inventory%ROWTYPE;
  v_units jsonb := '[]'::jsonb;
  v_released integer := 0;
BEGIN
  CASE p_quote->>'pool'
    WHEN 'serialized_variant' THEN
      FOR v_unit IN SELECT * FROM public.variant_inventory
        WHERE merchant_id = p_merchant AND order_id = p_order_id AND order_item_id = v_item
          AND variant_id = v_old_variant AND status = 'reserved' AND reservation_expires_at IS NULL
          AND sold_at IS NULL AND branch_id IS NOT DISTINCT FROM p_branch
        ORDER BY id FOR UPDATE
      LOOP
        PERFORM private.record_variant_inventory_event(
          v_unit.id, p_merchant, v_from, v_old_variant, 'reservation_released',
          'reserved', 'available', p_order_id, v_item, v_unit.branch_id, auth.uid()
        );
        UPDATE public.variant_inventory SET status = 'available', order_id = NULL, order_item_id = NULL,
          reserved_at = NULL, reservation_expires_at = NULL, updated_at = now() WHERE id = v_unit.id;
        v_released := v_released + 1;
      END LOOP;
      IF v_released <> v_qty THEN RAISE EXCEPTION 'amendment_ineligible'; END IF;
      FOR v_unit IN SELECT * FROM public.variant_inventory
        WHERE merchant_id = p_merchant AND variant_id = v_new_variant AND status = 'available'
          AND order_id IS NULL AND order_item_id IS NULL AND sold_at IS NULL
          AND branch_id IS NOT DISTINCT FROM p_branch
        ORDER BY id LIMIT v_qty FOR UPDATE SKIP LOCKED
      LOOP
        UPDATE public.variant_inventory SET status = 'reserved', order_id = p_order_id, order_item_id = v_item,
          reserved_at = now(), first_reserved_at = COALESCE(first_reserved_at, now()),
          reservation_expires_at = NULL, updated_at = now() WHERE id = v_unit.id;
        v_units := v_units || jsonb_build_array(jsonb_build_object(
          'inventoryUnitId', v_unit.id, 'identifierType', v_unit.identifier_type,
          'identifierValue', v_unit.identifier_value
        ));
      END LOOP;
      IF jsonb_array_length(v_units) <> v_qty THEN RAISE EXCEPTION 'replacement_unavailable'; END IF;
      PERFORM private.sync_serialized_stock(p_merchant, p.id)
      FROM public.products p WHERE p.id IN (v_from, v_to) ORDER BY p.id;
      RETURN jsonb_build_object(
        'source', 'merchant_stock', 'reservationExpiresAt', NULL,
        'inventoryUnits', v_units, 'missingUnitCount', 0
      );
    WHEN 'condition_offer' THEN
      UPDATE public.product_offers SET stock_quantity = stock_quantity - v_qty
        WHERE id = (v_new->>'offerId')::uuid AND merchant_id = p_merchant AND stock_quantity >= v_qty;
      IF NOT FOUND THEN RAISE EXCEPTION 'replacement_unavailable'; END IF;
      UPDATE public.product_offers SET stock_quantity = stock_quantity + v_qty
        WHERE id = (v_old->>'offerId')::uuid AND merchant_id = p_merchant;
      IF NOT FOUND THEN RAISE EXCEPTION 'amendment_ineligible'; END IF;
    WHEN 'product_scalar' THEN
      UPDATE public.products SET stock_quantity = stock_quantity - v_qty
        WHERE id = v_to AND merchant_id = p_merchant AND stock_quantity >= v_qty;
      IF NOT FOUND THEN RAISE EXCEPTION 'replacement_unavailable'; END IF;
      UPDATE public.products SET stock_quantity = COALESCE(stock_quantity, 0) + v_qty
        WHERE id = v_from AND merchant_id = p_merchant;
      IF NOT FOUND THEN RAISE EXCEPTION 'amendment_ineligible'; END IF;
    ELSE RAISE EXCEPTION 'amendment_ineligible';
  END CASE;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.swap_paid_order_amendment_inventory(uuid,uuid,uuid,jsonb)
FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.paid_order_document_inputs(p_order_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'order', jsonb_build_object('id', o.id, 'orderNumber', o.order_number, 'currency', o.currency,
      'total', o.total, 'subtotal', o.subtotal, 'amountPaid', o.amount_paid, 'paymentStatus', o.payment_status,
      'createdAt', o.created_at, 'transactionDate', o.transaction_date, 'taxBasis', o.tax_basis,
      'invoiceIssueDate', o.invoice_issue_date, 'taxPointDate', o.tax_point_date, 'invoiceTypeCode', o.invoice_type_code,
      'customerName', o.customer_name, 'customerEmail', o.customer_email, 'shippingAddress', o.shipping_address,
      'taxAmount', o.tax_amount, 'shippingFee', o.shipping_fee, 'discountAmount', o.discount_amount),
    'items', COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id)
      FROM public.order_items i WHERE i.order_id = o.id), '[]'::jsonb)
  ) FROM public.orders o WHERE o.id = p_order_id;
$$;
REVOKE ALL ON FUNCTION private.paid_order_document_inputs(uuid)
FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.preview_paid_order_amendment(p_order_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_quote jsonb;
  v_id uuid;
  v_expires timestamptz := clock_timestamp() + interval '10 minutes';
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_amendment_selection' USING ERRCODE = '22023';
  END IF;
  v_quote := private.quote_paid_order_amendment(p_order_id, p_payload, false);
  IF EXISTS (SELECT 1 FROM private.paid_order_amendments WHERE order_id = p_order_id) THEN
    RAISE EXCEPTION 'already_amended';
  END IF;
  INSERT INTO private.paid_order_amendment_previews(order_id, actor_id, selection, quote, expires_at)
    VALUES (p_order_id, auth.uid(), p_payload, v_quote, v_expires)
    RETURNING id INTO v_id;
  RETURN (v_quote - 'captureId') || jsonb_build_object('previewId', v_id, 'expiresAt', v_expires);
END;
$$;

CREATE FUNCTION public.confirm_paid_order_amendment(p_order_id uuid, p_payload jsonb)
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
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002'; END IF;
  IF NOT private.can_access_paid_order_amendment(o.merchant_id, 'edit') THEN
    RAISE EXCEPTION 'amendment_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT version, enabled INTO v_config_version, v_config_enabled
    FROM private.paid_order_amendment_config WHERE merchant_id = o.merchant_id FOR SHARE;
  PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || p_order_id::text, 0));
  SELECT * INTO o FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002'; END IF;
  IF NOT private.can_access_paid_order_amendment(o.merchant_id, 'edit') THEN
    RAISE EXCEPTION 'amendment_forbidden' USING ERRCODE = '42501';
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

  v_quote := private.quote_paid_order_amendment(p_order_id, p.selection, true);
  IF v_quote IS DISTINCT FROM p.quote THEN RAISE EXCEPTION 'preview_stale'; END IF;
  v_delta := (v_quote->>'adjustmentMinor')::bigint;
  IF v_delta < 0 AND NOT private.can_access_paid_order_amendment(o.merchant_id, 'refund') THEN
    RAISE EXCEPTION 'amendment_forbidden' USING ERRCODE = '42501';
  END IF;

  v_snapshot := private.paid_order_document_inputs(o.id);
  v_next := v_quote->'afterLine';
  v_total := (v_quote->>'afterTotalMinor')::numeric / 100;
  v_fulfillment := private.swap_paid_order_amendment_inventory(o.id, o.merchant_id, o.branch_id, v_quote);
  UPDATE public.order_items SET
    product_id = (v_next->>'productId')::uuid, variant_id = (v_next->>'variantId')::uuid,
    product_offer_id = (v_next->>'offerId')::uuid, name = v_next->>'name', condition = v_next->>'condition',
    variant_name = NULL, item_description = NULL, sellers_item_id = NULL,
    price = (v_next->>'unitPriceMinor')::numeric / 100,
    line_extension_amount = (v_next->>'unitPriceMinor')::numeric * quantity / 100,
    fulfillment_data = v_fulfillment
    WHERE id = (v_next->>'id')::uuid AND order_id = o.id;
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

REVOKE ALL ON FUNCTION public.preview_paid_order_amendment(uuid,jsonb),
  public.confirm_paid_order_amendment(uuid,jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.preview_paid_order_amendment(uuid,jsonb),
  public.confirm_paid_order_amendment(uuid,jsonb) TO authenticated;
