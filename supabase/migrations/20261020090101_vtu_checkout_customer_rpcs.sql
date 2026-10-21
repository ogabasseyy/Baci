-- Customer resolution RPCs for the wallet-only checkout RLS
-- boundary (epic #3694 Phase 2).
--
-- The checkout's customer email-link flow needs cross-user reads
-- (an unlinked guest row) that RLS cannot scope — the row is
-- invisible to the buyer by design. These SECURITY DEFINER RPCs
-- resolve identity from the JWT instead:
--
--   _vtu_checkout_caller_customer: confined helper (NO grants; only
--     reachable nested inside sibling SD RPCs, which run as owner).
--     byUserId hit, else verified-email unlinked row, else null.
--     Mirrors resolveVtuCustomer semantics exactly, including the
--     verified-identifier rules (either confirmed identifier opens
--     the user_id lookup; the EMAIL fallback needs a confirmed
--     email — a phone session carrying an unverified address must
--     never resolve it).
--   find_vtu_customer_for_checkout: read-only id lookup for the
--     replay path (never links — the 425 no-rotation design
--     depends on read-only pre-guard resolution).
--   link_vtu_customer_by_email: atomic user_id claim for the fresh
--     path (claim_customer_on_phone_auth precedent: explicit
--     p_user_id verified against the JWT, auth.users-sourced
--     identifiers, same-user re-read accept on race loss).
--
-- Caller binding (all RPCs in this boundary): an authenticated
-- caller may only resolve itself (p_user_id must equal auth.uid());
-- service_role (server callers, caller-owned checks) passes its
-- explicit id through. Verified-identifier rules apply to EVERY
-- caller — confirmation is a security invariant, not caller auth.

CREATE OR REPLACE FUNCTION public._vtu_checkout_caller_customer(
  p_merchant_id uuid,
  p_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_role text;
  v_caller_uid uuid;
  v_email text;
  v_email_confirmed boolean;
  v_phone_confirmed boolean;
  v_customer_id uuid;
BEGIN
  IF p_merchant_id IS NULL OR p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_caller_role := (SELECT auth.role());
  v_caller_uid := (SELECT auth.uid());

  -- Caller binding. NOTE the <> (not IS DISTINCT FROM): a JWT-less
  -- direct connection (NULL role) skips this check — same as
  -- claim_customer_on_phone_auth. PostgREST always sets the claim,
  -- so this only affects direct superuser connections, which bypass
  -- every application check anyway.
  IF v_caller_role <> 'service_role'
     AND (v_caller_uid IS NULL OR v_caller_uid IS DISTINCT FROM p_user_id) THEN
    RAISE EXCEPTION 'not authorized: caller mismatch';
  END IF;

  -- Verified identifiers come from auth.users, never caller params.
  SELECT u.email,
         u.email_confirmed_at IS NOT NULL,
         u.phone_confirmed_at IS NOT NULL
    INTO v_email, v_email_confirmed, v_phone_confirmed
  FROM auth.users AS u
  WHERE u.id = p_user_id;

  IF NOT FOUND OR (NOT v_email_confirmed AND NOT v_phone_confirmed) THEN
    RETURN NULL;
  END IF;

  -- Exact user_id match: either confirmed identifier opens it.
  SELECT c.id INTO v_customer_id
  FROM public.customers AS c
  WHERE c.merchant_id = p_merchant_id
    AND c.user_id = p_user_id
  LIMIT 1;
  IF FOUND THEN
    RETURN v_customer_id;
  END IF;

  -- Email fallback: VERIFIED email only, unlinked row only. A row
  -- linked to a different auth user is invisible here (fail closed).
  IF NOT v_email_confirmed OR v_email IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT c.id INTO v_customer_id
  FROM public.customers AS c
  WHERE c.merchant_id = p_merchant_id
    AND c.email = v_email
    AND c.user_id IS NULL
  LIMIT 1;
  IF FOUND THEN
    RETURN v_customer_id;
  END IF;

  RETURN NULL;
END;
$$;

-- Confined: no direct grants (not even service_role — nested SD
-- calls run as owner and are unaffected).
REVOKE ALL ON FUNCTION public._vtu_checkout_caller_customer(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._vtu_checkout_caller_customer(uuid, uuid) IS
  'Phase 2 (#3694): confined caller-customer resolver for checkout RPCs. byUserId, else verified-email unlinked row, else null. No grants — nested use only.';

CREATE OR REPLACE FUNCTION public.find_vtu_customer_for_checkout(
  p_merchant_id uuid,
  p_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Read-only by construction: SELECTs only, never links.
  RETURN public._vtu_checkout_caller_customer(p_merchant_id, p_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.find_vtu_customer_for_checkout(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.find_vtu_customer_for_checkout(uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.find_vtu_customer_for_checkout(uuid, uuid) IS
  'Phase 2 (#3694): read-only checkout customer lookup (replay path). Never links.';

CREATE OR REPLACE FUNCTION public.link_vtu_customer_by_email(
  p_merchant_id uuid,
  p_user_id uuid
)
RETURNS TABLE (
  id uuid,
  email text,
  first_name text,
  last_name text,
  phone text,
  user_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_customer_id uuid;
  v_final uuid;
  v_row public.customers%ROWTYPE;
BEGIN
  v_customer_id :=
    public._vtu_checkout_caller_customer(p_merchant_id, p_user_id);
  IF v_customer_id IS NULL THEN
    RETURN;
  END IF;

  SELECT c.* INTO v_row
  FROM public.customers AS c
  WHERE c.id = v_customer_id;
  -- Already linked to this user (byUserId hit): idempotent success.
  IF FOUND AND v_row.user_id = p_user_id THEN
    v_final := v_customer_id;
  ELSE
    -- Atomic claim: only an unlinked row. A concurrent winner
    -- makes this match zero rows (the loser re-reads below
    -- instead of stealing the link).
    UPDATE public.customers AS c
    SET user_id = p_user_id
    WHERE c.id = v_customer_id
      AND c.user_id IS NULL
    RETURNING c.id INTO v_final;

    IF NOT FOUND THEN
      -- Lost the race (or the row vanished): accept only a
      -- same-user link (two overlapping checkouts for one
      -- account); anything else fails closed.
      SELECT c.* INTO v_row
      FROM public.customers AS c
      WHERE c.id = v_customer_id;
      IF FOUND AND v_row.user_id IS NOT DISTINCT FROM p_user_id THEN
        v_final := v_customer_id;
      ELSE
        v_final := NULL;
      END IF;
    END IF;
  END IF;

  IF v_final IS NULL THEN
    RETURN;
  END IF;
  SELECT c.* INTO v_row
  FROM public.customers AS c
  WHERE c.id = v_final;
  id := v_row.id;
  email := v_row.email;
  first_name := v_row.first_name;
  last_name := v_row.last_name;
  phone := v_row.phone;
  user_id := v_row.user_id;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.link_vtu_customer_by_email(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.link_vtu_customer_by_email(uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.link_vtu_customer_by_email(uuid, uuid) IS
  'Phase 2 (#3694): atomic verified-email customer link for the checkout fresh path. Returns the full customer row (zero rows = no link). Same-user idempotent; foreign rows fail closed.';
