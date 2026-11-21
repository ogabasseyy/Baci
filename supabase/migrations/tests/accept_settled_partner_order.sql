-- Disposable partner admission database. Uses the writer contract fixture to
-- verify the boundary transaction separately from full storefront replay.
BEGIN;

INSERT INTO public.merchants (id) VALUES ('10000000-0000-4000-8000-000000000001');
INSERT INTO public.partner_writer_fixture_products (id, base_price, stock) VALUES
  ('40000000-0000-4000-8000-000000000001', 100, 10),
  ('40000000-0000-4000-8000-000000000002', 100.25, 10);

INSERT INTO private.partner_delivery_quotes (id, merchant_id, connection_id, created_at, expires_at, snapshot)
SELECT format('20000000-0000-4000-8000-00000000000%s', n)::uuid,
  '10000000-0000-4000-8000-000000000001', 'fixture-connection',
  now() - interval '20 minutes', now() - interval '10 minutes',
  jsonb_build_object(
    'currency', 'NGN', 'settlement_basis', 'base_plus_delivery', 'merchant_payable_minor', 170000,
    'delivery_minor', 150000, 'tax_minor', 0, 'total_minor', 171200, 'service', 'Standard',
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', format('40000000-0000-4000-8000-00000000000%s', least(n, 2)),
      'condition', 'new', 'quantity', 2, 'base_unit_price_minor', 10000
    )),
    'carrier_quote', '{"quote_request":{"receiver":{"address":"1 Fixture Road","city":"Ikeja","state":"Lagos","countryCode":"NG"}}}'::jsonb
  )
FROM generate_series(1, 3) AS n;

INSERT INTO private.partner_order_submissions (
  id, merchant_id, connection_id, quote_id, partner_order_id, idempotency_hash, submission
)
SELECT format('30000000-0000-4000-8000-00000000000%s', n)::uuid,
  '10000000-0000-4000-8000-000000000001', 'fixture-connection',
  format('20000000-0000-4000-8000-00000000000%s', n)::uuid, 'external-' || n,
  repeat(n::text, 64),
  '{"recipient":{"name":"Fixture Recipient","email":"recipient@example.invalid","phone":"+2348000000000"}}'
FROM generate_series(1, 3) AS n;

INSERT INTO private.partner_payment_captures (
  submission_id, source, provider_account, payment_reference, amount_minor, currency, captured_at
)
SELECT format('30000000-0000-4000-8000-00000000000%s', n)::uuid,
  'buyer-provider', 'buyer-account', 'capture-' || n, 171200, 'NGN', now() - interval '15 minutes'
FROM generate_series(1, 3) AS n;

INSERT INTO private.partner_order_settlements (
  submission_id, source, settlement_account, payout_reference, allocation_reference,
  amount_minor, currency, settled_at
)
SELECT format('30000000-0000-4000-8000-00000000000%s', n)::uuid,
  'settlement-provider', 'merchant-account', 'payout-001', 'allocation-' || n,
  170000, 'NGN', now() - interval '5 minutes'
FROM generate_series(1, 2) AS n;

CREATE FUNCTION pg_temp.accept_order(n integer, connection text DEFAULT 'fixture-connection')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT private.accept_settled_partner_order(
    format('30000000-0000-4000-8000-00000000000%s', n)::uuid,
    '10000000-0000-4000-8000-000000000001',
    connection
  );
$$;

CREATE FUNCTION pg_temp.read_tracking(order_id uuid, connection_id text)
RETURNS jsonb LANGUAGE sql AS $$
  WITH parameters AS (
    SELECT '10000000-0000-4000-8000-000000000001'::uuid AS merchant_id,
      now()::text AS issued_at,
      jsonb_build_object('connection_id', connection_id)::text AS payload
  )
  SELECT public.read_partner_order_tracking(merchant_id, order_id, connection_id,
    jsonb_build_object(
      'version', 'baci-shipping-quote-proof:v1',
      'action', 'read_partner_order_tracking',
      'merchant_id', merchant_id,
      'subject_id', order_id,
      'issued_at', issued_at,
      'payload_text', payload,
      'signature', encode(extensions.hmac(concat_ws(E'\n',
        'baci:shipping-quote-rpc:v1', 'baci-shipping-quote-proof:v1',
        'read_partner_order_tracking', order_id, merchant_id, issued_at, payload
      ), 'fixture-partner-quote-proof-secret', 'sha256'), 'hex')
    )
  ) FROM parameters;
$$;

DO $$
DECLARE
  receipt jsonb;
  accepted_order_id uuid;
  wallet_quote constant uuid := '50000000-0000-4000-8000-000000000001';
  expensive_quote constant uuid := '50000000-0000-4000-8000-000000000002';
  unattested_quote constant uuid := '50000000-0000-4000-8000-000000000003';
BEGIN
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS role
    WHERE has_function_privilege(role, 'private.accept_settled_partner_order(uuid,uuid,text)', 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'untrusted role can accept partner order';
  END IF;

  BEGIN
    PERFORM pg_temp.accept_order(1, 'other-connection');
    RAISE EXCEPTION 'order acceptance crossed connection boundary';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;

  BEGIN
    PERFORM pg_temp.accept_order(3);
    RAISE EXCEPTION 'verified capture without settlement created an order';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  receipt := pg_temp.accept_order(1);
  accepted_order_id := (receipt->>'order_id')::uuid;
  IF receipt->>'status' IS DISTINCT FROM 'accepted'
     OR receipt IS DISTINCT FROM pg_temp.accept_order(1)
     OR NOT EXISTS (
       SELECT 1 FROM public.orders AS o WHERE o.id = accepted_order_id
         AND o.payment_status = 'paid' AND o.amount_paid = 1700
         AND o.selected_quote_id IS NULL AND o.shipping_funding_source IS NULL
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.transactions AS t WHERE t.order_id = accepted_order_id
         AND t.amount = 1700 AND t.gateway = 'partner_settlement' AND t.status = 'completed'
     ) THEN
    RAISE EXCEPTION 'acceptance failed to publish one paid order without shipping entitlement';
  END IF;

  IF pg_temp.read_tracking(accepted_order_id, 'fixture-connection')->'tracking'
       IS DISTINCT FROM 'null'::jsonb
     OR pg_temp.read_tracking(accepted_order_id, 'other-connection') IS NOT NULL THEN
    RAISE EXCEPTION 'unbooked or cross-connection order leaked tracking';
  END IF;

  INSERT INTO public.shipping_quotes (
    id, merchant_id, provider, currency, session_id, expires_at,
    used, is_station_pickup, price, provider_rate_id, quote_request, service_tier
  )
  SELECT id, '10000000-0000-4000-8000-000000000001', 'GIGL', 'NGN', accepted_order_id::text,
    now() + interval '5 minutes', false, false, fee, 'fixture-rate',
    '{"shipmentType":"domestic","admin_order_provenance":"server_gigl_v1"}', 'Standard'
  FROM (VALUES (wallet_quote, 1500), (expensive_quote, 1501), (unattested_quote, 1500)) AS f(id, fee);

  INSERT INTO public.shipping_quote_attestations (
    quote_id, merchant_id, order_id, price, currency, provider_rate_id, quote_request, expires_at
  )
  SELECT id, merchant_id, accepted_order_id, price, currency, provider_rate_id, quote_request, expires_at
  FROM public.shipping_quotes WHERE id IN (wallet_quote, expensive_quote);

  BEGIN
    UPDATE public.orders SET selected_quote_id = wallet_quote, shipping_provider = 'GIGL',
      shipping_funding_source = 'customer_checkout' WHERE id = accepted_order_id;
    RAISE EXCEPTION 'incorrectly treated external settlement as checkout shipping retention' USING ERRCODE = '22023';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'partner_shipping_requires_merchant_wallet' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.orders SET selected_quote_id = expensive_quote, shipping_provider = 'GIGL',
      shipping_funding_source = 'merchant_wallet' WHERE id = accepted_order_id;
    RAISE EXCEPTION 'carrier price drift was not held' USING ERRCODE = '22023';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'partner_delivery_price_changed' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.orders SET selected_quote_id = unattested_quote, shipping_provider = 'GIGL',
      shipping_funding_source = 'merchant_wallet' WHERE id = accepted_order_id;
    RAISE EXCEPTION 'unattested quote was accepted' USING ERRCODE = '22023';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'partner_shipping_quote_invalid' THEN RAISE; END IF;
  END;

  UPDATE public.orders SET selected_quote_id = wallet_quote, shipping_provider = 'GIGL',
    shipping_funding_source = 'merchant_wallet' WHERE id = accepted_order_id;

  UPDATE public.orders SET shipping_status = 'shipped', shipping_provider = 'GIGL',
    tracking_number = 'TEST-WAYBILL' WHERE id = accepted_order_id;
  IF pg_temp.read_tracking(accepted_order_id, 'fixture-connection')->'tracking'
       IS DISTINCT FROM '{"provider":"GIGL","tracking_number":"TEST-WAYBILL"}'::jsonb THEN
    RAISE EXCEPTION 'partner did not receive updated tracking';
  END IF;

  -- The underlying writer permits up to NGN 1 of total drift. Partner
  -- acceptance must still roll back its order and inventory mutation.
  BEGIN
    PERFORM pg_temp.accept_order(2);
    RAISE EXCEPTION 'repriced line accepted against the old settled quote';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  IF (SELECT count(*) FROM public.orders) <> 1
     OR (SELECT count(*) FROM public.transactions) <> 1
     OR (SELECT stock FROM public.partner_writer_fixture_products
         WHERE id = '40000000-0000-4000-8000-000000000001') <> 8
     OR (SELECT stock FROM public.partner_writer_fixture_products
         WHERE id = '40000000-0000-4000-8000-000000000002') <> 10 THEN
    RAISE EXCEPTION 'replay or rejection changed order, ledger, or inventory more than once';
  END IF;
END;
$$;

ROLLBACK;
