-- REGRESSION TEST (behaviour): the checkout's owner-scoped read of how a
-- VTU purchase is paid (migration 20261113100000_vtu_piggyvest_wallet_pay).
-- Registered in replay-registry folder 20261113100000_vtu_piggyvest_wallet_pay.
\set ON_ERROR_STOP on
\ir piggyvest_wallet_pay.fixture.inc.sql

DO $behaviour$
DECLARE
  c_user constant text := 'f9a10000-0000-4000-8000-000000000001';
  c_customer constant uuid := 'f9a10000-0000-4000-8000-000000000003';
  c_merchant constant uuid := 'f9a10000-0000-4000-8000-000000000002';
  c_paid constant uuid := 'f9a10000-0000-4000-8000-0000000000d1';
  c_credit constant uuid := 'f9a10000-0000-4000-8000-0000000000d2';
  v_paid boolean;
  v_amount numeric;
BEGIN
  PERFORM pg_temp.wp_collection();
  INSERT INTO public.vtu_transactions (id, customer_id, merchant_id, type, network_provider, phone_number,
    request_reference, source, metadata, amount, status)
  VALUES
    (c_paid, c_customer, c_merchant, 'airtime', 'mtn', '08000000000', 'vtu-walletpay-read-1',
     'checkout', '{"paymentSource":"piggyvest_wallet","paymentSplit":{"wallet":1000,"card":0}}', 1000, 'pending'),
    (c_credit, c_customer, c_merchant, 'airtime', 'mtn', '08000000000', 'vtu-walletpay-read-2',
     'checkout', '{"paymentSplit":{"wallet":500,"card":0}}', 500, 'pending');

  -- The owner sees how each of their purchases is paid.
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', c_user, true);
  SELECT piggyvest_paid, amount INTO v_paid, v_amount
    FROM public.get_vtu_wallet_pay_purchase(c_paid);
  PERFORM pg_temp.wp_assert(v_paid IS TRUE AND v_amount = 1000, 'a PiggyVest purchase was not reported as such');
  PERFORM pg_temp.wp_assert((SELECT merchant_id = c_merchant AND customer_id = c_customer
    FROM public.get_vtu_wallet_pay_purchase(c_paid)), 'the purchase did not report its merchant and customer');
  SELECT piggyvest_paid INTO v_paid FROM public.get_vtu_wallet_pay_purchase(c_credit);
  PERFORM pg_temp.wp_assert(v_paid IS FALSE, 'a store credit purchase was reported as PiggyVest-paid');

  -- Anyone else (or no session) sees nothing.
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', 'f9a10000-0000-4000-8000-0000000000ff', true);
  PERFORM pg_temp.wp_assert(NOT EXISTS (SELECT 1 FROM public.get_vtu_wallet_pay_purchase(c_paid)),
    'another user read the purchase');
  -- REGRESSION (Codex P2): a purchase refused before any payment was
  -- issued is closed by its owner only; one with any payment is not.
  PERFORM pg_temp.wp_assert(NOT public.close_unissued_vtu_wallet_purchase(c_paid),
    'another user closed the purchase');
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', c_user, true);
  PERFORM pg_temp.wp_assert(NOT public.close_unissued_vtu_wallet_purchase(c_credit),
    'a store credit purchase was closed');
  PERFORM pg_temp.wp_issue(c_paid::text, 100000, 'vtu');
  PERFORM pg_temp.wp_assert(NOT public.close_unissued_vtu_wallet_purchase(c_paid),
    'a purchase with an issued payment was closed');
  DELETE FROM piggyvest_primary.wallet_payments WHERE purchase_ref = c_paid::text;
  PERFORM pg_temp.wp_assert(public.close_unissued_vtu_wallet_purchase(c_paid),
    'an unissued purchase was not closed');
  PERFORM pg_temp.wp_assert((SELECT status = 'failed' AND (metadata ->> 'refundSkipped')::boolean
    FROM public.vtu_transactions WHERE id = c_paid), 'the unissued purchase was not closed as unpaid');
  UPDATE public.vtu_transactions SET status = 'pending' WHERE id = c_paid;
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', 'f9a10000-0000-4000-8000-0000000000ff', true);
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '', true);
  PERFORM pg_temp.wp_assert(NOT EXISTS (SELECT 1 FROM public.get_vtu_wallet_pay_purchase(c_paid)),
    'a session-less call read the purchase');

  -- Only signed-in customers may call it.
  PERFORM pg_temp.wp_assert(pg_catalog.has_function_privilege('authenticated',
    'public.get_vtu_wallet_pay_purchase(uuid)', 'EXECUTE'), 'authenticated can not read');
  PERFORM pg_temp.wp_assert(pg_catalog.has_function_privilege('authenticated',
    'public.close_unissued_vtu_wallet_purchase(uuid)', 'EXECUTE'), 'the owner can not close');
  PERFORM pg_temp.wp_assert(NOT pg_catalog.has_function_privilege('anon',
    'public.close_unissued_vtu_wallet_purchase(uuid)', 'EXECUTE'), 'anon can close');
  PERFORM pg_temp.wp_assert(NOT pg_catalog.has_function_privilege('service_role',
    'public.close_unissued_vtu_wallet_purchase(uuid)', 'EXECUTE'), 'service_role can close');
  PERFORM pg_temp.wp_assert(NOT pg_catalog.has_function_privilege('anon',
    'public.get_vtu_wallet_pay_purchase(uuid)', 'EXECUTE'), 'anon can read');
END;
$behaviour$;

ROLLBACK;
