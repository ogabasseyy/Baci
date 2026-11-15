-- REGRESSION TEST (behaviour): delivery claims and exactly-once refunds of
-- PiggyVest wallet payments (migration 20261112161500_piggyvest_wallet_pay).
-- Registered in replay-registry folder 20261112161500_piggyvest_wallet_pay.
\set ON_ERROR_STOP on
\ir piggyvest_wallet_pay.fixture.inc.sql

DO $behaviour$
DECLARE
  c_integration constant uuid := 'f9a10000-0000-4000-8000-000000000006';
  v_scope jsonb := pg_temp.wp_scope();
  v_op text;
  v_late text;
  v_result jsonb;
  v_refund jsonb;
BEGIN
  PERFORM pg_temp.wp_collection();

  -- 1. Nothing is delivered before the payment is confirmed.
  v_op := pg_temp.wp_dispatched('lookup-r1');
  PERFORM pg_temp.wp_assert(pg_temp.wp_claim(v_op) ->> 'status' = 'not_confirmed', 'a pending payment was claimed');
  PERFORM pg_temp.wp_assert(pg_temp.wp_finish(v_op, 'failed') = 'conflict', 'a pending payment owed a refund');
  PERFORM pg_temp.wp_assert(pg_temp.wp_refunds(v_op) = 0, 'a pending payment opened a refund');
  PERFORM pg_temp.wp_assert(pg_temp.wp_settle(pg_temp.wp_pay_proof(v_op, 'txn-r1')) = 'confirmed', 'settle');

  -- 2. One claimant delivers.
  v_result := pg_temp.wp_claim(v_op);
  PERFORM pg_temp.wp_assert(v_result ->> 'status' = 'claimed' AND v_result ->> 'purchaseRef' = 'lookup-r1',
    'claim: ' || v_result::text);
  PERFORM pg_temp.wp_assert(pg_temp.wp_claim(v_op) ->> 'status' = 'busy', 'a second claimant was let in');
  -- A stale claim is handed back as reclaimed (the product recovers idempotently).
  UPDATE piggyvest_primary.wallet_payments SET fulfilment_claimed_at = pg_catalog.clock_timestamp() - interval '11 minutes'
   WHERE id = v_op::uuid;
  PERFORM pg_temp.wp_assert(pg_temp.wp_claim(v_op) ->> 'status' = 'reclaimed', 'a stale claim was not reclaimable');

  -- 3. A failed delivery owes exactly one refund of exactly the paid amount.
  PERFORM pg_temp.wp_assert(pg_temp.wp_finish(v_op, 'failed') = 'refund_owed', 'failed delivery');
  PERFORM pg_temp.wp_assert(pg_temp.wp_finish(v_op, 'failed') = 'duplicate', 'failed replay');
  PERFORM pg_temp.wp_assert(pg_temp.wp_finish(v_op, 'fulfilled') = 'conflict', 'a refunded purchase was delivered');
  PERFORM pg_temp.wp_assert(pg_temp.wp_claim(v_op) ->> 'status' = 'refund_owed', 'a refund-owed payment was claimed');
  PERFORM pg_temp.wp_assert(pg_temp.wp_refunds(v_op) = 1, 'refund rows after failure');
  v_refund := piggyvest_primary.read_owed_wallet_refund(c_integration, 'staging', v_op::uuid);
  PERFORM pg_temp.wp_assert((v_refund ->> 'amountKobo')::bigint = 100000
    AND v_refund ->> 'sourceWalletId' = 'synthetic-walletpay-collection'
    AND v_refund ->> 'destinationWalletId' = 'synthetic-walletpay-main'
    AND v_refund ->> 'reference' = 'pvb-refund-' || v_op, 'refund reservation: ' || v_refund::text);

  -- 4. A refund attempt dispatches once; a definitive failure moves to a NEW
  -- reference; the success settles once and marks the payment refunded.
  PERFORM pg_temp.wp_assert(piggyvest_primary.manage_wallet_refund(c_integration, 'staging',
    (v_refund ->> 'refundId')::uuid, 'dispatch'), 'refund dispatch');
  PERFORM pg_temp.wp_assert(NOT piggyvest_primary.manage_wallet_refund(c_integration, 'staging',
    (v_refund ->> 'refundId')::uuid, 'dispatch'), 'a refund was dispatched twice');
  PERFORM pg_temp.wp_assert(piggyvest_primary.read_owed_wallet_refund(c_integration, 'staging', v_op::uuid) IS NULL,
    'a dispatched refund is still owed');
  PERFORM pg_temp.wp_assert(piggyvest_primary.release_failed_wallet_refund(c_integration, 'staging',
    pg_temp.wp_refund_proof(v_op, 'txn-rf0')) = 'released', 'refund release');
  PERFORM pg_temp.wp_assert(piggyvest_primary.release_failed_wallet_refund(c_integration, 'staging',
    pg_temp.wp_refund_proof(v_op, 'txn-rf0')) = 'duplicate', 'refund release replay');
  v_refund := piggyvest_primary.read_owed_wallet_refund(c_integration, 'staging', v_op::uuid);
  PERFORM pg_temp.wp_assert(v_refund ->> 'reference' = 'pvb-refund-' || v_op || '-1',
    'the retry reused a reference: ' || COALESCE(v_refund::text, 'null'));
  PERFORM pg_temp.wp_assert(piggyvest_primary.manage_wallet_refund(c_integration, 'staging',
    (v_refund ->> 'refundId')::uuid, 'dispatch'), 'refund retry dispatch');
  PERFORM pg_temp.wp_assert(piggyvest_primary.settle_wallet_refund(c_integration, 'staging',
    pg_temp.wp_refund_proof(v_op, 'txn-rf1', 1) || '{"amountKobo":99999}'::jsonb) = 'conflict', 'a short refund settled');
  PERFORM pg_temp.wp_assert(piggyvest_primary.settle_wallet_refund(c_integration, 'staging',
    pg_temp.wp_refund_proof(v_op, 'txn-rf1', 1)) = 'confirmed', 'refund settle');
  PERFORM pg_temp.wp_assert(piggyvest_primary.settle_wallet_refund(c_integration, 'staging',
    pg_temp.wp_refund_proof(v_op, 'txn-rf1', 1)) = 'duplicate', 'refund settle replay');
  PERFORM pg_temp.wp_assert(pg_temp.wp_fulfilment(v_op) = 'refunded', 'payment not marked refunded');
  PERFORM pg_temp.wp_assert((SELECT pg_catalog.count(*) FROM piggyvest_primary.wallet_payment_refunds
    WHERE payment_id = v_op::uuid AND state = 'confirmed') = 1, 'more than one refund confirmed');
  -- The original (released) attempt turning up successful late would refund
  -- twice: it is never confirmed.
  PERFORM pg_temp.wp_assert(piggyvest_primary.settle_wallet_refund(c_integration, 'staging',
    pg_temp.wp_refund_proof(v_op, 'txn-rf0-late')) = 'needs_review', 'a late second refund settled');
  PERFORM pg_temp.wp_assert((SELECT pg_catalog.count(*) FROM piggyvest_primary.wallet_payment_refunds
    WHERE payment_id = v_op::uuid AND state = 'confirmed') = 1, 'a late refund was confirmed');
  -- REGRESSION (Codex P2): the proven late success is still recorded (its
  -- provider record kept for review), and its replay is a duplicate.
  PERFORM pg_temp.wp_assert((SELECT refund.state = 'released'
      AND refund.provider_transaction_id = 'txn-rf0-late'
      AND refund.settled_at IS NOT NULL
      AND refund.review_reason = 'late_refund_success'
      FROM piggyvest_primary.wallet_payment_refunds AS refund
     WHERE refund.payment_id = v_op::uuid AND refund.attempt = 0), 'the late refund success was not recorded');
  PERFORM pg_temp.wp_assert(piggyvest_primary.settle_wallet_refund(c_integration, 'staging',
    pg_temp.wp_refund_proof(v_op, 'txn-rf0-late')) = 'duplicate', 'a recorded late refund replayed as new');

  -- 5. A delivered purchase owes nothing.
  v_op := pg_temp.wp_dispatched('lookup-r2');
  PERFORM pg_temp.wp_settle(pg_temp.wp_pay_proof(v_op, 'txn-r2'));
  PERFORM pg_temp.wp_claim(v_op);
  PERFORM pg_temp.wp_assert(pg_temp.wp_finish(v_op, 'fulfilled') = 'fulfilled', 'delivery');
  PERFORM pg_temp.wp_assert(pg_temp.wp_finish(v_op, 'failed') = 'conflict', 'a delivered purchase owed a refund');
  PERFORM pg_temp.wp_assert(pg_temp.wp_refunds(v_op) = 0, 'a delivered purchase opened a refund');

  -- 6. Paid twice: an attempt released after dispatch turns out successful while
  -- another payment already covers the purchase. It is confirmed straight into
  -- a refund, never delivered.
  v_late := pg_temp.wp_dispatched('lookup-r3');
  PERFORM pg_temp.wp_assert(piggyvest_primary.manage_wallet_payment(v_scope, v_late::uuid, 'release'), 'release');
  v_op := pg_temp.wp_dispatched('lookup-r3');
  -- While the newer attempt is unresolved nothing is decided.
  PERFORM pg_temp.wp_assert(pg_temp.wp_settle(pg_temp.wp_pay_proof(v_late, 'txn-r3-late')) = 'deferred',
    'a late success was decided while another attempt was in flight');
  PERFORM pg_temp.wp_assert(pg_temp.wp_settle(pg_temp.wp_pay_proof(v_op, 'txn-r3')) = 'confirmed', 'settle newer');
  PERFORM pg_temp.wp_assert(pg_temp.wp_settle(pg_temp.wp_pay_proof(v_late, 'txn-r3-late')) = 'refunding',
    'a duplicate payment was not refunded');
  PERFORM pg_temp.wp_assert(pg_temp.wp_fulfilment(v_late) = 'refund_owed' AND pg_temp.wp_refunds(v_late) = 1,
    'the duplicate payment owes no refund');
  PERFORM pg_temp.wp_assert(pg_temp.wp_claim(v_late) ->> 'status' = 'refund_owed', 'a duplicate payment was delivered');
  PERFORM pg_temp.wp_assert(pg_temp.wp_claim(v_op) ->> 'status' = 'claimed', 'the real payment lost delivery');

  -- 7. The drain sees owed refunds and undelivered payments.
  v_result := piggyvest_primary.list_wallet_pay_work(c_integration, 'staging', 50);
  PERFORM pg_temp.wp_assert(v_result -> 'refund' ? v_late, 'the drain misses an owed refund: ' || v_result::text);

  -- 8. Customer deletion waits for an owed refund.
  -- Only this guard is armed: other triggers on public.customers raise their
  -- own errors on the real schema before ours would run.
  ALTER TABLE public.customers DISABLE TRIGGER USER;
  ALTER TABLE public.customers ENABLE TRIGGER primary_wallet_pay_block_unsettled_customer_deletion;
  BEGIN
    DELETE FROM public.customers WHERE id = 'f9a10000-0000-4000-8000-000000000003';
    RAISE EXCEPTION 'a customer with an owed refund was deleted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM NOT LIKE 'cannot delete customer with unsettled wallet payments%' THEN RAISE; END IF;
  END;
  ALTER TABLE public.customers ENABLE TRIGGER USER;

  -- 9. REGRESSION (Codex P1/P2): a duplicate payment's refund keeps retrying
  -- when an attempt is rejected (its own review reason does not freeze it),
  -- and a fee-free refund clears that reason, so the payment leaves the
  -- review report and the customer deletion fence.
  PERFORM pg_temp.wp_assert((SELECT review_reason FROM piggyvest_primary.wallet_payments WHERE id = v_late::uuid)
    = 'duplicate_payment', 'the duplicate payment has no duplicate_payment review reason');
  v_refund := piggyvest_primary.read_owed_wallet_refund(c_integration, 'staging', v_late::uuid);
  PERFORM pg_temp.wp_assert(piggyvest_primary.manage_wallet_refund(c_integration, 'staging',
    (v_refund ->> 'refundId')::uuid, 'dispatch'), 'duplicate refund dispatch');
  PERFORM pg_temp.wp_assert(piggyvest_primary.release_failed_wallet_refund(c_integration, 'staging',
    pg_temp.wp_refund_proof(v_late, 'txn-r3-rf0')) = 'released', 'duplicate refund release');
  v_refund := piggyvest_primary.read_owed_wallet_refund(c_integration, 'staging', v_late::uuid);
  PERFORM pg_temp.wp_assert(v_refund ->> 'reference' = 'pvb-refund-' || v_late || '-1',
    'a rejected duplicate refund opened no retry: ' || COALESCE(v_refund::text, 'null'));
  PERFORM pg_temp.wp_assert(piggyvest_primary.manage_wallet_refund(c_integration, 'staging',
    (v_refund ->> 'refundId')::uuid, 'dispatch'), 'duplicate refund retry dispatch');
  PERFORM pg_temp.wp_assert(piggyvest_primary.settle_wallet_refund(c_integration, 'staging',
    pg_temp.wp_refund_proof(v_late, 'txn-r3-rf1', 1)) = 'confirmed', 'duplicate refund settle');
  PERFORM pg_temp.wp_assert(pg_temp.wp_fulfilment(v_late) = 'refunded'
    AND (SELECT review_reason IS NULL FROM piggyvest_primary.wallet_payments WHERE id = v_late::uuid),
    'a refunded duplicate kept its review reason');
  -- 10. REGRESSION (Codex P1): a payment already marked refunded (a late
  -- success of an older attempt committed first) never gets another attempt
  -- when a live attempt is then released: nothing is left to be sent twice.
  v_op := pg_temp.wp_dispatched('lookup-r10');
  PERFORM pg_temp.wp_settle(pg_temp.wp_pay_proof(v_op, 'txn-r10'));
  PERFORM pg_temp.wp_claim(v_op);
  PERFORM pg_temp.wp_assert(pg_temp.wp_finish(v_op, 'failed') = 'refund_owed', 'r10 failed delivery');
  v_refund := piggyvest_primary.read_owed_wallet_refund(c_integration, 'staging', v_op::uuid);
  PERFORM pg_temp.wp_assert(piggyvest_primary.manage_wallet_refund(c_integration, 'staging',
    (v_refund ->> 'refundId')::uuid, 'dispatch'), 'r10 dispatch');
  UPDATE piggyvest_primary.wallet_payments SET fulfilment = 'refunded' WHERE id = v_op::uuid;
  PERFORM pg_temp.wp_assert(piggyvest_primary.manage_wallet_refund(c_integration, 'staging',
    (v_refund ->> 'refundId')::uuid, 'release'), 'r10 release');
  PERFORM pg_temp.wp_assert(pg_temp.wp_refunds(v_op) = 1, 'a refunded payment got another refund attempt');

  -- 11. REGRESSION (Codex P2): an attempt released after a definitive
  -- rejection, later indexed as failed WITH a fee, keeps that evidence and
  -- retires the unsent replacement, so a person decides.
  v_op := pg_temp.wp_dispatched('lookup-r11');
  PERFORM pg_temp.wp_settle(pg_temp.wp_pay_proof(v_op, 'txn-r11'));
  PERFORM pg_temp.wp_claim(v_op);
  PERFORM pg_temp.wp_assert(pg_temp.wp_finish(v_op, 'failed') = 'refund_owed', 'r11 failed delivery');
  v_refund := piggyvest_primary.read_owed_wallet_refund(c_integration, 'staging', v_op::uuid);
  PERFORM pg_temp.wp_assert(piggyvest_primary.manage_wallet_refund(c_integration, 'staging',
    (v_refund ->> 'refundId')::uuid, 'dispatch'), 'r11 dispatch');
  PERFORM pg_temp.wp_assert(piggyvest_primary.manage_wallet_refund(c_integration, 'staging',
    (v_refund ->> 'refundId')::uuid, 'release'), 'r11 release');
  PERFORM pg_temp.wp_assert(pg_temp.wp_refunds(v_op) = 2, 'r11 retry not opened');
  PERFORM pg_temp.wp_assert(piggyvest_primary.release_failed_wallet_refund(c_integration, 'staging',
    pg_temp.wp_refund_proof(v_op, 'txn-r11-fee') || '{"feeKobo":5000}'::jsonb) = 'needs_review',
    'a late fee on a released refund was dropped as a duplicate');
  PERFORM pg_temp.wp_assert((SELECT review_reason FROM piggyvest_primary.wallet_payments WHERE id = v_op::uuid)
    = 'refund_failed_with_fee', 'the late fee did not reach the payment review reason');
  PERFORM pg_temp.wp_assert(pg_temp.wp_refunds(v_op) = 1, 'the unsent replacement was not retired');
END;
$behaviour$;

ROLLBACK;
