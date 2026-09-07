CREATE TABLE IF NOT EXISTS public.shipping_quote_attestations (
  quote_id uuid PRIMARY KEY REFERENCES public.shipping_quotes(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  price numeric(12,2) NOT NULL,
  provider_cost numeric(12,2), platform_margin numeric(12,2), currency text NOT NULL,
  pricing_version text NOT NULL, expires_at timestamptz NOT NULL,
  is_station_pickup boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.shipping_quote_attestations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shipping_quote_attestations FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bind_admin_gigl_quote(
  p_order_id uuid,
  p_merchant_id uuid,
  p_quote_id uuid,
  p_receiver jsonb
)
RETURNS TABLE (quote jsonb, available_balance numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_balance numeric := 0;
  v_quote public.shipping_quotes%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.merchants m WHERE m.id = p_merchant_id AND m.user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id AND merchant_id = p_merchant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF v_order.shipment_id IS NOT NULL OR v_order.tracking_number IS NOT NULL OR lower(v_order.shipping_status) IN ('shipped','booked','in_transit') THEN
    RAISE EXCEPTION 'order_already_shipped_or_booked';
  END IF;
  SELECT * INTO v_quote FROM public.shipping_quotes WHERE id=p_quote_id FOR UPDATE;
  IF NOT FOUND OR v_quote.merchant_id IS DISTINCT FROM p_merchant_id OR v_quote.session_id IS DISTINCT FROM p_order_id::text
    OR v_quote.provider <> 'GIGL' OR v_quote.currency <> 'NGN' OR v_quote.is_station_pickup
    OR v_quote.expires_at <= now() OR v_quote.price <= 0 OR v_quote.pricing_version IS DISTINCT FROM 'gigl_platform_margin_v1'
    OR v_quote.quote_request->>'admin_order_provenance' <> 'server_gigl_v1' THEN RAISE EXCEPTION 'invalid_quote'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shipping_quote_attestations a WHERE a.quote_id=p_quote_id AND a.order_id=p_order_id AND a.merchant_id=p_merchant_id AND a.price=v_quote.price AND a.currency=v_quote.currency AND a.pricing_version=v_quote.pricing_version AND a.expires_at=v_quote.expires_at AND a.is_station_pickup=v_quote.is_station_pickup) THEN RAISE EXCEPTION 'invalid_quote_attestation'; END IF;
  SELECT COALESCE(w.available_balance,0) INTO v_balance FROM public.merchant_wallets w WHERE w.merchant_id = p_merchant_id;
  UPDATE public.orders SET selected_quote_id=p_quote_id, shipping_provider='GIGL', shipping_address=p_receiver, shipping_funding_source='merchant_wallet' WHERE id=p_order_id;
  RETURN QUERY SELECT to_jsonb(v_quote), v_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.bind_admin_gigl_quote(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bind_admin_gigl_quote(uuid, uuid, uuid, jsonb) TO authenticated;
