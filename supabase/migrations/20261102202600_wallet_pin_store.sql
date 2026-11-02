-- Wallet transaction PIN store (dark): tables.
--
-- A customer's PIN is hashed on the server (scrypt over an HMAC with the
-- server-only WALLET_PIN_PEPPER; apps/web/src/lib/wallet-pin/wallet-pin-kdf.ts).
-- This schema keeps only the salt and the SHA-256 of the derived hash, so
-- a copy of a stored value cannot be sent back as if it were the PIN. No
-- client or API role can use the schema or read its tables: the SECURITY
-- DEFINER functions in the following migrations are the only way in.
--
-- A correct PIN yields a single-use proof, valid for 120 seconds and bound
-- to one debit (customer, merchant, purpose, amount in kobo and the SHA-256
-- of the request's Idempotency-Key). The spend hold consumes it inside its
-- own transaction (wallet_pin_private.consume_wallet_pin_proof).
--
-- The database never trusts a hash a client computed on its own: every set,
-- change, reset and verify must carry a fresh server attestation, an HMAC
-- under a key derived from WALLET_PIN_PEPPER (attestation_keys), checked by
-- wallet_pin_private.require_attestation at the end of this file.
--
-- Dark: nothing consumes a proof yet, the server cannot hash or attest
-- while WALLET_PIN_PEPPER is unset, and no attestation key or enabled
-- merchant authority row exists (both are written only by owner SQL from
-- the enablement runbook).

BEGIN;

CREATE SCHEMA wallet_pin_private;
REVOKE ALL ON SCHEMA wallet_pin_private FROM PUBLIC, anon, authenticated, service_role;

-- Per-merchant switch. No row, or enabled = false, means no PIN can be set,
-- changed, reset or verified and no proof can be consumed for that merchant.
CREATE TABLE wallet_pin_private.merchant_authorities (
  merchant_id uuid PRIMARY KEY REFERENCES public.merchants(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

-- One attestation key per pepper: HMAC-SHA256(WALLET_PIN_PEPPER,
-- 'baci.wallet-pin.attestation-key.v1'), keyed by the pepper's public id.
-- Owner SQL only. With no row for a pepper, nothing can be set, changed,
-- reset or verified under it.
CREATE TABLE wallet_pin_private.attestation_keys (
  pepper_id bytea PRIMARY KEY CHECK (pg_catalog.octet_length(pepper_id) = 8),
  attestation_key bytea NOT NULL CHECK (pg_catalog.octet_length(attestation_key) = 32),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

-- One PIN per customer row (a customer row is already per merchant).
-- user_id is the sign-in account that set the PIN: if the customer row is
-- later pointed at another account, the PIN and its proofs stop working
-- for everyone instead of passing to that account. pepper_id identifies
-- the pepper that made the hash, so a hash made with a different pepper is
-- refused as "reset required" instead of counting as a wrong PIN. pin_hash
-- is SHA-256 of the derived hash. The lock window is at most 24 hours.
CREATE TABLE wallet_pin_private.customer_pins (
  customer_id uuid PRIMARY KEY REFERENCES public.customers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  kdf_version smallint NOT NULL CHECK (kdf_version = 1),
  pepper_id bytea NOT NULL CHECK (pg_catalog.octet_length(pepper_id) = 8),
  salt bytea NOT NULL CHECK (pg_catalog.octet_length(salt) = 16),
  pin_hash bytea NOT NULL CHECK (pg_catalog.octet_length(pin_hash) = 32),
  failed_attempts smallint NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5),
  lockout_count integer NOT NULL DEFAULT 0 CHECK (lockout_count BETWEEN 0 AND 1000),
  locked_at timestamptz,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  last_reset_at timestamptz,
  CONSTRAINT customer_pins_lock_window CHECK (
    (locked_at IS NULL) = (locked_until IS NULL)
    AND (locked_until IS NULL
      OR (locked_until > locked_at AND locked_until <= locked_at + interval '24 hours'))
  )
);
CREATE INDEX customer_pins_merchant_idx ON wallet_pin_private.customer_pins (merchant_id);
CREATE INDEX customer_pins_user_idx ON wallet_pin_private.customer_pins (user_id);

-- The debit purposes a proof can be issued for. Later work adds rows; the
-- proofs table references this one, so the domain lives in one place.
CREATE TABLE wallet_pin_private.proof_purposes (
  purpose text PRIMARY KEY CHECK (purpose ~ '^[a-z][a-z_]{1,31}$')
);
INSERT INTO wallet_pin_private.proof_purposes (purpose)
VALUES ('vtu'), ('imei'), ('checkout');

-- Only the SHA-256 of the proof token is stored. At most one unconsumed
-- proof exists per (customer, purpose, Idempotency-Key digest).
CREATE TABLE wallet_pin_private.proofs (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  token_sha256 bytea NOT NULL UNIQUE CHECK (pg_catalog.octet_length(token_sha256) = 32),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  purpose text NOT NULL REFERENCES wallet_pin_private.proof_purposes(purpose),
  amount_kobo bigint NOT NULL CHECK (amount_kobo BETWEEN 1 AND 9999999999),
  idempotency_key_sha256 bytea NOT NULL
    CHECK (pg_catalog.octet_length(idempotency_key_sha256) = 32),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT proofs_lifetime CHECK (expires_at = issued_at + interval '120 seconds'),
  CONSTRAINT proofs_consumed_before_expiry CHECK (consumed_at IS NULL OR consumed_at < expires_at)
);
CREATE UNIQUE INDEX proofs_live_binding_idx
  ON wallet_pin_private.proofs (customer_id, purpose, idempotency_key_sha256)
  WHERE consumed_at IS NULL;
CREATE INDEX proofs_customer_expiry_idx ON wallet_pin_private.proofs (customer_id, expires_at);
CREATE INDEX proofs_merchant_idx ON wallet_pin_private.proofs (merchant_id);
CREATE INDEX proofs_purpose_idx ON wallet_pin_private.proofs (purpose);

-- Second wall: RLS with a restrictive deny-all policy. The owner (postgres,
-- the definer of the functions below) is not subject to RLS.
ALTER TABLE wallet_pin_private.attestation_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_pin_private.merchant_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_pin_private.customer_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_pin_private.proof_purposes ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_pin_private.proofs ENABLE ROW LEVEL SECURITY;
CREATE POLICY attestation_keys_deny ON wallet_pin_private.attestation_keys
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
CREATE POLICY merchant_authorities_deny ON wallet_pin_private.merchant_authorities
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
CREATE POLICY customer_pins_deny ON wallet_pin_private.customer_pins
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
CREATE POLICY proof_purposes_deny ON wallet_pin_private.proof_purposes
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
CREATE POLICY proofs_deny ON wallet_pin_private.proofs
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);

REVOKE ALL ON ALL TABLES IN SCHEMA wallet_pin_private
  FROM PUBLIC, anon, authenticated, service_role;

-- Checks the server attestation on a set, change, reset or verify. It is
-- '<attested_at_ms>.<hex HMAC-SHA256>' over these lines joined by '\n':
-- 'baci.wallet-pin.attestation.v1', operation, caller user id, merchant id,
-- pepper id (hex), attested_at_ms, then the operation's fields, all lower
-- case. Returns true when valid, false when no key exists for the pepper
-- (the feature is not provisioned: callers answer "unavailable"), and
-- raises 42501 when the attestation is wrong, for another caller or
-- request, or older than 2 minutes. A NULL operation, merchant, pepper,
-- attestation or field raises 22023 (array_to_string would silently skip a
-- NULL field and sign a shorter message). Nothing is counted or changed first.
-- The two MACs are compared through a second HMAC under a random key, so the
-- time the comparison takes says nothing about how much of a guess was right.
CREATE FUNCTION wallet_pin_private.require_attestation(
  p_operation text,
  p_merchant_id uuid,
  p_pepper_id bytea,
  p_attestation text,
  p_fields text[]
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_key bytea;
  v_at_ms bigint := pg_catalog.split_part(p_attestation, '.', 1)::bigint;
  v_mac bytea := pg_catalog.decode(pg_catalog.split_part(p_attestation, '.', 2), 'hex');
  v_now_ms bigint := (pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()) * 1000)::bigint;
  v_blind bytea := extensions.gen_random_bytes(32);
  v_expected bytea;
BEGIN
  IF p_operation IS NULL OR p_merchant_id IS NULL OR p_pepper_id IS NULL
    OR p_attestation IS NULL OR p_fields IS NULL
    OR pg_catalog.array_position(p_fields, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'invalid wallet pin request' USING ERRCODE = '22023';
  END IF;
  SELECT attestation.attestation_key INTO v_key
    FROM wallet_pin_private.attestation_keys AS attestation
   WHERE attestation.pepper_id = p_pepper_id;
  IF v_key IS NULL THEN
    RETURN false;
  END IF;
  v_expected := extensions.hmac(
    pg_catalog.convert_to(pg_catalog.array_to_string(
      ARRAY['baci.wallet-pin.attestation.v1', p_operation,
            COALESCE(auth.uid()::text, ''), p_merchant_id::text,
            pg_catalog.encode(p_pepper_id, 'hex'), v_at_ms::text] || p_fields,
      E'\n'), 'UTF8'),
    v_key, 'sha256');
  IF v_at_ms < v_now_ms - 120000 OR v_at_ms > v_now_ms + 30000
    OR extensions.hmac(v_expected, v_blind, 'sha256')
      IS DISTINCT FROM extensions.hmac(v_mac, v_blind, 'sha256') THEN
    RAISE EXCEPTION 'wallet_pin_attestation_invalid' USING ERRCODE = '42501';
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION
  wallet_pin_private.require_attestation(text, uuid, bytea, text, text[])
FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
