-- Provider-evidence paths for gigl_provider_cancellation_wallet_refund.sql
-- (\ir part). shipments rows, statuses and tracking numbers are
-- merchant-writable, so each case below gives the helper a cancellation that
-- the stored status or the stamp would accept, and GIG's recorded timeline
-- must still refuse it: 55P03, nothing refunded. T1 is the positive control
-- (fresh MCRT + MSCC refunds once).

-- Applies GIG's cancellation for fixture order p_n through the worker entry
-- point and asserts the guard blocked it and the whole apply rolled back.
CREATE FUNCTION pg_temp.assert_cancel_blocked(
  p_label text,
  p_n integer,
  p_shipment uuid,
  p_events jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $assert$
DECLARE
  v_balance numeric := pg_temp.wallet_balance();
BEGIN
  PERFORM pg_temp.lease_monitor(p_shipment);
  BEGIN
    PERFORM pg_temp.apply_gig_events(p_shipment, 'cancelled', p_events);
    RAISE EXCEPTION '%: the cancellation must stay blocked', p_label;
  EXCEPTION WHEN SQLSTATE '55P03' THEN
    IF SQLERRM IS DISTINCT FROM 'active_merchant_shipping_charge' THEN
      RAISE EXCEPTION '%: unexpected 55P03 %', p_label, SQLERRM;
    END IF;
  END;
  IF (SELECT charge.status FROM public.merchant_shipping_charges AS charge
      WHERE charge.id = pg_temp.fixture_id(5, p_n)) IS DISTINCT FROM 'booked'
     OR pg_temp.refund_count(p_n) <> 0
     OR pg_temp.wallet_balance() IS DISTINCT FROM v_balance
     OR (SELECT o.shipping_status FROM public.orders AS o
         WHERE o.id = pg_temp.fixture_id(2, p_n)) IS DISTINCT FROM 'shipped'
     OR (SELECT s.status FROM public.shipments AS s WHERE s.id = p_shipment)
       = 'cancelled'
     OR EXISTS (
       SELECT 1 FROM public.shipment_tracking_events AS e
       WHERE e.shipment_id = p_shipment AND e.normalized_status = 'cancelled'
     ) THEN
    RAISE EXCEPTION '%: the blocked cancellation must refund nothing', p_label;
  END IF;
END;
$assert$;

-- T11: one poll carries a pickup scan and then the cancellation while the
-- stored status is still 'booked' (a paused monitor polls once a day). The
-- prior-status gate passes, but GIG's MPIK makes it a post-pickup cancel.
DO $t11$
BEGIN
  PERFORM pg_temp.assert_cancel_blocked(
    'T11', 11, pg_temp.fixture_id(4, 11),
    jsonb_build_array(
      pg_temp.gig_event('MCRT:11', 'MCRT', 'booked', now()),
      pg_temp.gig_event('MPIK:11', 'MPIK', 'picked_up', now() + interval '1 minute'),
      pg_temp.gig_event('MSCC:11', 'MSCC', 'cancelled', now() + interval '2 minutes')
    )
  );
END;
$t11$;

-- T12: after the tracker applied a pickup, the owner moves shipments.status
-- back to 'booked' (authenticated may update it). GIG's recorded MPIK still
-- makes the later cancellation a post-pickup one.
DO $t12_pickup$
BEGIN
  IF pg_temp.apply_gig_events(
       pg_temp.fixture_id(4, 12), 'picked_up',
       jsonb_build_array(
         pg_temp.gig_event('MCRT:12', 'MCRT', 'booked', now()),
         pg_temp.gig_event('MPIK:12', 'MPIK', 'picked_up', now() + interval '1 minute')
       )
     ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'T12: the pickup scan must apply first';
  END IF;
END;
$t12_pickup$;

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', 'c4ce1000-0000-4000-8000-000000000001', true
);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
UPDATE public.shipments SET status = 'booked'
WHERE id = 'c4ce1400-0000-4000-8000-000000000012';
RESET ROLE;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $t12$
BEGIN
  IF (SELECT status FROM public.shipments WHERE id = pg_temp.fixture_id(4, 12))
       IS DISTINCT FROM 'booked' THEN
    RAISE EXCEPTION 'T12: the owner must be able to move the status back';
  END IF;
  PERFORM pg_temp.assert_cancel_blocked(
    'T12', 12, pg_temp.fixture_id(4, 12),
    jsonb_build_array(
      pg_temp.gig_event('MCRT:12', 'MCRT', 'booked', now()),
      pg_temp.gig_event('MPIK:12', 'MPIK', 'picked_up', now() + interval '1 minute'),
      pg_temp.gig_event('MSCC:12', 'MSCC', 'cancelled', now() + interval '2 minutes')
    )
  );
END;
$t12$;

-- T13 (decoy waybill): while the real booking is in flight, the owner inserts
-- a second GIGL shipment for the same order and quote that carries an old
-- waybill GIG cancelled weeks ago, then binds the charge to it with the
-- recover RPC (no attempt token needed). The stamp names the decoy, but GIG's
-- history for it predates this submission, so its cancellation refunds
-- nothing.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', 'c4ce1000-0000-4000-8000-000000000001', true
);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
INSERT INTO public.shipments (
  id, order_id, merchant_id, provider, status, tracking_number,
  provider_shipment_id, shipping_quote_id, sender_address,
  receiver_address, items
) VALUES (
  'c4ce1400-0000-4000-8000-000000000131',
  'c4ce1200-0000-4000-8000-000000000013',
  'c4ce1100-0000-4000-8000-000000000001', 'GIGL', 'booked', 'WB-DECOY-13',
  'WB-DECOY-13', 'c4ce1300-0000-4000-8000-000000000013', '{}'::jsonb,
  '{}'::jsonb, '[]'::jsonb
);
DO $t13_bind$
BEGIN
  IF public.recover_merchant_shipping_charge_for_persisted_shipment(
       'c4ce1500-0000-4000-8000-000000000013', 'not-the-attempt-token',
       'c4ce1400-0000-4000-8000-000000000131'
     ) IS DISTINCT FROM 'booked' THEN
    RAISE EXCEPTION 'T13: the owner must be able to bind the charge to the decoy';
  END IF;
END;
$t13_bind$;
RESET ROLE;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $t13$
BEGIN
  IF (SELECT provider_reference FROM public.merchant_shipping_charges
      WHERE id = pg_temp.fixture_id(5, 13)) IS DISTINCT FROM 'WB-DECOY-13' THEN
    RAISE EXCEPTION 'T13: the worst case stamps the decoy waybill';
  END IF;
  PERFORM pg_temp.assert_cancel_blocked(
    'T13', 13, 'c4ce1400-0000-4000-8000-000000000131',
    jsonb_build_array(
      pg_temp.gig_event('MCRT:131', 'MCRT', 'booked', now() - interval '30 days'),
      pg_temp.gig_event('MSCC:131', 'MSCC', 'cancelled', now() - interval '29 days')
    )
  );
END;
$t13$;

-- T14 (one waybill, one charge): before completing the booking, the owner
-- points order 14's shipment at WB-CANCEL-1, which order 1's refunded charge
-- already holds. The charge books unstamped, the index rejects a second
-- holder, and a fresh GIG cancellation of that waybill refunds nothing.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', 'c4ce1000-0000-4000-8000-000000000001', true
);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
UPDATE public.shipments SET tracking_number = 'WB-CANCEL-1'
WHERE id = 'c4ce1400-0000-4000-8000-000000000014';
DO $t14_complete$
BEGIN
  IF public.complete_merchant_shipping_charge(
       'c4ce1500-0000-4000-8000-000000000014', 'attempt-14',
       'c4ce1400-0000-4000-8000-000000000014'
     ) IS DISTINCT FROM 'booked' THEN
    RAISE EXCEPTION 'T14: the owner must complete the booking';
  END IF;
END;
$t14_complete$;
RESET ROLE;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $t14$
DECLARE
  v_charge constant uuid := pg_temp.fixture_id(5, 14);
BEGIN
  IF (SELECT provider_reference FROM public.merchant_shipping_charges
      WHERE id = v_charge) IS NOT NULL
     OR (SELECT provider_reference FROM public.merchant_shipping_charges
         WHERE id = pg_temp.fixture_id(5, 1)) IS DISTINCT FROM 'WB-CANCEL-1' THEN
    RAISE EXCEPTION 'T14: a waybill another charge holds must not be stamped again';
  END IF;
  BEGIN
    UPDATE public.merchant_shipping_charges
    SET provider_reference = 'WB-CANCEL-1'
    WHERE id = v_charge;
    RAISE EXCEPTION 'T14: the index must reject a second holder of one waybill';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  PERFORM pg_temp.assert_cancel_blocked(
    'T14', 14, pg_temp.fixture_id(4, 14), pg_temp.fresh_cancel_history(14, 'MSCC')
  );
END;
$t14$;

-- T15: GIG's history for the stamped waybill has a fresh cancellation but no
-- creation scan inside this charge's submission window, so nothing proves the
-- submission created that waybill.
DO $t15$
BEGIN
  PERFORM pg_temp.assert_cancel_blocked(
    'T15', 15, pg_temp.fixture_id(4, 15),
    jsonb_build_array(
      pg_temp.gig_event('MSCC:15', 'MSCC', 'cancelled', now() + interval '2 minutes')
    )
  );
END;
$t15$;

-- T16: a fresh creation scan and cancellation, but GIG also reports the
-- waybill weeks before this submission began: an older waybill reused for
-- this charge.
DO $t16$
BEGIN
  PERFORM pg_temp.assert_cancel_blocked(
    'T16', 16, pg_temp.fixture_id(4, 16),
    pg_temp.fresh_cancel_history(16, 'MSCC')
      || pg_temp.gig_event('CRT:16', 'CRT', 'booked', now() - interval '30 days')
  );
END;
$t16$;
