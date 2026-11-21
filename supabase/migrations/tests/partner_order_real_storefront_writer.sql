-- Runs after the real schema replay, including storefront order and inventory
-- writers. All changes are rolled back. No provider credentials are needed.
BEGIN;

-- The full schema requires an audit actor for merchant fixture writes.
-- Keep the fixture seed claim out of the order writer checks below.
SET LOCAL request.jwt.claim.role = 'service_role';

INSERT INTO public.merchants (
  id, email, business_name, slug, is_published, payout_currency, vat_registration_status
) VALUES (
  '7a100000-0000-4000-8000-000000000001', 'partner-replay@example.invalid',
  'Partner Replay Merchant', 'partner-replay-fixture', true, 'NGN', 'registered'
);

INSERT INTO public.products (
  id, merchant_id, name, price, stock_quantity, manage_stock, status,
  condition, has_condition_offers, has_variants, vat_category_code, vat_rate
) VALUES
  ('7a100000-0000-4000-8000-000000000011', '7a100000-0000-4000-8000-000000000001',
   'Fixture new phone', 100, 10, true, 'active', 'new', false, false, 'S', 7.5),
  ('7a100000-0000-4000-8000-000000000012', '7a100000-0000-4000-8000-000000000001',
   'Fixture used tablet', 150, 10, false, 'active', 'used', true, false, 'Z', 0);

INSERT INTO public.product_offers (
  id, product_id, merchant_id, condition, price, status, stock_quantity
) VALUES (
  '7a100000-0000-4000-8000-000000000021', '7a100000-0000-4000-8000-000000000012',
  '7a100000-0000-4000-8000-000000000001', 'used', 100, 'active', 5
);

SET LOCAL request.jwt.claim.role = '';

DO $$
<<fixture>>
DECLARE
  merchant_id constant uuid := '7a100000-0000-4000-8000-000000000001';
  product_id constant uuid := '7a100000-0000-4000-8000-000000000011';
  offer_product_id constant uuid := '7a100000-0000-4000-8000-000000000012';
  offer_id constant uuid := '7a100000-0000-4000-8000-000000000021';
  quote_id constant uuid := '7a100000-0000-4000-8000-000000000031';
  shipping_quote_id constant uuid := '7a100000-0000-4000-8000-000000000033';
  submission_id constant uuid := '7a100000-0000-4000-8000-000000000041';
  connection_id constant text := 'partner-real-writer';
  receiver constant jsonb := '{"address":"1 Fixture Road","city":"Ikeja","state":"Lagos","country":"Nigeria","countryCode":"NG"}';
  receipt jsonb;
  accepted_id uuid;
  expired_submissions bigint;
  expected_job record;
  existing_job_id bigint;
  n integer;
BEGIN
  FOR n IN 1..2 LOOP
    INSERT INTO private.partner_delivery_quotes (id, merchant_id, connection_id, created_at, expires_at, snapshot)
    VALUES (
      CASE WHEN n = 1 THEN quote_id ELSE '7a100000-0000-4000-8000-000000000032'::uuid END,
      merchant_id, connection_id, now() - interval '5 minutes', now() + interval '5 minutes',
      jsonb_build_object(
        'currency', 'NGN', 'settlement_basis', 'base_plus_delivery', 'merchant_payable_minor', 181500,
        'delivery_minor', 150000, 'tax_minor', 1500, 'total_minor', 183300,
        'items', jsonb_build_array(
          jsonb_build_object('product_id', product_id, 'condition', 'new', 'quantity', 2, 'base_unit_price_minor', 10000),
          jsonb_build_object('product_id', offer_product_id, 'offer_id', offer_id,
            'condition', 'used', 'quantity', 1, 'base_unit_price_minor', 10000)
        ),
        'carrier_quote', jsonb_build_object('quote_request', jsonb_build_object('receiver', receiver))
      )
    );

    INSERT INTO private.partner_order_submissions (
      id, merchant_id, connection_id, quote_id, partner_order_id, idempotency_hash, submission
    ) VALUES (
      CASE WHEN n = 1 THEN submission_id ELSE '7a100000-0000-4000-8000-000000000042'::uuid END,
      merchant_id, connection_id,
      CASE WHEN n = 1 THEN quote_id ELSE '7a100000-0000-4000-8000-000000000032'::uuid END,
      'fixture-order-' || n, repeat(n::text, 64),
      jsonb_build_object(
        'recipient', '{"name":"Partner Replay Buyer","email":"partner-buyer@example.invalid","phone":"+2348000000000"}'::jsonb,
        'payment', jsonb_build_object('source', 'fixture', 'reference', 'capture-' || n, 'amount_minor', 183300, 'currency', 'NGN')
      )
    );

    PERFORM private.record_verified_partner_capture(
      CASE WHEN n = 1 THEN submission_id ELSE '7a100000-0000-4000-8000-000000000042'::uuid END,
      merchant_id, connection_id,
      CASE WHEN n = 1 THEN quote_id ELSE '7a100000-0000-4000-8000-000000000032'::uuid END,
      'fixture-order-' || n, 'fixture', 'partner-replay-provider', 'capture-' || n, 183300, 'NGN', now()
    );

    PERFORM private.record_verified_partner_settlement(
      CASE WHEN n = 1 THEN submission_id ELSE '7a100000-0000-4000-8000-000000000042'::uuid END,
      merchant_id, connection_id, 'fixture-payout', 'partner-replay-bank', 'payout-replay', 'allocation-' || n,
      181500, 'NGN', now()
    );
  END LOOP;

  BEGIN
    PERFORM private.record_verified_partner_capture(
      submission_id, merchant_id, connection_id, quote_id, 'fixture-order-1',
      'fixture', 'partner-replay-provider', 'capture-1', 183300, 'NGN',
      (SELECT s.received_at + interval '1 second'
       FROM private.partner_order_submissions AS s WHERE s.id = fixture.submission_id)
    );
    RAISE EXCEPTION 'after-receipt capture was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'partner_capture_timestamp_after_receipt' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE private.partner_payment_captures AS c SET currency = 'USD'
    WHERE c.submission_id = fixture.submission_id;
    RAISE EXCEPTION 'partner capture stored unsupported currency' USING ERRCODE = '22023';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    PERFORM private.accept_settled_partner_order(submission_id, merchant_id, connection_id);
    RAISE EXCEPTION 'unscoped partner acceptance bypassed the storefront order guard';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'storefront_order_route_context_required' THEN RAISE; END IF;
  END;

  -- Mirror the claims PostgREST receives from Baci's existing scoped signer.
  PERFORM pg_catalog.set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated',
    'storefront_order_context', 'route',
    'storefront_order_merchant_id', merchant_id
  )::text, true);

  -- Legacy feed stock can persist after the reservable quantity reaches zero.
  UPDATE public.products AS p SET stock = 10, stock_quantity = 0
  WHERE p.id = fixture.product_id;
  BEGIN
    PERFORM private.accept_settled_partner_order(submission_id, merchant_id, connection_id);
    RAISE EXCEPTION 'legacy stock was accepted as reservable inventory' USING ERRCODE = '22023';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'insufficient_stock' THEN RAISE; END IF;
  END;
  UPDATE public.products AS p SET stock = 0, stock_quantity = 10
  WHERE p.id = fixture.product_id;

  INSERT INTO public.shipping_quotes (
    id, merchant_id, provider, currency, session_id, expires_at, price
  ) VALUES (
    shipping_quote_id, merchant_id, 'GIGL', 'NGN', 'partner-insert-fixture',
    now() + interval '5 minutes', 1500
  );

  BEGIN
    INSERT INTO public.orders (
      merchant_id, order_number, source, total, selected_quote_id
    ) VALUES (
      merchant_id, 'partner-insert-fixture', 'partner', 1815, shipping_quote_id
    );
    RAISE EXCEPTION 'partner order was inserted with a carrier quote' USING ERRCODE = '22023';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'partner_order_shipping_must_start_unbound' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO public.orders (
      merchant_id, order_number, source, total, shipping_status, tracking_number
    ) VALUES (
      merchant_id, 'partner-dispatch-fixture', 'partner', 1815, 'shipped', 'FIXTURE-WAYBILL'
    );
    RAISE EXCEPTION 'partner order started in dispatch' USING ERRCODE = '22023';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'partner_order_shipping_must_start_unbound' THEN RAISE; END IF;
  END;

  receipt := private.accept_settled_partner_order(submission_id, merchant_id, connection_id);
  accepted_id := (receipt->>'order_id')::uuid;
  IF receipt->>'status' IS DISTINCT FROM 'accepted'
     OR receipt IS DISTINCT FROM private.accept_settled_partner_order(submission_id, merchant_id, connection_id)
     OR NOT EXISTS (
       SELECT 1 FROM public.orders AS o WHERE o.id = accepted_id AND o.merchant_id = fixture.merchant_id
         AND o.payment_status = 'paid' AND o.total = 1815 AND o.amount_paid = 1815 AND o.tax_amount = 15
         AND o.source = 'partner'
         AND o.shipping_funding_source IS NULL AND o.selected_quote_id IS NULL
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.order_items AS oi WHERE oi.order_id = accepted_id
         AND oi.product_offer_id = fixture.offer_id AND oi.price = 100 AND oi.quantity = 1
     ) THEN
    RAISE EXCEPTION 'partner order failed real writer, payment, or offer identity checks';
  END IF;

  BEGIN
    UPDATE public.orders SET shipping_address = shipping_address || '{"address":"2 Other Road"}'
    WHERE id = accepted_id;
    RAISE EXCEPTION 'settled destination was editable' USING ERRCODE = '22023';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'partner_delivery_destination_changed' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.orders SET source = 'online_store' WHERE id = accepted_id;
    RAISE EXCEPTION 'accepted partner source was editable' USING ERRCODE = '22023';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'partner_order_source_immutable' THEN RAISE; END IF;
  END;

  UPDATE public.orders SET shipping_address = shipping_address || '{"phone":"08011112222"}'
  WHERE id = accepted_id;
  IF (SELECT shipping_address->>'phone' FROM public.orders WHERE id = accepted_id)
     IS DISTINCT FROM '08011112222' THEN
    RAISE EXCEPTION 'accepted partner contact-only update was lost';
  END IF;

  UPDATE public.products AS p SET vat_rate = 7.75 WHERE p.id = fixture.product_id;
  BEGIN
    PERFORM private.accept_settled_partner_order('7a100000-0000-4000-8000-000000000042', merchant_id, connection_id);
    RAISE EXCEPTION 'a real catalog tax change was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'partner_order_tax_changed' THEN RAISE; END IF;
  END;
  UPDATE public.products AS p SET vat_rate = 7.5 WHERE p.id = fixture.product_id;

  BEGIN
    UPDATE public.orders
    SET shipping_fee = shipping_fee + 1, total = total + 1 WHERE id = accepted_id;
    RAISE EXCEPTION 'accepted partner order pricing was edited' USING ERRCODE = '22023';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'partner_settled_order_amounts_immutable' THEN RAISE; END IF;
  END;

  UPDATE public.products AS p SET price = 100.25 WHERE p.id = fixture.product_id;
  BEGIN
    PERFORM private.accept_settled_partner_order('7a100000-0000-4000-8000-000000000042', merchant_id, connection_id);
    RAISE EXCEPTION 'a real catalog price change was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT IN ('partner_order_price_or_items_changed', 'partner_order_tax_changed') THEN RAISE; END IF;
  END;

  IF (SELECT count(*) FROM public.orders AS o WHERE o.merchant_id = fixture.merchant_id) <> 1
     OR (SELECT count(*) FROM public.transactions AS t WHERE t.order_id = accepted_id
          AND t.gateway = 'partner_settlement' AND t.amount = 1815) <> 1
     OR (SELECT stock_quantity FROM public.products AS p WHERE p.id = fixture.product_id) <> 8
     OR (SELECT stock_quantity FROM public.product_offers AS po WHERE po.id = fixture.offer_id) <> 4 THEN
    RAISE EXCEPTION 'real writer produced duplicate orders, funds, or inventory mutations';
  END IF;

  UPDATE private.partner_delivery_quotes
  SET created_at = now() - interval '10 days', expires_at = now() - interval '9 days'
  WHERE id = fixture.quote_id;

  INSERT INTO private.partner_delivery_quotes (id, merchant_id, connection_id, created_at, expires_at, snapshot)
  VALUES
    ('7a100000-0000-4000-8000-000000000051', merchant_id, connection_id,
      now() - interval '10 days', now() - interval '9 days', '{}'),
    ('7a100000-0000-4000-8000-000000000052', merchant_id, connection_id,
      now() - interval '2 days', now() - interval '1 day', '{}'),
    ('7a100000-0000-4000-8000-000000000053', merchant_id, connection_id,
      now(), now() + interval '10 minutes', '{}'),
    ('7a100000-0000-4000-8000-000000000054', merchant_id, connection_id,
      now() - interval '10 days', now() - interval '9 days', '{}');

  INSERT INTO private.partner_order_submissions (
    merchant_id, connection_id, quote_id, partner_order_id, idempotency_hash, submission, received_at
  ) VALUES (
    merchant_id, connection_id, '7a100000-0000-4000-8000-000000000054',
    'abandoned-payment-fixture', repeat('a', 64), '{}', now() - interval '8 days'
  );
  expired_submissions := private.expire_unverified_partner_submissions();
  IF expired_submissions <> 1
     OR EXISTS (SELECT 1 FROM private.partner_delivery_quotes WHERE id = '7a100000-0000-4000-8000-000000000054')
     OR NOT EXISTS (
       SELECT 1 FROM private.partner_payment_captures AS c WHERE c.submission_id = fixture.submission_id
     ) THEN
    RAISE EXCEPTION 'submission expiry lost verified evidence or retained the abandoned quote (deleted %)', expired_submissions;
  END IF;

  IF private.expire_unclaimed_partner_quotes() <> 1 THEN
    RAISE EXCEPTION 'quote expiry reported an unexpected deletion count';
  END IF;
  IF EXISTS (SELECT 1 FROM private.partner_delivery_quotes WHERE id = '7a100000-0000-4000-8000-000000000051')
     OR (SELECT count(*) FROM private.partner_delivery_quotes WHERE id IN (
       fixture.quote_id, '7a100000-0000-4000-8000-000000000052', '7a100000-0000-4000-8000-000000000053'
     )) <> 3 THEN
    RAISE EXCEPTION 'quote expiry failed to remove abandoned data or keep protected quotes';
  END IF;
  IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    FOR expected_job IN SELECT * FROM (VALUES
      ('partner-unclaimed-quote-expiry', '22 * * * *', 'SELECT private.expire_unclaimed_partner_quotes();'),
      ('partner-unverified-submission-expiry', '37 * * * *', 'SELECT private.expire_unverified_partner_submissions();')
    ) AS expected(job_name, job_schedule, job_command)
    LOOP
      SELECT jobid INTO STRICT existing_job_id FROM cron.job
      WHERE jobname = expected_job.job_name AND database = current_database();
      IF NOT EXISTS (
        SELECT 1 FROM cron.job WHERE jobid = existing_job_id AND active
          AND username = current_user AND schedule = expected_job.job_schedule
          AND command = expected_job.job_command
      ) OR cron.schedule(expected_job.job_name, expected_job.job_schedule, expected_job.job_command)
        IS DISTINCT FROM existing_job_id THEN
        RAISE EXCEPTION 'partner expiry job is missing, duplicated or not reusable: %', expected_job.job_name;
      END IF;
    END LOOP;
  END IF;
END;
$$;

ROLLBACK;
