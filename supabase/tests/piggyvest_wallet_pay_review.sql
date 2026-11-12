-- REGRESSION TEST (review findings on #4218): claim tokens, fee-failed
-- records, late successes, refund attempts, webhook acknowledgement, stale
-- reservations and the deletion fence (migration 20261112161500_piggyvest_wallet_pay).
-- Registered in replay-registry folder 20261112161500_piggyvest_wallet_pay.
\set ON_ERROR_STOP on
\ir piggyvest_wallet_pay.fixture.inc.sql

DO $behaviour$
DECLARE
  c_integration constant uuid := 'f9a10000-0000-4000-8000-000000000006';
  v_scope jsonb := pg_temp.wp_scope();
  v_op text;
  v_late text;
  v_claim jsonb;
  v_stale uuid;
  v_found jsonb;
  v_refund jsonb;
BEGIN
  PERFORM pg_temp.wp_collection();

  -- 1. Only the current claimant finishes delivery.
  v_op := pg_temp.wp_dispatched('rv-1');
  PERFORM pg_temp.wp_settle(pg_temp.wp_pay_proof(v_op, 'txn-rv-1'));
  v_claim := pg_temp.wp_claim(v_op);
  v_stale := (v_claim ->> 'claimToken')::uuid;
  PERFORM pg_temp.wp_assert(v_stale IS NOT NULL, 'claim returned no token');
  UPDATE piggyvest_primary.wallet_payments SET fulfilment_claimed_at = pg_catalog.clock_timestamp() - interval '11 minutes'
   WHERE id = v_op::uuid;
  v_claim := pg_temp.wp_claim(v_op);
  PERFORM pg_temp.wp_assert(v_claim ->> 'status' = 'reclaimed' AND (v_claim ->> 'claimToken')::uuid <> v_stale,
    'a reclaim kept the old token: ' || v_claim::text);
  PERFORM pg_temp.wp_assert(pg_temp.wp_finish_with(v_op, 'failed', v_stale) = 'conflict',
    'a worker past its lease finished the delivery');
  PERFORM pg_temp.wp_assert(pg_temp.wp_finish_with(v_op, 'fulfilled', NULL) = 'conflict', 'a tokenless finish was accepted');
  PERFORM pg_temp.wp_assert(pg_temp.wp_finish(v_op, 'fulfilled') = 'fulfilled', 'the current claimant could not finish');

  -- 2. A FAILED record that still charged a fee is never released.
  v_op := pg_temp.wp_dispatched('rv-2');
  PERFORM pg_temp.wp_assert(pg_temp.wp_release(pg_temp.wp_pay_proof(v_op, 'txn-rv-2') || '{"feeKobo":5000}'::jsonb) = 'needs_review',
    'a fee-charged failure was released');
  PERFORM pg_temp.wp_assert(pg_temp.wp_state(v_op) = 'needs_review', 'fee-charged failure state');
  PERFORM pg_temp.wp_assert(pg_temp.wp_release(pg_temp.wp_pay_proof(v_op, 'txn-rv-2') || '{"feeKobo":5000}'::jsonb) = 'duplicate',
    'fee-charged failure replay');

  -- 3. A late success decided while another attempt is in flight is durable.
  v_late := pg_temp.wp_dispatched('rv-3');
  PERFORM piggyvest_primary.manage_wallet_payment(v_scope, v_late::uuid, 'release');
  v_op := pg_temp.wp_dispatched('rv-3');
  PERFORM pg_temp.wp_assert(pg_temp.wp_settle(pg_temp.wp_pay_proof(v_late, 'txn-rv-3-late')) = 'deferred', 'deferred');
  PERFORM pg_temp.wp_assert((SELECT review_reason FROM piggyvest_primary.wallet_payments WHERE id = v_late::uuid) = 'late_success_deferred',
    'a deferred late success left no obligation');
  UPDATE piggyvest_primary.wallet_payments SET dispatched_at = pg_catalog.clock_timestamp() - interval '3 days'
   WHERE id = v_late::uuid;
  PERFORM pg_temp.wp_assert(piggyvest_primary.list_wallet_pay_work(c_integration, 'staging', 200) -> 'settle' ? v_late,
    'a deferred late success fell out of the work list after two days');
  PERFORM pg_temp.wp_assert(EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(
      piggyvest_primary.read_wallet_pay_reconciliation(c_integration, 'staging', '{}') -> 'needsReview') AS item
      WHERE item ->> 'operationId' = v_late), 'a deferred late success is not in the review report');

  -- 4. Webhook attribution: settled transfers are acknowledged, and a refund
  -- webhook is judged against the exact attempt it names.
  v_op := pg_temp.wp_dispatched('rv-4');
  PERFORM pg_temp.wp_settle(pg_temp.wp_pay_proof(v_op, 'txn-rv-4'));
  v_found := piggyvest_primary.find_wallet_pay_transfer_by_reference(c_integration, 'staging', 'pvb-pay-' || v_op);
  PERFORM pg_temp.wp_assert((v_found ->> 'settled')::boolean AND v_found ->> 'reference' = 'pvb-pay-' || v_op,
    'a settled payment was not acknowledged: ' || v_found::text);
  PERFORM pg_temp.wp_claim(v_op);
  PERFORM pg_temp.wp_finish(v_op, 'failed');
  v_refund := piggyvest_primary.read_owed_wallet_refund(c_integration, 'staging', v_op::uuid);
  PERFORM piggyvest_primary.manage_wallet_refund(c_integration, 'staging', (v_refund ->> 'refundId')::uuid, 'dispatch');
  PERFORM piggyvest_primary.release_failed_wallet_refund(c_integration, 'staging', pg_temp.wp_refund_proof(v_op, 'txn-rv-4-r0'));
  v_refund := piggyvest_primary.read_owed_wallet_refund(c_integration, 'staging', v_op::uuid);
  PERFORM piggyvest_primary.manage_wallet_refund(c_integration, 'staging', (v_refund ->> 'refundId')::uuid, 'dispatch');
  PERFORM pg_temp.wp_assert(piggyvest_primary.read_wallet_refund_attempt(c_integration, 'staging', 'pvb-refund-' || v_op) ->> 'reference'
    = 'pvb-refund-' || v_op, 'the named (earlier) refund attempt could not be loaded');
  PERFORM pg_temp.wp_assert(piggyvest_primary.read_dispatched_wallet_refund(c_integration, 'staging', v_op::uuid) ->> 'reference'
    = 'pvb-refund-' || v_op || '-1', 'the payment-level read did not prefer the attempt in flight');

  -- 5. A late success of the released attempt freezes further refund attempts.
  PERFORM pg_temp.wp_assert(piggyvest_primary.settle_wallet_refund(c_integration, 'staging',
    pg_temp.wp_refund_proof(v_op, 'txn-rv-4-r0-late')) = 'needs_review', 'late refund success');
  PERFORM piggyvest_primary.release_failed_wallet_refund(c_integration, 'staging', pg_temp.wp_refund_proof(v_op, 'txn-rv-4-r1', 1));
  PERFORM pg_temp.wp_assert(piggyvest_primary.read_owed_wallet_refund(c_integration, 'staging', v_op::uuid) IS NULL,
    'a refund retry was opened after a late refund success');

  -- 6. A reservation that was never sent is released by the worker after 5 minutes.
  v_op := pg_temp.wp_reserved('rv-6');
  PERFORM pg_temp.wp_assert(NOT piggyvest_primary.release_stale_wallet_payment(c_integration, 'staging', v_op::uuid),
    'a fresh reservation was released');
  UPDATE piggyvest_primary.wallet_payments SET reserved_at = pg_catalog.clock_timestamp() - interval '6 minutes' WHERE id = v_op::uuid;
  PERFORM pg_temp.wp_assert(piggyvest_primary.release_stale_wallet_payment(c_integration, 'staging', v_op::uuid)
    AND pg_temp.wp_state(v_op) = 'released', 'a stale reservation was not released');

  -- 7. Deletion waits while a released send can still settle late.
  UPDATE piggyvest_primary.wallet_payments SET review_reason = NULL;
  DELETE FROM piggyvest_primary.wallet_payment_refunds;
  UPDATE piggyvest_primary.wallet_payments SET state = 'released', fulfilment = 'awaiting', provider_transaction_id = NULL;
  UPDATE piggyvest_primary.wallet_payments SET dispatched_at = pg_catalog.clock_timestamp() - interval '1 hour'
   WHERE id = v_late::uuid;
  BEGIN
    DELETE FROM public.customers WHERE id = 'f9a10000-0000-4000-8000-000000000003';
    RAISE EXCEPTION 'a customer with a reconcilable released send was deleted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM NOT LIKE 'cannot delete customer with unsettled wallet payments%' THEN RAISE; END IF;
  END;
END;
$behaviour$;

ROLLBACK;
