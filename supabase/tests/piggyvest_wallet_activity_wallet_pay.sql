-- REGRESSION/CONTRACT TEST: public.list_piggyvest_wallet_activity as replaced
-- by 20261113150000_piggyvest_wallet_activity_wallet_pay lists what the
-- signed-in customer paid from the PiggyVest wallet (IMEI checks,
-- airtime/data/bills) and the refunds of those payments: customer words,
-- masked numbers, never a payment that moved no money, never another
-- customer's. Registered in replay-registry folder
-- 20261113150000_piggyvest_wallet_activity_wallet_pay.
\set ON_ERROR_STOP on
\ir piggyvest_wallet_pay.fixture.inc.sql

DO $behaviour$
DECLARE
  c_user constant text := 'f9a10000-0000-4000-8000-000000000001';
  c_customer constant uuid := 'f9a10000-0000-4000-8000-000000000003';
  c_merchant constant uuid := 'f9a10000-0000-4000-8000-000000000002';
  c_lookup constant text := 'f9a10000-0000-4000-8000-0000000000a9';
  c_airtime constant uuid := 'f9a10000-0000-4000-8000-0000000000b9';
  c_issued constant text := 'f9a10000-0000-4000-8000-0000000000c9';
  v_imei text;
  v_vtu text;
  v_rows jsonb;
BEGIN
  PERFORM pg_temp.wp_collection();
  -- An IMEI check paid and confirmed, then refunded (refund sent).
  v_imei := pg_temp.wp_dispatched(c_lookup, 100000);
  PERFORM pg_temp.wp_settle(pg_temp.wp_pay_proof(v_imei, 'txn-activity-imei'));
  INSERT INTO piggyvest_primary.wallet_payment_refunds (
    payment_id, integration_id, attempt, state, reference, amount_kobo,
    source_wallet_id, destination_wallet_id, dispatched_at)
  VALUES (v_imei::uuid, 'f9a10000-0000-4000-8000-000000000006', 0, 'dispatched',
    'pvb-refund-' || v_imei, 100000, 'synthetic-walletpay-collection',
    'synthetic-walletpay-main', pg_catalog.clock_timestamp());
  -- Airtime paid from the wallet: PIN reserved, not yet confirmed.
  INSERT INTO public.vtu_transactions (id, customer_id, merchant_id, type, network_provider,
    phone_number, request_reference, source, metadata, amount, status)
  VALUES (c_airtime, c_customer, c_merchant, 'airtime', 'mtn', '08031234567',
    'vtu-activity-1', 'checkout', '{"paymentSource":"piggyvest_wallet"}', 500, 'pending');
  v_vtu := pg_temp.wp_issue(c_airtime::text, 50000, 'vtu') ->> 'operationId';
  PERFORM pg_temp.wp_assert(pg_temp.wp_reserve(v_vtu, pg_temp.wp_proof('activity-vtu', 'wallet_pay',
    50000, pg_temp.wp_key(v_vtu, c_airtime::text, 'vtu'))) ->> 'status' = 'claimed', 'vtu reserve');
  -- Issued only (no PIN): moved no money, never listed.
  PERFORM pg_temp.wp_issue(c_issued, 70000);

  PERFORM pg_catalog.set_config('request.jwt.claim.sub', c_user, true);
  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', c_user, 'role', 'authenticated')::text, true);
  SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row) ORDER BY row.kind, row.amount_kobo)
    INTO v_rows
    FROM public.list_piggyvest_wallet_activity(c_merchant) AS row
   WHERE row.kind IN ('wallet_spend', 'wallet_refund');

  PERFORM pg_temp.wp_assert(pg_catalog.jsonb_array_length(v_rows) = 3,
    'expected two spends and one refund: ' || COALESCE(v_rows::text, 'none'));
  PERFORM pg_temp.wp_assert(v_rows -> 0 ->> 'kind' = 'wallet_refund'
      AND v_rows -> 0 ->> 'direction' = 'in'
      AND v_rows -> 0 ->> 'label' = 'Refund: IMEI check'
      AND v_rows -> 0 ->> 'status' = 'pending'
      AND (v_rows -> 0 ->> 'amount_kobo')::bigint = 100000,
    'the refund row is wrong: ' || (v_rows -> 0)::text);
  PERFORM pg_temp.wp_assert(v_rows -> 1 ->> 'kind' = 'wallet_spend'
      AND v_rows -> 1 ->> 'direction' = 'out'
      AND v_rows -> 1 ->> 'label' = 'Airtime · MTN · 0803…4567'
      AND v_rows -> 1 ->> 'status' = 'pending'
      AND (v_rows -> 1 ->> 'amount_kobo')::bigint = 50000,
    'the airtime row is wrong: ' || (v_rows -> 1)::text);
  PERFORM pg_temp.wp_assert(v_rows -> 2 ->> 'label' = 'IMEI check'
      AND v_rows -> 2 ->> 'status' = 'completed',
    'the IMEI row is wrong: ' || (v_rows -> 2)::text);
  -- The full phone number and any purchase id never appear.
  PERFORM pg_temp.wp_assert(v_rows::text NOT LIKE '%08031234567%'
      AND v_rows::text NOT LIKE '%' || c_airtime::text || '%'
      AND v_rows::text NOT LIKE '%' || c_lookup || '%',
    'a full number or purchase id leaked');

  -- Another user sees none of it.
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', 'f9a10000-0000-4000-8000-0000000000ff', true);
  PERFORM pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object(
    'sub', 'f9a10000-0000-4000-8000-0000000000ff', 'role', 'authenticated')::text, true);
  PERFORM pg_temp.wp_assert(NOT EXISTS (
    SELECT 1 FROM public.list_piggyvest_wallet_activity(c_merchant)), 'another user saw the activity');

  -- Grants unchanged: only authenticated.
  PERFORM pg_temp.wp_assert(pg_catalog.has_function_privilege('authenticated',
    'public.list_piggyvest_wallet_activity(uuid,timestamptz,uuid,integer)', 'EXECUTE'),
    'authenticated can not read activity');
  PERFORM pg_temp.wp_assert(NOT pg_catalog.has_function_privilege('anon',
    'public.list_piggyvest_wallet_activity(uuid,timestamptz,uuid,integer)', 'EXECUTE'),
    'anon can read activity');
  PERFORM pg_temp.wp_assert(NOT pg_catalog.has_function_privilege('service_role',
    'public.list_piggyvest_wallet_activity(uuid,timestamptz,uuid,integer)', 'EXECUTE'),
    'service_role can read activity');
END;
$behaviour$;

ROLLBACK;
