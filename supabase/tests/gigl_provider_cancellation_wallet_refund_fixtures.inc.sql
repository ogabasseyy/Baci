-- Fixtures for gigl_provider_cancellation_wallet_refund.sql (\ir part).
-- Runs on the replay connection's postgres role with the service_role claim.
-- now() is fixed for the whole transaction, so every seeded charge began its
-- provider submission at now(); GIG events near now() fall inside that
-- submission's window and events hours earlier predate it.
-- Fixture ids: c4ce1<kind>00-0000-4000-8000-<n>, kind 2 order, 3 quote,
-- 4 shipment, 5 charge, 6 debit. Order n ships waybill WB-CANCEL-<n>.

CREATE FUNCTION pg_temp.fixture_id(p_kind integer, p_n integer)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT pg_catalog.format(
    'c4ce1%s00-0000-4000-8000-%s', p_kind, pg_catalog.lpad(p_n::text, 12, '0')
  )::uuid
$$;

CREATE FUNCTION pg_temp.wallet_balance()
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT wallet.available_balance
  FROM public.merchant_wallets AS wallet
  WHERE wallet.merchant_id = 'c4ce1100-0000-4000-8000-000000000001'
$$;

CREATE FUNCTION pg_temp.refund_count(p_n integer)
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
  SELECT count(*)
  FROM public.wallet_transactions AS refund
  WHERE refund.type = 'refund'
    AND refund.source_type = 'gigl_shipping'
    AND refund.source_id = pg_temp.fixture_id(2, p_n)
$$;

-- One GIGL order with an attested quote and a booked GIGL shipment. A wallet
-- order (p_charge_status 'provider_submitting' or 'booked') also gets the
-- debit and the charge; 'booked' binds the charge to the shipment, which
-- stamps the waybill. The shipment's monitor is leased to 'worker-test'.
CREATE FUNCTION pg_temp.seed_gigl_order(
  p_n integer,
  p_shipping_status text,
  p_charge_status text
)
RETURNS void
LANGUAGE plpgsql
AS $seed$
DECLARE
  v_merchant constant uuid := 'c4ce1100-0000-4000-8000-000000000001';
  v_order constant uuid := pg_temp.fixture_id(2, p_n);
  v_quote constant uuid := pg_temp.fixture_id(3, p_n);
  v_shipment constant uuid := pg_temp.fixture_id(4, p_n);
  v_charge constant uuid := pg_temp.fixture_id(5, p_n);
  v_debit constant uuid := pg_temp.fixture_id(6, p_n);
  v_waybill constant text := 'WB-CANCEL-' || p_n;
  v_wallet uuid;
  v_balance numeric;
BEGIN
  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid, payment_status,
    shipping_status
  ) VALUES (
    v_order, v_merchant, 'GIGL-CANCEL-REFUND-' || p_n, 150000, 150000, 'paid',
    p_shipping_status
  );
  INSERT INTO public.shipping_quotes (
    id, merchant_id, session_id, provider, service_tier, carrier_name, price,
    provider_cost, platform_margin, pricing_version, currency,
    is_station_pickup, provider_rate_id, expires_at, quote_request
  ) VALUES (
    v_quote, v_merchant, v_order::text, 'GIGL', 'standard', 'GIG Logistics',
    48500.40, 44091.27, 4409.13, 'gigl_platform_margin_v1', 'NGN', false,
    'rate-' || p_n, now() + interval '1 hour', jsonb_build_object('fixture', p_n)
  );
  INSERT INTO public.shipping_quote_attestations (
    quote_id, order_id, merchant_id, price, provider_cost, platform_margin,
    currency, pricing_version, expires_at, is_station_pickup,
    provider_rate_id, quote_request
  )
  SELECT quote.id, v_order, quote.merchant_id, quote.price,
    quote.provider_cost, quote.platform_margin, quote.currency,
    quote.pricing_version, quote.expires_at, quote.is_station_pickup,
    quote.provider_rate_id, quote.quote_request
  FROM public.shipping_quotes AS quote
  WHERE quote.id = v_quote;
  UPDATE public.orders
  SET selected_quote_id = v_quote,
      shipping_funding_source = CASE
        WHEN p_charge_status = 'none' THEN 'customer_checkout'
        ELSE 'merchant_wallet'
      END
  WHERE id = v_order;

  IF p_charge_status <> 'none' THEN
    UPDATE public.merchant_wallets AS wallet
    SET available_balance = wallet.available_balance - 48500.40,
        updated_at = now()
    WHERE wallet.merchant_id = v_merchant
    RETURNING wallet.id, wallet.available_balance INTO v_wallet, v_balance;
    INSERT INTO public.wallet_transactions (
      id, wallet_id, merchant_id, type, amount, balance_after, source_type,
      source_id, description, status
    ) VALUES (
      v_debit, v_wallet, v_merchant, 'debit', 48500.40, v_balance,
      'gigl_shipping', v_order, 'GIGL shipping reservation', 'completed'
    );
    INSERT INTO public.merchant_shipping_charges (
      id, merchant_id, order_id, shipping_quote_id, status, currency,
      charged_amount, provider_cost, platform_margin, attempt_token_digest,
      debit_transaction_id, provider_submitting_at
    ) VALUES (
      v_charge, v_merchant, v_order, v_quote, 'provider_submitting', 'NGN',
      48500.40, 44091.27, 4409.13,
      pg_catalog.encode(extensions.digest('attempt-' || p_n, 'sha256'), 'hex'),
      v_debit, now()
    );
  END IF;

  INSERT INTO public.shipments (
    id, order_id, merchant_id, provider, status, tracking_number,
    provider_shipment_id, shipping_quote_id, sender_address,
    receiver_address, items
  ) VALUES (
    v_shipment, v_order, v_merchant, 'GIGL', 'booked', v_waybill, v_waybill,
    v_quote, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb
  );
  IF p_charge_status = 'booked' THEN
    UPDATE public.merchant_shipping_charges
    SET status = 'booked', shipment_id = v_shipment,
        completed_at = now(), updated_at = now()
    WHERE id = v_charge;
  END IF;
  UPDATE public.orders SET shipment_id = v_shipment WHERE id = v_order;
  UPDATE public.shipment_tracking_monitors
  SET locked_by = 'worker-test', locked_at = now()
  WHERE shipment_id = v_shipment;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fixture %: the GIGL shipment must enroll a monitor', p_n;
  END IF;
END;
$seed$;

-- One GIG tracking event as the worker sends it.
CREATE FUNCTION pg_temp.gig_event(
  p_key text,
  p_raw_status text,
  p_status text,
  p_occurred_at timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'provider_event_key', p_key,
    'raw_status', p_raw_status,
    'normalized_status', p_status,
    'description', 'GIG reported ' || p_raw_status,
    'occurred_at', p_occurred_at
  )
$$;

-- GIG's full history for a waybill this order's submission created (MCRT at
-- the submission time, now() in this transaction) and later cancelled.
CREATE FUNCTION pg_temp.fresh_cancel_history(p_n integer, p_cancel_raw text)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_array(
    pg_temp.gig_event('MCRT:' || p_n, 'MCRT', 'booked', now()),
    pg_temp.gig_event(
      p_cancel_raw || ':' || p_n, p_cancel_raw, 'cancelled',
      now() + interval '2 minutes'
    )
  )
$$;

-- The worker's real entry point: gigl_worker_apply_tracking_result elevates
-- to service_role and calls apply_gigl_tracking_result with the lease.
CREATE FUNCTION pg_temp.apply_gig_events(
  p_shipment uuid,
  p_status text,
  p_events jsonb
)
RETURNS boolean
LANGUAGE plpgsql
AS $apply$
DECLARE
  v_epoch uuid;
  v_applied boolean;
BEGIN
  SELECT monitor.tracking_epoch_id INTO v_epoch
  FROM public.shipment_tracking_monitors AS monitor
  WHERE monitor.shipment_id = p_shipment;
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.role', 'gigl_tracking_worker', true
  );
  v_applied := public.gigl_worker_apply_tracking_result(
    p_shipment, v_epoch, 'worker-test', p_status, NULL, NULL, p_events
  );
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  RETURN v_applied;
END;
$apply$;

CREATE FUNCTION pg_temp.apply_gig_status(
  p_shipment uuid,
  p_status text,
  p_raw_status text,
  p_event_key text,
  p_occurred_at timestamptz
)
RETURNS boolean
LANGUAGE sql
AS $$
  SELECT pg_temp.apply_gig_events(
    p_shipment, p_status,
    jsonb_build_array(
      pg_temp.gig_event(p_event_key, p_raw_status, p_status, p_occurred_at)
    )
  )
$$;

-- Leases the shipment's current monitor to 'worker-test' again.
CREATE FUNCTION pg_temp.lease_monitor(p_shipment uuid)
RETURNS void
LANGUAGE plpgsql
AS $lease$
BEGIN
  UPDATE public.shipment_tracking_monitors
  SET locked_by = 'worker-test', locked_at = now()
  WHERE shipment_id = p_shipment;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shipment % has no tracking monitor', p_shipment;
  END IF;
END;
$lease$;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES
  ('c4ce1000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'gigl-cancel-refund-owner@example.test', 'test', now(), now(), now(),
    '{}'::jsonb, '{}'::jsonb),
  ('c4ce1000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'gigl-cancel-refund-staff@example.test', 'test', now(), now(), now(),
    '{}'::jsonb, '{}'::jsonb);

INSERT INTO public.merchants (id, user_id, email, business_name, slug)
VALUES (
  'c4ce1100-0000-4000-8000-000000000001',
  'c4ce1000-0000-4000-8000-000000000001',
  'gigl-cancel-refund-owner@example.test',
  'GIGL Cancel Refund Fixture',
  'gigl-cancel-refund-fixture'
);

INSERT INTO public.staff_members (
  merchant_id, user_id, email, name, role, permissions, status
) VALUES (
  'c4ce1100-0000-4000-8000-000000000001',
  'c4ce1000-0000-4000-8000-000000000002',
  'gigl-cancel-refund-staff@example.test', 'GIGL Cancel Refund Staff',
  'accountant', '{"orders":{"view":true,"edit":true}}'::jsonb, 'active'
);

INSERT INTO public.merchant_wallets (merchant_id, available_balance)
VALUES ('c4ce1100-0000-4000-8000-000000000001', 1000000.00);

DO $seed_orders$
BEGIN
  PERFORM pg_temp.seed_gigl_order(1, 'shipped', 'booked');     -- T1-T3
  PERFORM pg_temp.seed_gigl_order(4, 'processing', 'booked');  -- T4
  PERFORM pg_temp.seed_gigl_order(5, 'shipped', 'booked');     -- T5
  PERFORM pg_temp.seed_gigl_order(6, 'shipped', 'booked');     -- T6
  PERFORM pg_temp.seed_gigl_order(7, 'shipped', 'none');       -- T7
  PERFORM pg_temp.seed_gigl_order(8, 'shipped', 'provider_submitting'); -- T8
  PERFORM pg_temp.seed_gigl_order(10, 'shipped', 'booked');    -- T10
  PERFORM pg_temp.seed_gigl_order(11, 'shipped', 'booked');    -- T11
  PERFORM pg_temp.seed_gigl_order(12, 'shipped', 'booked');    -- T12
  PERFORM pg_temp.seed_gigl_order(13, 'shipped', 'provider_submitting'); -- T13
  PERFORM pg_temp.seed_gigl_order(14, 'shipped', 'provider_submitting'); -- T14
  PERFORM pg_temp.seed_gigl_order(15, 'shipped', 'booked');    -- T15
  PERFORM pg_temp.seed_gigl_order(16, 'shipped', 'booked');    -- T16
END;
$seed_orders$;
