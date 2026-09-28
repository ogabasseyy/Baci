-- Merge leg-level cancellation evidence into the first open order review.
-- When another leg already opened the order-level review, a second
-- quarantine (ambiguous initiation failure, later-leg failure, or a
-- preflight over unrecoverable legs) must not discard its own reason,
-- accepted provider IDs, and leg candidates: merge them under the leg key
-- alongside the provider-ID evidence merged by
-- merge_paystack_cancellation_refund_provider_evidence_v1.
CREATE FUNCTION public.merge_paystack_cancellation_refund_leg_evidence_v1(
  p_order_id uuid,
  p_merchant_id uuid,
  p_payment_transaction_id uuid,
  p_reason text,
  p_accepted_refund_ids jsonb,
  p_candidates jsonb
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_review_id uuid;
  v_candidates jsonb;
  v_new_candidates jsonb;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_order_id IS NULL OR p_merchant_id IS NULL
    OR p_payment_transaction_id IS NULL
    OR nullif(btrim(p_reason), '') IS NULL
    OR (p_accepted_refund_ids IS NOT NULL
        AND jsonb_typeof(p_accepted_refund_ids) <> 'array')
    OR (p_candidates IS NOT NULL
        AND jsonb_typeof(p_candidates) <> 'array') THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.transactions
    WHERE id = p_payment_transaction_id AND order_id = p_order_id
      AND merchant_id = p_merchant_id AND transaction_type = 'payment'
  ) THEN
    RETURN false;
  END IF;

  SELECT id, candidates INTO v_review_id, v_candidates
    FROM public.reconciliation_review
    WHERE issue_type = 'order_cancellation_refund_requires_review'
      AND order_id = p_order_id AND merchant_id = p_merchant_id
      AND resolved_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT coalesce(jsonb_agg(elem), '[]'::jsonb) INTO v_new_candidates
    FROM jsonb_array_elements(coalesce(p_candidates, '[]'::jsonb)) AS elem
    WHERE elem->>'paymentTransactionId' IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(coalesce(v_candidates, '[]'::jsonb)) AS existing
        WHERE existing->>'paymentTransactionId' = elem->>'paymentTransactionId'
      );

  UPDATE public.reconciliation_review
    SET metadata = jsonb_set(
      coalesce(metadata, '{}'::jsonb),
      '{refund_evidence}',
      coalesce(metadata->'refund_evidence', '{}'::jsonb) ||
        jsonb_build_object(
          'leg:' || p_payment_transaction_id::text,
          jsonb_build_object(
            'reason', left(p_reason, 120),
            'accepted_refund_ids', coalesce(p_accepted_refund_ids, '[]'::jsonb),
            'observed_at', now()
          )
        ),
      true
    ),
    candidates = coalesce(v_candidates, '[]'::jsonb) || v_new_candidates
    WHERE id = v_review_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.merge_paystack_cancellation_refund_leg_evidence_v1(uuid,uuid,uuid,text,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_paystack_cancellation_refund_leg_evidence_v1(uuid,uuid,uuid,text,jsonb,jsonb)
  TO service_role;
