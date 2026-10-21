-- Verdict idempotency-key lookup for the wallet-only checkout
-- (epic #3694 Phase 2).
--
-- vtu_idempotency_keys has RLS enabled with NO buyer policy by
-- design (the lookup is keyed by the unguessable key alone, which
-- RLS cannot scope). This RPC replaces the route's direct SELECT:
--
--   fresh → key unmapped; all row fields null.
--   owned  → key maps to one of the caller's customer rows (any
--            merchant — the key carries its own scope); full row.
--   foreign→ key maps elsewhere; row fields ALL null. No disclosure
--            beyond existence — which today's 400 already reveals
--            ("does not belong to this customer" implies mapped).
--
-- Ownership INCLUDES verified-email unlinked rows (not just
-- user_id-linked ones). Load-bearing parity: legacy/manual key
-- rows can point at unlinked guest rows, and the replay path must
-- reach the owner-presence 425 (key kept) for those — a 'foreign'
-- verdict would 400-rotate the key and risk a second debit on a
-- debited transaction (the R152 design).

CREATE OR REPLACE FUNCTION public.lookup_vtu_idempotency_row(
  p_key uuid,
  p_user_id uuid
)
RETURNS TABLE (
  verdict text,
  key uuid,
  vtu_transaction_id uuid,
  customer_id uuid,
  merchant_id uuid,
  request_fingerprint text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_role text;
  v_caller_uid uuid;
  v_row public.vtu_idempotency_keys%ROWTYPE;
  v_email text;
  v_owned boolean;
BEGIN
  v_caller_role := (SELECT auth.role());
  v_caller_uid := (SELECT auth.uid());

  -- Caller binding (same <> form as the customer RPCs: JWT-less
  -- direct connections skip; PostgREST always sets the claim).
  IF v_caller_role <> 'service_role'
     AND (v_caller_uid IS NULL OR v_caller_uid IS DISTINCT FROM p_user_id) THEN
    RAISE EXCEPTION 'not authorized: caller mismatch';
  END IF;

  IF p_key IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_arguments: lookup_vtu_idempotency_row requires key and user';
  END IF;

  SELECT k.* INTO v_row
  FROM public.vtu_idempotency_keys AS k
  WHERE k.key = p_key;

  IF NOT FOUND THEN
    verdict := 'fresh';
    key := p_key;
    vtu_transaction_id := NULL;
    customer_id := NULL;
    merchant_id := NULL;
    request_fingerprint := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_caller_role = 'service_role' THEN
    -- Server callers: trusted (their own ownership checks apply).
    v_owned := true;
  ELSE
    -- The caller's verified email, for the unlinked-row arm.
    SELECT u.email INTO v_email
    FROM auth.users AS u
    WHERE u.id = p_user_id
      AND u.email_confirmed_at IS NOT NULL;

    SELECT EXISTS (
      SELECT 1
      FROM public.customers AS c
      WHERE c.id = v_row.customer_id
        AND (
          c.user_id = p_user_id
          OR (
            c.user_id IS NULL
            AND v_email IS NOT NULL
            AND c.email = v_email
          )
        )
    ) INTO v_owned;
  END IF;

  IF v_owned THEN
    verdict := 'owned';
    key := v_row.key;
    vtu_transaction_id := v_row.vtu_transaction_id;
    customer_id := v_row.customer_id;
    merchant_id := v_row.merchant_id;
    request_fingerprint := v_row.request_fingerprint;
  ELSE
    verdict := 'foreign';
    key := p_key;
    vtu_transaction_id := NULL;
    customer_id := NULL;
    merchant_id := NULL;
    request_fingerprint := NULL;
  END IF;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_vtu_idempotency_row(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lookup_vtu_idempotency_row(uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.lookup_vtu_idempotency_row(uuid, uuid) IS
  'Phase 2 (#3694): verdict idempotency lookup. fresh/owned(+row)/foreign(no fields). Unlinked-email rows count as owned (425 parity).';
