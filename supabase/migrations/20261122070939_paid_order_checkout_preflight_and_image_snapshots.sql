-- Reject unavailable checkout collection before creating a claim.
DROP FUNCTION IF EXISTS public.claim_checkout_for_paid_order_amendment(uuid,text,text,text,text,bigint);
CREATE OR REPLACE FUNCTION public.claim_checkout_for_paid_order_amendment(
  p_order_id uuid, p_tracking_token text, p_gateway text, p_reference text,
  p_currency text, p_expected_amount_minor bigint,
  p_platform_fee_minor bigint DEFAULT NULL, p_retained_shipping_minor bigint DEFAULT NULL
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  o public.orders%ROWTYPE;
  v_merchant uuid;
  v_integration bigint;
  v_wallet_checkout boolean;
BEGIN
  SELECT merchant_id INTO v_merchant FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN 'untracked'; END IF;
  -- Coordinate the cutover with configuration updates. Disabled configurations
  -- still track instruments so re-enabling cannot skip a checkout in flight.
  SELECT paystack_integration_id,integration_wallet_checkout INTO v_integration,v_wallet_checkout
  FROM private.paid_order_amendment_config WHERE merchant_id = v_merchant FOR SHARE;
  IF NOT FOUND THEN RETURN 'untracked'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || p_order_id::text, 0));
  SELECT * INTO o FROM public.orders WHERE id = p_order_id AND merchant_id = v_merchant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002'; END IF;
  IF p_tracking_token IS NULL OR NOT COALESCE(public.verify_order_tracking_token(p_order_id, p_tracking_token), false) THEN
    RAISE EXCEPTION 'checkout_proof_required' USING ERRCODE = '42501';
  END IF;
  IF o.payment_status NOT IN ('unpaid', 'pending')
     OR o.shipping_status NOT IN ('pending', 'processing')
     OR o.cancelled_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM private.paid_order_amendments WHERE order_id = o.id) THEN
    RAISE EXCEPTION 'amendment_payment_open';
  END IF;
  -- The no-subaccount route can only claim an integration-wallet capture.
  IF p_gateway = 'paystack_no_subaccount' AND NOT v_wallet_checkout THEN
    RAISE EXCEPTION 'checkout_gateway_not_configured';
  END IF;
  IF v_integration IS NULL OR COALESCE(p_gateway,'') NOT IN ('paystack','paystack_no_subaccount')
     OR p_currency IS DISTINCT FROM 'NGN'
     OR p_expected_amount_minor IS NULL OR p_expected_amount_minor <> round(o.total * 100)::bigint
     OR p_expected_amount_minor <= 0 OR p_reference IS NULL OR p_reference !~ '^BAC-[A-Z0-9]{12}$'
     OR COALESCE(o.wallet_amount_used, 0) <> 0 THEN
    RAISE EXCEPTION 'amendment_ineligible';
  END IF;
  -- Bind preflight to the retained shipping economics under the order lock.
  IF p_platform_fee_minor IS NOT NULL OR p_retained_shipping_minor IS NOT NULL THEN
    IF p_platform_fee_minor IS NULL OR p_platform_fee_minor NOT BETWEEN 0 AND p_expected_amount_minor
      OR p_retained_shipping_minor IS DISTINCT FROM least(
        round(private.gigl_order_remaining_retained_shipping(o.id, o.merchant_id) * 100)::bigint,
        p_expected_amount_minor - p_platform_fee_minor)
    THEN RAISE EXCEPTION 'checkout_payment_details_changed'; END IF;
  END IF;
  INSERT INTO private.paid_order_checkout_claims(
    order_id, reference, gateway, currency, expected_amount_minor, order_version
  ) VALUES (o.id, p_reference, 'paystack', p_currency, p_expected_amount_minor, md5(to_jsonb(o)::text))
  ON CONFLICT (order_id) DO NOTHING;
  IF NOT FOUND THEN RAISE EXCEPTION 'amendment_payment_open'; END IF;
  INSERT INTO private.paid_order_checkout_capture_bindings(
    reference, order_id, expected_amount_minor, currency, provider_integration_id, order_fingerprint,integration_wallet_checkout
  ) VALUES (p_reference, o.id, p_expected_amount_minor, p_currency, v_integration,
    private.paid_order_checkout_fingerprint(o),v_wallet_checkout);
  RETURN CASE WHEN v_wallet_checkout THEN 'claimed_integration' ELSE 'claimed' END;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_checkout_for_paid_order_amendment(uuid,text,text,text,text,bigint,bigint,bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_checkout_for_paid_order_amendment(uuid,text,text,text,text,bigint,bigint,bigint)
  TO anon, authenticated;

-- Retain immutable image evidence with the replacement and its reversal.
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

  v_quote := private.add_paid_order_amendment_quote_options(
    private.quote_paid_order_amendment(p_order_id, p.selection, true),p_order_id);
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
  UPDATE public.order_items SET product_id = old_line.product_id, variant_id = old_line.variant_id,
    product_offer_id = old_line.product_offer_id, name = old_line.name, condition = old_line.condition,
    price = old_line.price, variant_name = old_line.variant_name, item_description = old_line.item_description,
    sellers_item_id = old_line.sellers_item_id, image_url = old_line.image_url, line_extension_amount = old_line.line_extension_amount,
    fulfillment_data = fulfillment WHERE id = old_line.id AND order_id = a.order_id;
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
