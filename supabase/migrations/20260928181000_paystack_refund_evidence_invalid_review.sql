-- Allow a generic durable review for signed Paystack refunds whose
-- provider evidence is unusable AND matches no local payment. The
-- order-scoped filers need candidate orders, so without this row the
-- wedge branch throws for redelivery with no durable trace — and when
-- provider retries stop, the malformed evidence vanishes while the
-- customer may have been refunded. One open review per reference:
-- redeliveries merge refund-keyed evidence into it.

ALTER TABLE public.reconciliation_review
  DROP CONSTRAINT IF EXISTS reconciliation_review_issue_type_check;

ALTER TABLE public.reconciliation_review
  ADD CONSTRAINT reconciliation_review_issue_type_check CHECK (issue_type IN (
    'payment_match_ambiguous',
    'payment_match_zero_candidates',
    'manage_stock_cancellation_held',
    'tax_basis_unclassified',
    'tax_basis_inconsistent_total',
    'wallet_dva_order_alias_conflict',
    'wallet_dva_order_payment_replay',
    'customer_savings_auto_debit_allocation_failed',
    'wallet_order_funding_ambiguous',
    'wallet_order_funding_conflict',
    'wallet_order_funding_finalize_failed',
    'payment_received_after_cancellation',
    'payment_received_after_refund',
    'serialized_inventory_confirmation_failed',
    'merchant_settlement_failed',
    'gateway_payment_wedge_requires_review',
    'credit_direct_confirmation_missing',
    'order_cancellation_refund_requires_review',
    'paypal_capture_persist_failed',
    'merchant_invoice_partial_payment_conflict',
    'merchant_wallet_assignment_review',
    'gigl_wallet_shipping_charge_ambiguous',
    'shipment_booked_after_full_refund',
    'duplicate_payment_capture_requires_review',
    'abandoned_attempt_evidence_mismatch',
    'provider_refund_outside_cancellation',
    'order_cancellation_over_refund_requires_review',
    'partial_capture_short_requires_review',
    'paystack_refund_evidence_invalid'
  )) NOT VALID;

ALTER TABLE public.reconciliation_review
  VALIDATE CONSTRAINT reconciliation_review_issue_type_check;

-- Merge malformed-evidence entries into the open generic review for a
-- reference. Client-side read-modify-write would race concurrent
-- webhooks and drop evidence, so the merge happens atomically here.
CREATE FUNCTION public.merge_paystack_refund_evidence_invalid_v1(
  p_paystack_ref text,
  p_evidence_key text,
  p_evidence jsonb
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_review_id uuid;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(p_paystack_ref), '') IS NULL
    OR nullif(btrim(p_evidence_key), '') IS NULL
    OR p_evidence IS NULL OR jsonb_typeof(p_evidence) <> 'object' THEN
    RETURN false;
  END IF;

  SELECT id INTO v_review_id
    FROM public.reconciliation_review
    WHERE issue_type = 'paystack_refund_evidence_invalid'
      AND paystack_ref = p_paystack_ref
      AND resolved_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.reconciliation_review
    SET metadata = jsonb_set(
      coalesce(metadata, '{}'::jsonb),
      '{refund_evidence}',
      coalesce(metadata->'refund_evidence', '{}'::jsonb) ||
        jsonb_build_object(p_evidence_key, p_evidence),
      true
    )
    WHERE id = v_review_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.merge_paystack_refund_evidence_invalid_v1(text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_paystack_refund_evidence_invalid_v1(text,text,jsonb)
  TO service_role;
