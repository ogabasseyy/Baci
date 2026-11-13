-- REGRESSION TEST (behaviour): closing a PiggyVest-paid VTU purchase whose
-- payment ended unpaid, so a later store credit purchase never joins a row
-- that can not be vended (migration 20261113100000_vtu_piggyvest_wallet_pay).
-- Registered in replay-registry folder 20261113100000_vtu_piggyvest_wallet_pay.
\set ON_ERROR_STOP on
\ir piggyvest_wallet_pay.fixture.inc.sql

DO $behaviour$
DECLARE
  c_customer constant uuid := 'f9a10000-0000-4000-8000-000000000003';
  c_merchant constant uuid := 'f9a10000-0000-4000-8000-000000000002';
  c_paid constant uuid := 'f9a10000-0000-4000-8000-0000000000e1';
  c_credit constant uuid := 'f9a10000-0000-4000-8000-0000000000e2';
  c_other constant uuid := 'f9a10000-0000-4000-8000-0000000000e3';
  v_op text;
  v_threw boolean;
BEGIN
  PERFORM pg_temp.wp_collection();
  INSERT INTO public.vtu_transactions (id, customer_id, merchant_id, type, network_provider, phone_number,
    request_reference, source, metadata, amount, status)
  VALUES
    (c_paid, c_customer, c_merchant, 'airtime', 'mtn', '08000000000', 'vtu-walletpay-close-1',
     'checkout', '{"paymentSource":"piggyvest_wallet","paymentSplit":{"wallet":1000,"card":0}}', 1000, 'pending'),
    (c_credit, c_customer, c_merchant, 'airtime', 'mtn', '08000000000', 'vtu-walletpay-close-2',
     'checkout', '{"paymentSplit":{"wallet":1000,"card":0}}', 1000, 'pending'),
    (c_other, 'f9a10000-0000-4000-8000-0000000000ff', c_merchant, 'airtime', 'mtn', '08000000000',
     'vtu-walletpay-close-3', 'checkout', '{"paymentSource":"piggyvest_wallet"}', 1000, 'pending');

  -- An issued payment still open keeps the row.
  v_op := pg_temp.wp_issue(c_paid::text, 100000, 'vtu') ->> 'operationId';
  PERFORM pg_temp.wp_assert(NOT piggyvest_primary.close_unpaid_vtu_wallet_purchase(pg_temp.wp_scope(),
    jsonb_build_object('transactionId', c_paid)), 'a row with an open payment was closed');
  PERFORM pg_temp.wp_assert((SELECT status FROM public.vtu_transactions WHERE id = c_paid) = 'pending',
    'a row with an open payment changed');
  -- Expired unpaid: closed as failed, once.
  UPDATE piggyvest_primary.wallet_payments SET expires_at = pg_catalog.clock_timestamp() - interval '1 second'
   WHERE id = v_op::uuid;
  PERFORM pg_temp.wp_assert(piggyvest_primary.close_unpaid_vtu_wallet_purchase(pg_temp.wp_scope(),
    jsonb_build_object('transactionId', c_paid)), 'an unpaid row was not closed');
  PERFORM pg_temp.wp_assert((SELECT status FROM public.vtu_transactions WHERE id = c_paid) = 'failed',
    'an unpaid row was not failed');
  PERFORM pg_temp.wp_assert(NOT piggyvest_primary.close_unpaid_vtu_wallet_purchase(pg_temp.wp_scope(),
    jsonb_build_object('transactionId', c_paid)), 'a closed row was closed twice');
  PERFORM pg_temp.wp_assert((SELECT (metadata ->> 'refundSkipped')::boolean FROM public.vtu_transactions
    WHERE id = c_paid), 'a closed unpaid row would be picked up for a refund');

  -- REGRESSION (Codex P2): the sheet closed before any PIN releases the open
  -- issued payment and closes the purchase; without the flag it stays.
  UPDATE public.vtu_transactions SET status = 'pending' WHERE id = c_paid;
  v_op := pg_temp.wp_issue(c_paid::text, 100000, 'vtu') ->> 'operationId';
  PERFORM pg_temp.wp_assert(NOT piggyvest_primary.close_unpaid_vtu_wallet_purchase(pg_temp.wp_scope(),
    jsonb_build_object('transactionId', c_paid)), 'an open issued payment was closed without cancelling');
  PERFORM pg_temp.wp_assert(piggyvest_primary.close_unpaid_vtu_wallet_purchase(pg_temp.wp_scope(),
    jsonb_build_object('transactionId', c_paid, 'cancelIssued', true, 'operationId', v_op)), 'a cancelled purchase was not closed');
  PERFORM pg_temp.wp_assert(pg_temp.wp_state(v_op) = 'released', 'the issued payment was not released');
  PERFORM pg_temp.wp_assert(pg_temp.wp_reserve(v_op, pg_temp.wp_proof('vtu-cancel', 'wallet_pay', 100000,
    pg_temp.wp_key(v_op, c_paid::text, 'vtu'))) ->> 'status' <> 'claimed', 'a released payment was reserved');
  -- REGRESSION (Codex P2): a stale cancel for another operation releases
  -- nothing, and a cancel must name its operation.
  UPDATE public.vtu_transactions SET status = 'pending' WHERE id = c_paid;
  v_op := pg_temp.wp_issue(c_paid::text, 100000, 'vtu') ->> 'operationId';
  PERFORM pg_temp.wp_assert(NOT piggyvest_primary.close_unpaid_vtu_wallet_purchase(pg_temp.wp_scope(),
    jsonb_build_object('transactionId', c_paid, 'cancelIssued', true,
      'operationId', 'f9a10000-0000-4000-8000-0000000000ee')), 'a stale cancel closed the purchase');
  PERFORM pg_temp.wp_assert(pg_temp.wp_state(v_op) = 'issued', 'a stale cancel released another operation');
  v_threw := false;
  BEGIN
    PERFORM piggyvest_primary.close_unpaid_vtu_wallet_purchase(pg_temp.wp_scope(),
      jsonb_build_object('transactionId', c_paid, 'cancelIssued', true));
  EXCEPTION WHEN invalid_parameter_value THEN v_threw := true;
  END;
  PERFORM pg_temp.wp_assert(v_threw, 'a cancel without its operation was accepted');
  UPDATE piggyvest_primary.wallet_payments SET state = 'released' WHERE id = v_op::uuid;
  -- A reserved payment is never released by a cancel.
  UPDATE public.vtu_transactions SET status = 'pending' WHERE id = c_paid;
  v_op := pg_temp.wp_issue(c_paid::text, 100000, 'vtu') ->> 'operationId';
  PERFORM pg_temp.wp_assert(pg_temp.wp_reserve(v_op, pg_temp.wp_proof('vtu-res-' || v_op, 'wallet_pay',
    100000, pg_temp.wp_key(v_op, c_paid::text, 'vtu'))) ->> 'status' = 'claimed', 'vtu reserve');
  PERFORM pg_temp.wp_assert(NOT piggyvest_primary.close_unpaid_vtu_wallet_purchase(pg_temp.wp_scope(),
    jsonb_build_object('transactionId', c_paid, 'cancelIssued', true, 'operationId', v_op)), 'a reserved payment was cancelled');
  PERFORM pg_temp.wp_assert(pg_temp.wp_state(v_op) <> 'released', 'a reserved payment was released');
  -- A store credit row, or another customer's row, is never touched.
  PERFORM pg_temp.wp_assert(NOT piggyvest_primary.close_unpaid_vtu_wallet_purchase(pg_temp.wp_scope(),
    jsonb_build_object('transactionId', c_credit)), 'a store credit row was closed');
  PERFORM pg_temp.wp_assert(NOT piggyvest_primary.close_unpaid_vtu_wallet_purchase(pg_temp.wp_scope(),
    jsonb_build_object('transactionId', c_other)), 'another customer''s row was closed');
  PERFORM pg_temp.wp_assert((SELECT pg_catalog.count(*) FROM public.vtu_transactions
    WHERE id IN (c_credit, c_other) AND status = 'pending') = 2, 'an untouched row changed');
  -- Strict request shape.
  v_threw := false;
  BEGIN
    PERFORM piggyvest_primary.close_unpaid_vtu_wallet_purchase(pg_temp.wp_scope(),
      jsonb_build_object('transactionId', c_paid, 'extra', 1));
  EXCEPTION WHEN invalid_parameter_value THEN v_threw := true;
  END;
  PERFORM pg_temp.wp_assert(v_threw, 'an extra request key was accepted');
  -- Only the wallet pay authorizer can call it.
  PERFORM pg_temp.wp_assert(NOT pg_catalog.has_function_privilege('authenticated',
    'piggyvest_primary.close_unpaid_vtu_wallet_purchase(jsonb,jsonb)', 'EXECUTE'), 'authenticated can close');
  PERFORM pg_temp.wp_assert(NOT pg_catalog.has_function_privilege('service_role',
    'piggyvest_primary.close_unpaid_vtu_wallet_purchase(jsonb,jsonb)', 'EXECUTE'), 'service_role can close');
  PERFORM pg_temp.wp_assert(pg_catalog.has_function_privilege('piggyvest_primary_authorizer',
    'piggyvest_primary.close_unpaid_vtu_wallet_purchase(jsonb,jsonb)', 'EXECUTE'), 'the authorizer can not close');
END;
$behaviour$;

ROLLBACK;
