-- Keep staff and reconciled tender paths on one auditable POS reference contract.
CREATE OR REPLACE FUNCTION public.register_paid_order_tender_receipt(
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
    OR COALESCE(p_receipt_reference,'') !~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{7,99}$'
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
  v_staff_top_up jsonb := p_payload->'staffTopUp';
  v_payment_method text := v_staff_top_up->>'method';
  v_receipt_reference text := trim(v_staff_top_up->>'receiptReference');
  v_receipt_key text;
  v_amendment private.paid_order_amendments%ROWTYPE;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
    OR p_payload->'customerAgreed' IS DISTINCT FROM 'true'::jsonb
    OR v_key IS NULL OR length(v_key) NOT BETWEEN 8 AND 128
    OR v_reason IS NULL OR length(v_reason) NOT BETWEEN 1 AND 500
    OR length(COALESCE(p_payload->>'supportReference', '')) > 200
    OR (p_payload ? 'bankEvidenceId' AND jsonb_typeof(p_payload->'bankEvidenceId') <> 'string')
    OR (p_payload - ARRAY['customerAgreed','idempotencyKey','reason','supportReference','previewId','bankEvidenceId','staffTopUp']) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid_amendment_confirmation' USING ERRCODE = '22023';
  END IF;

  IF v_staff_top_up IS NOT NULL THEN
    IF p_payload ? 'bankEvidenceId' OR jsonb_typeof(v_staff_top_up) <> 'object' THEN
      RAISE EXCEPTION 'invalid_amendment_confirmation' USING ERRCODE = '22023';
    END IF;
    IF NOT COALESCE(
      (v_staff_top_up = '{"method":"cash"}'::jsonb)
      OR (v_payment_method = 'pos'
        AND (v_staff_top_up - ARRAY['method','receiptReference']) = '{}'::jsonb
        AND jsonb_typeof(v_staff_top_up->'receiptReference') = 'string'
        AND v_receipt_reference ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{7,99}$'), false) THEN
      RAISE EXCEPTION 'invalid_amendment_confirmation' USING ERRCODE = '22023';
    END IF;
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
  IF v_staff_top_up IS NOT NULL THEN
    IF v_quote->'canRecordStaffTopUp' IS DISTINCT FROM 'true'::jsonb THEN
      RAISE EXCEPTION 'scenario_disabled';
    END IF;

    -- This is a staff attestation against this preview. Reuse the atomic
    -- allocator and the POS receipt namespace shared by imported records.
    v_receipt_key := CASE WHEN v_payment_method = 'pos'
      THEN 'tender:pos:' || upper(v_receipt_reference)
      ELSE 'staff:cash:' || p.id::text END;
    IF v_payment_method = 'pos' AND EXISTS (
      SELECT 1 FROM private.paid_order_bank_evidence
      WHERE merchant_id = o.merchant_id AND bank_transaction_id = v_receipt_key
    ) THEN RAISE EXCEPTION 'staff_pos_receipt_used'; END IF;
    INSERT INTO private.paid_order_bank_evidence(
      merchant_id,account_id,bank_transaction_id,direction,amount_minor,currency,
      occurred_at,statement_entry,bound_order_id,collection_method
    )
    SELECT o.merchant_id,c.bank_account_id,v_receipt_key,'incoming',v_delta,'NGN',
      clock_timestamp(),'Admin payment recorded by ' || auth.uid()::text,o.id,v_payment_method
    FROM private.paid_order_amendment_config c WHERE c.merchant_id = o.merchant_id
    ON CONFLICT (account_id,bank_transaction_id) DO NOTHING
    RETURNING id INTO v_bank_evidence;
    IF v_bank_evidence IS NULL THEN RAISE EXCEPTION 'staff_pos_receipt_used'; END IF;
  ELSIF v_verified AND v_delta > 0 THEN
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
    ) || CASE WHEN v_staff_top_up IS NULL THEN '{}'::jsonb
      ELSE jsonb_build_object('staffTopUp',jsonb_strip_nulls(jsonb_build_object(
        'method',v_payment_method,'receiptReference',upper(v_receipt_reference)
      ))) END);
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
