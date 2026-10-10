-- Merge provider-refund evidence into the open non-cancellation review
-- for an order. When a verified refund on an active order already opened
-- the order-level review, a redelivery or a later refund must not
-- discard its own evidence: merge it under the provider key alongside
-- the candidates. Client-side read-modify-write would race concurrent
-- webhooks and drop evidence, so the merge happens atomically here.
CREATE FUNCTION public.merge_provider_refund_outside_cancellation_evidence_v1(
  p_order_id uuid,
  p_merchant_id uuid,
  p_evidence_key text,
  p_evidence jsonb,
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
    OR nullif(btrim(p_evidence_key), '') IS NULL
    OR p_evidence IS NULL OR jsonb_typeof(p_evidence) <> 'object'
    OR (p_candidates IS NOT NULL
        AND jsonb_typeof(p_candidates) <> 'array') THEN
    RETURN false;
  END IF;

  SELECT id, candidates INTO v_review_id, v_candidates
    FROM public.reconciliation_review
    WHERE issue_type = 'provider_refund_outside_cancellation'
      AND order_id = p_order_id AND merchant_id = p_merchant_id
      AND resolved_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT coalesce(jsonb_agg(elem), '[]'::jsonb) INTO v_new_candidates
    FROM jsonb_array_elements(coalesce(p_candidates, '[]'::jsonb)) AS elem
    WHERE elem->>'payment_transaction_id' IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(coalesce(v_candidates, '[]'::jsonb))
          AS existing
        WHERE existing->>'payment_transaction_id' =
          elem->>'payment_transaction_id'
      );

  UPDATE public.reconciliation_review
    SET metadata = jsonb_set(
      coalesce(metadata, '{}'::jsonb),
      '{refund_evidence}',
      coalesce(metadata->'refund_evidence', '{}'::jsonb) ||
        jsonb_build_object(p_evidence_key, p_evidence),
      true
    ),
    candidates = coalesce(v_candidates, '[]'::jsonb) || v_new_candidates
    WHERE id = v_review_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.merge_provider_refund_outside_cancellation_evidence_v1(uuid,uuid,text,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_provider_refund_outside_cancellation_evidence_v1(uuid,uuid,text,jsonb,jsonb)
  TO service_role;
