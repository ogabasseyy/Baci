-- Round-32 review fixes.
-- P2 (reserve deadlock, production path): the v2 wrapper is the live
-- reservation entry point (RedvaultRefundStore.reserve), and it locked
-- the payment attempt row before delegating to the v1 implementation,
-- which then waits for the order advisory lock. Approval acquires
-- that advisory lock first and later waits for the same attempt row,
-- so the round-31 lock reorder inside v1 did not fix the active call
-- path. The wrapper no longer pre-locks: its reads are deliberately
-- unlocked, and all locking happens inside v1 (order advisory lock,
-- then attempt row lock), matching approval's order. Mutual
-- exclusion is unchanged because concurrent reservations still
-- serialize on v1's attempt row lock, and v1 revalidates the
-- merchant, the idempotency key, and the reserved amounts (which
-- include needs_reconciliation rows) under that lock. The wrapper's
-- column references are also qualified: the OUT params share the
-- id/state names, and the unqualified reads error under
-- plpgsql.variable_conflict = error.
CREATE OR REPLACE FUNCTION public.reserve_uba_redvault_refund_v2(
  p_attempt_id uuid, p_merchant_id uuid, p_idempotency_key text,
  p_type text, p_units jsonb DEFAULT NULL
)
RETURNS TABLE (id uuid, amount_kobo bigint, state text, attempt_reference text,
  provider_reference text, provider_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
BEGIN
  -- Unlocked on purpose: locking the attempt here and delegating to
  -- v1 (which takes the order advisory lock next) inverts approval's
  -- advisory-first order and deadlocks when the two race. The v1
  -- call below locks the attempt itself and revalidates everything
  -- this probe checks. The column is qualified because the OUT param
  -- shares its name; unqualified, this errors under
  -- plpgsql.variable_conflict = error on every call.
  SELECT * INTO STRICT v_attempt FROM private.uba_redvault_payment_attempts AS attempt
  WHERE attempt.id = p_attempt_id;
  IF v_attempt.merchant_id IS DISTINCT FROM p_merchant_id THEN
    RAISE EXCEPTION 'redvault_refund_attempt_not_found';
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.uba_redvault_refunds AS refund
    WHERE refund.attempt_id = p_attempt_id AND refund.idempotency_key = p_idempotency_key
  ) THEN
    RETURN QUERY SELECT * FROM public.reserve_uba_redvault_refund(
      p_attempt_id, p_merchant_id, p_idempotency_key, p_type, p_units
    );
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.uba_redvault_refunds AS refund
    WHERE refund.attempt_id = p_attempt_id AND refund.state = 'needs_reconciliation'
  ) THEN
    RAISE EXCEPTION 'redvault_refund_amount_reserved';
  END IF;
  RETURN QUERY SELECT * FROM public.reserve_uba_redvault_refund(
    p_attempt_id, p_merchant_id, p_idempotency_key, p_type, p_units
  );
END;
$$;
ALTER FUNCTION public.reserve_uba_redvault_refund_v2(uuid, uuid, text, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reserve_uba_redvault_refund_v2(uuid, uuid, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_uba_redvault_refund_v2(uuid, uuid, text, text, jsonb)
  TO service_role;
