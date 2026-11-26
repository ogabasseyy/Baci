-- Draft approvals can retain multiple proof rows after retries; read the
-- latest matching proof expiry so a fresh retry proof is reused instead of
-- picking an earlier expired row.
CREATE OR REPLACE FUNCTION public.experience_prepare_approval(p_intent uuid, p_kind text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  draft experience_authorization.apply_intents;
  lifecycle experience_authorization.lifecycle_intents;
  linked experience_authorization.approval_preparation_successors;
  issued timestamptz;
  effect text;
  review jsonb;
  proof_expires timestamptz;
  next_review jsonb;
  next_id uuid;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('draft', 'lifecycle') THEN
    RAISE EXCEPTION 'INVALID_REQUEST';
  END IF;
  -- Serialize refreshes by intent. Re-read under the current owner's authority
  -- before using a saved successor or creating a new one.
  PERFORM pg_advisory_xact_lock(hashtextextended('baci:approval-prepare:' || p_kind || ':' || p_intent::text, 0));
  BEGIN
    IF p_kind = 'draft' THEN
      review := public.experience_load_draft_approval(p_intent);
    ELSE
      review := public.experience_load_lifecycle(p_intent);
      IF review->>'action' NOT IN ('publish', 'rollback') THEN
        RAISE EXCEPTION 'INVALID_REQUEST';
      END IF;
    END IF;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'APPROVAL_EXPIRED' THEN RAISE; END IF;
  END;
  IF review IS NOT NULL THEN
    IF review->>'status' <> 'confirmation-required' THEN RETURN review; END IF;
    IF p_kind = 'draft' THEN
      SELECT max(expires_at) INTO proof_expires FROM experience_authorization.approval_checks
        WHERE intent_id = p_intent AND effect_digest = review->>'effectDigest'
          AND verified_at <= clock_timestamp() AND expires_at <= (review->>'expiresAt')::timestamptz;
    ELSE
      SELECT max(expires_at) INTO proof_expires FROM experience_authorization.lifecycle_checks
        WHERE intent_id = p_intent AND kind = 'render' AND effect_digest = review->>'effectDigest'
          AND verified_at <= clock_timestamp() AND expires_at <= (review->>'expiresAt')::timestamptz;
    END IF;
    IF proof_expires > clock_timestamp() + interval '15 seconds' THEN
      RETURN review || jsonb_build_object('proofExpiresAt', proof_expires);
    END IF;
    IF proof_expires IS NULL AND (review->>'expiresAt')::timestamptz > clock_timestamp() + interval '15 seconds' THEN
      RETURN review;
    END IF;
  END IF;

  IF p_kind = 'draft' THEN
    SELECT * INTO STRICT draft FROM experience_authorization.apply_intents
      WHERE id = p_intent AND actor_user_id = auth.uid();
    issued := draft.issued_at;
    effect := draft.effect_digest;
  ELSE
    SELECT * INTO STRICT lifecycle FROM experience_authorization.lifecycle_intents
      WHERE id = p_intent AND actor_user_id = auth.uid() AND action IN ('publish', 'rollback');
    issued := lifecycle.issued_at;
    effect := lifecycle.effect_digest;
  END IF;
  issued := COALESCE((
    SELECT preparation_started_at FROM experience_authorization.approval_preparation_successors
    WHERE kind = p_kind AND successor = p_intent
  ), issued);
  IF issued > clock_timestamp() OR issued <= clock_timestamp() - interval '24 hours' THEN
    RAISE EXCEPTION 'PREPARATION_EXPIRED';
  END IF;

  SELECT * INTO linked FROM experience_authorization.approval_preparation_successors
    WHERE kind = p_kind AND predecessor = p_intent;
  IF FOUND THEN
    RETURN jsonb_build_object('status', 'preparing', 'approvalId', linked.successor);
  END IF;

  IF p_kind = 'draft' THEN
    next_review := public.experience_request_draft_apply(
      draft.merchant_id, draft.connection_id, draft.grant_version,
      draft.build_id, draft.evidence_id, draft.expected_version, gen_random_uuid()
    );
  ELSE
    next_review := public.experience_request_lifecycle(
      lifecycle.merchant_id, lifecycle.connection_id, lifecycle.grant_version,
      lifecycle.action, lifecycle.payload, gen_random_uuid()
    );
  END IF;
  IF next_review->>'status' IS DISTINCT FROM 'confirmation-required'
     OR next_review->>'effectDigest' IS DISTINCT FROM effect THEN
    RAISE EXCEPTION 'APPROVAL_MISMATCH';
  END IF;
  next_id := (next_review->>'approvalId')::uuid;
  INSERT INTO experience_authorization.approval_preparation_successors
    VALUES (p_kind, p_intent, next_id, issued);
  RETURN next_review;
END $$;
REVOKE ALL ON FUNCTION public.experience_prepare_approval(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.experience_prepare_approval(uuid, text) TO authenticated;
