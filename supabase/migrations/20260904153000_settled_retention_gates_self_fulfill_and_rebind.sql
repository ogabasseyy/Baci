-- Gate checkout→wallet rebind and self-fulfillment on settled retention, not
-- the order snapshot. Quiz-voucher / zero-paid orders can stamp a positive
-- retained amount without ever settling shipping; those must stay rebindable.
-- Once merchant_settlements has retained shipping, clearing the snapshot alone
-- would leave the merchant paying for unused GIGL tariff.

CREATE OR REPLACE FUNCTION private.order_settled_gigl_retained_amount(
  p_order_id uuid,
  p_merchant_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(SUM(
    GREATEST(
      COALESCE((settlement.metadata ->> 'retained_shipping_amount')::numeric, 0),
      0
    )
  ), 0)
  FROM public.merchant_settlements AS settlement
  WHERE settlement.source_type = 'order'
    AND settlement.source_id = p_order_id
    AND settlement.merchant_id = p_merchant_id
    AND settlement.status IS DISTINCT FROM 'cancelled';
$$;

REVOKE ALL ON FUNCTION private.order_settled_gigl_retained_amount(uuid, uuid)
  FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.stamp_gigl_order_economics()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_provider text;
  v_provider_cost numeric;
  v_platform_margin numeric;
  v_pricing_version text;
  v_price numeric;
  v_settled_retained numeric := 0;
BEGIN
  IF NEW.shipping_funding_source IS NOT NULL
     AND NEW.shipping_funding_source NOT IN ('customer_checkout', 'merchant_wallet') THEN
    RAISE EXCEPTION 'Invalid shipping funding source' USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_settled_retained := private.order_settled_gigl_retained_amount(
      NEW.id, NEW.merchant_id
    );
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.shipping_funding_source = 'customer_checkout'
     AND v_settled_retained > 0
     AND NEW.shipping_funding_source = 'merchant_wallet' THEN
    RAISE EXCEPTION 'customer_checkout_wallet_rebind_forbidden' USING ERRCODE = 'P0001';
  END IF;

  -- Self-fulfillment before settlement must drop checkout retention so payment
  -- settlement does not withhold GIGL shipping for a merchant-delivered order.
  -- After settlement has retained shipping, reject — clearing the snapshot would
  -- leave the merchant short the already-deducted tariff.
  IF TG_OP = 'UPDATE'
     AND NEW.fulfillment_type = 'self'
     AND COALESCE(OLD.fulfillment_type, '') IS DISTINCT FROM 'self'
     AND NEW.selected_quote_id IS NULL
     AND NEW.shipping_status IN ('shipped', 'delivered') THEN
    IF v_settled_retained > 0 THEN
      RAISE EXCEPTION 'settled_checkout_retention_blocks_self_fulfillment'
        USING ERRCODE = 'P0001';
    END IF;
    NEW.shipping_funding_source := NULL;
    NEW.shipping_provider_cost := NULL;
    NEW.shipping_platform_margin := NULL;
    NEW.shipping_pricing_version := NULL;
    NEW.shipping_platform_retained_amount := 0;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.shipping_funding_source = 'customer_checkout'
     AND v_settled_retained > 0 THEN
    NEW.shipping_funding_source := 'customer_checkout';
    IF COALESCE(NEW.fulfillment_type, '') IS DISTINCT FROM 'self' THEN
      NEW.shipping_provider := 'GIGL';
    END IF;
    NEW.shipping_provider_cost := OLD.shipping_provider_cost;
    NEW.shipping_platform_margin := OLD.shipping_platform_margin;
    NEW.shipping_pricing_version := OLD.shipping_pricing_version;
    NEW.shipping_platform_retained_amount := OLD.shipping_platform_retained_amount;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.shipping_funding_source = 'merchant_wallet'
     AND NEW.selected_quote_id IS NOT NULL THEN
    NEW.shipping_funding_source := 'merchant_wallet';
  END IF;

  IF NEW.selected_quote_id IS NULL THEN
    NEW.shipping_funding_source := NULL;
    NEW.shipping_provider_cost := NULL;
    NEW.shipping_platform_margin := NULL;
    NEW.shipping_pricing_version := NULL;
    NEW.shipping_platform_retained_amount := 0;
    RETURN NEW;
  END IF;

  SELECT sq.provider, sq.provider_cost, sq.platform_margin,
         sq.pricing_version, sq.price
    INTO v_provider, v_provider_cost, v_platform_margin, v_pricing_version, v_price
    FROM public.shipping_quotes sq
   WHERE sq.id = NEW.selected_quote_id
     AND sq.merchant_id = NEW.merchant_id
   LIMIT 1;
  IF NOT FOUND
     OR pg_catalog.upper(pg_catalog.btrim(COALESCE(v_provider, ''))) <> 'GIGL'
     OR v_pricing_version IS DISTINCT FROM 'gigl_platform_margin_v1' THEN
    NEW.shipping_funding_source := NULL;
    NEW.shipping_provider_cost := NULL;
    NEW.shipping_platform_margin := NULL;
    NEW.shipping_pricing_version := NULL;
    NEW.shipping_platform_retained_amount := 0;
    RETURN NEW;
  END IF;
  IF NEW.shipping_funding_source IS NULL THEN
    NEW.shipping_funding_source := 'customer_checkout';
  END IF;
  NEW.shipping_provider_cost := v_provider_cost;
  NEW.shipping_platform_margin := v_platform_margin;
  NEW.shipping_pricing_version := 'gigl_platform_margin_v1';
  NEW.shipping_platform_retained_amount := CASE
    WHEN NEW.shipping_funding_source = 'customer_checkout' THEN v_price
    ELSE 0
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.stamp_gigl_order_economics() FROM PUBLIC;

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
  v_quote public.shipping_quotes%ROWTYPE;
  v_attestation public.shipping_quote_attestations%ROWTYPE;
  v_balance numeric := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.merchants m WHERE m.id = p_merchant_id AND m.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND merchant_id = p_merchant_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF v_order.shipping_funding_source = 'customer_checkout'
     AND private.order_settled_gigl_retained_amount(p_order_id, p_merchant_id) > 0 THEN
    RAISE EXCEPTION 'customer_checkout_wallet_rebind_forbidden' USING ERRCODE = 'P0001';
  END IF;
  IF v_order.shipment_id IS NOT NULL OR v_order.tracking_number IS NOT NULL
     OR lower(COALESCE(v_order.shipping_status, '')) IS DISTINCT FROM 'processing' THEN
    RAISE EXCEPTION 'order_already_shipped_or_booked';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.merchant_shipping_charges AS charge
    WHERE charge.order_id = p_order_id
      AND charge.status = 'booked'
  ) THEN
    RAISE EXCEPTION 'order_already_shipped_or_booked';
  END IF;
  SELECT * INTO v_quote FROM public.shipping_quotes WHERE id = p_quote_id FOR UPDATE;
  SELECT * INTO v_attestation
  FROM public.shipping_quote_attestations
  WHERE quote_id = p_quote_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_quote.merchant_id IS DISTINCT FROM p_merchant_id
     OR v_quote.session_id IS DISTINCT FROM p_order_id::text
     OR v_quote.provider IS DISTINCT FROM 'GIGL'
     OR v_quote.currency IS DISTINCT FROM 'NGN'
     OR v_quote.is_station_pickup
     OR v_quote.expires_at <= now()
     OR v_quote.price <= 0
     OR v_quote.pricing_version IS DISTINCT FROM 'gigl_platform_margin_v1'
     OR v_attestation.order_id IS DISTINCT FROM p_order_id
     OR v_attestation.merchant_id IS DISTINCT FROM p_merchant_id
     OR v_attestation.provider_rate_id IS DISTINCT FROM v_quote.provider_rate_id
     OR v_attestation.quote_request IS DISTINCT FROM v_quote.quote_request
     OR v_attestation.price IS DISTINCT FROM v_quote.price
     OR v_attestation.provider_cost IS DISTINCT FROM v_quote.provider_cost
     OR v_attestation.platform_margin IS DISTINCT FROM v_quote.platform_margin
     OR v_attestation.currency IS DISTINCT FROM v_quote.currency
     OR v_attestation.pricing_version IS DISTINCT FROM v_quote.pricing_version
     OR v_attestation.expires_at IS DISTINCT FROM v_quote.expires_at
     OR v_attestation.is_station_pickup IS DISTINCT FROM v_quote.is_station_pickup
     OR v_attestation.quote_request->'receiver' IS DISTINCT FROM p_receiver THEN
    RAISE EXCEPTION 'invalid_quote_attestation';
  END IF;
  SELECT COALESCE(w.available_balance, 0)
  INTO v_balance
  FROM public.merchant_wallets w
  WHERE w.merchant_id = p_merchant_id
  FOR UPDATE;
  UPDATE public.orders
  SET selected_quote_id = p_quote_id,
      shipping_provider = 'GIGL',
      shipping_address = p_receiver,
      shipping_funding_source = 'merchant_wallet'
  WHERE id = p_order_id;
  RETURN QUERY SELECT jsonb_build_object(
    'id', v_quote.id,
    'merchant_id', v_quote.merchant_id,
    'session_id', v_quote.session_id,
    'provider', v_quote.provider,
    'service_tier', v_quote.service_tier,
    'carrier_name', v_quote.carrier_name,
    'price', v_quote.price,
    'currency', v_quote.currency,
    'estimated_days', v_quote.estimated_days,
    'min_days', v_quote.min_days,
    'max_days', v_quote.max_days,
    'pickup_included', v_quote.pickup_included,
    'insurance_included', v_quote.insurance_included,
    'provider_rate_id', v_quote.provider_rate_id,
    'is_station_pickup', v_quote.is_station_pickup,
    'station_name', v_quote.station_name,
    'station_address', v_quote.station_address,
    'quote_request', v_quote.quote_request,
    'used', v_quote.used,
    'expires_at', v_quote.expires_at,
    'created_at', v_quote.created_at
  ), v_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.bind_admin_gigl_quote(uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bind_admin_gigl_quote(uuid, uuid, uuid, jsonb)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.self_fulfill_order_with_wallet_release(
  p_order_id uuid,
  p_self_fulfillment_data jsonb,
  p_carrier_name text DEFAULT 'Self-Delivery',
  p_tracking_number text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_charge public.merchant_shipping_charges%ROWTYPE;
  v_balance numeric;
  v_transaction uuid;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('merchant-shipping-order:' || p_order_id::text, 0)
  );

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND OR NOT EXISTS (
    SELECT 1
    FROM public.orders AS o
    JOIN public.merchants AS merchant ON merchant.id = o.merchant_id
    WHERE o.id = p_order_id
      AND (
        merchant.user_id = (SELECT auth.uid())
        OR public.check_staff_permission(
          (SELECT auth.uid()), o.merchant_id, 'orders', 'fulfill'
        )
        OR public.check_staff_permission(
          (SELECT auth.uid()), o.merchant_id, 'orders', 'edit'
        )
      )
  ) THEN
    RAISE EXCEPTION 'order_not_owned' USING ERRCODE = '42501';
  END IF;

  IF v_order.shipping_status IN ('shipped', 'delivered') THEN
    RAISE EXCEPTION 'order_already_shipped' USING ERRCODE = 'P0001';
  END IF;

  IF private.order_settled_gigl_retained_amount(
       p_order_id, v_order.merchant_id
     ) > 0 THEN
    RAISE EXCEPTION 'settled_checkout_retention_blocks_self_fulfillment'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_order.shipment_booking_lock_token IS NOT NULL
     AND v_order.shipment_booking_started_at IS NOT NULL
     AND v_order.shipment_booking_started_at > now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'active_shipment_booking_lock' USING ERRCODE = '55P03';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.merchant_shipping_charges AS charge
    WHERE charge.order_id = p_order_id
      AND charge.status IN ('booked', 'needs_reconciliation', 'provider_submitting')
  ) THEN
    RAISE EXCEPTION 'active_merchant_shipping_charge' USING ERRCODE = '55P03';
  END IF;

  FOR v_charge IN
    SELECT charge.*
    FROM public.merchant_shipping_charges AS charge
    WHERE charge.order_id = p_order_id
      AND charge.status = 'reserved'
      AND charge.shipment_id IS NULL
    FOR UPDATE
  LOOP
    UPDATE public.merchant_wallets
    SET available_balance = available_balance + v_charge.charged_amount,
        updated_at = now()
    WHERE merchant_id = v_charge.merchant_id
    RETURNING available_balance INTO v_balance;

    INSERT INTO public.wallet_transactions(
      wallet_id, merchant_id, type, amount, balance_after, source_type,
      source_id, description, status
    )
    SELECT id, v_charge.merchant_id, 'refund', v_charge.charged_amount,
      v_balance, 'gigl_shipping', v_charge.order_id,
      'GIGL shipping reservation refund before self-fulfillment', 'completed'
    FROM public.merchant_wallets
    WHERE merchant_id = v_charge.merchant_id
    RETURNING id INTO v_transaction;

    UPDATE public.merchant_shipping_charges
    SET status = 'refunded',
        refund_transaction_id = v_transaction,
        failure_code = 'SELF_FULFILL_BEFORE_SUBMISSION',
        refunded_at = now(),
        updated_at = now()
    WHERE id = v_charge.id;
  END LOOP;

  UPDATE public.orders
  SET shipping_status = 'shipped',
      fulfillment_type = 'self',
      self_fulfillment_data = p_self_fulfillment_data,
      tracking_number = p_tracking_number,
      shipping_provider = COALESCE(NULLIF(btrim(p_carrier_name), ''), 'Self-Delivery'),
      selected_quote_id = NULL,
      shipping_funding_source = NULL,
      shipping_provider_cost = NULL,
      shipping_platform_margin = NULL,
      shipping_pricing_version = NULL,
      shipping_platform_retained_amount = 0,
      shipment_booking_lock_token = NULL,
      shipment_booking_started_at = NULL,
      updated_at = now()
  WHERE id = p_order_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.self_fulfill_order_with_wallet_release(
  uuid, jsonb, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.self_fulfill_order_with_wallet_release(
  uuid, jsonb, text, text
) TO authenticated;
