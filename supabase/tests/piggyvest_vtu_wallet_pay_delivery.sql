-- REGRESSION TEST (behaviour): how the wallet pay drain settles a confirmed
-- VTU payment (migration 20261113100000_vtu_piggyvest_wallet_pay).
-- Registered in replay-registry folder 20261113100000_vtu_piggyvest_wallet_pay.
\set ON_ERROR_STOP on
\ir piggyvest_wallet_pay.fixture.inc.sql

DO $behaviour$
DECLARE
  c_integration constant uuid := 'f9a10000-0000-4000-8000-000000000006';
  c_customer constant uuid := 'f9a10000-0000-4000-8000-000000000003';
  c_merchant constant uuid := 'f9a10000-0000-4000-8000-000000000002';
  c_row constant uuid := 'f9a10000-0000-4000-8000-0000000000c1';
  v_op text;
  v_message text;
BEGIN
  PERFORM pg_temp.wp_collection();

  -- A confirmed VTU payment, claimed for delivery.
  v_op := pg_temp.wp_issue(c_row::text, 100000, 'vtu') ->> 'operationId';
  PERFORM pg_temp.wp_assert(
    pg_temp.wp_reserve(v_op, pg_temp.wp_proof('vtu-' || v_op, 'wallet_pay', 100000,
      pg_temp.wp_key(v_op, c_row::text, 'vtu'))) ->> 'status' = 'claimed', 'vtu reserve');
  PERFORM pg_temp.wp_assert(
    piggyvest_primary.manage_wallet_payment(pg_temp.wp_scope(), v_op::uuid, 'dispatch'), 'vtu dispatch');
  PERFORM pg_temp.wp_settle(pg_temp.wp_pay_proof(v_op, 'txn-vtu-1'));
  PERFORM pg_temp.wp_claim(v_op);

  -- No purchase row: mismatch.
  PERFORM pg_temp.wp_assert(piggyvest_primary.vtu_wallet_payment_delivery_state(
    c_integration, 'staging', v_op::uuid) = 'mismatch', 'a payment with no purchase matched');

  -- A pending purchase was never vended: closed as failed (refund owed).
  INSERT INTO public.vtu_transactions (id, customer_id, merchant_id, type, network_provider, phone_number,
    request_reference, source, metadata, amount, status)
  VALUES (c_row, c_customer, c_merchant, 'airtime', 'mtn', '08000000000', 'vtu-walletpay-test-1',
    'checkout', '{"paymentSource":"piggyvest_wallet"}', 1000, 'pending');
  PERFORM pg_temp.wp_assert(piggyvest_primary.vtu_wallet_payment_delivery_state(
    c_integration, 'staging', v_op::uuid) = 'failed', 'a pending purchase was not failed');
  SELECT error_message INTO v_message FROM public.vtu_transactions WHERE id = c_row;
  PERFORM pg_temp.wp_assert(
    (SELECT status FROM public.vtu_transactions WHERE id = c_row) = 'failed'
      AND v_message LIKE '%PiggyVest wallet%', 'the pending purchase was not closed as failed');

  -- A vend in flight is left alone; a vended or failed one is reported.
  UPDATE public.vtu_transactions SET status = 'processing' WHERE id = c_row;
  PERFORM pg_temp.wp_assert(piggyvest_primary.vtu_wallet_payment_delivery_state(
    c_integration, 'staging', v_op::uuid) = 'processing', 'a processing purchase was settled');
  PERFORM pg_temp.wp_assert((SELECT status FROM public.vtu_transactions WHERE id = c_row) = 'processing',
    'a processing purchase was changed');
  UPDATE public.vtu_transactions SET status = 'successful' WHERE id = c_row;
  PERFORM pg_temp.wp_assert(piggyvest_primary.vtu_wallet_payment_delivery_state(
    c_integration, 'staging', v_op::uuid) = 'success', 'a vended purchase was not a success');

  -- Only this customer's PiggyVest-paid checkout row at exactly the price.
  UPDATE public.vtu_transactions SET amount = 999 WHERE id = c_row;
  PERFORM pg_temp.wp_assert(piggyvest_primary.vtu_wallet_payment_delivery_state(
    c_integration, 'staging', v_op::uuid) = 'mismatch', 'another price matched');
  UPDATE public.vtu_transactions SET amount = 1000, metadata = '{}' WHERE id = c_row;
  PERFORM pg_temp.wp_assert(piggyvest_primary.vtu_wallet_payment_delivery_state(
    c_integration, 'staging', v_op::uuid) = 'mismatch', 'a store credit purchase matched');
  UPDATE public.vtu_transactions SET metadata = '{"paymentSource":"piggyvest_wallet"}', source = 'gift' WHERE id = c_row;
  PERFORM pg_temp.wp_assert(piggyvest_primary.vtu_wallet_payment_delivery_state(
    c_integration, 'staging', v_op::uuid) = 'mismatch', 'a non-checkout purchase matched');
  UPDATE public.vtu_transactions SET source = 'checkout' WHERE id = c_row;
  PERFORM pg_temp.wp_assert(piggyvest_primary.vtu_wallet_payment_delivery_state(
    c_integration, 'staging', v_op::uuid) = 'success', 'the restored purchase did not match');

  -- A refund already owed (delivery finished) is no longer claimed: mismatch.
  PERFORM pg_temp.wp_finish(v_op, 'failed');
  PERFORM pg_temp.wp_assert(piggyvest_primary.vtu_wallet_payment_delivery_state(
    c_integration, 'staging', v_op::uuid) = 'mismatch', 'a finished payment matched');

  -- Client roles can not call it; only the worker login can.
  PERFORM pg_temp.wp_assert(NOT pg_catalog.has_function_privilege('authenticated',
    'piggyvest_primary.vtu_wallet_payment_delivery_state(uuid,text,uuid)', 'EXECUTE'), 'authenticated can settle');
  PERFORM pg_temp.wp_assert(NOT pg_catalog.has_function_privilege('service_role',
    'piggyvest_primary.vtu_wallet_payment_delivery_state(uuid,text,uuid)', 'EXECUTE'), 'service_role can settle');
  PERFORM pg_temp.wp_assert(pg_catalog.has_function_privilege('piggyvest_primary_authorizer',
    'piggyvest_primary.vtu_wallet_payment_delivery_state(uuid,text,uuid)', 'EXECUTE'), 'the worker can not settle');
END;
$behaviour$;

ROLLBACK;
