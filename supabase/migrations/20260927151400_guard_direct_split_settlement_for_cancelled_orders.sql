-- Reject direct-split settlement recording for cancelled/refunded orders.
-- record_uba_redvault_direct_settlement inserts its settled row directly
-- instead of delegating to record_merchant_settlement, so the guard in
-- 20260927151300 does not cover it: a paid-order side-effect worker that
-- claimed merchant_settlement before cancellation could otherwise create
-- a live direct-split settlement after the refund completed. Lock the
-- order row to serialize with the cancellation refund reversal, using
-- the same settlement_order_cancelled code so the executor maps it to
-- its permanent error. record_uba_redvault_direct_settlement_gigl_v1
-- delegates to this primitive, so GIGL split sales inherit the guard.
CREATE OR REPLACE FUNCTION public.record_uba_redvault_direct_settlement(
  p_merchant_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_gateway text,
  p_gateway_reference text,
  p_gross_amount numeric,
  p_gateway_fee numeric,
  p_platform_fee numeric,
  p_description text,
  p_metadata jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_wallet_id uuid;
  v_net_amount numeric;
  v_expected_date date;
  v_settlement_id uuid;
  v_method text;
  v_shipping_status text;
  v_payment_status text;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: record_uba_redvault_direct_settlement requires service_role';
  END IF;
  IF p_source_type = 'order' THEN
    SELECT o.payment_method, o.shipping_status, o.payment_status
      INTO v_method, v_shipping_status, v_payment_status
      FROM public.orders AS o WHERE o.id = p_source_id
      FOR UPDATE;
    IF v_method IS DISTINCT FROM 'uba_redvault' THEN
      RAISE EXCEPTION 'redvault_direct_settlement_order_mismatch';
    END IF;
    IF v_shipping_status IN ('cancelled', 'canceled')
      OR v_payment_status = 'refunded'
    THEN
      RAISE EXCEPTION 'settlement_order_cancelled';
    END IF;
  END IF;

  v_wallet_id := public.get_or_create_merchant_wallet(p_merchant_id);
  -- Account-borne gateway fee: Paystack deducts it from the platform share
  -- (Bearer [REDACTED]'account'), so the merchant subaccount settles gross
  -- minus transaction_charge. Record the fee, but do not deduct it here.
  v_net_amount := p_gross_amount - p_platform_fee;
  v_expected_date := public.calculate_settlement_date(p_gateway);

  INSERT INTO public.merchant_settlements (
    merchant_id, wallet_id, source_type, source_id, gateway,
    gateway_reference, gross_amount, gateway_fee, platform_fee, net_amount,
    payment_date, expected_settlement_date, description, status, metadata,
    settlement_notified
  ) VALUES (
    p_merchant_id, v_wallet_id, p_source_type, p_source_id, p_gateway,
    p_gateway_reference, p_gross_amount, p_gateway_fee, p_platform_fee,
    v_net_amount, pg_catalog.now(), v_expected_date,
    COALESCE(p_description, 'Payment received'),
    'settled',
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('redvault_direct_split', true),
    true
  )
  ON CONFLICT (source_type, source_id, gateway_reference)
    WHERE gateway_reference IS NOT NULL AND status != 'cancelled'
    DO NOTHING
  RETURNING id INTO v_settlement_id;

  RETURN v_settlement_id;
END;
$$;
ALTER FUNCTION public.record_uba_redvault_direct_settlement(uuid, text, uuid, text, text, numeric, numeric, numeric, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_uba_redvault_direct_settlement(uuid, text, uuid, text, text, numeric, numeric, numeric, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_uba_redvault_direct_settlement(uuid, text, uuid, text, text, numeric, numeric, numeric, text, jsonb) TO service_role;
