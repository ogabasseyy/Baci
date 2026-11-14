-- Wallet PIN status reports 'unavailable' when the pepper's signing key is
-- absent. Mutations already refuse without that key; status now agrees.
-- Same signature, return type and ACL as before.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_wallet_pin_state(p_merchant_id uuid, p_pepper_id text)
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
  -- Without the pepper's signing key every set, change and reset is refused,
  -- so the status must not advertise a working PIN (a missing or deleted key
  -- is the emergency stop).
  IF NOT EXISTS (
    SELECT 1 FROM wallet_pin_private.attestation_keys AS attestation
     WHERE attestation.pepper_id = v_pepper_id
  ) THEN
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

REVOKE ALL ON FUNCTION public.get_wallet_pin_state(uuid, text)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_wallet_pin_state(uuid, text) TO authenticated;

COMMIT;
