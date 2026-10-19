-- Reuse the existing claimed reference-only watch on redelivery
-- instead of retaining another one. The open-watch unique index
-- admits a fresh open row once the first watch flips to claimed, so
-- every provider redelivery minted another permanent claimed row
-- that the completion claim scans for each later completion:
-- unbounded rows and duplicate review-filing work. When a claimed
-- row already carries the handoff, fold the caller's duplicate open
-- row into it (sticky verdict merge, same rule as the open path)
-- and drop the duplicate. Same signature: OR REPLACE keeps every
-- existing call on the new body.
CREATE OR REPLACE FUNCTION public.mark_paystack_refund_reference_watch_claimed_v1(
  p_paystack_ref text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_reference text;
  v_claimed_id uuid;
  v_claimed_evidence jsonb;
  v_open_evidence jsonb;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  v_reference := nullif(btrim(coalesce(p_paystack_ref, '')), '');
  IF v_reference IS NULL THEN
    RAISE EXCEPTION 'invalid_refund_recovery_watch' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'baci_paystack_refund_watch:' || v_reference, 0)
  );
  -- The caller marks only after its current matches are durably
  -- handled, so the duplicate open row carries no unfiled handoff:
  -- the pre-existing claimed row already serves future completions.
  SELECT id, evidence INTO v_claimed_id, v_claimed_evidence
    FROM public.paystack_refund_recovery_watch
   WHERE paystack_ref = v_reference
     AND provider_refund_id IS NULL
     AND status = 'claimed'
   ORDER BY updated_at DESC, id
   LIMIT 1
   FOR UPDATE;
  IF FOUND THEN
    SELECT evidence INTO v_open_evidence
      FROM public.paystack_refund_recovery_watch
     WHERE paystack_ref = v_reference
       AND provider_refund_id IS NULL
       AND status = 'open'
     FOR UPDATE;
    IF NOT FOUND THEN
      -- Already deduped (or never opened): touch the handoff and
      -- report handled.
      UPDATE public.paystack_refund_recovery_watch
         SET updated_at = now()
       WHERE id = v_claimed_id;
      RETURN true;
    END IF;
    -- Fold the redelivered observation into the retained handoff. A
    -- non-failed verdict is sticky: a delayed failed redelivery must
    -- not overwrite an earlier processed observation, or the claim
    -- files failed-only evidence the audit reader excludes and
    -- cancellation refunds the leg again.
    UPDATE public.paystack_refund_recovery_watch
       SET evidence = v_open_evidence || jsonb_build_object(
             'provider_refund_status',
             CASE
               WHEN v_claimed_evidence->>'provider_refund_status' IS DISTINCT FROM 'failed'
                 AND v_open_evidence->>'provider_refund_status' = 'failed'
               THEN v_claimed_evidence->>'provider_refund_status'
               ELSE v_open_evidence->>'provider_refund_status'
             END
           ),
           updated_at = now()
     WHERE id = v_claimed_id;
    DELETE FROM public.paystack_refund_recovery_watch
     WHERE paystack_ref = v_reference
       AND provider_refund_id IS NULL
       AND status = 'open';
    RETURN true;
  END IF;
  UPDATE public.paystack_refund_recovery_watch
    SET status = 'claimed', updated_at = now()
    WHERE paystack_ref = v_reference
      AND provider_refund_id IS NULL
      AND status = 'open';
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_paystack_refund_reference_watch_claimed_v1(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_paystack_refund_reference_watch_claimed_v1(text)
  TO service_role;
