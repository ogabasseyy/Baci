-- Round-8 P1 regression: indeterminate refund submissions (provider timeout,
-- non-2xx, or unverifiable response) park in needs_reconciliation without a
-- provider reference, yet stay recoverable: the reconciliation claim selects
-- them for lookup through the original capture reference, and reconcile
-- resolves them back to processing/failed so reserve v2 is unblocked.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  v_order uuid := '10000000-0000-4000-8000-000000000031';
  v_application uuid := 'd1000000-0000-4000-8000-000000000031';
  v_attempt uuid := 'd2000000-0000-4000-8000-000000000031';
  v_refund_a uuid := 'e1000000-0000-4000-8000-000000000031';
  v_refund_b uuid := 'e1000000-0000-4000-8000-000000000032';
  v_discount uuid := 'f0000000-0000-4000-8000-000000000031';
  v_hash text := '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  v_claim_id uuid;
  v_token uuid;
  v_attempt_ref text;
  v_state text;
  v_count integer;
BEGIN
  -- Orders writes must ride the protected path like production writers do.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.merchants (id, email, business_name)
  VALUES (v_merchant, 'redvault-p8@example.com', 'Redvault P8')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.discount_codes (id, merchant_id, code, discount_type, discount_value)
  VALUES (v_discount, v_merchant, 'R8P1', 'fixed_amount', 100);
  -- Mirror ops activation so applications pass commercial-terms validation.
  UPDATE private.uba_redvault_runtime
  SET commercial_terms_confirmed = true,
      commercial_terms = jsonb_build_object(
        'campaign_dates', jsonb_build_object(
          'starts_at', '2020-01-01T00:00:00Z', 'ends_at', '2030-01-01T00:00:00Z'),
        'minimum_spend', jsonb_build_object('eligible_subtotal_kobo', 1000),
        'caps', jsonb_build_object('discount_kobo', 1000000),
        'usage_limits', jsonb_build_object(
          'usage_limit', 1000000, 'usage_limit_per_customer', 1000000))
  WHERE partnership = 'uba_redvault';
  INSERT INTO public.orders (id, merchant_id, order_number, total, payment_method)
  VALUES (v_order, v_merchant, 'R8P1', 1500.00, 'uba_redvault');
  INSERT INTO private.uba_redvault_applications
    (id, order_id, discount_code_id, merchant_id, quote_version_id, quote_payload_hash,
     quote_payload, customer_email, checkout_key, request_hash,
     discount_kobo, eligible_subtotal_kobo, status)
  VALUES
    (v_application, v_order, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p8@example.com', 'R8P1', 'R8P1', 100, 150000, 'pending');
  INSERT INTO private.uba_redvault_payment_attempts
    (id, application_id, order_id, merchant_id, reference, quote_payload_hash,
     amount_kobo, currency, state)
  VALUES
    (v_attempt, v_application, v_order, v_merchant, 'R8P1-ATTEMPT', v_hash,
     150000, 'NGN', 'created');
  INSERT INTO private.uba_redvault_refunds (id, attempt_id, state, refund_type, idempotency_key, amount_kobo)
  VALUES
    (v_refund_a, v_attempt, 'needs_reconciliation', 'merchandise_units', 'R8P1-A', 10000),
    (v_refund_b, v_attempt, 'needs_reconciliation', 'merchandise_units', 'R8P1-B', 10000);

  -- The reconciliation claim picks up the reference-less indeterminate row
  -- for lookup through the original capture reference.
  SELECT id, reconciliation_claim_token, attempt_reference
  INTO v_claim_id, v_token, v_attempt_ref
  FROM public.claim_next_uba_redvault_refund_reconciliation();
  IF v_claim_id IS NULL OR v_token IS NULL THEN
    RAISE EXCEPTION 'indeterminate refund was not claimable';
  END IF;
  IF v_attempt_ref <> 'R8P1-ATTEMPT' THEN
    RAISE EXCEPTION 'claim did not carry the capture reference: %', v_attempt_ref;
  END IF;

  -- A pending lookup returns the refund to processing.
  PERFORM public.reconcile_uba_redvault_refund(v_claim_id, v_token, 'pending');
  SELECT state INTO v_state FROM private.uba_redvault_refunds WHERE id = v_claim_id;
  IF v_state <> 'processing' THEN
    RAISE EXCEPTION 'reconcile did not return to processing, got %', v_state;
  END IF;

  -- A failed lookup finalizes the sibling, clearing the reserve v2 block.
  SELECT id, reconciliation_claim_token INTO v_claim_id, v_token
  FROM public.claim_next_uba_redvault_refund_reconciliation();
  PERFORM public.reconcile_uba_redvault_refund(v_claim_id, v_token, 'failed');
  SELECT state INTO v_state FROM private.uba_redvault_refunds WHERE id = v_claim_id;
  IF v_state <> 'failed' THEN
    RAISE EXCEPTION 'reconcile did not finalize, got %', v_state;
  END IF;
  SELECT count(*) INTO v_count FROM private.uba_redvault_refunds
  WHERE attempt_id = v_attempt AND state = 'needs_reconciliation';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'needs_reconciliation rows remain: %', v_count;
  END IF;

  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

RESET ROLE;
ROLLBACK;
