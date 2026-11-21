DO $$
DECLARE
  v_fixture jsonb := current_setting('test.bank_offer_attempt_fixture')::jsonb;
  v_merchant uuid := (v_fixture->>'merchant')::uuid;
  v_order uuid := (v_fixture->>'order')::uuid;
  v_capture jsonb := current_setting('test.bank_offer_capture_fixture')::jsonb;
  v_reference text := v_capture->>'reference';
  v_transaction uuid := (v_capture->>'transaction')::uuid;
  v_refund_claim uuid := gen_random_uuid();
BEGIN
  SET LOCAL ROLE service_role;
  IF public.get_bank_card_offer_refundable_amount(v_order, v_merchant, v_transaction, v_reference) IS DISTINCT FROM 9500
    OR public.get_bank_card_offer_refundable_amount(v_order, v_merchant, v_transaction, 'BCO-other') IS NOT NULL
  THEN RAISE EXCEPTION 'Refund worker must read only the verified discounted capture'; END IF;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.get_bank_card_offer_refundable_amount(v_order, v_merchant, v_transaction, v_reference);
    RAISE EXCEPTION 'A buyer session accessed the service-only refund lookup';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  IF NOT public.bank_card_offer_refund_capture_matches(v_order, v_merchant, v_transaction, v_reference, 9500)
    OR public.bank_card_offer_refund_capture_matches(v_order, v_merchant, v_transaction, v_reference, 10000)
  THEN RAISE EXCEPTION 'Refund must use the discounted capture'; END IF;
  INSERT INTO public.order_cancellation_side_effects(order_id, merchant_id, step, status, claim_token)
    VALUES (v_order, v_merchant, 'refund', 'claimed', v_refund_claim);
  SET LOCAL ROLE service_role;
  IF public.authorize_bank_card_offer_refund_dispatch(v_order, v_merchant, v_transaction, v_reference,
    v_refund_claim, '42', 'test', 9500) IS DISTINCT FROM true
    OR public.authorize_bank_card_offer_refund_dispatch(v_order, v_merchant, v_transaction, v_reference,
      gen_random_uuid(), '42', 'test', 9500) IS DISTINCT FROM false
    OR public.authorize_bank_card_offer_refund_dispatch(v_order, v_merchant, v_transaction, v_reference,
      v_refund_claim, '43', 'test', 9500) IS DISTINCT FROM false
  THEN RAISE EXCEPTION 'Refund admission must bind the captured provider identity and live worker claim'; END IF;
  IF has_function_privilege('authenticated', 'public.record_bank_card_offer_dispute(text,text,text,text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.begin_bank_card_offer_refund_dispatch(uuid,uuid,uuid,text,uuid,text,text,bigint)', 'EXECUTE')
  THEN RAISE EXCEPTION 'Dispute and dispatch writes must be service-only'; END IF;
  IF public.begin_bank_card_offer_refund_dispatch(v_order, v_merchant, v_transaction, v_reference,
    v_refund_claim, '42', 'test', 9500) IS DISTINCT FROM 'dispatch'
  THEN RAISE EXCEPTION 'Refund dispatch should be admitted once'; END IF;
  IF public.begin_bank_card_offer_refund_dispatch(v_order, v_merchant, v_transaction, v_reference,
    v_refund_claim, '42', 'test', 9500) IS DISTINCT FROM 'already_admitted'
  THEN RAISE EXCEPTION 'An accepted dispatch claim must survive retries'; END IF;
  RESET ROLE;
  IF NOT public.flag_bank_card_offer_terminal_review(v_order, v_merchant, v_transaction, 'failed')
  THEN RAISE EXCEPTION 'The sweep must record a confirmed failed status for a completed attempt'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.reconciliation_review
    WHERE txn_id = v_transaction AND metadata->>'source' = 'bank_card_offer_initialization'
      AND metadata->>'provider_status' = 'failed' AND resolved_at IS NULL
  ) THEN RAISE EXCEPTION 'Terminal status must use the review that suppresses stale checkout URLs'; END IF;
  IF NOT public.flag_bank_card_offer_terminal_review(v_order, v_merchant, v_transaction, 'reversed')
  THEN RAISE EXCEPTION 'Unable to persist the capture reversal before refund verification'; END IF;
  UPDATE private.bank_card_offer_payment_attempts SET paid_recheck_after = now()
    WHERE transaction_id = v_transaction;
  SET LOCAL ROLE service_role;
  IF EXISTS (
    SELECT 1 FROM public.claim_paid_bank_card_offer_recheck() c WHERE c.transaction_id = v_transaction
  ) THEN RAISE EXCEPTION 'A recorded reversal must leave the paid recheck queue'; END IF;
  RESET ROLE;
  IF public.bank_card_offer_refund_capture_matches(v_order, v_merchant, v_transaction, v_reference, 9500)
    OR public.get_bank_card_offer_refundable_amount(v_order, v_merchant, v_transaction, v_reference) IS NOT NULL
  THEN RAISE EXCEPTION 'Reconciled reversal must block another cancellation refund'; END IF;
  SET LOCAL ROLE service_role;
  IF public.authorize_bank_card_offer_refund_dispatch(v_order, v_merchant, v_transaction, v_reference,
    v_refund_claim, '42', 'test', 9500) IS DISTINCT FROM false
  THEN RAISE EXCEPTION 'A reversal recorded before refund admission must win'; END IF;
  RESET ROLE;

  IF NOT EXISTS (
    SELECT 1 FROM public.reconciliation_review
    WHERE txn_id = v_transaction AND metadata->>'provider_status' = 'reversed'
      AND metadata->>'refund_dispatch_admitted' = 'true'
  ) THEN RAISE EXCEPTION 'A late reversal must carry the admitted refund evidence'; END IF;

  -- Exercise the dispute fence without the terminal verification review.
  DELETE FROM public.reconciliation_review WHERE txn_id = v_transaction;
  UPDATE private.bank_card_offer_payment_attempts SET refund_dispatch_claim = NULL
    WHERE transaction_id = v_transaction;
  SET LOCAL ROLE service_role;
  IF public.record_bank_card_offer_dispute(v_reference, 'charge.dispute.create', '42', 'open') IS DISTINCT FROM true
    OR public.record_bank_card_offer_dispute(v_reference, 'charge.dispute.resolve', '42', 'open') IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'Signed dispute events must hold the saved capture'; END IF;
  IF public.begin_bank_card_offer_refund_dispatch(v_order, v_merchant, v_transaction, v_reference,
    v_refund_claim, '42', 'test', 9500) IS DISTINCT FROM 'blocked'
  THEN RAISE EXCEPTION 'A dispute recorded before dispatch must block the refund'; END IF;
  RESET ROLE;
  IF NOT EXISTS (
    SELECT 1 FROM public.reconciliation_review
    WHERE txn_id = v_transaction AND metadata->>'bank_offer_dispute' = 'true'
  ) THEN RAISE EXCEPTION 'Dispute evidence must be durable'; END IF;

  IF NOT public.flag_bank_card_offer_terminal_review(v_order, v_merchant, v_transaction, 'reversed')
  THEN RAISE EXCEPTION 'Unable to record the later reversal on the disputed charge'; END IF;
  IF (SELECT count(*) FROM public.reconciliation_review WHERE txn_id = v_transaction) <> 1
    OR NOT EXISTS (
      SELECT 1 FROM public.reconciliation_review WHERE txn_id = v_transaction
        AND metadata->>'source' = 'bank_card_offer_dispute'
        AND metadata->>'provider_status' = 'reversed'
    )
  THEN RAISE EXCEPTION 'The reversal must merge into the existing dispute review'; END IF;
  UPDATE private.bank_card_offer_payment_attempts SET paid_recheck_after = now()
    WHERE transaction_id = v_transaction;
  SET LOCAL ROLE service_role;
  IF EXISTS (SELECT 1 FROM public.claim_paid_bank_card_offer_recheck() c WHERE c.transaction_id = v_transaction)
  THEN RAISE EXCEPTION 'A verified reversal on a dispute must leave the recheck queue'; END IF;
  RESET ROLE;

  SET LOCAL ROLE service_role;
  IF NOT public.record_bank_card_offer_dispute(v_reference, 'charge.dispute.create', '43', 'open')
    OR NOT public.record_bank_card_offer_dispute(v_reference, 'charge.dispute.resolve', '42', 'won')
  THEN RAISE EXCEPTION 'Unable to isolate dispute outcomes by provider case'; END IF;
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM private.bank_card_offer_payment_attempts
    WHERE transaction_id = v_transaction AND dispute_hold_at IS NOT NULL)
  THEN RAISE EXCEPTION 'Winning one dispute must not clear another open dispute'; END IF;

  SET LOCAL ROLE service_role;
  IF NOT public.record_bank_card_offer_dispute(v_reference, 'charge.dispute.resolve', '43', 'won')
    OR NOT public.record_bank_card_offer_dispute(v_reference, 'charge.dispute.create', '43', 'open')
  THEN RAISE EXCEPTION 'Unable to record and replay a won dispute'; END IF;
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM private.bank_card_offer_payment_attempts
    WHERE transaction_id = v_transaction AND dispute_hold_at IS NOT NULL)
  THEN RAISE EXCEPTION 'A replay must not reinstate a dispute hold after a win'; END IF;
  IF NOT private.bank_card_offer_reversal_recorded(v_transaction)
  THEN RAISE EXCEPTION 'A won dispute must not clear an independently confirmed reversal'; END IF;

  DELETE FROM public.reconciliation_review WHERE txn_id = v_transaction;
  SET LOCAL ROLE service_role;
  IF public.get_bank_card_offer_refundable_amount(v_order, v_merchant, v_transaction, v_reference)
    IS DISTINCT FROM 9500
  THEN RAISE EXCEPTION 'Won disputes alone should permit a legitimate cancellation refund'; END IF;
  IF NOT public.record_bank_card_offer_dispute(v_reference, 'charge.dispute.resolve', '44', 'lost')
  THEN RAISE EXCEPTION 'Unable to record a lost dispute'; END IF;
  IF public.get_bank_card_offer_refundable_amount(v_order, v_merchant, v_transaction, v_reference) IS NOT NULL
  THEN RAISE EXCEPTION 'Lost dispute must continue blocking automatic refunds'; END IF;
  RESET ROLE;

  -- Inventory can leave a completed transaction attached to a pending order.
  UPDATE public.orders SET payment_status = 'pending' WHERE id = v_order;
  BEGIN
    UPDATE public.orders SET payment_status = 'paid' WHERE id = v_order;
    RAISE EXCEPTION 'Completed replay repaid an order after its reversal';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'bank_card_offer_payment_not_verified' THEN RAISE; END IF;
  END;
  IF (SELECT status FROM public.transactions WHERE id = v_transaction) <> 'completed'
    OR (SELECT payment_status FROM public.orders WHERE id = v_order) <> 'pending'
  THEN RAISE EXCEPTION 'A reversed replay changed settlement state'; END IF;
END;
$$;
