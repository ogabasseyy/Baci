-- Account-attestation, ordering and fail-safe paths for
-- gigl_provider_cancellation_wallet_refund.sql (\ir part). Every case below
-- must leave the guard's 55P03 'active_merchant_shipping_charge' in place and
-- refund nothing (pg_temp.assert_cancel_blocked from _evidence.inc.sql).

-- T17 (decoy from the merchant's own GIG account): while the real booking is
-- in flight, the owner creates a waybill in their own GIG account, inserts a
-- second GIGL shipment for the same order and quote that carries it, binds
-- the charge to it with the recover RPC (no attempt token needed) and
-- cancels it at GIG. GIG's timeline for that decoy is fresh (created inside
-- the submission window, cancelled after), but recover leaves the charge
-- unstamped and the preshipment record names the merchant's GIG account, so
-- the worker sends no account attestation either.
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
  'c4ce1400-0000-4000-8000-000000000171',
  'c4ce1200-0000-4000-8000-000000000017',
  'c4ce1100-0000-4000-8000-000000000001', 'GIGL', 'booked', 'WB-DECOY-17',
  'WB-DECOY-17', 'c4ce1300-0000-4000-8000-000000000017', '{}'::jsonb,
  '{}'::jsonb, '[]'::jsonb
);
DO $t17_bind$
BEGIN
  IF public.recover_merchant_shipping_charge_for_persisted_shipment(
       'c4ce1500-0000-4000-8000-000000000017', 'not-the-attempt-token',
       'c4ce1400-0000-4000-8000-000000000171'
     ) IS DISTINCT FROM 'booked' THEN
    RAISE EXCEPTION 'T17: the owner must be able to bind the charge to the decoy';
  END IF;
END;
$t17_bind$;
RESET ROLE;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $t17$
BEGIN
  IF (SELECT provider_reference FROM public.merchant_shipping_charges
      WHERE id = pg_temp.fixture_id(5, 17)) IS NOT NULL THEN
    RAISE EXCEPTION 'T17: a charge bound by recover must stay unstamped';
  END IF;
  PERFORM pg_temp.assert_cancel_blocked(
    'T17', 17, 'c4ce1400-0000-4000-8000-000000000171',
    jsonb_build_array(
      pg_temp.gig_event('MCRT:171', 'MCRT', 'booked', now() + interval '1 minute'),
      pg_temp.gig_event('MSCC:171', 'MSCC', 'cancelled', now() + interval '3 minutes')
    )
  );
END;
$t17$;

-- T18: only a JSON true on the cancellation event the refund relies on,
-- sent in this apply call, counts as the worker's attestation. No mark, a
-- string "true", false, a mark on the creation scan, or a mark on another
-- (ineligible) cancellation refunds nothing.
DO $t18$
DECLARE
  v_shipment constant uuid := pg_temp.fixture_id(4, 18);
  v_created constant jsonb :=
    pg_temp.gig_event('MCRT:18', 'MCRT', 'booked', now());
  v_cancel constant jsonb := pg_temp.gig_event(
    'MSCC:18', 'MSCC', 'cancelled', now() + interval '2 minutes'
  );
BEGIN
  PERFORM pg_temp.assert_cancel_blocked(
    'T18 string', 18, v_shipment,
    jsonb_build_array(v_created, v_cancel || '{"account_attested": "true"}')
  );
  PERFORM pg_temp.assert_cancel_blocked(
    'T18 unmarked', 18, v_shipment, jsonb_build_array(v_created, v_cancel)
  );
  PERFORM pg_temp.assert_cancel_blocked(
    'T18 false', 18, v_shipment,
    jsonb_build_array(v_created, v_cancel || '{"account_attested": false}')
  );
  PERFORM pg_temp.assert_cancel_blocked(
    'T18 creation scan', 18, v_shipment,
    jsonb_build_array(pg_temp.attested(v_created), v_cancel)
  );
  -- The only attested cancellation predates the creation scan; the one
  -- after it is unattested. The mark must sit on the event the refund uses.
  PERFORM pg_temp.assert_cancel_blocked(
    'T18 other event', 18, v_shipment,
    jsonb_build_array(
      v_created,
      pg_temp.attested(pg_temp.gig_event(
        'MSCP:18', 'MSCP', 'cancelled', now() - interval '1 minute'
      )),
      v_cancel
    )
  );
END;
$t18$;

-- T19: the attested cancellation predates the in-window creation scan, so
-- it cannot be GIG cancelling the waybill this submission created.
DO $t19$
BEGIN
  PERFORM pg_temp.assert_cancel_blocked(
    'T19', 19, pg_temp.fixture_id(4, 19),
    jsonb_build_array(
      pg_temp.attested(pg_temp.gig_event(
        'MSCC:19', 'MSCC', 'cancelled', now() + interval '1 minute'
      )),
      pg_temp.gig_event('MCRT:19', 'MCRT', 'booked', now() + interval '3 minutes')
    )
  );
END;
$t19$;

-- T20: the charge's debit no longer matches what was charged (one kobo
-- off). The refund declines instead of raising an opaque P0001, so the
-- guard's documented 55P03 manual-handling signal is what surfaces.
SET LOCAL session_replication_role = replica;
UPDATE public.wallet_transactions
SET amount = 48500.39
WHERE id = 'c4ce1600-0000-4000-8000-000000000020';
SET LOCAL session_replication_role = origin;

DO $t20$
BEGIN
  PERFORM pg_temp.assert_cancel_blocked(
    'T20', 20, pg_temp.fixture_id(4, 20),
    pg_temp.fresh_cancel_history(20, 'MSCC')
  );
END;
$t20$;

-- T21: the merchant's wallet row is missing. The refund declines instead of
-- raising P0001 and the guard raises 55P03. The wallet is removed inside a
-- subtransaction that is rolled back afterwards.
DO $t21$
DECLARE
  v_balance constant numeric := pg_temp.wallet_balance();
BEGIN
  BEGIN
    PERFORM pg_catalog.set_config('session_replication_role', 'replica', true);
    DELETE FROM public.merchant_wallets AS wallet
    WHERE wallet.merchant_id = 'c4ce1100-0000-4000-8000-000000000001';
    PERFORM pg_catalog.set_config('session_replication_role', 'origin', true);
    IF pg_temp.wallet_balance() IS NOT NULL THEN
      RAISE EXCEPTION 'T21: the wallet must be missing for this case';
    END IF;
    PERFORM pg_temp.assert_cancel_blocked(
      'T21', 21, pg_temp.fixture_id(4, 21),
      pg_temp.fresh_cancel_history(21, 'MSCC')
    );
    RAISE EXCEPTION 'T21 restores the wallet' USING ERRCODE = 'XT021';
  EXCEPTION WHEN SQLSTATE 'XT021' THEN
    NULL;
  END;
  IF pg_temp.wallet_balance() IS DISTINCT FROM v_balance
     OR pg_temp.refund_count(21) <> 0
     OR (SELECT status FROM public.merchant_shipping_charges
         WHERE id = pg_temp.fixture_id(5, 21)) IS DISTINCT FROM 'booked' THEN
    RAISE EXCEPTION 'T21: a missing wallet must refund nothing';
  END IF;
END;
$t21$;

-- T22 (race): the owner rewrites the server's freshly inserted shipment row
-- to another fresh Baci-account waybill before complete() runs. The row is
-- no longer as the server inserted it (tracking_snapshot_version 2), so the
-- charge books unstamped and that waybill's attested cancellation refunds
-- nothing.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', 'c4ce1000-0000-4000-8000-000000000001', true
);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
UPDATE public.shipments
SET tracking_number = 'WB-RACE-22', provider_shipment_id = 'WB-RACE-22'
WHERE id = 'c4ce1400-0000-4000-8000-000000000022';
DO $t22_complete$
BEGIN
  IF public.complete_merchant_shipping_charge(
       'c4ce1500-0000-4000-8000-000000000022', 'attempt-22',
       'c4ce1400-0000-4000-8000-000000000022'
     ) IS DISTINCT FROM 'booked' THEN
    RAISE EXCEPTION 'T22: the owner must complete the booking';
  END IF;
END;
$t22_complete$;
RESET ROLE;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $t22$
BEGIN
  IF (SELECT provider_reference FROM public.merchant_shipping_charges
      WHERE id = pg_temp.fixture_id(5, 22)) IS NOT NULL THEN
    RAISE EXCEPTION 'T22: a rewritten shipment row must not be stamped';
  END IF;
  PERFORM pg_temp.assert_cancel_blocked(
    'T22', 22, pg_temp.fixture_id(4, 22),
    jsonb_build_array(
      pg_temp.gig_event('MCRT:22', 'MCRT', 'booked', now()),
      pg_temp.attested(pg_temp.gig_event(
        'MSCC:22', 'MSCC', 'cancelled', now() + interval '2 minutes'
      ))
    )
  );
END;
$t22$;

-- T23: GIG scanned the waybill at the final destination (ARF) before the
-- cancellation. ARF is not in the status map, so the normalizer stores it
-- as 'pending'; it still counts as a post-pickup scan and refunds nothing.
DO $t23$
BEGIN
  PERFORM pg_temp.assert_cancel_blocked(
    'T23', 23, pg_temp.fixture_id(4, 23),
    jsonb_build_array(
      pg_temp.gig_event('MCRT:23', 'MCRT', 'booked', now()),
      pg_temp.gig_event('ARF:23', 'ARF', 'pending', now() + interval '1 minute'),
      pg_temp.attested(pg_temp.gig_event(
        'MSCC:23', 'MSCC', 'cancelled', now() + interval '2 minutes'
      ))
    )
  );
END;
$t23$;
