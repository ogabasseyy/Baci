-- REGRESSION TEST (behaviour): issue, PIN binding, reservation and settlement
-- of a PiggyVest wallet payment (migration 20261112161500_piggyvest_wallet_pay).
-- Registered in replay-registry folder 20261112161500_piggyvest_wallet_pay.
\set ON_ERROR_STOP on
\ir piggyvest_wallet_pay.fixture.inc.sql

DO $behaviour$
DECLARE
  v_scope jsonb := pg_temp.wp_scope();
  v_issue jsonb;
  v_op text;
  v_old text;
  v_result jsonb;
  v_binding jsonb;
BEGIN
  -- 1. A malformed request is refused, never defaulted.
  BEGIN
    PERFORM piggyvest_primary.issue_wallet_payment(v_scope,
      '{"purpose":"checkout","purchaseRef":"a1","amountKobo":100}'::jsonb);
    RAISE EXCEPTION 'an unknown purpose was issued';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM piggyvest_primary.issue_wallet_payment(v_scope,
      '{"purpose":"vtu","purchaseRef":"a1","amountKobo":"100"}'::jsonb);
    RAISE EXCEPTION 'a string amount was issued';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  -- 2. No collection wallet configured: nothing is issued.
  v_result := pg_temp.wp_issue('lookup-1');
  PERFORM pg_temp.wp_assert(v_result ->> 'status' = 'unavailable', 'no collection wallet: ' || v_result::text);
  PERFORM pg_temp.wp_assert(NOT EXISTS (SELECT 1 FROM piggyvest_primary.wallet_payments),
    'an unavailable issue wrote a payment');
  PERFORM pg_temp.wp_collection();

  -- 3. Issue, reuse, re-price.
  v_issue := pg_temp.wp_issue('lookup-1');
  v_op := v_issue ->> 'operationId';
  PERFORM pg_temp.wp_assert(v_issue ->> 'status' = 'issued' AND (v_issue ->> 'amountKobo')::bigint = 100000,
    'issue: ' || v_issue::text);
  PERFORM pg_temp.wp_assert(pg_temp.wp_issue('lookup-1') ->> 'operationId' = v_op, 'a live issued id was not reused');
  v_old := v_op;
  v_op := pg_temp.wp_issue('lookup-1', 150000) ->> 'operationId';
  PERFORM pg_temp.wp_assert(v_op <> v_old AND pg_temp.wp_state(v_old) = 'released',
    'a re-priced purchase kept the old id live');
  v_op := pg_temp.wp_issue('lookup-1') ->> 'operationId';

  -- 4. The verify route reads the binding from the issued row only.
  v_binding := piggyvest_primary.read_issued_wallet_payment(v_scope, v_op::uuid);
  PERFORM pg_temp.wp_assert(v_binding ->> 'purpose' = 'imei_check'
    AND (v_binding ->> 'amountKobo')::bigint = 100000
    AND v_binding ->> 'pinKeySha256' = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_temp.wp_key(v_op, 'lookup-1'), 'UTF8')), 'hex'), 'binding: ' || v_binding::text);
  PERFORM pg_temp.wp_assert(piggyvest_primary.read_issued_wallet_payment(v_scope,
    'f9a10000-0000-4000-8000-0000000000ee'::uuid) IS NULL, 'an invented id has a binding');

  -- 5. Wrong or missing PIN proof moves nothing.
  v_result := pg_temp.wp_reserve(v_op, NULL);
  PERFORM pg_temp.wp_assert(v_result ->> 'status' = 'pin_refused' AND v_result ->> 'reason' = 'missing',
    'missing proof: ' || v_result::text);
  v_result := pg_temp.wp_reserve(v_op, 'not-a-proof');
  PERFORM pg_temp.wp_assert(v_result ->> 'reason' = 'invalid', 'garbage proof: ' || v_result::text);
  PERFORM pg_temp.wp_proof('cheaper', 'wallet_pay', 1000, pg_temp.wp_key(v_op, 'lookup-1'));
  PERFORM pg_temp.wp_assert(pg_temp.wp_reserve(v_op, pg_temp.wp_token('cheaper')) ->> 'reason' = 'mismatch',
    'a proof for another amount was accepted');
  PERFORM pg_temp.wp_proof('other-purchase', 'wallet_pay', 100000, pg_temp.wp_key(v_op, 'lookup-2'));
  PERFORM pg_temp.wp_assert(pg_temp.wp_reserve(v_op, pg_temp.wp_token('other-purchase')) ->> 'reason' = 'mismatch',
    'a proof for another purchase was accepted');
  PERFORM pg_temp.wp_proof('goal-proof', 'imei', 100000, pg_temp.wp_key(v_op, 'lookup-1'));
  PERFORM pg_temp.wp_assert(pg_temp.wp_reserve(v_op, pg_temp.wp_token('goal-proof')) ->> 'reason' = 'mismatch',
    'a legacy IMEI proof was accepted');
  PERFORM pg_temp.wp_assert(pg_temp.wp_state(v_op) = 'issued' AND NOT pg_temp.wp_spent('cheaper')
    AND NOT pg_temp.wp_spent('other-purchase') AND NOT pg_temp.wp_spent('goal-proof'),
    'a refused proof was spent or moved the payment');
  PERFORM pg_temp.wp_assert((SELECT reference IS NULL FROM piggyvest_primary.wallet_payments WHERE id = v_op::uuid),
    'a refused payment got a provider reference');
  DELETE FROM wallet_pin_private.proofs WHERE consumed_at IS NULL;

  -- 6. A collection wallet that is a customer's own wallet is refused.
  PERFORM pg_temp.wp_collection('synthetic-walletpay-main');
  PERFORM pg_temp.wp_proof('exact', 'wallet_pay', 100000, pg_temp.wp_key(v_op, 'lookup-1'));
  v_result := pg_temp.wp_reserve(v_op, pg_temp.wp_token('exact'));
  PERFORM pg_temp.wp_assert(v_result ->> 'status' = 'unavailable' AND NOT pg_temp.wp_spent('exact'),
    'a customer wallet stood in for the collection wallet: ' || v_result::text);
  PERFORM pg_temp.wp_collection();

  -- 7. The exact proof reserves the payment once and is spent with it.
  v_result := pg_temp.wp_reserve(v_op, pg_temp.wp_token('exact'));
  PERFORM pg_temp.wp_assert(v_result ->> 'status' = 'claimed' AND pg_temp.wp_spent('exact'),
    'exact proof: ' || v_result::text);
  PERFORM pg_temp.wp_assert(v_result #>> '{reservation,reference}' = 'pvb-pay-' || v_op
    AND v_result #>> '{reservation,sourceWalletId}' = 'synthetic-walletpay-main'
    AND v_result #>> '{reservation,destinationWalletId}' = 'synthetic-walletpay-collection'
    AND (v_result #>> '{reservation,amountKobo}')::bigint = 100000, 'reservation: ' || v_result::text);
  PERFORM pg_temp.wp_assert(pg_temp.wp_reserve(v_op, pg_temp.wp_token('exact')) ->> 'status' = 'pending',
    'a replayed reserve was not pending');
  -- A second issue for the purchase answers with the live payment.
  v_issue := pg_temp.wp_issue('lookup-1');
  PERFORM pg_temp.wp_assert(v_issue ->> 'status' = 'pending' AND v_issue ->> 'operationId' = v_op,
    'a second payment was issued for a paid purchase: ' || v_issue::text);

  -- 8. Dispatch happens once.
  PERFORM pg_temp.wp_assert(piggyvest_primary.manage_wallet_payment(v_scope, v_op::uuid, 'dispatch'), 'dispatch');
  PERFORM pg_temp.wp_assert(NOT piggyvest_primary.manage_wallet_payment(v_scope, v_op::uuid, 'dispatch'),
    'a payment was dispatched twice');
  PERFORM pg_temp.wp_assert(NOT piggyvest_primary.manage_wallet_payment(v_scope, v_op::uuid, 'cancel'),
    'a dispatched payment was cancelled');

  -- 9. Settlement binds every field and settles exactly once.
  PERFORM pg_temp.wp_assert(pg_temp.wp_settle(pg_temp.wp_pay_proof(v_op, 'txn-1', 99999)) = 'conflict',
    'a wrong amount settled');
  PERFORM pg_temp.wp_assert(pg_temp.wp_settle(pg_catalog.jsonb_set(pg_temp.wp_pay_proof(v_op, 'txn-1'),
    '{destinationWalletId}', '"someone-else"')) = 'conflict', 'a foreign destination settled');
  PERFORM pg_temp.wp_assert(pg_temp.wp_release(pg_temp.wp_pay_proof(v_op, 'txn-1', 99999)) = 'conflict',
    'a wrong amount released');
  PERFORM pg_temp.wp_assert(pg_temp.wp_settle(pg_temp.wp_pay_proof(v_op, 'txn-1')) = 'confirmed', 'settle');
  PERFORM pg_temp.wp_assert(pg_temp.wp_settle(pg_temp.wp_pay_proof(v_op, 'txn-1')) = 'duplicate', 'settle replay');
  PERFORM pg_temp.wp_assert(pg_temp.wp_settle(pg_temp.wp_pay_proof(v_op, 'txn-2')) = 'conflict',
    'a second provider transaction settled the payment');
  PERFORM pg_temp.wp_assert(pg_temp.wp_release(pg_temp.wp_pay_proof(v_op, 'txn-1')) = 'conflict',
    'a confirmed payment was released');
  v_result := piggyvest_primary.read_wallet_payment_status(v_scope, v_op::uuid);
  PERFORM pg_temp.wp_assert(v_result ->> 'state' = 'confirmed' AND v_result ->> 'fulfilment' = 'awaiting',
    'status: ' || v_result::text);
  PERFORM pg_temp.wp_assert(piggyvest_primary.find_wallet_pay_transfer_by_reference(
    'f9a10000-0000-4000-8000-000000000006'::uuid, 'staging', 'pvb-pay-' || v_op) ->> 'operationId' = v_op,
    'webhook attribution by reference');

  -- 10. A failed provider record releases a dispatched payment; nothing else.
  v_op := pg_temp.wp_dispatched('lookup-3');
  PERFORM pg_temp.wp_assert(pg_temp.wp_release(pg_temp.wp_pay_proof(v_op, 'txn-3')) = 'released', 'release');
  PERFORM pg_temp.wp_assert(pg_temp.wp_release(pg_temp.wp_pay_proof(v_op, 'txn-3')) = 'duplicate', 'release replay');
  PERFORM pg_temp.wp_assert((pg_temp.wp_claim(v_op) ->> 'status') = 'not_confirmed',
    'a released payment was delivered');

  -- 11. A non-zero fee is never a clean payment.
  v_op := pg_temp.wp_dispatched('lookup-4');
  PERFORM pg_temp.wp_assert(pg_temp.wp_settle(pg_temp.wp_pay_proof(v_op, 'txn-4') || '{"feeKobo":5000}'::jsonb)
    = 'needs_review', 'a fee settled cleanly');
  PERFORM pg_temp.wp_assert((pg_temp.wp_claim(v_op) ->> 'status') = 'not_confirmed', 'a fee payment was delivered');

  -- 12. Expired ids are dead whatever the proof says.
  v_op := pg_temp.wp_issue('lookup-5') ->> 'operationId';
  UPDATE piggyvest_primary.wallet_payments SET expires_at = pg_catalog.clock_timestamp() - interval '1 second'
   WHERE id = v_op::uuid;
  PERFORM pg_temp.wp_proof('late', 'wallet_pay', 100000, pg_temp.wp_key(v_op, 'lookup-5'));
  v_result := pg_temp.wp_reserve(v_op, pg_temp.wp_token('late'));
  PERFORM pg_temp.wp_assert(v_result ->> 'status' = 'expired' AND NOT pg_temp.wp_spent('late'),
    'expired id: ' || v_result::text);

  -- 13. Nothing is callable by client roles.
  PERFORM pg_temp.wp_assert(NOT pg_catalog.has_function_privilege('authenticated',
    'piggyvest_primary.settle_wallet_payment(uuid,text,jsonb)', 'EXECUTE'), 'authenticated can settle');
  PERFORM pg_temp.wp_assert(NOT pg_catalog.has_function_privilege('anon',
    'piggyvest_primary.issue_wallet_payment(jsonb,jsonb)', 'EXECUTE'), 'anon can issue');
  PERFORM pg_temp.wp_assert(NOT pg_catalog.has_function_privilege('service_role',
    'piggyvest_primary.reserve_wallet_payment_with_pin(jsonb,jsonb,text)', 'EXECUTE'), 'service role can reserve');
  PERFORM pg_temp.wp_assert(NOT pg_catalog.has_function_privilege('piggyvest_primary_evidence',
    'piggyvest_primary.manage_wallet_payment(jsonb,uuid,text)', 'EXECUTE'), 'evidence login can dispatch');
  PERFORM pg_temp.wp_assert(NOT pg_catalog.has_function_privilege('piggyvest_primary_authorizer',
    'piggyvest_primary.settle_wallet_payment(uuid,text,jsonb)', 'EXECUTE'), 'authorizer login can settle');
END;
$behaviour$;

ROLLBACK;
