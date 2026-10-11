-- Carry the provider verdict in merged leg evidence. Reference-only
-- refund events merge here when the order already has an open review;
-- without the verdict a definitively failed provider refund blocks a
-- later genuine cancellation as if money moved. The entry also gains
-- the audit marker and leg id the audit-blocking reader keys on (it
-- reads entry values, not the leg key). Quarantine merges pass no
-- verdict and keep failing closed exactly as before. DROP + CREATE:
-- the new trailing parameter cannot be added with OR REPLACE.
DROP FUNCTION IF EXISTS public.merge_paystack_cancellation_refund_leg_evidence_v1(uuid, uuid, uuid, text, jsonb, jsonb, boolean);
CREATE OR REPLACE FUNCTION public.merge_paystack_cancellation_refund_leg_evidence_v1(
  p_order_id uuid,
  p_merchant_id uuid,
  p_payment_transaction_id uuid,
  p_reason text,
  p_accepted_refund_ids jsonb,
  p_candidates jsonb,
  p_ambiguous boolean DEFAULT false,
  p_provider_refund_status text DEFAULT NULL
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
            -- Sticky: a later deterministic merge for the same leg must
            -- not clear an earlier ambiguity — only operations resolves
            -- the uncertainty that a provider refund already exists.
            'ambiguous', coalesce(p_ambiguous, false) OR coalesce(
              (metadata->'refund_evidence')->('leg:' || p_payment_transaction_id::text)->>'ambiguous',
              'false'
            ) <> 'false',
            -- The audit-blocking reader keys failed-only exclusion on
            -- marked entries carrying the leg id and provider verdict;
            -- it reads entry values, never the leg key. A NULL verdict
            -- (quarantine merges) fails closed as before.
            'audit_record_failed', true,
            'payment_transaction_id', p_payment_transaction_id::text,
            'provider_refund_status', p_provider_refund_status,
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
REVOKE ALL ON FUNCTION public.merge_paystack_cancellation_refund_leg_evidence_v1(uuid,uuid,uuid,text,jsonb,jsonb,boolean,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_paystack_cancellation_refund_leg_evidence_v1(uuid,uuid,uuid,text,jsonb,jsonb,boolean,text)
  TO service_role;
