-- Preserve the first open order review while recording provider-accepted
-- refund evidence that has no local refund row (its audit insert failed).
-- A second webhook or cron worker must not overwrite it.
CREATE FUNCTION public.merge_paystack_cancellation_refund_provider_evidence_v1(
  p_order_id uuid,
  p_merchant_id uuid,
  p_provider_refund_id bigint,
  p_payment_transaction_id uuid,
  p_reason text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_review_id uuid;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_order_id IS NULL OR p_merchant_id IS NULL
    OR p_provider_refund_id IS NULL OR p_provider_refund_id <= 0
    OR p_payment_transaction_id IS NULL
    OR nullif(btrim(p_reason), '') IS NULL THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.transactions
    WHERE id = p_payment_transaction_id AND order_id = p_order_id
      AND merchant_id = p_merchant_id AND transaction_type = 'payment'
      AND public.normalized_gateway_name_v1(gateway) = 'PAYSTACK'
  ) THEN
    RETURN false;
  END IF;

  SELECT id INTO v_review_id FROM public.reconciliation_review
    WHERE issue_type = 'order_cancellation_refund_requires_review'
      AND order_id = p_order_id AND merchant_id = p_merchant_id
      AND resolved_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.reconciliation_review
    SET metadata = jsonb_set(
      coalesce(metadata, '{}'::jsonb),
      '{refund_evidence}',
      coalesce(metadata->'refund_evidence', '{}'::jsonb) ||
        jsonb_build_object(
          'provider:' || p_provider_refund_id::text,
          jsonb_build_object(
            'reason', left(p_reason, 120),
            'payment_transaction_id', p_payment_transaction_id::text,
            'audit_record_failed', true,
            'observed_at', now()
          )
        ),
      true
    )
    WHERE id = v_review_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.merge_paystack_cancellation_refund_provider_evidence_v1(uuid,uuid,bigint,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_paystack_cancellation_refund_provider_evidence_v1(uuid,uuid,bigint,uuid,text)
  TO service_role;
