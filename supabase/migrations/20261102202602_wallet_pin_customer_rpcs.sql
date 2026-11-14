-- Wallet transaction PIN store (dark): customer RPCs.
--
-- Called by the storefront PIN routes with the customer's own session
-- (authenticated role, JWT claims). The server hashes the PIN before the
-- call; the PIN never reaches the database and the hash never leaves it.
-- p_pepper_id is the public id of the server's WALLET_PIN_PEPPER. Inputs
-- are hex text (lower case). Arguments are checked before any state
-- changes, so a malformed request never counts as an attempt.
--
-- Set, change, reset and verify also take p_attestation, the server's HMAC
-- over the caller and every argument
-- (wallet_pin_private.require_attestation). A client calling the API
-- directly cannot produce it, so the database never accepts a hash the
-- client computed itself, and nothing works under a pepper with no key.
--
-- A first set and a reset both need a recent sign-in
-- (wallet_pin_private.has_recent_authentication). A PIN belongs to the
-- sign-in account and the merchant it was set for: if the caller's customer
-- row now points at another account or merchant, every call answers
-- "unavailable".
--
-- Results are {"status": ...}:
--   get_wallet_pin_state  unavailable | not_set | reset_required
--                         | locked {lockedUntil} | set {kdfVersion, salt, attemptsRemaining}
--   set_wallet_pin        unavailable | reauthentication_required | already_set | set
--   change_wallet_pin     unavailable | not_set | reset_required | locked
--                         | incorrect {attemptsRemaining} | changed
--   reset_wallet_pin      unavailable | reauthentication_required | not_set | reset
--   verify_wallet_pin     unavailable | not_set | reset_required | locked
--                         | incorrect | too_many_proofs | verified {proof, expiresAt}
-- Identity failures raise 42501; malformed arguments raise 22023.

BEGIN;

CREATE FUNCTION public.get_wallet_pin_state(p_merchant_id uuid, p_pepper_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pepper_id bytea := wallet_pin_private.hex_bytes(p_pepper_id, 8);
  v_customer_id uuid;
  v_pin wallet_pin_private.customer_pins%ROWTYPE;
BEGIN
  IF p_merchant_id IS NULL OR v_pepper_id IS NULL THEN
    RAISE EXCEPTION 'invalid wallet pin request' USING ERRCODE = '22023';
  END IF;
  v_customer_id := wallet_pin_private.caller_customer_id(p_merchant_id);
  IF NOT wallet_pin_private.merchant_enabled(p_merchant_id) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'unavailable');
  END IF;

  SELECT pin.* INTO v_pin FROM wallet_pin_private.customer_pins AS pin
   WHERE pin.customer_id = v_customer_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', 'not_set');
  ELSIF v_pin.user_id IS DISTINCT FROM auth.uid()
    OR NOT wallet_pin_private.pin_binding_intact(v_customer_id) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'unavailable');
  ELSIF v_pin.pepper_id <> v_pepper_id THEN
    RETURN pg_catalog.jsonb_build_object('status', 'reset_required');
  ELSIF v_pin.locked_until > pg_catalog.clock_timestamp() THEN
    RETURN pg_catalog.jsonb_build_object('status', 'locked', 'lockedUntil', v_pin.locked_until);
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'status', 'set',
    'kdfVersion', v_pin.kdf_version,
    'salt', pg_catalog.encode(v_pin.salt, 'hex'),
    'attemptsRemaining',
    5 - CASE WHEN v_pin.locked_until IS NULL THEN v_pin.failed_attempts ELSE 0 END
  );
END;
$$;

CREATE FUNCTION public.set_wallet_pin(
  p_merchant_id uuid,
  p_pepper_id text,
  p_kdf_version integer,
  p_salt text,
  p_pin_hash text,
  p_attestation text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pepper_id bytea := wallet_pin_private.hex_bytes(p_pepper_id, 8);
  v_salt bytea := wallet_pin_private.hex_bytes(p_salt, 16);
  v_hash bytea := wallet_pin_private.hex_bytes(p_pin_hash, 32);
  v_customer_id uuid;
  v_inserted integer;
BEGIN
  IF p_merchant_id IS NULL OR v_pepper_id IS NULL OR v_salt IS NULL OR v_hash IS NULL
    OR p_kdf_version IS DISTINCT FROM 1 OR p_attestation IS NULL OR p_attestation !~ '^[0-9]{13}\.[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid wallet pin request' USING ERRCODE = '22023';
  END IF;
  v_customer_id := wallet_pin_private.caller_customer_id(p_merchant_id);
  IF NOT wallet_pin_private.merchant_enabled(p_merchant_id) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'unavailable');
  END IF;
  IF NOT wallet_pin_private.require_attestation('set', p_merchant_id, v_pepper_id,
    p_attestation, ARRAY['1', p_salt, p_pin_hash]) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'unavailable');
  END IF;
  -- Creating the spending credential needs a recent sign-in, like a reset,
  -- so an old session alone cannot claim a wallet that has no PIN yet.
  IF NOT wallet_pin_private.has_recent_authentication() THEN
    RETURN pg_catalog.jsonb_build_object('status', 'reauthentication_required');
  END IF;

  -- First-time only: an existing PIN changes through change or reset.
  INSERT INTO wallet_pin_private.customer_pins (
    customer_id, user_id, merchant_id, kdf_version, pepper_id, salt, pin_hash
  ) VALUES (
    v_customer_id, auth.uid(), p_merchant_id, 1, v_pepper_id, v_salt,
    pg_catalog.sha256(v_hash)
  )
  ON CONFLICT (customer_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN pg_catalog.jsonb_build_object(
    'status', CASE WHEN v_inserted = 1 THEN 'set' ELSE 'already_set' END
  );
END;
$$;

CREATE FUNCTION public.change_wallet_pin(
  p_merchant_id uuid,
  p_pepper_id text,
  p_current_pin_hash text,
  p_kdf_version integer,
  p_salt text,
  p_pin_hash text,
  p_attestation text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pepper_id bytea := wallet_pin_private.hex_bytes(p_pepper_id, 8);
  v_current bytea := wallet_pin_private.hex_bytes(p_current_pin_hash, 32);
  v_salt bytea := wallet_pin_private.hex_bytes(p_salt, 16);
  v_hash bytea := wallet_pin_private.hex_bytes(p_pin_hash, 32);
  v_customer_id uuid;
  v_attempt jsonb;
BEGIN
  IF p_merchant_id IS NULL OR v_pepper_id IS NULL OR v_current IS NULL
    OR v_salt IS NULL OR v_hash IS NULL OR p_kdf_version IS DISTINCT FROM 1
    OR p_attestation IS NULL OR p_attestation !~ '^[0-9]{13}\.[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid wallet pin request' USING ERRCODE = '22023';
  END IF;
  v_customer_id := wallet_pin_private.caller_customer_id(p_merchant_id);
  IF NOT wallet_pin_private.merchant_enabled(p_merchant_id) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'unavailable');
  END IF;
  IF NOT wallet_pin_private.require_attestation('change', p_merchant_id, v_pepper_id,
    p_attestation, ARRAY[p_current_pin_hash, '1', p_salt, p_pin_hash]) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'unavailable');
  END IF;

  v_attempt := wallet_pin_private.check_pin_attempt(v_customer_id, v_pepper_id, v_current);
  IF v_attempt ->> 'status' <> 'match' THEN
    RETURN v_attempt;
  END IF;
  PERFORM wallet_pin_private.replace_pin(v_customer_id, v_pepper_id, v_salt, v_hash, false);
  RETURN pg_catalog.jsonb_build_object('status', 'changed');
END;
$$;

CREATE FUNCTION public.reset_wallet_pin(
  p_merchant_id uuid,
  p_pepper_id text,
  p_kdf_version integer,
  p_salt text,
  p_pin_hash text,
  p_attestation text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pepper_id bytea := wallet_pin_private.hex_bytes(p_pepper_id, 8);
  v_salt bytea := wallet_pin_private.hex_bytes(p_salt, 16);
  v_hash bytea := wallet_pin_private.hex_bytes(p_pin_hash, 32);
  v_customer_id uuid;
  v_bound_user_id uuid;
  v_has_pin boolean;
BEGIN
  IF p_merchant_id IS NULL OR v_pepper_id IS NULL OR v_salt IS NULL OR v_hash IS NULL
    OR p_kdf_version IS DISTINCT FROM 1 OR p_attestation IS NULL OR p_attestation !~ '^[0-9]{13}\.[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid wallet pin request' USING ERRCODE = '22023';
  END IF;
  v_customer_id := wallet_pin_private.caller_customer_id(p_merchant_id);
  IF NOT wallet_pin_private.merchant_enabled(p_merchant_id) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'unavailable');
  END IF;
  IF NOT wallet_pin_private.require_attestation('reset', p_merchant_id, v_pepper_id,
    p_attestation, ARRAY['1', p_salt, p_pin_hash]) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'unavailable');
  END IF;

  -- The PIN row is locked first and the sign-in age is judged after the lock
  -- is held, so a wait behind another attempt never lets a stale sign-in pass.
  SELECT pin.user_id INTO v_bound_user_id
    FROM wallet_pin_private.customer_pins AS pin
   WHERE pin.customer_id = v_customer_id
     FOR UPDATE;
  v_has_pin := FOUND;
  IF NOT wallet_pin_private.has_recent_authentication() THEN
    RETURN pg_catalog.jsonb_build_object('status', 'reauthentication_required');
  END IF;
  IF NOT v_has_pin THEN
    RETURN pg_catalog.jsonb_build_object('status', 'not_set');
  END IF;
  -- A reset never moves a PIN to another account or merchant.
  IF v_bound_user_id IS DISTINCT FROM auth.uid()
    OR NOT wallet_pin_private.pin_binding_intact(v_customer_id) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'unavailable');
  END IF;
  -- A reset also re-establishes the PIN under the server's current pepper
  -- and clears any lockout.
  PERFORM wallet_pin_private.replace_pin(v_customer_id, v_pepper_id, v_salt, v_hash, true);
  RETURN pg_catalog.jsonb_build_object('status', 'reset');
END;
$$;

REVOKE ALL ON FUNCTION
  public.get_wallet_pin_state(uuid, text),
  public.set_wallet_pin(uuid, text, integer, text, text, text),
  public.change_wallet_pin(uuid, text, text, integer, text, text, text),
  public.reset_wallet_pin(uuid, text, integer, text, text, text)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.get_wallet_pin_state(uuid, text),
  public.set_wallet_pin(uuid, text, integer, text, text, text),
  public.change_wallet_pin(uuid, text, text, integer, text, text, text),
  public.reset_wallet_pin(uuid, text, integer, text, text, text)
TO authenticated;

COMMIT;
