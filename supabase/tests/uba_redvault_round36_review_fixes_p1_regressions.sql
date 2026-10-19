-- Round-36 P1 regressions: customer cancellation (guest and
-- authenticated) rejects while a live shipment-booking claim exists, and
-- unblocks once the claim expires.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '9e8febd7-8808-689f-d369-b08fd63fe083';
  v_user uuid := 'a1a1a1a1-0000-4000-8000-0000000000e1';
  v_guest uuid := '66666666-0000-4000-8000-0000000000e1';
  v_customer uuid := '77777777-0000-4000-8000-0000000000e1';
  v_guest_live uuid := '41000000-0000-4000-8000-0000000000e1';
  v_guest_stale uuid := '41000000-0000-4000-8000-0000000000e2';
  v_owned_live uuid := '42000000-0000-4000-8000-0000000000e1';
  v_owned_stale uuid := '42000000-0000-4000-8000-0000000000e2';
  v_cancelled boolean;
  v_status text;
BEGIN
  -- Orders writes must ride the protected path like production writers do.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.merchants (id, email, business_name)
  VALUES (v_merchant, 'redvault-p36@example.com', 'Redvault P36')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.customers (id, merchant_id, user_id, email)
  VALUES (v_guest, v_merchant, NULL, 'redvault-p36-guest@example.com'),
    (v_customer, v_merchant, v_user, 'redvault-p36@example.com');

  INSERT INTO public.orders
    (id, merchant_id, customer_id, order_number, total, payment_method, payment_status, shipping_status,
     tracking_token, shipment_booking_lock_token, shipment_booking_started_at, created_at)
  VALUES
    (v_guest_live, v_merchant, v_guest, 'R36P1-GLIVE', 1200.00, 'pod', 'unpaid', 'pending',
     'track-r36-glive', gen_random_uuid(), pg_catalog.now() - interval '1 minute',
     pg_catalog.now() - interval '10 minutes'),
    (v_guest_stale, v_merchant, v_guest, 'R36P1-GSTALE', 1200.00, 'pod', 'unpaid', 'pending',
     'track-r36-gstale', gen_random_uuid(), pg_catalog.now() - interval '20 minutes',
     pg_catalog.now() - interval '30 minutes'),
    (v_owned_live, v_merchant, v_customer, 'R36P1-OLIVE', 1200.00, 'pod', 'unpaid', 'pending',
     'track-r36-olive', gen_random_uuid(), pg_catalog.now() - interval '1 minute',
     pg_catalog.now() - interval '10 minutes'),
    (v_owned_stale, v_merchant, v_customer, 'R36P1-OSTALE', 1200.00, 'pod', 'unpaid', 'pending',
     'track-r36-ostale', gen_random_uuid(), pg_catalog.now() - interval '20 minutes',
     pg_catalog.now() - interval '30 minutes');
  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();

  -- P1 (cancel during live booking): a guest cancel against a live
  -- booking claim rejects instead of restocking inventory the provider
  -- shipment then reuses.
  BEGIN
    PERFORM public.cancel_storefront_order_as_guest(v_guest_live, 'track-r36-glive', 'changed mind');
    RAISE EXCEPTION 'guest cancel during a live booking claim unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_not_cancellable' THEN RAISE; END IF;
  END;
  SELECT shipping_status INTO v_status FROM public.orders WHERE id = v_guest_live;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'blocked guest cancel mutated shipping to %', v_status;
  END IF;

  -- The same claim blocks the authenticated cancellation path.
  BEGIN
    PERFORM public.cancel_order_as_customer(v_owned_live, 'changed mind');
    RAISE EXCEPTION 'customer cancel during a live booking claim unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_not_cancellable' THEN RAISE; END IF;
  END;
  SELECT shipping_status INTO v_status FROM public.orders WHERE id = v_owned_live;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'blocked customer cancel mutated shipping to %', v_status;
  END IF;

  -- A crashed booking unblocks cancellation once its claim expires: both
  -- paths cancel stale-claim orders instead of stranding them.
  SELECT public.cancel_storefront_order_as_guest(v_guest_stale, 'track-r36-gstale', 'changed mind')
  INTO v_cancelled;
  IF v_cancelled IS NOT TRUE THEN RAISE EXCEPTION 'guest cancel of a stale-claim order failed'; END IF;
  SELECT public.cancel_order_as_customer(v_owned_stale, 'changed mind') INTO v_cancelled;
  IF v_cancelled IS NOT TRUE THEN RAISE EXCEPTION 'customer cancel of a stale-claim order failed'; END IF;

  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

RESET ROLE;
ROLLBACK;
