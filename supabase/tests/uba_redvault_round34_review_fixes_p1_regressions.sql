-- Round-34 P1 regressions: shipment-booking claims (and the pre-submit
-- payment assertion) reject unpaid REDVAULT orders, while paid REDVAULT
-- orders and unpaid orders on other rails still book.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '7c6dc9b5-6686-467d-b147-9e6fb41ec861';
  v_customer uuid := '44444444-0000-4000-8000-0000000000e1';
  v_order_unpaid uuid := '30000000-0000-4000-8000-0000000000e1';
  v_order_paid uuid := '30000000-0000-4000-8000-0000000000e2';
  v_order_pod uuid := '30000000-0000-4000-8000-0000000000e3';
  v_claimed boolean;
BEGIN
  -- Orders writes must ride the protected path like production writers do.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.merchants (id, email, business_name)
  VALUES (v_merchant, 'redvault-p34@example.com', 'Redvault P34')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.customers (id, merchant_id, user_id, email)
  VALUES (v_customer, v_merchant, NULL, 'redvault-p34@example.com');

  INSERT INTO public.orders
    (id, merchant_id, customer_id, order_number, total, payment_method, payment_status, shipping_status,
     tracking_token, created_at)
  VALUES
    (v_order_unpaid, v_merchant, v_customer, 'R34P1-UNPAID', 1500.00, 'uba_redvault', 'unpaid', 'pending',
     'track-r34-unpaid', pg_catalog.now() - interval '10 minutes'),
    (v_order_paid, v_merchant, v_customer, 'R34P1-PAID', 1500.00, 'uba_redvault', 'paid', 'pending',
     'track-r34-paid', pg_catalog.now() - interval '10 minutes'),
    (v_order_pod, v_merchant, v_customer, 'R34P1-POD', 1500.00, 'pod', 'unpaid', 'pending',
     'track-r34-pod', pg_catalog.now() - interval '10 minutes');
  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();

  -- P1 (unpaid REDVAULT claims): the booking claim and the pre-submit
  -- payment assertion reject an unpaid REDVAULT order; a paid REDVAULT
  -- order still claims; and an unpaid pay-on-delivery order (a rail that
  -- legitimately books unpaid) is unaffected.
  BEGIN
    PERFORM public.claim_order_shipment_booking(v_order_unpaid, v_merchant, gen_random_uuid());
    RAISE EXCEPTION 'claim on an unpaid REDVAULT order unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_redvault_unpaid_for_shipment' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.assert_shippable_order_payment(v_order_unpaid, v_merchant);
    RAISE EXCEPTION 'payment assertion on an unpaid REDVAULT order unexpectedly passed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_redvault_unpaid_for_shipment' THEN RAISE; END IF;
  END;
  PERFORM public.assert_shippable_order_payment(v_order_paid, v_merchant);
  SELECT claimed INTO v_claimed
  FROM public.claim_order_shipment_booking(v_order_paid, v_merchant, gen_random_uuid());
  IF v_claimed IS NOT TRUE THEN RAISE EXCEPTION 'claim on a paid REDVAULT order failed'; END IF;
  PERFORM public.assert_shippable_order_payment(v_order_pod, v_merchant);
  SELECT claimed INTO v_claimed
  FROM public.claim_order_shipment_booking(v_order_pod, v_merchant, gen_random_uuid());
  IF v_claimed IS NOT TRUE THEN RAISE EXCEPTION 'claim on an unpaid POD order failed'; END IF;

  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

RESET ROLE;
ROLLBACK;
