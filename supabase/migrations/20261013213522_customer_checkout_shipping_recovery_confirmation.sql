CREATE OR REPLACE FUNCTION public.prepare_customer_checkout_shipping_recovery(
  p_order_id uuid, p_fingerprint text, p_quote jsonb, p_route_proof jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order public.orders%ROWTYPE; v_id uuid; v_receiver jsonb; v_payload jsonb; v_expiry timestamptz;
BEGIN
  v_order := private.assert_customer_checkout_shipping_recovery(p_order_id);
  IF private.verify_shipping_quote_route_proof(p_route_proof,
    'prepare_customer_checkout_shipping_recovery',p_order_id,v_order.merchant_id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'invalid_shipping_quote_route_proof' USING ERRCODE='42501';
  END IF;
  v_payload := (p_route_proof->>'payload_text')::jsonb;
  IF v_payload IS DISTINCT FROM pg_catalog.jsonb_build_object(
    'order_id',p_order_id,'fingerprint',p_fingerprint,'quote',p_quote) THEN
    RAISE EXCEPTION 'invalid_shipping_quote_route_proof' USING ERRCODE='42501';
  END IF;
  IF p_fingerprint IS DISTINCT FROM private.customer_checkout_shipping_recovery_fingerprint(p_order_id) THEN
    RAISE EXCEPTION 'shipping_recovery_stale' USING ERRCODE='40001';
  END IF;
  IF jsonb_typeof(p_quote->'price') IS DISTINCT FROM 'number'
    OR (p_quote->>'price')::numeric IS DISTINCT FROM v_order.shipping_fee THEN
    RAISE EXCEPTION 'shipping_recovery_price_changed' USING ERRCODE='22023';
  END IF;
  v_receiver := p_quote->'quote_request'->'receiver';
  IF jsonb_typeof(v_receiver) IS DISTINCT FROM 'object'
    OR jsonb_typeof(v_receiver->'latitude') IS DISTINCT FROM 'number'
    OR jsonb_typeof(v_receiver->'longitude') IS DISTINCT FROM 'number'
    OR (v_receiver->>'latitude')::numeric NOT BETWEEN -90 AND 90
    OR (v_receiver->>'longitude')::numeric NOT BETWEEN -180 AND 180
    OR COALESCE(length(btrim(v_receiver->>'address')),0)=0
    OR COALESCE(length(btrim(v_receiver->>'city')),0)=0
    OR COALESCE(length(btrim(v_receiver->>'state')),0)=0
    OR COALESCE(length(btrim(v_receiver->>'phone')),0)=0
    OR p_quote->>'provider' IS DISTINCT FROM 'GIGL'
    OR p_quote->>'currency' IS DISTINCT FROM 'NGN'
    OR p_quote->>'merchant_id' IS DISTINCT FROM v_order.merchant_id::text
    OR p_quote->'quote_request'->>'merchantId' IS DISTINCT FROM v_order.merchant_id::text
    OR p_quote->'quote_request'->>'shipmentType' IS DISTINCT FROM 'domestic' THEN
    RAISE EXCEPTION 'invalid_shipping_recovery_destination' USING ERRCODE='22023';
  END IF;
  v_id := (p_quote->>'id')::uuid;
  v_expiry := LEAST((p_quote->>'expires_at')::timestamptz,now()+interval '5 minutes');
  IF v_id IS NULL OR (p_quote->>'expires_at') IS NULL OR v_expiry<=now() THEN
    RAISE EXCEPTION 'shipping_recovery_expired' USING ERRCODE='22023';
  END IF;
  INSERT INTO private.customer_checkout_shipping_recovery_previews
    (id,order_id,merchant_id,actor_id,fingerprint,original_address,quote,expires_at)
    VALUES (v_id,p_order_id,v_order.merchant_id,auth.uid(),p_fingerprint,
      COALESCE(v_order.shipping_address,'{}'::jsonb),p_quote,v_expiry)
    ON CONFLICT (id) DO NOTHING;
  -- A retried prepare is idempotent only for the same actor, inputs and proof-bound quote.
  IF NOT EXISTS (SELECT 1 FROM private.customer_checkout_shipping_recovery_previews
    WHERE id=v_id AND order_id=p_order_id AND merchant_id=v_order.merchant_id
      AND actor_id=auth.uid() AND fingerprint=p_fingerprint AND quote=p_quote
      AND expires_at>now() AND confirmed_at IS NULL) THEN
    RAISE EXCEPTION 'shipping_recovery_stale' USING ERRCODE='40001';
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_customer_checkout_shipping_recovery(
  p_order_id uuid, p_preview_id uuid, p_confirm_destination boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order public.orders%ROWTYPE;
  v_preview private.customer_checkout_shipping_recovery_previews%ROWTYPE; v_quote_id uuid;
BEGIN
  IF p_confirm_destination IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'destination_confirmation_required' USING ERRCODE='22023';
  END IF;
  v_order := private.assert_customer_checkout_shipping_recovery(p_order_id);
  -- Lock the order before its preview consistently with prepare/refund/booking.
  SELECT * INTO v_preview FROM private.customer_checkout_shipping_recovery_previews
    WHERE id=p_preview_id AND order_id=p_order_id AND merchant_id=v_order.merchant_id
      AND actor_id=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden_shipping_recovery' USING ERRCODE='42501';
  END IF;
  IF v_preview.confirmed_at IS NOT NULL THEN
    IF v_order.selected_quote_id=v_preview.id
      AND v_order.shipping_address @> (v_preview.quote->'quote_request'->'receiver') THEN
      RETURN pg_catalog.jsonb_build_object('quoteId',v_preview.id,'confirmed',true);
    END IF;
    RAISE EXCEPTION 'shipping_recovery_stale' USING ERRCODE='40001';
  END IF;
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
  UPDATE public.orders SET shipping_address=COALESCE(shipping_address,'{}'::jsonb)
      || (v_preview.quote->'quote_request'->'receiver'), updated_at=now()
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
REVOKE ALL ON FUNCTION public.prepare_customer_checkout_shipping_recovery(uuid,text,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.confirm_customer_checkout_shipping_recovery(uuid,uuid,boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prepare_customer_checkout_shipping_recovery(uuid,text,jsonb,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_customer_checkout_shipping_recovery(uuid,uuid,boolean) TO authenticated;
NOTIFY pgrst, 'reload schema';
