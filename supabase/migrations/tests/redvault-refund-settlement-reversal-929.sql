DO $$
DECLARE routine_name text; caller_role text;
BEGIN
  FOREACH routine_name IN ARRAY ARRAY[
    'private.reverse_uba_redvault_merchant_settlement(uuid,uuid)',
    'private.finalize_uba_redvault_refund_settlement_reversal()',
    'private.prevent_uba_redvault_refunded_settlement()'
  ] LOOP
    FOREACH caller_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF has_function_privilege(caller_role, routine_name, 'EXECUTE') THEN
        RAISE EXCEPTION 'REDVAULT settlement reversal routine is externally executable: % %', caller_role, routine_name;
      END IF;
    END LOOP;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.merchant_settlements'::regclass
      AND tgname = 'prevent_uba_redvault_refunded_settlement'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'REDVAULT refunded-settlement prevention trigger is absent';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.test_prepare_redvault_refund_settlement_929() RETURNS void LANGUAGE plpgsql AS $$
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
SELECT public.test_prepare_redvault_refund_settlement_929();

DO $$
DECLARE
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_settlement_id uuid;
  v_refund record;
  v_claim record;
  v_net_amount numeric;
BEGIN
  SELECT * INTO STRICT v_attempt FROM private.uba_redvault_payment_attempts
  WHERE id = (SELECT attempt_id FROM public.test_attempt);

  SELECT public.record_merchant_settlement(
    v_attempt.merchant_id, 'order', v_attempt.order_id, 'paystack', v_attempt.reference,
    (SELECT amount FROM public.transactions WHERE gateway_reference = v_attempt.reference),
    0, 0, 'REDVAULT settlement fixture', '{}'::jsonb
  ) INTO v_settlement_id;
  IF v_settlement_id IS NULL THEN RAISE EXCEPTION 'fixture settlement was not recorded'; END IF;
  UPDATE public.merchant_settlements SET expected_settlement_date = current_date WHERE id = v_settlement_id;
  PERFORM public.process_due_settlements();
  SELECT net_amount INTO v_net_amount FROM public.merchant_settlements WHERE id = v_settlement_id;

  IF (SELECT status FROM public.merchant_settlements WHERE id = v_settlement_id) IS DISTINCT FROM 'settled'
    OR (SELECT available_balance FROM public.merchant_wallets WHERE merchant_id = v_attempt.merchant_id) IS DISTINCT FROM v_net_amount THEN
    RAISE EXCEPTION 'fixture settlement did not reach the merchant wallet';
  END IF;

  SELECT * INTO v_refund FROM public.reserve_uba_redvault_refund(
    v_attempt.id, v_attempt.merchant_id, '929-finish-settlement-reversal', 'full_capture', NULL
  );
  SELECT * INTO v_claim FROM public.claim_next_uba_redvault_refund();
  IF v_claim.id IS DISTINCT FROM v_refund.id THEN RAISE EXCEPTION 'fixture refund was not claimed'; END IF;
  PERFORM public.finish_uba_redvault_refund(v_refund.id, 'processed', '929-finish-provider', 'processed');

  IF (SELECT status FROM public.merchant_settlements WHERE id = v_settlement_id) IS DISTINCT FROM 'cancelled'
    OR (SELECT available_balance FROM public.merchant_wallets WHERE merchant_id = v_attempt.merchant_id) IS DISTINCT FROM 0
    OR (SELECT total_earned FROM public.merchant_wallets WHERE merchant_id = v_attempt.merchant_id) IS DISTINCT FROM 0
    OR (SELECT count(*) FROM public.wallet_transactions WHERE source_type = 'refund' AND source_id = v_refund.id) <> 1 THEN
    RAISE EXCEPTION 'processed capture refund did not reverse settled merchant funds exactly';
  END IF;

  SELECT public.record_merchant_settlement(
    v_attempt.merchant_id, 'order', v_attempt.order_id, 'paystack', v_attempt.reference,
    (SELECT amount FROM public.transactions WHERE gateway_reference = v_attempt.reference),
    0, 0, 'late REDVAULT settlement fixture', '{}'::jsonb
  ) INTO v_settlement_id;
  IF v_settlement_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.merchant_settlements WHERE status <> 'cancelled'
      AND source_id = v_attempt.order_id AND gateway_reference = v_attempt.reference)
    OR (SELECT available_balance FROM public.merchant_wallets WHERE merchant_id = v_attempt.merchant_id) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'late settlement credited a fully refunded REDVAULT capture';
  END IF;
END;
$$;
ROLLBACK;

BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT public.test_prepare_redvault_refund_settlement_929();

DO $$
DECLARE
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_settlement_id uuid;
  v_refund record;
  v_claim record;
BEGIN
  SELECT * INTO STRICT v_attempt FROM private.uba_redvault_payment_attempts
  WHERE id = (SELECT attempt_id FROM public.test_attempt);
  SELECT public.record_merchant_settlement(
    v_attempt.merchant_id, 'order', v_attempt.order_id, 'paystack', v_attempt.reference,
    (SELECT amount FROM public.transactions WHERE gateway_reference = v_attempt.reference),
    0, 0, 'REDVAULT pending settlement fixture', '{}'::jsonb
  ) INTO v_settlement_id;
  IF v_settlement_id IS NULL THEN RAISE EXCEPTION 'pending fixture settlement was not recorded'; END IF;

  SELECT * INTO v_refund FROM public.reserve_uba_redvault_refund(
    v_attempt.id, v_attempt.merchant_id, '929-reconcile-settlement-reversal', 'full_capture', NULL
  );
  PERFORM public.claim_next_uba_redvault_refund();
  PERFORM public.record_uba_redvault_refund_provider_submission(v_refund.id, '929-reconcile-provider', 'pending');
  SELECT * INTO v_claim FROM public.claim_next_uba_redvault_refund_reconciliation();
  PERFORM public.reconcile_uba_redvault_refund(v_refund.id, v_claim.reconciliation_claim_token, 'processed');

  IF (SELECT status FROM public.merchant_settlements WHERE id = v_settlement_id) IS DISTINCT FROM 'cancelled'
    OR (SELECT upcoming_balance FROM public.merchant_wallets WHERE merchant_id = v_attempt.merchant_id) IS DISTINCT FROM 0
    OR (SELECT upcoming_count FROM public.merchant_wallets WHERE merchant_id = v_attempt.merchant_id) IS DISTINCT FROM 0
    OR EXISTS (SELECT 1 FROM public.wallet_transactions WHERE source_type = 'refund' AND source_id = v_refund.id) THEN
    RAISE EXCEPTION 'reconciled capture refund did not cancel pending merchant settlement exactly';
  END IF;
END;
$$;
ROLLBACK;

SELECT 'REDVAULT 929 processed capture refunds reverse settled and pending merchant settlement balances' AS result;
