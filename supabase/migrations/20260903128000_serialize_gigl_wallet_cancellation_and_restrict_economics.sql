-- Final GIGL wallet/cancellation race and economics read boundary.
-- This migration is append-only: it supersedes the prior RPC definitions.

-- Once customer-checkout economics are stamped, address invalidation and quote
-- rebinding must not erase or reprice that settlement snapshot. The snapshot
-- remains immutable for every later order UPDATE, including one that clears
-- selected_quote_id or temporarily clears the funding-source field.
CREATE OR REPLACE FUNCTION private.stamp_gigl_order_economics()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_provider text;
  v_merchant_id uuid;
  v_provider_cost numeric;
  v_platform_margin numeric;
  v_pricing_version text;
  v_price numeric;
BEGIN
  IF NEW.shipping_funding_source IS NOT NULL
     AND NEW.shipping_funding_source NOT IN ('customer_checkout', 'merchant_wallet') THEN
    RAISE EXCEPTION 'Invalid shipping funding source' USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.shipping_funding_source = 'customer_checkout' THEN
    NEW.shipping_funding_source := 'customer_checkout';
    NEW.shipping_provider_cost := OLD.shipping_provider_cost;
    NEW.shipping_platform_margin := OLD.shipping_platform_margin;
    NEW.shipping_pricing_version := OLD.shipping_pricing_version;
    NEW.shipping_platform_retained_amount := OLD.shipping_platform_retained_amount;
    RETURN NEW;
  END IF;

  IF NEW.selected_quote_id IS NULL THEN
    NEW.shipping_funding_source := NULL;
    NEW.shipping_provider_cost := NULL;
    NEW.shipping_platform_margin := NULL;
    NEW.shipping_pricing_version := NULL;
    NEW.shipping_platform_retained_amount := 0;
    RETURN NEW;
  END IF;

  SELECT sq.provider, sq.merchant_id, sq.provider_cost, sq.platform_margin,
         sq.pricing_version, sq.price
    INTO v_provider, v_merchant_id, v_provider_cost, v_platform_margin,
         v_pricing_version, v_price
    FROM public.shipping_quotes AS sq
   WHERE sq.id = NEW.selected_quote_id
     AND sq.merchant_id = NEW.merchant_id
   LIMIT 1;

  IF NOT FOUND OR pg_catalog.upper(pg_catalog.btrim(COALESCE(v_provider, ''))) <> 'GIGL'
     OR v_merchant_id IS DISTINCT FROM NEW.merchant_id
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
  NEW.shipping_pricing_version := v_pricing_version;
  NEW.shipping_platform_retained_amount := CASE
    WHEN NEW.shipping_funding_source = 'customer_checkout' THEN v_price
    ELSE 0
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.stamp_gigl_order_economics() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.reserve_merchant_shipping_charge(
  p_order_id uuid,
  p_quote_id uuid,
  p_attempt_token text
)
RETURNS TABLE(charge_id uuid, charged_amount numeric, balance_after numeric, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_quote public.shipping_quotes%ROWTYPE;
  v_attestation public.shipping_quote_attestations%ROWTYPE;
  v_wallet public.merchant_wallets%ROWTYPE;
  v_existing public.merchant_shipping_charges%ROWTYPE;
  v_tx uuid;
  v_charge_id uuid;
  v_charge_status text;
BEGIN
  -- Use the same per-order mutex as cancellation before reading the order.
  -- This makes the processing/non-cancelled check and debit one serialized unit.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('merchant-shipping-order:' || p_order_id, 0)
  );

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND
     OR NOT EXISTS (
       SELECT 1 FROM public.merchants m
       WHERE m.id = v_order.merchant_id AND m.user_id = auth.uid()
     )
     OR v_order.shipping_funding_source IS DISTINCT FROM 'merchant_wallet'
     OR lower(COALESCE(v_order.shipping_status, '')) IS DISTINCT FROM 'processing'
     OR v_order.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'order_not_owned' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing
  FROM public.merchant_shipping_charges
  WHERE order_id = p_order_id AND shipping_quote_id = p_quote_id
  FOR UPDATE;

  SELECT * INTO v_quote
  FROM public.shipping_quotes
  WHERE id = p_quote_id AND merchant_id = v_order.merchant_id
    AND provider = 'GIGL' AND currency = 'NGN'
  FOR SHARE;

  SELECT * INTO v_attestation
  FROM public.shipping_quote_attestations
  WHERE quote_id = p_quote_id
  FOR SHARE;

  IF v_quote.id IS NULL OR v_attestation.quote_id IS NULL
     OR v_order.selected_quote_id IS DISTINCT FROM p_quote_id
     OR v_order.shipping_provider IS DISTINCT FROM 'GIGL'
     OR v_order.shipping_provider_cost IS DISTINCT FROM v_quote.provider_cost
     OR v_order.shipping_platform_margin IS DISTINCT FROM v_quote.platform_margin
     OR v_order.shipping_pricing_version IS DISTINCT FROM v_quote.pricing_version
     OR v_quote.session_id IS DISTINCT FROM p_order_id::text
     OR v_quote.pricing_version IS DISTINCT FROM 'gigl_platform_margin_v1'
     OR v_quote.is_station_pickup
     OR (v_existing.id IS NULL AND v_quote.expires_at <= now())
     OR v_attestation.order_id IS DISTINCT FROM p_order_id
     OR v_attestation.merchant_id IS DISTINCT FROM v_order.merchant_id
     OR v_attestation.price IS DISTINCT FROM v_quote.price
     OR v_attestation.provider_cost IS DISTINCT FROM v_quote.provider_cost
     OR v_attestation.platform_margin IS DISTINCT FROM v_quote.platform_margin
     OR v_attestation.currency IS DISTINCT FROM v_quote.currency
     OR v_attestation.pricing_version IS DISTINCT FROM v_quote.pricing_version
     OR v_attestation.expires_at IS DISTINCT FROM v_quote.expires_at
     OR v_attestation.is_station_pickup IS DISTINCT FROM v_quote.is_station_pickup
     OR v_attestation.provider_rate_id IS DISTINCT FROM v_quote.provider_rate_id
     OR v_attestation.quote_request IS DISTINCT FROM v_quote.quote_request THEN
    RAISE EXCEPTION 'quote_not_eligible' USING ERRCODE = '22023';
  END IF;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.status = 'reserved' THEN
      UPDATE public.merchant_shipping_charges
      SET attempt_token_digest = pg_catalog.encode(extensions.digest(p_attempt_token, 'sha256'), 'hex'), updated_at = now()
      WHERE id = v_existing.id;
    END IF;
    SELECT available_balance INTO balance_after
    FROM public.merchant_wallets WHERE merchant_id = v_order.merchant_id;
    RETURN QUERY SELECT v_existing.id, v_existing.charged_amount, balance_after, v_existing.status;
    RETURN;
  END IF;

  SELECT * INTO v_wallet
  FROM public.merchant_wallets
  WHERE merchant_id = v_order.merchant_id
  FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_wallet.available_balance, 0) < v_quote.price THEN
    RAISE EXCEPTION 'MERCHANT_WALLET_INSUFFICIENT' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.merchant_wallets
  SET available_balance = available_balance - v_quote.price, updated_at = now()
  WHERE id = v_wallet.id
  RETURNING available_balance INTO balance_after;

  INSERT INTO public.wallet_transactions(
    wallet_id, merchant_id, type, amount, balance_after, source_type, source_id, description, status
  ) VALUES (
    v_wallet.id, v_order.merchant_id, 'debit', v_quote.price, balance_after,
    'gigl_shipping', p_order_id, 'GIGL shipping reservation', 'completed'
  ) RETURNING id INTO v_tx;

  INSERT INTO public.merchant_shipping_charges AS charge(
    merchant_id, order_id, shipping_quote_id, currency, charged_amount,
    provider_cost, platform_margin, attempt_token_digest, debit_transaction_id
  ) VALUES (
    v_order.merchant_id, p_order_id, p_quote_id, v_quote.currency, v_quote.price,
    v_quote.provider_cost, v_quote.platform_margin,
    pg_catalog.encode(extensions.digest(p_attempt_token, 'sha256'), 'hex'), v_tx
  ) RETURNING charge.id, charge.status INTO v_charge_id, v_charge_status;

  RETURN QUERY SELECT v_charge_id, v_quote.price, balance_after, v_charge_status;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_merchant_shipping_charge(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_merchant_shipping_charge(uuid, uuid, text) TO authenticated;

-- A cancellation must not race a provider booking or consume an active charge.
-- The trigger runs after the order row lock is acquired, so reservation and
-- cancellation serialize even when callers do not use the RPC mutex directly.
CREATE OR REPLACE FUNCTION private.prevent_active_gigl_shipping_cancellation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF NEW.shipping_status IN ('cancelled', 'canceled')
     AND OLD.shipping_status NOT IN ('cancelled', 'canceled')
     AND NEW.shipment_id IS NULL THEN
    IF NEW.shipment_booking_lock_token IS NOT NULL
       AND NEW.shipment_booking_started_at IS NOT NULL
       AND NEW.shipment_booking_started_at > now() - interval '15 minutes' THEN
      RAISE EXCEPTION 'active_shipment_booking_lock' USING ERRCODE = '55P03';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.merchant_shipping_charges charge
      WHERE charge.order_id = NEW.id
        AND charge.shipment_id IS NULL
        AND charge.status IN ('reserved', 'provider_submitting')
    ) THEN
      RAISE EXCEPTION 'active_merchant_shipping_charge' USING ERRCODE = '55P03';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_active_gigl_shipping_cancellation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS prevent_active_gigl_shipping_cancellation ON public.orders;
CREATE TRIGGER prevent_active_gigl_shipping_cancellation
  BEFORE UPDATE OF shipping_status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION private.prevent_active_gigl_shipping_cancellation();

-- Provider tariff and platform margin are internal economics. Keep customer /
-- merchant-safe bundled prices available through authenticated PostgREST reads.
REVOKE SELECT ON TABLE public.shipments, public.merchant_shipping_charges FROM authenticated;
GRANT SELECT (
  id, order_id, merchant_id, provider, provider_shipment_id, tracking_number,
  carrier_name, service_tier, price, currency, status, estimated_delivery_days,
  estimated_delivery_at, delivered_at, cancelled_at, label_url,
  pickup_scheduled_at, current_location, tracking_events, last_tracked_at,
  refund_amount, is_station_pickup, station_name, station_address,
  sender_address, receiver_address, items, provider_response,
  shipping_quote_id, tracking_snapshot_version, tracking_timeline_generation,
  created_at, updated_at
) ON TABLE public.shipments TO authenticated;
GRANT SELECT (
  id, merchant_id, order_id, shipping_quote_id, status, currency, charged_amount,
  shipment_id, provider_reference, failure_code, debit_transaction_id,
  refund_transaction_id, created_at, updated_at, provider_submitting_at,
  completed_at, refunded_at
) ON TABLE public.merchant_shipping_charges TO authenticated;

COMMENT ON COLUMN public.shipments.provider_cost IS
  'Internal GIGL provider tariff. Not exposed to authenticated PostgREST clients.';
COMMENT ON COLUMN public.shipments.platform_margin IS
  'Internal platform margin. Not exposed to authenticated PostgREST clients.';
COMMENT ON COLUMN public.merchant_shipping_charges.provider_cost IS
  'Internal GIGL provider tariff. Not exposed to authenticated PostgREST clients.';
COMMENT ON COLUMN public.merchant_shipping_charges.platform_margin IS
  'Internal platform margin. Not exposed to authenticated PostgREST clients.';
