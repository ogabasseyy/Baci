-- Coerce legacy scalar destinations before the recovery merge. A jsonb scalar
-- || object merge writes an array instead of an address object, leaving the
-- recovered order unbookable, so non-object values fall back to {}.
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
  UPDATE public.orders SET shipping_address=(CASE WHEN
      pg_catalog.jsonb_typeof(COALESCE(shipping_address,'{}'::jsonb))='object'
      THEN COALESCE(shipping_address,'{}'::jsonb) ELSE '{}'::jsonb END)
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
