-- Close the remaining GIGL wallet boundary findings.
--
-- The authenticated quote RPCs are only callable from server code that has
-- received a provider response.  A short-lived HMAC proof binds that complete
-- response (including tariff, metadata, request, expiry, and identity) to the
-- order.  The existing `service_role_key` Vault secret is used only as an HMAC
-- key with a distinct domain/version; no service-role client is introduced on
-- a user route.

CREATE OR REPLACE FUNCTION private.verify_shipping_quote_route_proof(
  p_proof jsonb,
  p_action text,
  p_subject_id uuid,
  p_merchant_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret text;
  v_payload_text text;
  v_canonical text;
  v_expected text;
  v_issued_at timestamptz;
  v_signature text := COALESCE(p_proof->>'signature', '');
BEGIN
  IF p_proof IS NULL
     OR p_action IS NULL OR p_subject_id IS NULL OR p_merchant_id IS NULL
     OR p_proof->>'version' <> 'baci-shipping-quote-proof:v1'
     OR p_proof->>'action' <> p_action
     OR p_proof->>'subject_id' <> p_subject_id::text
     OR p_proof->>'merchant_id' <> p_merchant_id::text
     OR p_proof->>'issued_at' IS NULL
     OR pg_catalog.btrim(p_proof->>'issued_at') = ''
     OR p_proof->>'payload_text' IS NULL
     OR v_signature !~ '^[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;
  BEGIN
    v_issued_at := (p_proof->>'issued_at')::timestamptz;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;
  IF v_issued_at IS NULL
     OR v_issued_at < pg_catalog.now() - interval '5 minutes'
     OR v_issued_at > pg_catalog.now() + interval '30 seconds' THEN
    RETURN false;
  END IF;
  -- Sign the exact JSON text emitted by the server. This avoids cross-runtime
  -- JSON canonicalization differences and prevents payload substitution.
  v_payload_text := p_proof->>'payload_text';
  BEGIN
    PERFORM v_payload_text::jsonb;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;
  v_canonical := 'baci:shipping-quote-rpc:v1' || E'\n'
    || p_proof->>'version' || E'\n' || p_action || E'\n'
    || p_subject_id::text || E'\n' || p_merchant_id::text || E'\n'
    || p_proof->>'issued_at' || E'\n' || v_payload_text;
  IF pg_catalog.to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1'
      INTO v_secret USING 'service_role_key';
  END IF;
  IF v_secret IS NULL OR pg_catalog.btrim(v_secret) = '' THEN RETURN false; END IF;
  v_expected := pg_catalog.encode(extensions.hmac(v_canonical, v_secret, 'sha256'), 'hex');
  RETURN COALESCE(
    pg_catalog.encode(extensions.digest(v_signature, 'sha256'), 'hex')
      = pg_catalog.encode(extensions.digest(v_expected, 'sha256'), 'hex'),
    false
  );
END;
$$;

REVOKE ALL ON FUNCTION private.verify_shipping_quote_route_proof(jsonb, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- Remove the unproved authenticated overloads.  The wrappers below are the
-- only browser-callable entry points and require the signed complete payload.
REVOKE ALL ON FUNCTION public.persist_authenticated_admin_gigl_quote(jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.persist_refreshed_order_shipping_quote(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.persist_authenticated_admin_gigl_quote(
  p_quote jsonb,
  p_attestation jsonb,
  p_route_proof jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_order_id uuid := (p_attestation->>'order_id')::uuid;
  v_merchant_id uuid := (p_attestation->>'merchant_id')::uuid;
  v_payload jsonb;
BEGIN
  IF private.verify_shipping_quote_route_proof(
    p_route_proof, 'persist_authenticated_admin_gigl_quote',
    v_order_id, v_merchant_id
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'invalid_shipping_quote_route_proof' USING ERRCODE = '42501';
  END IF;
  BEGIN
    v_payload := (p_route_proof->>'payload_text')::jsonb;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'invalid_shipping_quote_route_proof' USING ERRCODE = '42501';
  END;
  IF v_payload IS DISTINCT FROM
      jsonb_build_object('quote', p_quote, 'attestation', p_attestation) THEN
    RAISE EXCEPTION 'invalid_shipping_quote_route_proof' USING ERRCODE = '42501';
  END IF;
  RETURN public.persist_authenticated_admin_gigl_quote(p_quote, p_attestation);
END;
$$;

CREATE OR REPLACE FUNCTION public.persist_refreshed_order_shipping_quote(
  p_order_id uuid,
  p_quote jsonb,
  p_route_proof jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_merchant_id uuid;
  v_quote_id uuid;
  v_provider text;
  v_expires timestamptz;
  v_request jsonb;
  v_payload jsonb;
BEGIN
  SELECT merchant_id INTO v_merchant_id
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;
  IF v_merchant_id IS NULL THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = '22023';
  END IF;
  IF private.verify_shipping_quote_route_proof(
    p_route_proof, 'persist_refreshed_order_shipping_quote',
    p_order_id, v_merchant_id
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'invalid_shipping_quote_route_proof' USING ERRCODE = '42501';
  END IF;
  BEGIN
    v_payload := (p_route_proof->>'payload_text')::jsonb;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'invalid_shipping_quote_route_proof' USING ERRCODE = '42501';
  END;
  IF v_payload IS DISTINCT FROM
      jsonb_build_object('order_id', p_order_id, 'quote', p_quote) THEN
    RAISE EXCEPTION 'invalid_shipping_quote_route_proof' USING ERRCODE = '42501';
  END IF;

  -- Preserve the existing canonical GIGL economics validation. TOPSHIP has no
  -- platform-margin tariff, but still uses this proof-bound order writer so
  -- provider metadata cannot be forged through an authenticated table write.
  IF p_quote->>'provider' = 'GIGL' THEN
    RETURN public.persist_refreshed_order_shipping_quote(p_order_id, p_quote);
  END IF;
  IF p_quote->>'provider' IS DISTINCT FROM 'TOPSHIP'
     OR NOT public.check_staff_permission(
       auth.uid(), v_merchant_id, 'orders', 'fulfill'
     ) AND NOT public.check_staff_permission(
       auth.uid(), v_merchant_id, 'orders', 'edit'
     ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.orders AS order_record
    WHERE order_record.id = p_order_id
      AND order_record.merchant_id = v_merchant_id
      AND order_record.shipment_id IS NULL
      AND order_record.tracking_number IS NULL
      AND order_record.cancelled_at IS NULL
      AND lower(COALESCE(order_record.shipping_status, '')) = 'processing'
  ) THEN
    RAISE EXCEPTION 'order_not_found_or_already_booked' USING ERRCODE = '22023';
  END IF;
  v_quote_id := (p_quote->>'id')::uuid;
  v_provider := p_quote->>'provider';
  v_expires := (p_quote->>'expires_at')::timestamptz;
  v_request := p_quote->'quote_request';
  IF v_quote_id IS NULL
     OR p_quote->>'merchant_id' <> v_merchant_id::text
     OR btrim(COALESCE(p_quote->>'session_id', '')) = ''
     OR btrim(COALESCE(p_quote->>'currency', '')) = ''
     OR v_expires IS NULL OR v_expires <= pg_catalog.now()
     OR v_request IS NULL OR v_request = 'null'::jsonb
     OR (p_quote->>'price')::numeric IS NULL
     OR (p_quote->>'price')::numeric <= 0 THEN
    RAISE EXCEPTION 'invalid_refreshed_quote' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.shipping_quote_attestations AS attestation
    WHERE attestation.quote_id = v_quote_id
  ) THEN
    RAISE EXCEPTION 'attested_shipping_quote_immutable' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.shipping_quotes (
    id, merchant_id, session_id, provider, service_tier, carrier_name, price,
    currency, estimated_days, min_days, max_days, pickup_included,
    insurance_included, is_station_pickup, station_name, station_address,
    provider_rate_id, provider_metadata, expires_at, quote_request
  ) VALUES (
    v_quote_id, v_merchant_id, p_quote->>'session_id', v_provider,
    p_quote->>'service_tier', p_quote->>'carrier_name',
    (p_quote->>'price')::numeric, p_quote->>'currency',
    NULLIF(p_quote->>'estimated_days', '')::integer,
    NULLIF(p_quote->>'min_days', '')::integer,
    NULLIF(p_quote->>'max_days', '')::integer,
    COALESCE((p_quote->>'pickup_included')::boolean, false),
    COALESCE((p_quote->>'insurance_included')::boolean, false),
    COALESCE((p_quote->>'is_station_pickup')::boolean, false),
    p_quote->>'station_name', p_quote->>'station_address',
    p_quote->>'provider_rate_id', p_quote->'provider_metadata',
    v_expires, v_request
  )
  ON CONFLICT (id) DO UPDATE SET
    session_id = EXCLUDED.session_id,
    provider = EXCLUDED.provider,
    service_tier = EXCLUDED.service_tier,
    carrier_name = EXCLUDED.carrier_name,
    price = EXCLUDED.price,
    currency = EXCLUDED.currency,
    estimated_days = EXCLUDED.estimated_days,
    min_days = EXCLUDED.min_days,
    max_days = EXCLUDED.max_days,
    pickup_included = EXCLUDED.pickup_included,
    insurance_included = EXCLUDED.insurance_included,
    is_station_pickup = EXCLUDED.is_station_pickup,
    station_name = EXCLUDED.station_name,
    station_address = EXCLUDED.station_address,
    provider_rate_id = EXCLUDED.provider_rate_id,
    provider_metadata = EXCLUDED.provider_metadata,
    expires_at = EXCLUDED.expires_at,
    quote_request = EXCLUDED.quote_request
  WHERE public.shipping_quotes.merchant_id = v_merchant_id
    AND public.shipping_quotes.session_id = p_order_id::text
  RETURNING id INTO v_quote_id;
  IF v_quote_id IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN v_quote_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.persist_authenticated_admin_gigl_quote(jsonb, jsonb, jsonb)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.persist_refreshed_order_shipping_quote(uuid, jsonb, jsonb)
  TO authenticated;

-- Reassert the authenticated quote projection after removing the historical
-- table-wide SELECT grant. Internal economics and raw provider metadata are
-- available only through the purpose-built SECURITY DEFINER projections.
REVOKE SELECT ON TABLE public.shipping_quotes FROM authenticated;
REVOKE INSERT, UPDATE ON TABLE public.shipping_quotes FROM authenticated;
GRANT UPDATE (used) ON TABLE public.shipping_quotes TO authenticated;
GRANT SELECT (
  id, merchant_id, session_id, provider, service_tier, carrier_name, price,
  currency, estimated_days, min_days, max_days, pickup_included,
  insurance_included, provider_rate_id, is_station_pickup, station_name,
  station_address, quote_request, used, expires_at, created_at
) ON TABLE public.shipping_quotes TO authenticated;

-- PostgreSQL table privileges are additive: remove the baseline table-wide
-- grant before allowing only the columns the authenticated booking writer can
-- supply.  Economics are populated by the trigger below, never by the client.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.shipments FROM authenticated;
GRANT INSERT (
  id, order_id, merchant_id, provider, provider_shipment_id, tracking_number,
  carrier_name, service_tier, price, currency, status,
  estimated_delivery_days, estimated_delivery_at, delivered_at, cancelled_at,
  label_url, pickup_scheduled_at, current_location, tracking_events,
  last_tracked_at, refund_amount, is_station_pickup, station_name,
  station_address, sender_address, receiver_address, items, provider_response,
  shipping_quote_id, tracking_snapshot_version, tracking_timeline_generation,
  created_at, updated_at
) ON TABLE public.shipments TO authenticated;
GRANT UPDATE (
  provider_shipment_id, tracking_number, status, estimated_delivery_days,
  estimated_delivery_at, delivered_at, cancelled_at, label_url,
  pickup_scheduled_at, current_location, tracking_events, last_tracked_at,
  refund_amount, provider_response, tracking_snapshot_version,
  tracking_timeline_generation, updated_at
) ON TABLE public.shipments TO authenticated;

DROP POLICY IF EXISTS "Staff can insert shipments" ON public.shipments;
CREATE POLICY "Staff can insert shipments" ON public.shipments
  FOR INSERT WITH CHECK (
    merchant_id IN (
      SELECT merchant.id FROM public.merchants AS merchant
      WHERE merchant.user_id = (SELECT auth.uid())
    ) OR public.check_staff_permission(
      (SELECT auth.uid()), merchant_id, 'orders', 'fulfill'
    ) OR public.check_staff_permission(
      (SELECT auth.uid()), merchant_id, 'orders', 'edit'
    )
  );

CREATE OR REPLACE FUNCTION private.stamp_gigl_shipment_economics()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_provider_cost numeric;
  v_platform_margin numeric;
BEGIN
  IF NEW.provider = 'GIGL' AND NEW.order_id IS NOT NULL THEN
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
DROP TRIGGER IF EXISTS stamp_gigl_shipment_economics ON public.shipments;
CREATE TRIGGER stamp_gigl_shipment_economics
  BEFORE INSERT ON public.shipments FOR EACH ROW
  EXECUTE FUNCTION private.stamp_gigl_shipment_economics();

COMMENT ON FUNCTION private.verify_shipping_quote_route_proof(jsonb, text, uuid, uuid)
  IS 'Domain-separated HMAC boundary for provider quote writes; proof payload is server-created and expires quickly.';
