DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.transactions'::regclass
    AND conname = 'transactions_status_check' AND convalidated
    AND position('refund_pending' IN pg_get_constraintdef(oid)) > 0
    AND position('refunded' IN pg_get_constraintdef(oid)) > 0) THEN
    RAISE EXCEPTION '925 refund tests require the real 20260723000010 transaction status constraint';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.prepare_redvault_refund_925() RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_order_id uuid := (SELECT id FROM public.test_result);
BEGIN
  DELETE FROM private.uba_redvault_refund_lifecycle WHERE order_id = v_order_id;
  DELETE FROM private.uba_redvault_refund_line_allocations WHERE refund_id IN (
    SELECT refund.id FROM private.uba_redvault_refunds AS refund
    JOIN private.uba_redvault_payment_attempts AS attempt ON attempt.id = refund.attempt_id
    WHERE attempt.order_id = v_order_id
  );
  DELETE FROM private.uba_redvault_refunds WHERE attempt_id IN (
    SELECT id FROM private.uba_redvault_payment_attempts WHERE order_id = v_order_id
  );
  INSERT INTO private.uba_redvault_write_context VALUES (txid_current()) ON CONFLICT DO NOTHING;
  UPDATE public.orders SET payment_status = 'paid', amount_paid = total WHERE id = v_order_id;
  UPDATE public.transactions SET status = 'completed' WHERE order_id = v_order_id AND transaction_type = 'payment';
  DELETE FROM private.uba_redvault_write_context WHERE transaction_id = txid_current();
END;
$$;

BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT pg_temp.prepare_redvault_refund_925();

DO $$
DECLARE
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_refund record;
  v_claim record;
  v_paid numeric;
  v_inventory jsonb;
  v_count bigint;
BEGIN
  SELECT * INTO STRICT v_attempt FROM private.uba_redvault_payment_attempts
    WHERE id = (SELECT attempt_id FROM public.test_attempt);
  SELECT amount_paid INTO v_paid FROM public.orders WHERE id = v_attempt.order_id;
  SELECT jsonb_agg(to_jsonb(inventory)) INTO v_inventory FROM public.variant_inventory AS inventory;
  SELECT * INTO v_refund FROM public.reserve_uba_redvault_refund(v_attempt.id,
    v_attempt.merchant_id, '925-approved-full', 'full_capture', NULL);
  SELECT * INTO v_claim FROM public.claim_next_uba_redvault_refund();
  IF v_claim.id IS DISTINCT FROM v_refund.id THEN RAISE EXCEPTION 'unexpected refund claim'; END IF;
  PERFORM public.finish_uba_redvault_refund(v_refund.id, 'processed', '925-approved-provider', 'processed');
  IF (SELECT payment_status FROM public.orders WHERE id = v_attempt.order_id) <> 'refunded'
    OR (SELECT status FROM public.transactions WHERE gateway_reference = v_attempt.reference) <> 'refunded'
    OR (SELECT amount_paid FROM public.orders WHERE id = v_attempt.order_id) IS DISTINCT FROM v_paid THEN
    RAISE EXCEPTION 'full refund must terminalize financial state without rewriting captured amount';
  END IF;
  SELECT count(*) INTO v_count FROM public.transactions WHERE order_id = v_attempt.order_id;
  UPDATE private.uba_redvault_refunds SET state = 'processed' WHERE id = v_refund.id;
  IF (SELECT count(*) FROM private.uba_redvault_refund_lifecycle WHERE refund_id = v_refund.id) <> 1
    OR (SELECT count(*) FROM public.transactions WHERE order_id = v_attempt.order_id) <> v_count THEN
    RAISE EXCEPTION 'processed replay duplicated lifecycle or refund ledger';
  END IF;
  IF (SELECT jsonb_agg(to_jsonb(inventory)) FROM public.variant_inventory AS inventory) IS DISTINCT FROM v_inventory
    OR NOT EXISTS (SELECT 1 FROM private.uba_redvault_refund_lifecycle WHERE refund_id = v_refund.id
      AND inventory_state = 'review_required') THEN
    RAISE EXCEPTION 'ambiguous shipment or stock must remain in durable inventory review';
  END IF;
  IF private.redvault_approved_completion_durable(v_attempt.order_id) THEN
    RAISE EXCEPTION 'full refund reopened fulfillment';
  END IF;
END;
$$;
ROLLBACK;

BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT pg_temp.prepare_redvault_refund_925();
DO $$
DECLARE v_attempt private.uba_redvault_payment_attempts%ROWTYPE; v_refund record; v_claim record;
BEGIN
  SELECT * INTO STRICT v_attempt FROM private.uba_redvault_payment_attempts
    WHERE id = (SELECT attempt_id FROM public.test_attempt);
  INSERT INTO private.uba_redvault_write_context VALUES (txid_current());
  UPDATE public.orders SET payment_status = 'unpaid', amount_paid = 0 WHERE id = v_attempt.order_id;
  UPDATE public.transactions SET status = 'pending' WHERE gateway_reference = v_attempt.reference;
  UPDATE private.uba_redvault_payment_attempts SET state = 'captured_held' WHERE id = v_attempt.id;
  UPDATE private.uba_redvault_applications SET status = 'pending' WHERE id = v_attempt.application_id;
  DELETE FROM private.uba_redvault_write_context WHERE transaction_id = txid_current();
  SELECT * INTO v_refund FROM public.reserve_uba_redvault_refund(v_attempt.id,
    v_attempt.merchant_id, '925-held-full', 'full_capture', NULL);
  PERFORM public.claim_next_uba_redvault_refund();
  PERFORM public.record_uba_redvault_refund_provider_submission(v_refund.id, '925-held-provider', 'pending');
  SELECT * INTO v_claim FROM public.claim_next_uba_redvault_refund_reconciliation();
  PERFORM public.reconcile_uba_redvault_refund(v_refund.id, v_claim.reconciliation_claim_token, 'processed');
  IF (SELECT payment_status FROM public.orders WHERE id = v_attempt.order_id) <> 'refunded'
    OR (SELECT status FROM public.transactions WHERE gateway_reference = v_attempt.reference) <> 'refunded'
    OR NOT EXISTS (SELECT 1 FROM private.uba_redvault_refund_lifecycle WHERE refund_id = v_refund.id) THEN
    RAISE EXCEPTION 'held full refund reconciliation did not finalize';
  END IF;
END;
$$;
ROLLBACK;

BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT pg_temp.prepare_redvault_refund_925();
DO $$
DECLARE v_attempt private.uba_redvault_payment_attempts%ROWTYPE; v_refund record; v_units jsonb;
BEGIN
  SELECT * INTO STRICT v_attempt FROM private.uba_redvault_payment_attempts
    WHERE id = (SELECT attempt_id FROM public.test_attempt);
  SELECT jsonb_build_array(jsonb_build_object('orderItemId', order_item_id, 'unitOrdinal', unit_ordinal))
    INTO v_units FROM private.uba_redvault_line_allocations WHERE application_id = v_attempt.application_id LIMIT 1;
  SELECT * INTO v_refund FROM public.reserve_uba_redvault_refund(v_attempt.id,
    v_attempt.merchant_id, '925-partial', 'merchandise_units', v_units);
  IF private.redvault_approved_completion_durable(v_attempt.order_id) THEN RAISE EXCEPTION 'pending partial refund reopened fulfillment'; END IF;
  PERFORM public.claim_next_uba_redvault_refund();
  PERFORM public.finish_uba_redvault_refund(v_refund.id, 'processed', '925-partial-provider', 'processed');
  IF NOT EXISTS (SELECT 1 FROM private.uba_redvault_refund_lifecycle WHERE refund_id = v_refund.id
    AND review_reason = 'partial_units_require_fulfillment_reconciliation')
    OR private.redvault_approved_completion_durable(v_attempt.order_id)
    OR (SELECT payment_status FROM public.orders WHERE id = v_attempt.order_id) <> 'paid' THEN
    RAISE EXCEPTION 'partial units must remain protected pending reconciliation';
  END IF;
  BEGIN
    PERFORM public.reserve_uba_redvault_refund(v_attempt.id, v_attempt.merchant_id,
      '925-double-partial', 'merchandise_units', v_units);
    RAISE EXCEPTION 'processed unit was refundable twice';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_refund_unit_already_reserved' THEN RAISE; END IF;
  END;
END;
$$;
ROLLBACK;
SELECT 'REDVAULT 925 full refund finish/reconciliation and partial-unit safeguards passed' AS result;
