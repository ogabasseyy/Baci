-- Preserve audit-failure markers when merging recovery reviews. The
-- merge kept only refund_evidence, dropping the incoming top-level
-- audit_record_failed / reference_only_refund_event markers — so a
-- reference-only merge into an open review left aggregate
-- finalization free to resolve it on another refund's coverage, even
-- though the reference-only event can never be tied to a recorded
-- row. Markers now OR-preserve across merges. Same signature:
-- OR REPLACE keeps every existing call on the new body.

CREATE OR REPLACE FUNCTION public.file_paystack_refund_recovery_review_v1(
  p_order_id uuid,
  p_merchant_id uuid,
  p_paystack_ref text,
  p_reason text,
  p_candidates jsonb,
  p_metadata jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_review_id uuid;
  v_candidates jsonb;
  v_metadata jsonb;
  v_existing_evidence jsonb;
  v_incoming_evidence jsonb;
  v_new_candidates jsonb;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_order_id IS NULL OR p_merchant_id IS NULL
    OR nullif(btrim(p_reason), '') IS NULL
    OR (p_candidates IS NOT NULL
        AND jsonb_typeof(p_candidates) <> 'array')
    OR (p_metadata IS NOT NULL
        AND jsonb_typeof(p_metadata) <> 'object') THEN
    RETURN NULL;
  END IF;

  SELECT id, candidates, metadata INTO v_review_id, v_candidates, v_metadata
    FROM public.reconciliation_review
    WHERE issue_type = 'order_cancellation_refund_requires_review'
      AND order_id = p_order_id AND merchant_id = p_merchant_id
      AND resolved_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    BEGIN
      INSERT INTO public.reconciliation_review (
        issue_type, order_id, merchant_id, paystack_ref, reason,
        candidates, metadata
      ) VALUES (
        'order_cancellation_refund_requires_review', p_order_id,
        p_merchant_id, nullif(btrim(p_paystack_ref), ''), p_reason,
        coalesce(p_candidates, '[]'::jsonb),
        coalesce(p_metadata, '{}'::jsonb)
      )
      RETURNING id INTO v_review_id;
      RETURN v_review_id;
    EXCEPTION WHEN unique_violation THEN
      -- A concurrent filing won the open-by-order index: merge into it.
      SELECT id, candidates, metadata INTO v_review_id, v_candidates,
        v_metadata
        FROM public.reconciliation_review
        WHERE issue_type = 'order_cancellation_refund_requires_review'
          AND order_id = p_order_id AND merchant_id = p_merchant_id
          AND resolved_at IS NULL
        FOR UPDATE;
      IF NOT FOUND THEN
        -- The conflict is not this order's open review (the same provider
        -- refund filed under another order): surface it instead of
        -- silently dropping the evidence.
        RAISE EXCEPTION 'paystack_refund_recovery_review_conflict'
          USING ERRCODE = '23505';
      END IF;
    END;
  END IF;

  -- Non-object evidence (a hand-edited row) resets to the incoming map
  -- instead of aborting the merge, matching the client fallback.
  IF jsonb_typeof(v_metadata->'refund_evidence') IS DISTINCT FROM 'object'
  THEN
    v_existing_evidence := '{}'::jsonb;
  ELSE
    v_existing_evidence := v_metadata->'refund_evidence';
  END IF;
  IF jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)->'refund_evidence')
    IS DISTINCT FROM 'object' THEN
    v_incoming_evidence := '{}'::jsonb;
  ELSE
    v_incoming_evidence :=
      coalesce(p_metadata, '{}'::jsonb)->'refund_evidence';
  END IF;

  SELECT coalesce(jsonb_agg(elem), '[]'::jsonb) INTO v_new_candidates
    FROM jsonb_array_elements(coalesce(p_candidates, '[]'::jsonb)) AS elem
    WHERE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(coalesce(v_candidates, '[]'::jsonb))
        AS existing
      WHERE existing->>'payment_transaction_id' IS NOT DISTINCT FROM
        elem->>'payment_transaction_id'
    );

  UPDATE public.reconciliation_review
    SET metadata = jsonb_set(
      coalesce(v_metadata, '{}'::jsonb) || jsonb_build_object(
        -- Preserve audit-failure markers across merges: the merge used
        -- to keep only refund_evidence, so a reference-only merge into
        -- an open review dropped the top-level markers and aggregate
        -- finalization could later resolve the review on another
        -- refund's coverage — even though a reference-only event can
        -- never be tied to a recorded row and may be an additional
        -- merchant debit. OR, never overwrite: a marker once raised
        -- stays until operations resolves the review.
        'audit_record_failed',
          coalesce(v_metadata->>'audit_record_failed', 'false') <> 'false'
          OR coalesce(
            coalesce(p_metadata, '{}'::jsonb)->>'audit_record_failed',
            'false'
          ) <> 'false',
        'reference_only_refund_event',
          coalesce(v_metadata->>'reference_only_refund_event', 'false')
          <> 'false'
          OR coalesce(
            coalesce(p_metadata, '{}'::jsonb)->>'reference_only_refund_event',
            'false'
          ) <> 'false'
      ),
      '{refund_evidence}',
      v_existing_evidence || v_incoming_evidence,
      true
    ),
    candidates = coalesce(v_candidates, '[]'::jsonb) || v_new_candidates
    WHERE id = v_review_id;
  RETURN v_review_id;
END;
$$;
REVOKE ALL ON FUNCTION public.file_paystack_refund_recovery_review_v1(uuid,uuid,text,text,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.file_paystack_refund_recovery_review_v1(uuid,uuid,text,text,jsonb,jsonb)
  TO service_role;
