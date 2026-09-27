-- Execute after the REDVAULT native fixture and migrations through 20260912090900.
-- The tests are intentionally separate from the shared runner for parent integration.

DO $$
DECLARE attempt_id uuid; order_item_id uuid; refund_id uuid; amount bigint; units jsonb; evidence jsonb;
BEGIN
  SELECT id INTO attempt_id FROM private.uba_redvault_payment_attempts LIMIT 1;
  SELECT provider_response INTO evidence FROM private.uba_redvault_payment_attempts WHERE id = attempt_id;
  IF evidence IS NULL THEN RAISE EXCEPTION 'capture fixture must record held evidence'; END IF;
  UPDATE private.uba_redvault_payment_attempts
  SET provider_response = evidence || jsonb_build_object('capture_status', 'failed', 'held_reason', 'capture_status_not_success')
  WHERE id = attempt_id;
  BEGIN
    PERFORM public.reserve_uba_redvault_refund(attempt_id, '6b5cb8a4-5575-456c-b936-8cdfae30db74', 'failed-capture', 'full_capture', NULL);
    RAISE EXCEPTION 'failed capture status accepted for automatic refund';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'redvault_refund_capture_evidence_mismatch' THEN RAISE; END IF; END;
  UPDATE private.uba_redvault_payment_attempts
  SET provider_response = evidence || jsonb_build_object('capture_amount_kobo', 1, 'held_reason', 'capture_amount_mismatch')
  WHERE id = attempt_id;
  BEGIN
    PERFORM public.reserve_uba_redvault_refund(attempt_id, '6b5cb8a4-5575-456c-b936-8cdfae30db74', 'smaller-capture', 'full_capture', NULL);
    RAISE EXCEPTION 'smaller capture accepted for expected full refund';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'redvault_refund_capture_evidence_mismatch' THEN RAISE; END IF; END;
  UPDATE private.uba_redvault_payment_attempts SET provider_response = evidence WHERE id = attempt_id;
  SELECT allocation.order_item_id INTO order_item_id FROM private.uba_redvault_line_allocations allocation
  JOIN private.uba_redvault_payment_attempts attempt ON attempt.application_id = allocation.application_id
  WHERE attempt.id = attempt_id;
  units := jsonb_build_array(jsonb_build_object('orderItemId', order_item_id, 'unitOrdinal', 1));
  SELECT id, amount_kobo INTO refund_id, amount FROM public.reserve_uba_redvault_refund(
    attempt_id, '6b5cb8a4-5575-456c-b936-8cdfae30db74', 'partial-1', 'merchandise_units',
    units
  );
  IF amount <> 9500 THEN RAISE EXCEPTION 'unit net arithmetic failed'; END IF;
  IF (SELECT count(*) FROM public.reserve_uba_redvault_refund(attempt_id, '6b5cb8a4-5575-456c-b936-8cdfae30db74', 'partial-1', 'merchandise_units', units)) <> 1 THEN
    RAISE EXCEPTION 'idempotency retry failed';
  END IF;
  BEGIN
    PERFORM public.reserve_uba_redvault_refund(attempt_id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'wrong-merchant', 'full_capture', NULL);
    RAISE EXCEPTION 'wrong merchant accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'redvault_refund_attempt_not_found' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.reserve_uba_redvault_refund(attempt_id, '6b5cb8a4-5575-456c-b936-8cdfae30db74', 'duplicate-unit', 'merchandise_units', units);
    RAISE EXCEPTION 'duplicate unit accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'redvault_refund_unit_already_reserved' THEN RAISE; END IF; END;
END $$;

DO $$
DECLARE claimed record; retried record;
BEGIN
  SELECT * INTO claimed FROM public.claim_next_uba_redvault_refund();
  IF claimed.state <> 'processing' THEN RAISE EXCEPTION 'pending refund not claimed'; END IF;
  IF (SELECT count(*) FROM public.claim_next_uba_redvault_refund()) <> 0 THEN
    RAISE EXCEPTION 'processing refund was blindly re-claimed';
  END IF;
  SELECT * INTO claimed FROM public.finish_uba_redvault_refund(claimed.id, 'failed', NULL, 'rejected');
  IF claimed.state <> 'failed' THEN RAISE EXCEPTION 'failed transition failed'; END IF;
  SELECT * INTO retried FROM public.reserve_uba_redvault_refund(
    (SELECT id FROM private.uba_redvault_payment_attempts LIMIT 1),
    '6b5cb8a4-5575-456c-b936-8cdfae30db74', 'partial-after-failure', 'merchandise_units',
    (SELECT jsonb_agg(jsonb_build_object('orderItemId', order_item_id, 'unitOrdinal', unit_ordinal))
      FROM private.uba_redvault_line_allocations LIMIT 1)
  );
  SELECT * INTO claimed FROM public.claim_next_uba_redvault_refund();
  IF claimed.id IS DISTINCT FROM retried.id THEN RAISE EXCEPTION 'released unit not retried'; END IF;
  SELECT * INTO claimed FROM public.record_uba_redvault_refund_provider_submission(claimed.id, 'provider-1', 'pending');
  IF claimed.state <> 'processing' OR claimed.provider_reference <> 'provider-1' THEN
    RAISE EXCEPTION 'accepted pending provider refund was not persisted';
  END IF;
  SELECT * INTO claimed FROM public.claim_next_uba_redvault_refund_reconciliation();
  IF claimed.reconciliation_claim_token IS NULL THEN RAISE EXCEPTION 'reconciliation was not claimed'; END IF;
  SELECT * INTO claimed FROM public.reconcile_uba_redvault_refund(claimed.id, claimed.reconciliation_claim_token, 'processed');
  IF claimed.state <> 'processed' THEN RAISE EXCEPTION 'processed transition failed'; END IF;
END $$;

SELECT 'REDVAULT refund lifecycle checks passed' AS result;
