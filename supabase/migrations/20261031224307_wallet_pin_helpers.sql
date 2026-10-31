-- Wallet transaction PIN store (dark): internal helpers.
--
-- Called only from the SECURITY DEFINER functions in the next migrations,
-- which run as the owner. None is granted to any role: the schema itself is
-- closed to every client and API role.

BEGIN;

-- Lower-case hex of exactly p_bytes bytes, else NULL (callers raise 22023).
CREATE FUNCTION wallet_pin_private.hex_bytes(p_value text, p_bytes integer)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_value IS NOT NULL AND p_bytes BETWEEN 1 AND 64
      AND p_value ~ ('^[0-9a-f]{' || (p_bytes * 2)::text || '}$')
    THEN pg_catalog.decode(p_value, 'hex')
  END;
$$;

-- The calling customer's row for this merchant, from the JWT subject. The
-- merchant comes from the trusted storefront host; a caller only ever
-- reaches their own customer row.
CREATE FUNCTION wallet_pin_private.caller_customer_id(p_merchant_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_jwt jsonb := COALESCE(auth.jwt(), '{}'::jsonb);
  v_customer_id uuid;
BEGIN
  IF v_user_id IS NULL
    OR COALESCE(v_jwt ->> 'role', '') <> 'authenticated'
    OR COALESCE(v_jwt ->> 'is_anonymous', 'false') <> 'false' THEN
    RAISE EXCEPTION 'wallet_pin_authentication_required' USING ERRCODE = '42501';
  END IF;

  SELECT customer.id INTO v_customer_id
    FROM public.customers AS customer
   WHERE customer.merchant_id = p_merchant_id
     AND customer.user_id = v_user_id
     AND customer.deleted_at IS NULL;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'wallet_pin_customer_unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN v_customer_id;
END;
$$;

CREATE FUNCTION wallet_pin_private.merchant_enabled(p_merchant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT authority.enabled
      FROM wallet_pin_private.merchant_authorities AS authority
     WHERE authority.merchant_id = p_merchant_id
  ), false);
$$;

-- A reset needs a sign-in within the last 15 minutes on a session that
-- still exists, and AAL2 when the user has a verified MFA factor. Token
-- refreshes and anonymous sign-ins do not count.
CREATE FUNCTION wallet_pin_private.has_recent_authentication()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_jwt jsonb := COALESCE(auth.jwt(), '{}'::jsonb);
  v_session_id uuid;
  v_latest_auth_at timestamptz;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  BEGIN
    v_session_id := NULLIF(v_jwt ->> 'session_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RETURN false;
  END;

  IF v_session_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.sessions AS session_row
     WHERE session_row.id = v_session_id AND session_row.user_id = v_user_id
  ) THEN
    RETURN false;
  END IF;

  IF COALESCE(v_jwt ->> 'aal', 'aal1') <> 'aal2' AND EXISTS (
    SELECT 1 FROM auth.mfa_factors AS factor
     WHERE factor.user_id = v_user_id AND factor.status::text = 'verified'
  ) THEN
    RETURN false;
  END IF;

  IF pg_catalog.jsonb_typeof(v_jwt -> 'amr') IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;

  SELECT pg_catalog.to_timestamp(pg_catalog.max((entry.value ->> 'timestamp')::bigint))
    INTO v_latest_auth_at
    FROM pg_catalog.jsonb_array_elements(v_jwt -> 'amr') AS entry(value)
   WHERE pg_catalog.jsonb_typeof(entry.value) = 'object'
     AND (entry.value ->> 'timestamp') ~ '^[0-9]{1,12}$'
     AND COALESCE(entry.value ->> 'method', '') NOT IN ('', 'anonymous', 'token_refresh');

  RETURN v_latest_auth_at IS NOT NULL
    AND v_latest_auth_at >= v_now - interval '15 minutes'
    AND v_latest_auth_at <= v_now + interval '1 minute';
END;
$$;

-- Locks the customer's PIN row and checks one attempt. Returns
-- {"status":"match"} (and clears every counter) or the refusal to return
-- to the caller: not_set, reset_required (hash made with another pepper;
-- not a failed attempt), locked {lockedUntil} or incorrect
-- {attemptsRemaining}. Five consecutive wrong PINs lock the PIN for
-- 30 minutes; each later lockout doubles, capped at 24 hours. An expired
-- lock gives a fresh window of five attempts; the lockout count only resets
-- on a correct PIN or a reset.
CREATE FUNCTION wallet_pin_private.check_pin_attempt(
  p_customer_id uuid,
  p_pepper_id bytea,
  p_candidate bytea
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_pin wallet_pin_private.customer_pins%ROWTYPE;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_failed integer;
  v_lockouts integer;
  v_until timestamptz;
BEGIN
  SELECT pin.* INTO v_pin
    FROM wallet_pin_private.customer_pins AS pin
   WHERE pin.customer_id = p_customer_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', 'not_set');
  END IF;
  IF v_pin.pepper_id <> p_pepper_id THEN
    RETURN pg_catalog.jsonb_build_object('status', 'reset_required');
  END IF;
  IF v_pin.locked_until > v_now THEN
    RETURN pg_catalog.jsonb_build_object('status', 'locked', 'lockedUntil', v_pin.locked_until);
  END IF;

  IF v_pin.pin_hash = p_candidate THEN
    UPDATE wallet_pin_private.customer_pins
       SET failed_attempts = 0, lockout_count = 0, locked_at = NULL,
           locked_until = NULL, updated_at = v_now
     WHERE customer_id = p_customer_id;
    RETURN pg_catalog.jsonb_build_object('status', 'match');
  END IF;

  v_failed := CASE WHEN v_pin.locked_until IS NULL THEN v_pin.failed_attempts ELSE 0 END + 1;
  IF v_failed >= 5 THEN
    v_lockouts := LEAST(v_pin.lockout_count + 1, 1000);
    v_until := v_now + LEAST(
      interval '30 minutes' * pg_catalog.power(2, LEAST(v_lockouts - 1, 6)),
      interval '24 hours'
    );
    UPDATE wallet_pin_private.customer_pins
       SET failed_attempts = 5, lockout_count = v_lockouts, locked_at = v_now,
           locked_until = v_until, updated_at = v_now
     WHERE customer_id = p_customer_id;
    RETURN pg_catalog.jsonb_build_object('status', 'locked', 'lockedUntil', v_until);
  END IF;

  UPDATE wallet_pin_private.customer_pins
     SET failed_attempts = v_failed, locked_at = NULL, locked_until = NULL,
         updated_at = v_now
   WHERE customer_id = p_customer_id;
  RETURN pg_catalog.jsonb_build_object('status', 'incorrect', 'attemptsRemaining', 5 - v_failed);
END;
$$;

-- Replaces the PIN after a correct change or a re-authenticated reset:
-- clears every counter and revokes the customer's unconsumed proofs.
CREATE FUNCTION wallet_pin_private.replace_pin(
  p_customer_id uuid,
  p_pepper_id bytea,
  p_salt bytea,
  p_pin_hash bytea,
  p_is_reset boolean
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  UPDATE wallet_pin_private.customer_pins
     SET kdf_version = 1, pepper_id = p_pepper_id, salt = p_salt,
         pin_hash = p_pin_hash, failed_attempts = 0, lockout_count = 0,
         locked_at = NULL, locked_until = NULL, updated_at = v_now,
         last_reset_at = CASE WHEN p_is_reset THEN v_now ELSE last_reset_at END
   WHERE customer_id = p_customer_id;
  DELETE FROM wallet_pin_private.proofs
   WHERE customer_id = p_customer_id AND consumed_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION
  wallet_pin_private.hex_bytes(text, integer),
  wallet_pin_private.caller_customer_id(uuid),
  wallet_pin_private.merchant_enabled(uuid),
  wallet_pin_private.has_recent_authentication(),
  wallet_pin_private.check_pin_attempt(uuid, bytea, bytea),
  wallet_pin_private.replace_pin(uuid, bytea, bytea, bytea, boolean)
FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
