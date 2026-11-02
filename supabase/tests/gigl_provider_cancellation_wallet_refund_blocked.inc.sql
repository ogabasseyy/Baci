-- Fail-safe paths for gigl_provider_cancellation_wallet_refund.sql (\ir part):
-- every one of them still raises 55P03 'active_merchant_shipping_charge' and
-- refunds nothing.

-- T4: merchant, staff and service-role cancellation writes stay blocked for a
-- booked, stamped charge (order 4 is 'processing' so the cancel RPC reaches
-- the guard), and the merchant refund RPC leaves a booked charge alone.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', 'c4ce1000-0000-4000-8000-000000000001', true
);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
DO $t4_owner$
BEGIN
  BEGIN
    UPDATE public.orders SET shipping_status = 'cancelled'
    WHERE id = 'c4ce1200-0000-4000-8000-000000000004';
    RAISE EXCEPTION 'T4a: the owner order cancellation must be blocked';
  EXCEPTION WHEN SQLSTATE '55P03' THEN
    IF SQLERRM IS DISTINCT FROM 'active_merchant_shipping_charge' THEN
      RAISE EXCEPTION 'T4a: unexpected 55P03 %', SQLERRM;
    END IF;
  END;
  BEGIN
    PERFORM public.cancel_provider_shipment_order_and_release_inventory(
      'c4ce1100-0000-4000-8000-000000000001',
      'c4ce1400-0000-4000-8000-000000000004'
    );
    RAISE EXCEPTION 'T4c: the provider cancel RPC must be blocked';
  EXCEPTION WHEN SQLSTATE '55P03' THEN
    IF SQLERRM IS DISTINCT FROM 'active_merchant_shipping_charge' THEN
      RAISE EXCEPTION 'T4c: unexpected 55P03 %', SQLERRM;
    END IF;
  END;
  IF public.refund_merchant_shipping_charge(
       'c4ce1500-0000-4000-8000-000000000004', 'attempt-4', 'X'
     ) IS DISTINCT FROM 'booked' THEN
    RAISE EXCEPTION 'T4e: the merchant refund RPC must leave a booked charge';
  END IF;
END;
$t4_owner$;

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', 'c4ce1000-0000-4000-8000-000000000002', true
);
DO $t4_staff$
BEGIN
  UPDATE public.shipments
  SET status = 'cancelled', last_tracked_at = now(),
      tracking_events = jsonb_build_array(jsonb_build_object(
        'provider_event_key', 'MSCC:forged', 'raw_status', 'MSCC',
        'normalized_status', 'cancelled', 'occurred_at', now()
      ))
  WHERE id = 'c4ce1400-0000-4000-8000-000000000004';
  RAISE EXCEPTION 'T4b: an orders.edit staff shipment cancellation must be blocked';
EXCEPTION WHEN SQLSTATE '55P03' THEN
  IF SQLERRM IS DISTINCT FROM 'active_merchant_shipping_charge' THEN
    RAISE EXCEPTION 'T4b: unexpected 55P03 %', SQLERRM;
  END IF;
END;
$t4_staff$;
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SET LOCAL ROLE service_role;
DO $t4_service$
BEGIN
  UPDATE public.shipments SET status = 'cancelled'
  WHERE id = 'c4ce1400-0000-4000-8000-000000000004';
  RAISE EXCEPTION 'T4d: a service-role shipment cancellation must be blocked';
EXCEPTION WHEN SQLSTATE '55P03' THEN
  IF SQLERRM IS DISTINCT FROM 'active_merchant_shipping_charge' THEN
    RAISE EXCEPTION 'T4d: unexpected 55P03 %', SQLERRM;
  END IF;
END;
$t4_service$;
RESET ROLE;

DO $t4$
BEGIN
  IF (SELECT status FROM public.merchant_shipping_charges
      WHERE id = pg_temp.fixture_id(5, 4)) IS DISTINCT FROM 'booked'
     OR (SELECT provider_reference FROM public.merchant_shipping_charges
         WHERE id = pg_temp.fixture_id(5, 4)) IS DISTINCT FROM 'WB-CANCEL-4'
     OR pg_temp.refund_count(4) <> 0
     OR (SELECT shipping_status FROM public.orders
         WHERE id = pg_temp.fixture_id(2, 4)) IS DISTINCT FROM 'processing' THEN
    RAISE EXCEPTION 'T4: blocked writers must leave order 4 booked and unrefunded';
  END IF;
END;
$t4$;

-- T5: a merchant who points a booked shipment at another waybill cannot turn
-- that waybill's cancellation into a refund of this charge, even when GIG's
-- history for it is otherwise fresh.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', 'c4ce1000-0000-4000-8000-000000000001', true
);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
UPDATE public.shipments SET tracking_number = 'WB-ALREADY-CANCELLED'
WHERE id = 'c4ce1400-0000-4000-8000-000000000005';
RESET ROLE;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $t5$
DECLARE
  v_shipment constant uuid := pg_temp.fixture_id(4, 5);
  v_balance numeric := pg_temp.wallet_balance();
  v_epoch uuid;
BEGIN
  -- Worst case: the monitor follows the swapped waybill under a new epoch.
  UPDATE public.shipment_tracking_monitors
  SET tracking_number = 'WB-ALREADY-CANCELLED',
      tracking_epoch_id = CASE
        WHEN tracking_number = 'WB-ALREADY-CANCELLED' THEN tracking_epoch_id
        ELSE gen_random_uuid()
      END,
      state = 'active', locked_by = 'worker-test', locked_at = now()
  WHERE shipment_id = v_shipment
  RETURNING tracking_epoch_id INTO v_epoch;
  BEGIN
    PERFORM pg_temp.apply_gig_events(
      v_shipment, 'cancelled', pg_temp.fresh_cancel_history(5, 'MSCC')
    );
    RAISE EXCEPTION 'T5: a swapped-waybill cancellation must stay blocked';
  EXCEPTION WHEN SQLSTATE '55P03' THEN
    IF SQLERRM IS DISTINCT FROM 'active_merchant_shipping_charge' THEN
      RAISE EXCEPTION 'T5: unexpected 55P03 %', SQLERRM;
    END IF;
  END;
  IF (SELECT status FROM public.merchant_shipping_charges
      WHERE id = pg_temp.fixture_id(5, 5)) IS DISTINCT FROM 'booked'
     OR (SELECT provider_reference FROM public.merchant_shipping_charges
         WHERE id = pg_temp.fixture_id(5, 5)) IS DISTINCT FROM 'WB-CANCEL-5'
     OR pg_temp.refund_count(5) <> 0
     OR pg_temp.wallet_balance() IS DISTINCT FROM v_balance
     OR EXISTS (SELECT 1 FROM public.shipment_tracking_events
                WHERE shipment_id = v_shipment AND tracking_epoch_id = v_epoch) THEN
    RAISE EXCEPTION 'T5: the swapped-waybill charge must stay booked and unrefunded';
  END IF;
END;
$t5$;

-- T6: an ambiguous needs_reconciliation charge on the order keeps blocking
-- the cancellation, and the booked sibling's refund (its GIG evidence is
-- complete, so the helper does credit it) rolls back with it. The
-- second charge is seeded with triggers off because moving a charge into
-- needs_reconciliation currently fails on its review enqueue (42P10).
SET LOCAL session_replication_role = replica;
INSERT INTO public.shipping_quotes (
  id, merchant_id, session_id, provider, price, provider_cost,
  platform_margin, pricing_version, currency, is_station_pickup, expires_at
) VALUES (
  'c4ce1700-0000-4000-8000-000000000006', 'c4ce1100-0000-4000-8000-000000000001',
  'c4ce1200-0000-4000-8000-000000000006', 'GIGL', 12000, 10900, 1100,
  'gigl_platform_margin_v1', 'NGN', false, now() + interval '1 hour'
);
INSERT INTO public.merchant_shipping_charges (
  id, merchant_id, order_id, shipping_quote_id, status, currency,
  charged_amount, provider_cost, platform_margin, attempt_token_digest,
  failure_code
) VALUES (
  'c4ce1800-0000-4000-8000-000000000006', 'c4ce1100-0000-4000-8000-000000000001',
  'c4ce1200-0000-4000-8000-000000000006', 'c4ce1700-0000-4000-8000-000000000006',
  'needs_reconciliation', 'NGN', 12000, 10900, 1100,
  pg_catalog.encode(extensions.digest('attempt-6b', 'sha256'), 'hex'),
  'STALE_PROVIDER_SUBMISSION'
);
SET LOCAL session_replication_role = origin;

DO $t6$
DECLARE
  v_shipment constant uuid := pg_temp.fixture_id(4, 6);
  v_balance numeric := pg_temp.wallet_balance();
BEGIN
  BEGIN
    PERFORM pg_temp.apply_gig_events(
      v_shipment, 'cancelled', pg_temp.fresh_cancel_history(6, 'MSCP')
    );
    RAISE EXCEPTION 'T6: an unresolved sibling charge must keep blocking';
  EXCEPTION WHEN SQLSTATE '55P03' THEN
    IF SQLERRM IS DISTINCT FROM 'active_merchant_shipping_charge' THEN
      RAISE EXCEPTION 'T6: unexpected 55P03 %', SQLERRM;
    END IF;
  END;
  IF (SELECT status FROM public.merchant_shipping_charges
      WHERE id = pg_temp.fixture_id(5, 6)) IS DISTINCT FROM 'booked'
     OR (SELECT status FROM public.merchant_shipping_charges
         WHERE id = 'c4ce1800-0000-4000-8000-000000000006')
       IS DISTINCT FROM 'needs_reconciliation'
     OR pg_temp.refund_count(6) <> 0
     OR pg_temp.wallet_balance() IS DISTINCT FROM v_balance
     OR (SELECT status FROM public.shipments WHERE id = v_shipment)
       IS DISTINCT FROM 'booked'
     OR (SELECT shipping_status FROM public.orders WHERE id = pg_temp.fixture_id(2, 6))
       IS DISTINCT FROM 'shipped'
     OR (SELECT locked_by FROM public.shipment_tracking_monitors
         WHERE shipment_id = v_shipment) IS DISTINCT FROM 'worker-test' THEN
    RAISE EXCEPTION 'T6: the blocked apply must roll back completely';
  END IF;
END;
$t6$;

-- T10 (owner scope): a cancellation GIG reports after a pickup the tracker
-- already applied is not refunded; the guard keeps blocking so ops can
-- handle it by hand. All events fall inside the submission window.
DO $t10$
DECLARE
  v_shipment constant uuid := pg_temp.fixture_id(4, 10);
  v_balance numeric := pg_temp.wallet_balance();
  v_pickup constant jsonb := jsonb_build_array(
    pg_temp.gig_event('MCRT:10', 'MCRT', 'booked', now()),
    pg_temp.gig_event('MPIK:10', 'MPIK', 'picked_up', now() + interval '1 minute')
  );
  v_applied boolean;
BEGIN
  v_applied := pg_temp.apply_gig_events(v_shipment, 'picked_up', v_pickup);
  IF v_applied IS DISTINCT FROM true
     OR (SELECT status FROM public.shipments WHERE id = v_shipment)
       IS DISTINCT FROM 'picked_up' THEN
    RAISE EXCEPTION 'T10: the pickup scan must apply first';
  END IF;
  PERFORM pg_temp.lease_monitor(v_shipment);
  BEGIN
    PERFORM pg_temp.apply_gig_events(
      v_shipment, 'cancelled',
      v_pickup || pg_temp.gig_event(
        'MSCC:10', 'MSCC', 'cancelled', now() + interval '2 minutes'
      )
    );
    RAISE EXCEPTION 'T10: a post-pickup cancellation must stay blocked';
  EXCEPTION WHEN SQLSTATE '55P03' THEN
    IF SQLERRM IS DISTINCT FROM 'active_merchant_shipping_charge' THEN
      RAISE EXCEPTION 'T10: unexpected 55P03 %', SQLERRM;
    END IF;
  END;
  IF (SELECT status FROM public.merchant_shipping_charges
      WHERE id = pg_temp.fixture_id(5, 10)) IS DISTINCT FROM 'booked'
     OR pg_temp.refund_count(10) <> 0
     OR pg_temp.wallet_balance() IS DISTINCT FROM v_balance
     OR (SELECT status FROM public.shipments WHERE id = v_shipment)
       IS DISTINCT FROM 'picked_up'
     OR (SELECT shipping_status FROM public.orders WHERE id = pg_temp.fixture_id(2, 10))
       IS DISTINCT FROM 'shipped'
     OR EXISTS (SELECT 1 FROM public.shipment_tracking_events
                WHERE shipment_id = v_shipment AND raw_status = 'MSCC') THEN
    RAISE EXCEPTION 'T10: a post-pickup cancellation must refund nothing';
  END IF;
END;
$t10$;
