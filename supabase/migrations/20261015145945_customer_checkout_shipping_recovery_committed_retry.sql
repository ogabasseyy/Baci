-- Acknowledge an already committed, actor-bound recovery before testing
-- whether the order is still eligible for a new recovery. Preserve ownership,
-- selected-quote linkage, serialization and every first-confirmation guard.
-- CREATE OR REPLACE preserves the restricted authenticated EXECUTE grant.
CREATE OR REPLACE FUNCTION public.confirm_customer_checkout_shipping_recovery(
  p_order_id uuid, p_preview_id uuid, p_confirm_destination boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order public.orders%ROWTYPE;
  v_preview private.customer_checkout_shipping_recovery_previews%ROWTYPE; v_quote_id uuid;
  v_existing jsonb; v_receiver jsonb;
BEGIN
  IF p_confirm_destination IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'destination_confirmation_required' USING ERRCODE='22023';
  END IF;
  -- A committed result remains valid after booking, refund or cancellation.
  -- Authorize and serialize independently of first-confirmation eligibility.
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.orders o JOIN public.merchants m ON m.id=o.merchant_id
      WHERE o.id=p_order_id AND m.user_id=auth.uid()) THEN
    RAISE EXCEPTION 'forbidden_shipping_recovery' USING ERRCODE='42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text,0));
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden_shipping_recovery' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.merchants WHERE id=v_order.merchant_id FOR SHARE;
  IF NOT EXISTS (SELECT 1 FROM public.merchants
    WHERE id=v_order.merchant_id AND user_id=auth.uid()) THEN
    RAISE EXCEPTION 'forbidden_shipping_recovery' USING ERRCODE='42501';
  END IF;
  -- Lock the order before its preview consistently with prepare/refund/booking.
  SELECT * INTO v_preview FROM private.customer_checkout_shipping_recovery_previews
    WHERE id=p_preview_id AND order_id=p_order_id AND merchant_id=v_order.merchant_id
      AND actor_id=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden_shipping_recovery' USING ERRCODE='42501';
  END IF;
  IF v_preview.confirmed_at IS NOT NULL THEN
    -- The live quote link survives audit redaction; the quoted-receiver
    -- comparison below does not (redacted quotes lose quote_request). A
    -- selected_quote_id pointing at this preview proves this confirmation
    -- already committed, so the retry stays idempotent past redaction.
    IF v_order.selected_quote_id=v_preview.id THEN
      RETURN pg_catalog.jsonb_build_object('quoteId',v_preview.id,'confirmed',true);
    END IF;
    RAISE EXCEPTION 'shipping_recovery_stale' USING ERRCODE='40001';
  END IF;
  -- New confirmations still require every current eligibility, payment,
  -- delivery, refund and input-lock guard. Reentrant locks retain the same
  -- order-payment boundary; the idempotent branch above never writes state.
  v_order := private.assert_customer_checkout_shipping_recovery(p_order_id);
  IF v_preview.expires_at<=now() THEN
    RAISE EXCEPTION 'shipping_recovery_expired' USING ERRCODE='22023';
  END IF;
  IF v_preview.fingerprint IS DISTINCT FROM private.customer_checkout_shipping_recovery_fingerprint(p_order_id) THEN
    RAISE EXCEPTION 'shipping_recovery_stale' USING ERRCODE='40001';
  END IF;
  IF (v_preview.quote->>'price')::numeric IS DISTINCT FROM v_order.shipping_fee THEN
    RAISE EXCEPTION 'shipping_recovery_price_changed' USING ERRCODE='22023';
  END IF;
  -- Explicit operator confirmation, never inferred from legacy quote coordinates.
  -- A scalar legacy address (stored JSON string) would merge into an array
  -- with `jsonb ||`; coerce non-objects to {} so confirmation always writes
  -- a bookable address object.
  v_existing := COALESCE(v_order.shipping_address,'{}'::jsonb);
  IF pg_catalog.jsonb_typeof(v_existing) IS DISTINCT FROM 'object' THEN
    v_existing := '{}'::jsonb;
  END IF;
  -- Replace both canonical and legacy spellings from the same signed
  -- receiver. The confirmed street is complete; an old second line must
  -- not survive as a different unit in receipts. Never retain an old
  -- postcode when the replacement quote does not carry one.
  v_existing := v_existing - 'address_line1' - 'address_line2' - 'postal_code' - 'postalCode';
  v_receiver := v_preview.quote->'quote_request'->'receiver';
  UPDATE public.orders SET shipping_address=v_existing || v_receiver
      || pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'address_line1',v_receiver->'address',
        'postal_code',v_receiver->'postalCode')), updated_at=now()
    WHERE id=p_order_id AND merchant_id=v_order.merchant_id;
  -- Reuse the existing validated GIGL writer, which retains paid checkout economics.
  -- The private preview was already proof-verified and is inaccessible to clients.
  v_quote_id := public.persist_refreshed_order_shipping_quote(p_order_id,v_preview.quote);
  UPDATE private.customer_checkout_shipping_recovery_previews SET confirmed_at=now()
    WHERE id=p_preview_id;
  -- Private preview stores actor, original destination, replacement and confirmation time as audit.
  RETURN pg_catalog.jsonb_build_object('quoteId',v_quote_id,'confirmed',true);
END;
$$;
