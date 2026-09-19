BEGIN;
DO $$
DECLARE original_claim record; renewed_claim record; result_row record; target_id uuid; reserved_amount bigint;
BEGIN
  SELECT refund.id, refund.amount_kobo INTO STRICT target_id, reserved_amount
  FROM private.uba_redvault_refunds refund WHERE refund.state = 'processed' LIMIT 1;
  UPDATE private.uba_redvault_refunds refund
  SET state = 'processing', processed_at = NULL, provider_status = 'pending',
    reconciliation_claim_token = NULL, reconciliation_claimed_at = NULL
  WHERE refund.id = target_id;
  SELECT * INTO original_claim FROM public.claim_next_uba_redvault_refund_reconciliation();
  IF original_claim.id IS DISTINCT FROM target_id OR original_claim.reconciliation_claim_token IS NULL THEN
    RAISE EXCEPTION 'initial reconciliation claim missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.claim_next_uba_redvault_refund_reconciliation()) THEN
    RAISE EXCEPTION 'active lease was reclaimed';
  END IF;
  UPDATE private.uba_redvault_refunds refund
  SET reconciliation_claimed_at = statement_timestamp() - interval '3 minutes' WHERE refund.id = target_id;
  BEGIN
    PERFORM public.reconcile_uba_redvault_refund(target_id, original_claim.reconciliation_claim_token, 'failed');
    RAISE EXCEPTION 'expired token accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_refund_reconciliation_claim_invalid' THEN RAISE; END IF;
  END;
  SELECT * INTO renewed_claim FROM public.claim_next_uba_redvault_refund_reconciliation();
  IF renewed_claim.id IS DISTINCT FROM target_id OR renewed_claim.reconciliation_claim_token IS NULL
    OR renewed_claim.reconciliation_claim_token = original_claim.reconciliation_claim_token THEN
    RAISE EXCEPTION 'expired claim not rotated';
  END IF;
  BEGIN
    PERFORM public.reconcile_uba_redvault_refund(target_id, original_claim.reconciliation_claim_token, 'failed');
    RAISE EXCEPTION 'stale token released reservation';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_refund_reconciliation_claim_invalid' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.reconcile_uba_redvault_refund(target_id, NULL, 'processed');
    RAISE EXCEPTION 'null fencing token accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_refund_reconciliation_claim_invalid' THEN RAISE; END IF;
  END;
  IF NOT EXISTS (SELECT 1 FROM private.uba_redvault_refunds refund
    WHERE refund.id = target_id AND refund.state = 'processing' AND refund.amount_kobo = reserved_amount)
    OR NOT EXISTS (SELECT 1 FROM private.uba_redvault_refund_line_allocations allocation
      WHERE allocation.refund_id = target_id AND allocation.released_at IS NULL) THEN
    RAISE EXCEPTION 'lease recovery lost reservation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.claim_next_uba_redvault_refund()) THEN
    RAISE EXCEPTION 'lease recovery enabled submission retry';
  END IF;
  SELECT * INTO result_row FROM public.reconcile_uba_redvault_refund(target_id, renewed_claim.reconciliation_claim_token, 'processed');
  IF result_row.state IS DISTINCT FROM 'processed' THEN RAISE EXCEPTION 'renewed token could not finish'; END IF;
END $$;
ROLLBACK;
SELECT 'REDVAULT refund reconciliation lease checks passed' AS result;
