-- Require the settled GIG service and a bound wallet quote before dispatch.
CREATE OR REPLACE FUNCTION private.guard_partner_shipping_quote_binding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_delivery_minor numeric;
  v_service text;
  v_quote record;
BEGIN
  SELECT (q.snapshot->>'delivery_minor')::numeric, q.snapshot->>'service'
  INTO v_delivery_minor, v_service
  FROM private.accepted_partner_orders AS a
  JOIN private.partner_order_submissions AS s ON s.id = a.submission_id
  JOIN private.partner_delivery_quotes AS q ON q.id = s.quote_id
    AND q.merchant_id = s.merchant_id AND q.connection_id = s.connection_id
  WHERE a.order_id = NEW.id AND s.merchant_id = NEW.merchant_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NEW.shipping_funding_source = 'customer_checkout'
     OR COALESCE(NEW.shipping_platform_retained_amount, 0) <> 0 THEN
    RAISE EXCEPTION 'partner_shipping_requires_merchant_wallet' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.selected_quote_id IS NULL THEN
    IF NEW.shipment_id IS NOT NULL OR NEW.tracking_number IS NOT NULL
       OR NEW.shipping_status IN (
         'shipped', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'completed'
       ) THEN
      RAISE EXCEPTION 'partner_shipping_requires_merchant_wallet' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.shipping_funding_source IS DISTINCT FROM 'merchant_wallet'
     OR NEW.shipping_provider IS DISTINCT FROM 'GIGL' THEN
    RAISE EXCEPTION 'partner_shipping_requires_merchant_wallet' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.selected_quote_id IS NOT DISTINCT FROM OLD.selected_quote_id THEN
    RETURN NEW;
  END IF;

  SELECT sq.provider, sq.currency, sq.session_id, sq.expires_at, sq.used,
    sq.is_station_pickup, sq.price, sq.quote_request, sq.service_tier
  INTO v_quote
  FROM public.shipping_quotes AS sq
  JOIN public.shipping_quote_attestations AS a ON a.quote_id = sq.id
    AND a.merchant_id = sq.merchant_id AND a.order_id = NEW.id
    AND a.price = sq.price AND a.currency = sq.currency
    AND a.provider_rate_id IS NOT DISTINCT FROM sq.provider_rate_id
    AND a.quote_request IS NOT DISTINCT FROM sq.quote_request
    AND a.expires_at = sq.expires_at
  WHERE sq.id = NEW.selected_quote_id AND sq.merchant_id = NEW.merchant_id;
  IF NOT FOUND
     OR v_quote.provider IS DISTINCT FROM 'GIGL'
     OR v_quote.currency IS DISTINCT FROM 'NGN'
     OR v_quote.session_id IS DISTINCT FROM NEW.id::text
     OR v_quote.expires_at <= clock_timestamp()
     OR v_quote.used IS TRUE OR v_quote.is_station_pickup IS TRUE
     OR v_quote.quote_request->>'shipmentType' IS DISTINCT FROM 'domestic'
     OR v_quote.quote_request->>'admin_order_provenance' IS DISTINCT FROM 'server_gigl_v1' THEN
    RAISE EXCEPTION 'partner_shipping_quote_invalid' USING ERRCODE = 'P0001';
  END IF;

  IF v_delivery_minor IS NULL OR v_delivery_minor <= 0
     OR v_quote.price <= 0 OR round(v_quote.price * 100) <> v_delivery_minor THEN
    RAISE EXCEPTION 'partner_delivery_price_changed' USING ERRCODE = 'P0001';
  END IF;

  IF v_service IS NULL OR v_quote.service_tier IS DISTINCT FROM v_service THEN
    RAISE EXCEPTION 'partner_delivery_service_changed' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER guard_partner_shipping_quote_binding ON public.orders;
CREATE TRIGGER guard_partner_shipping_quote_binding
  AFTER UPDATE OF selected_quote_id, shipping_funding_source, shipping_provider,
    shipping_platform_retained_amount, payment_method, payment_status,
    shipping_status, shipment_id, tracking_number
  ON public.orders
  FOR EACH ROW
  WHEN (
    OLD.selected_quote_id IS DISTINCT FROM NEW.selected_quote_id
    OR OLD.shipping_funding_source IS DISTINCT FROM NEW.shipping_funding_source
    OR OLD.shipping_provider IS DISTINCT FROM NEW.shipping_provider
    OR OLD.shipping_platform_retained_amount IS DISTINCT FROM NEW.shipping_platform_retained_amount
    OR OLD.shipping_status IS DISTINCT FROM NEW.shipping_status
    OR OLD.shipment_id IS DISTINCT FROM NEW.shipment_id
    OR OLD.tracking_number IS DISTINCT FROM NEW.tracking_number
  )
  EXECUTE FUNCTION private.guard_partner_shipping_quote_binding();

-- Distinguish operational settlement failures while preserving verified capture evidence.
-- An accepted replay still verifies any settlement evidence the verifier supplies.
CREATE OR REPLACE FUNCTION public.reconcile_verified_partner_order(
  p_submission_id uuid,
  p_merchant_id uuid,
  p_connection_id text,
  p_evidence jsonb,
  p_route_proof jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_capture jsonb;
  v_settlement jsonb;
  v_receipt jsonb;
  v_hold_reason text;
BEGIN
  IF p_connection_id IS NULL OR p_connection_id !~ '^[a-z0-9][a-z0-9_-]{0,79}$'
     OR jsonb_typeof(p_evidence) IS DISTINCT FROM 'object'
     OR pg_column_size(p_evidence) > 8192
     OR pg_column_size(p_route_proof) > 16384
     OR private.verify_shipping_quote_route_proof(
       p_route_proof, 'reconcile_verified_partner_order', p_submission_id, p_merchant_id
     ) IS DISTINCT FROM true
     OR (p_route_proof->>'payload_text')::jsonb IS DISTINCT FROM jsonb_build_object(
       'connection_id', p_connection_id, 'evidence', p_evidence
     ) THEN
    RAISE EXCEPTION 'invalid_partner_reconciliation_proof' USING ERRCODE = '42501';
  END IF;

  v_capture := p_evidence->'capture';
  v_settlement := p_evidence->'settlement';
  v_receipt := private.record_verified_partner_capture(
    p_submission_id, p_merchant_id, p_connection_id, (p_evidence->>'quote_id')::uuid,
    p_evidence->>'partner_order_id', v_capture->>'source', v_capture->>'provider_account',
    v_capture->>'reference', (v_capture->>'amount_minor')::bigint,
    v_capture->>'currency', (v_capture->>'captured_at')::timestamptz
  );

  v_hold_reason := v_receipt->>'review_reason';
  IF v_hold_reason = 'ORDER_REVIEW_REQUIRED'
     OR v_settlement IS NULL OR v_settlement = 'null'::jsonb THEN
    RETURN jsonb_build_object('receipt', v_receipt, 'hold_reason', v_hold_reason);
  END IF;

  BEGIN
    v_receipt := private.record_verified_partner_settlement(
      p_submission_id, p_merchant_id, p_connection_id, v_settlement->>'source',
      v_settlement->>'settlement_account', v_settlement->>'payout_reference',
      v_settlement->>'allocation_reference', (v_settlement->>'amount_minor')::bigint,
      v_settlement->>'currency', (v_settlement->>'settled_at')::timestamptz
    );
    IF v_receipt->>'status' = 'accepted' THEN
      RETURN jsonb_build_object('receipt', v_receipt, 'hold_reason', NULL);
    END IF;
    -- A corrected, independently verified allocation can resolve a settlement hold.
    DELETE FROM private.partner_order_review_holds
    WHERE submission_id = p_submission_id AND reason = 'SETTLEMENT_REVIEW_REQUIRED';
    v_hold_reason := NULL;
  EXCEPTION WHEN invalid_parameter_value OR unique_violation THEN
    IF SQLERRM IN ('partner_settlement_terms_unavailable', 'partner_capture_not_verified') THEN
      RAISE LOG 'partner_settlement_operational_error reason=%', SQLERRM;
    END IF;
    IF v_receipt->>'status' = 'accepted' THEN
      RAISE EXCEPTION 'partner_accepted_settlement_evidence_conflict' USING ERRCODE = '23505';
    END IF;
    v_hold_reason := 'SETTLEMENT_REVIEW_REQUIRED';
  END;

  IF v_hold_reason IS NULL THEN
    BEGIN
      v_receipt := private.accept_settled_partner_order(p_submission_id, p_merchant_id, p_connection_id);
    EXCEPTION WHEN invalid_parameter_value OR raise_exception THEN
      -- Roll back the order and stock mutation while preserving paid evidence.
      IF SQLSTATE = 'P0001' AND SQLERRM NOT IN (
        'insufficient_stock', 'insufficient_variant_stock', 'insufficient_condition_offer_stock',
        'invalid_condition_offer', 'invalid_variant', 'product_not_found',
        'condition_offer_price_changed', 'order_total_mismatch', 'tax_amount_mismatch',
        'invalid_items', 'invalid_offer', 'tax_amount_must_be_zero_for_non_vat_merchant'
      ) THEN
        RAISE;
      END IF;
      v_hold_reason := 'ORDER_REVIEW_REQUIRED';
    END;
  END IF;

  IF v_hold_reason IS NOT NULL THEN
    INSERT INTO private.partner_order_review_holds (submission_id, reason)
    VALUES (p_submission_id, v_hold_reason)
    ON CONFLICT (submission_id) DO UPDATE SET reason = EXCLUDED.reason;
    SELECT private.partner_order_receipt(s) INTO STRICT v_receipt
    FROM private.partner_order_submissions AS s WHERE s.id = p_submission_id;
  END IF;

  RETURN jsonb_build_object('receipt', v_receipt, 'hold_reason', v_hold_reason);
END;
$$;
