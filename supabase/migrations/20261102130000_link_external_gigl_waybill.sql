-- Attach a GIG waybill that staff booked directly in GIG's own app to a Baci
-- order, so it is tracked and notified like a Baci-booked shipment.
--
-- GIG billed the GIG account directly, so no merchant wallet charge or quote
-- is involved. The shipment records that as funding_source='external_manual'.
-- Only public.link_external_gigl_waybill can create such a row: the
-- authenticated INSERT column grant does not include funding_source, and the
-- RPC accepts only a server-signed snapshot of GIG's read-only lookup (account
-- ownership and receiver match already checked by the route).
--
-- The existing triggers then do the rest: bump_shipment_tracking_snapshot_version
-- allocates a new tracking timeline generation for the order, and
-- activate_gigl_tracking_monitor creates the active tracking monitor.

ALTER TABLE public.shipments
  ADD COLUMN funding_source text NOT NULL DEFAULT 'baci_booking';
ALTER TABLE public.shipments
  ADD CONSTRAINT shipments_funding_source_check
  CHECK (funding_source IN ('baci_booking', 'external_manual'));
COMMENT ON COLUMN public.shipments.funding_source IS
  'baci_booking: booked through Baci (quote, wallet or checkout funded). external_manual: booked outside Baci (e.g. in the GIG app) and only linked for tracking; no Baci charge.';
GRANT SELECT (funding_source) ON TABLE public.shipments TO authenticated;

-- One live GIGL shipment per waybill, across all orders and merchants.
-- Production held four GIGL rows with distinct tracking numbers when this was
-- written. Cancelled rows release the waybill so a mistaken link can be fixed.
-- Other carriers are out of scope (their data was not audited).
CREATE UNIQUE INDEX shipments_provider_tracking_number_live_key
  ON public.shipments (provider, pg_catalog.upper(pg_catalog.btrim(tracking_number)))
  WHERE provider = 'GIGL'
    AND tracking_number IS NOT NULL
    AND pg_catalog.btrim(tracking_number) <> ''
    AND status <> 'cancelled';

-- Preserve the quote-economics stamp for Baci bookings; external rows carry
-- no Baci quote and therefore no provider cost or platform margin.
CREATE OR REPLACE FUNCTION private.stamp_gigl_shipment_economics()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_provider_cost numeric;
  v_platform_margin numeric;
BEGIN
  IF NEW.funding_source = 'external_manual' THEN
    IF NEW.provider <> 'GIGL' OR NEW.order_id IS NULL
       OR NEW.shipping_quote_id IS NOT NULL THEN
      RAISE EXCEPTION 'external_shipment_invalid' USING ERRCODE = '22023';
    END IF;
    NEW.provider_cost := NULL;
    NEW.platform_margin := NULL;
  ELSIF NEW.provider = 'GIGL' AND NEW.order_id IS NOT NULL THEN
    SELECT quote.provider_cost, quote.platform_margin
      INTO v_provider_cost, v_platform_margin
    FROM public.shipping_quotes AS quote
    WHERE quote.id = NEW.shipping_quote_id
      AND quote.merchant_id = NEW.merchant_id
      AND quote.provider = 'GIGL'
      AND quote.pricing_version = 'gigl_platform_margin_v1'
      AND quote.provider_cost IS NOT NULL
      AND quote.platform_margin IS NOT NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'gigl_shipment_quote_economics_missing' USING ERRCODE = '22023';
    END IF;
    NEW.provider_cost := v_provider_cost;
    NEW.platform_margin := v_platform_margin;
  ELSE
    NEW.provider_cost := NULL;
    NEW.platform_margin := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.stamp_gigl_shipment_economics() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.link_external_gigl_waybill(
  p_order_id uuid,
  p_route_proof jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_payload jsonb;
  v_waybill text;
  v_price numeric;
  v_shipment_id uuid;
BEGIN
  IF p_order_id IS NULL OR p_route_proof IS NULL THEN
    RAISE EXCEPTION 'external_waybill_link_invalid' USING ERRCODE = '22023';
  END IF;

  -- Same per-order lock as wallet booking and self-fulfilment.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('merchant-shipping-order:' || p_order_id::text, 0)
  );

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  -- EXISTS keeps a NULL permission result from passing as "not denied".
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1
    FROM public.merchants AS merchant
    WHERE merchant.id = v_order.merchant_id
      AND (
        merchant.user_id = (SELECT auth.uid())
        OR public.check_staff_permission(
          (SELECT auth.uid()), v_order.merchant_id, 'orders', 'fulfill'
        )
        OR public.check_staff_permission(
          (SELECT auth.uid()), v_order.merchant_id, 'orders', 'edit'
        )
      )
  ) THEN
    RAISE EXCEPTION 'order_not_owned' USING ERRCODE = '42501';
  END IF;

  IF NOT COALESCE(private.verify_shipping_quote_route_proof(
       p_route_proof, 'link_external_gigl_waybill', p_order_id, v_order.merchant_id
     ), false) THEN
    RAISE EXCEPTION 'external_waybill_proof_invalid' USING ERRCODE = '42501';
  END IF;

  v_payload := (p_route_proof->>'payload_text')::jsonb;
  v_waybill := pg_catalog.btrim(COALESCE(v_payload->>'waybill', ''));
  IF v_waybill !~ '^[A-Za-z0-9-]{4,32}$'
     OR v_payload->'account_verified' IS DISTINCT FROM 'true'::jsonb
     OR v_payload->'receiver_match' IS DISTINCT FROM 'true'::jsonb
     OR pg_catalog.jsonb_typeof(v_payload->'receiver_address') IS DISTINCT FROM 'object'
     OR pg_catalog.jsonb_typeof(v_payload->'sender_address') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'external_waybill_link_invalid' USING ERRCODE = '22023';
  END IF;
  -- The receiver was matched against an earlier read of the order; refuse
  -- if the customer or delivery fields changed before this row lock.
  IF pg_catalog.jsonb_typeof(v_payload->'order_receiver') IS DISTINCT FROM 'object'
     OR (v_payload->'order_receiver'->>'customer_name') IS DISTINCT FROM v_order.customer_name
     OR (v_payload->'order_receiver'->>'customer_phone') IS DISTINCT FROM v_order.customer_phone
     OR (v_payload->'order_receiver'->>'phone') IS DISTINCT FROM (
       CASE WHEN pg_catalog.jsonb_typeof(v_order.shipping_address->'phone') = 'string'
         THEN v_order.shipping_address->>'phone' END)
     OR (v_payload->'order_receiver'->>'state') IS DISTINCT FROM (
       CASE WHEN pg_catalog.jsonb_typeof(v_order.shipping_address->'state') = 'string'
         THEN v_order.shipping_address->>'state' END) THEN
    RAISE EXCEPTION 'order_changed_during_link' USING ERRCODE = '40001';
  END IF;
  IF pg_catalog.jsonb_typeof(v_payload->'price') = 'number' THEN
    v_price := (v_payload->>'price')::numeric;
    IF v_price < 0 THEN v_price := NULL; END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.merchant_feature_settings AS mfs
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements_text(
      CASE WHEN pg_catalog.jsonb_typeof(mfs.shipping_providers) = 'array'
        THEN mfs.shipping_providers ELSE '[]'::jsonb END
    ) AS configured_provider(value)
    WHERE mfs.merchant_id = v_order.merchant_id
      AND pg_catalog.lower(pg_catalog.btrim(configured_provider.value)) = 'gigl'
  ) THEN
    RAISE EXCEPTION 'gigl_not_enabled' USING ERRCODE = 'P0001';
  END IF;

  -- Legacy cancellations can carry cancelled_at with a pending status.
  IF v_order.cancelled_at IS NOT NULL
     OR v_order.shipping_status IS NULL
     OR v_order.shipping_status NOT IN ('pending', 'processing', 'shipped') THEN
    RAISE EXCEPTION 'order_not_linkable' USING ERRCODE = 'P0001';
  END IF;

  -- A customer-paid Baci GIG quote is still withheld from settlement for a
  -- Baci booking; linking a waybill GIG billed directly would charge twice.
  IF v_order.shipping_funding_source = 'customer_checkout'
     OR COALESCE(v_order.shipping_platform_retained_amount, 0) > 0 THEN
    RAISE EXCEPTION 'checkout_shipping_retained' USING ERRCODE = 'P0001';
  END IF;

  IF v_order.shipment_booking_lock_token IS NOT NULL
     AND v_order.shipment_booking_started_at IS NOT NULL
     AND v_order.shipment_booking_started_at > pg_catalog.now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'active_shipment_booking_lock' USING ERRCODE = '55P03';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.merchant_shipping_charges AS charge
    WHERE charge.order_id = p_order_id
      AND charge.status IN (
        'reserved', 'provider_submitting', 'booked', 'needs_reconciliation'
      )
  ) THEN
    RAISE EXCEPTION 'active_merchant_shipping_charge' USING ERRCODE = '55P03';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.shipments AS shipment
    WHERE shipment.order_id = p_order_id
      AND shipment.status NOT IN ('cancelled', 'failed', 'returned')
  ) THEN
    RAISE EXCEPTION 'order_shipment_exists' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.shipments AS shipment
    WHERE shipment.provider = 'GIGL'
      AND pg_catalog.upper(pg_catalog.btrim(shipment.tracking_number))
        = pg_catalog.upper(v_waybill)
      AND shipment.status <> 'cancelled'
  ) OR EXISTS (
    -- Any merchant: GIG credentials are one shared Baci account.
    SELECT 1 FROM public.orders AS other_order
    WHERE other_order.id <> p_order_id
      AND pg_catalog.upper(pg_catalog.btrim(other_order.tracking_number))
        = pg_catalog.upper(v_waybill)
      -- A cancelled link releases the waybill, as the index does.
      AND NOT EXISTS (
        SELECT 1 FROM public.shipments AS released
        WHERE released.order_id = other_order.id
          AND released.provider = 'GIGL'
          AND released.status = 'cancelled'
          AND pg_catalog.upper(pg_catalog.btrim(released.tracking_number))
            = pg_catalog.upper(v_waybill)
      )
  ) THEN
    RAISE EXCEPTION 'waybill_already_linked' USING ERRCODE = '23505';
  END IF;

  BEGIN
    INSERT INTO public.shipments (
      order_id, merchant_id, provider, provider_shipment_id, tracking_number,
      carrier_name, status, sender_address, receiver_address, items, price,
      currency, is_station_pickup, station_address, provider_response,
      funding_source
    ) VALUES (
      p_order_id, v_order.merchant_id, 'GIGL', v_waybill, v_waybill,
      'GIG Logistics', 'booked', v_payload->'sender_address',
      v_payload->'receiver_address', '[]'::jsonb, v_price, 'NGN',
      COALESCE(v_payload->'is_station_pickup' = 'true'::jsonb, false),
      NULLIF(pg_catalog.btrim(COALESCE(v_payload->>'station_address', '')), ''),
      CASE WHEN pg_catalog.jsonb_typeof(v_payload->'provider_snapshot') = 'object'
        THEN v_payload->'provider_snapshot' ELSE '{}'::jsonb END,
      'external_manual'
    )
    RETURNING id INTO v_shipment_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'waybill_already_linked' USING ERRCODE = '23505';
  END;

  -- Rider details no longer describe how the order travels, and an unused
  -- Baci quote must not make the order look Baci- or wallet-funded. Same
  -- clearing as self-fulfilment; checkout-funded orders were refused above.
  UPDATE public.orders
  SET shipment_id = v_shipment_id,
      tracking_number = v_waybill,
      shipping_provider = 'GIGL',
      fulfillment_type = 'provider',
      self_fulfillment_data = NULL,
      selected_quote_id = NULL,
      shipping_funding_source = NULL,
      shipping_provider_cost = NULL,
      shipping_platform_margin = NULL,
      shipping_pricing_version = NULL,
      shipping_platform_retained_amount = 0,
      shipment_booking_lock_token = NULL,
      shipment_booking_started_at = NULL,
      shipping_status = 'shipped',
      updated_at = pg_catalog.now()
  WHERE id = p_order_id;

  RETURN v_shipment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.link_external_gigl_waybill(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_external_gigl_waybill(uuid, jsonb)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
