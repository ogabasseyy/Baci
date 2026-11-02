-- Wallet transaction PIN store (dark): single-use, debit-bound proofs.
--
-- verify_wallet_pin (customer RPC, authenticated only, server-attested)
-- checks one PIN attempt and, on a correct PIN, issues a proof valid for 120
-- seconds and bound to (customer, merchant, purpose, amount_kobo, SHA-256 of
-- the debit request's Idempotency-Key). Only the SHA-256 of the proof token
-- is stored. Verifying again for the same purpose and key replaces the live
-- proof; a customer holds at most 10 live proofs.
--
-- consume_wallet_pin_proof is ungranted: the spend hold calls it definer to
-- definer inside its own transaction, so the proof is spent if and only if
-- the hold commits. It returns consumed, or a refusal that never spends a
-- valid proof: missing, invalid (unknown or revoked), mismatch (any part of
-- the binding differs), used, expired or unavailable (merchant switched
-- off, customer soft-deleted, or the customer row no longer points at the
-- account and merchant the PIN was set for). The proof row is locked, so
-- two concurrent spends of one proof cannot both succeed, and expiry is
-- judged by the clock after the lock is held.
--
-- Reason precedence: missing, invalid, mismatch, used, expired, unavailable.
-- The binding is judged before the proof's state, so used and expired only
-- ever describe a proof presented for exactly the debit it was issued for
-- (a replay of that debit, or a late retry of it). A spent or expired proof
-- presented for anything else is a mismatch. A spend hold can therefore
-- read used as "this debit already spent its proof" and mismatch as a caller
-- error, without a differing field turning one into the other.

BEGIN;

CREATE FUNCTION public.verify_wallet_pin(
  p_merchant_id uuid,
  p_pepper_id text,
  p_pin_hash text,
  p_purpose text,
  p_amount_kobo bigint,
  p_idempotency_key_sha256 text,
  p_attestation text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pepper_id bytea := wallet_pin_private.hex_bytes(p_pepper_id, 8);
  v_candidate bytea := wallet_pin_private.hex_bytes(p_pin_hash, 32);
  v_idempotency bytea := wallet_pin_private.hex_bytes(p_idempotency_key_sha256, 32);
  v_customer_id uuid;
  v_attempt jsonb;
  v_now timestamptz;
  v_token bytea;
BEGIN
  IF p_merchant_id IS NULL OR v_pepper_id IS NULL OR v_candidate IS NULL
    OR v_idempotency IS NULL OR p_amount_kobo IS NULL
    OR p_amount_kobo NOT BETWEEN 1 AND 9999999999
    OR p_attestation IS NULL OR p_attestation !~ '^[0-9]{13}\.[0-9a-f]{64}$'
    OR NOT EXISTS (
      SELECT 1 FROM wallet_pin_private.proof_purposes AS purpose
       WHERE purpose.purpose = p_purpose
    ) THEN
    RAISE EXCEPTION 'invalid wallet pin request' USING ERRCODE = '22023';
  END IF;
  v_customer_id := wallet_pin_private.caller_customer_id(p_merchant_id);
  IF NOT wallet_pin_private.merchant_enabled(p_merchant_id) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'unavailable');
  END IF;
  IF NOT wallet_pin_private.require_attestation('verify', p_merchant_id, v_pepper_id,
    p_attestation, ARRAY[p_pin_hash, p_purpose, p_amount_kobo::text, p_idempotency_key_sha256]) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'unavailable');
  END IF;

  v_attempt := wallet_pin_private.check_pin_attempt(v_customer_id, v_pepper_id, v_candidate);
  IF v_attempt ->> 'status' <> 'match' THEN
    RETURN v_attempt;
  END IF;

  v_now := pg_catalog.clock_timestamp();
  DELETE FROM wallet_pin_private.proofs AS proof
   WHERE proof.customer_id = v_customer_id
     AND proof.consumed_at IS NULL
     AND (proof.expires_at <= v_now
       OR (proof.purpose = p_purpose AND proof.idempotency_key_sha256 = v_idempotency));
  -- The purge can wait for a spend that holds one of these proofs, so the
  -- issue time is read again once it is done.
  v_now := pg_catalog.clock_timestamp();
  IF (SELECT pg_catalog.count(*) FROM wallet_pin_private.proofs AS proof
       WHERE proof.customer_id = v_customer_id AND proof.consumed_at IS NULL) >= 10 THEN
    RETURN pg_catalog.jsonb_build_object('status', 'too_many_proofs');
  END IF;

  v_token := extensions.gen_random_bytes(32);
  INSERT INTO wallet_pin_private.proofs (
    token_sha256, customer_id, merchant_id, purpose, amount_kobo,
    idempotency_key_sha256, issued_at, expires_at
  ) VALUES (
    pg_catalog.sha256(v_token), v_customer_id, p_merchant_id, p_purpose,
    p_amount_kobo, v_idempotency, v_now, v_now + interval '120 seconds'
  );
  RETURN pg_catalog.jsonb_build_object(
    'status', 'verified',
    'proof', pg_catalog.encode(v_token, 'hex'),
    'expiresAt', v_now + interval '120 seconds'
  );
END;
$$;

CREATE FUNCTION wallet_pin_private.consume_wallet_pin_proof(
  p_customer_id uuid,
  p_merchant_id uuid,
  p_purpose text,
  p_amount_kobo bigint,
  p_idempotency_key_sha256 text,
  p_proof text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_idempotency bytea := wallet_pin_private.hex_bytes(p_idempotency_key_sha256, 32);
  v_token bytea;
  v_proof wallet_pin_private.proofs%ROWTYPE;
  v_now timestamptz;
BEGIN
  IF p_customer_id IS NULL OR p_merchant_id IS NULL OR p_purpose IS NULL
    OR p_amount_kobo IS NULL OR v_idempotency IS NULL THEN
    RAISE EXCEPTION 'invalid wallet pin proof binding' USING ERRCODE = '22023';
  END IF;
  IF p_proof IS NULL OR p_proof = '' THEN
    RETURN 'missing';
  END IF;
  v_token := wallet_pin_private.hex_bytes(p_proof, 32);
  IF v_token IS NULL THEN
    RETURN 'invalid';
  END IF;

  SELECT proof.* INTO v_proof FROM wallet_pin_private.proofs AS proof
   WHERE proof.token_sha256 = pg_catalog.sha256(v_token)
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'invalid';
  END IF;
  v_now := pg_catalog.clock_timestamp();
  IF v_proof.customer_id <> p_customer_id OR v_proof.merchant_id <> p_merchant_id
    OR v_proof.purpose <> p_purpose OR v_proof.amount_kobo <> p_amount_kobo
    OR v_proof.idempotency_key_sha256 <> v_idempotency THEN
    RETURN 'mismatch';
  END IF;
  IF v_proof.consumed_at IS NOT NULL THEN
    RETURN 'used';
  END IF;
  IF v_proof.expires_at <= v_now THEN
    RETURN 'expired';
  END IF;
  IF NOT wallet_pin_private.merchant_enabled(p_merchant_id)
    OR NOT wallet_pin_private.pin_binding_intact(p_customer_id) THEN
    RETURN 'unavailable';
  END IF;

  UPDATE wallet_pin_private.proofs SET consumed_at = v_now WHERE id = v_proof.id;
  RETURN 'consumed';
END;
$$;

REVOKE ALL ON FUNCTION public.verify_wallet_pin(uuid, text, text, text, bigint, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_wallet_pin(uuid, text, text, text, bigint, text, text)
  TO authenticated;
REVOKE ALL ON FUNCTION
  wallet_pin_private.consume_wallet_pin_proof(uuid, uuid, text, bigint, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
