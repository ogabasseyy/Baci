-- Preserve the first open duplicate-capture review while recording each
-- additional verified capture on the same order. A second sweep worker
-- must not overwrite it.
CREATE FUNCTION public.merge_duplicate_payment_capture_evidence_v1(
  p_order_id uuid,
  p_merchant_id uuid,
  p_transaction_id uuid,
  p_gateway_reference text,
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
    OR p_transaction_id IS NULL
    OR nullif(btrim(coalesce(p_gateway_reference, '')), '') IS NULL
    OR nullif(btrim(p_reason), '') IS NULL THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.transactions
    WHERE id = p_transaction_id AND order_id = p_order_id
      AND merchant_id = p_merchant_id AND transaction_type = 'payment'
      AND gateway = 'paystack'
  ) THEN
    RETURN false;
  END IF;

  SELECT id INTO v_review_id FROM public.reconciliation_review
    WHERE issue_type = 'duplicate_payment_capture_requires_review'
      AND order_id = p_order_id AND merchant_id = p_merchant_id
      AND resolved_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.reconciliation_review
    SET metadata = jsonb_set(
      coalesce(metadata, '{}'::jsonb),
      '{captured_attempts}',
      coalesce(metadata->'captured_attempts', '{}'::jsonb) ||
        jsonb_build_object(
          p_transaction_id::text,
          jsonb_build_object(
            'gateway_reference', left(p_gateway_reference, 120),
            'reason', left(p_reason, 120),
            'observed_at', now()
          )
        ),
      true
    )
    WHERE id = v_review_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.merge_duplicate_payment_capture_evidence_v1(uuid,uuid,uuid,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_duplicate_payment_capture_evidence_v1(uuid,uuid,uuid,text,text)
  TO service_role;
