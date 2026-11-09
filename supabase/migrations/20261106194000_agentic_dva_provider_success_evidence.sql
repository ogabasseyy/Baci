-- Dormant, server-attested Paystack DVA assignment evidence for dispatch holds.
-- This does not call Paystack, enable dispatch, or make evidence caller-writable.

DO $roles$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'agentic_dva_provider_evidence_writer'
  ) THEN
    -- Do not normalize an existing role: it may own objects or carry grants,
    -- default privileges, or memberships that this migration cannot safely
    -- infer. Provision this dormant role only when the name is unused.
    RAISE EXCEPTION 'agentic DVA evidence writer role already exists';
  END IF;

  CREATE ROLE agentic_dva_provider_evidence_writer
    NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
    NOREPLICATION NOBYPASSRLS;
END;
$roles$;


GRANT USAGE ON SCHEMA public TO agentic_dva_provider_evidence_writer;
-- Deliberately do not grant this role to authenticator. The existing
-- PostgREST pre-request hook does not scope role switching to this RPC, so a
-- membership grant would expose the role to any JWT carrying the role claim.
-- Keep the writer unreachable until a separately reviewed gateway rollout.

CREATE TABLE private.agentic_cart_dispatch_provider_evidence (
  hold_id uuid PRIMARY KEY
    REFERENCES private.agentic_cart_dispatch_holds(id) ON DELETE RESTRICT,
  merchant_id uuid NOT NULL,
  cart_id uuid NOT NULL,
  checkout_session_id uuid NOT NULL,
  checkout_generation integer NOT NULL CHECK (checkout_generation >= 1),
  cart_version integer NOT NULL CHECK (cart_version >= 1),
  principal_id text NOT NULL,
  claim_reference text NOT NULL UNIQUE,
  attestation_jti uuid NOT NULL UNIQUE,
  account_number text NOT NULL CHECK (account_number ~ '^[0-9]{10}$'),
  account_name text NOT NULL CHECK (octet_length(account_name) BETWEEN 1 AND 120),
  bank_name text NOT NULL CHECK (octet_length(bank_name) BETWEEN 1 AND 120),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  subaccount_code text NOT NULL CHECK (subaccount_code ~ '^ACCT_[A-Za-z0-9]{15}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (merchant_id, cart_id)
    REFERENCES public.commerce_carts(merchant_id, id) ON DELETE RESTRICT
);
CREATE INDEX agentic_cart_dispatch_provider_evidence_merchant_cart_idx
  ON private.agentic_cart_dispatch_provider_evidence (merchant_id, cart_id);
ALTER TABLE private.agentic_cart_dispatch_provider_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY agentic_cart_dispatch_provider_evidence_deny
  ON private.agentic_cart_dispatch_provider_evidence
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON private.agentic_cart_dispatch_provider_evidence
  FROM PUBLIC, anon, authenticated, service_role,
       agentic_dva_provider_evidence_writer;

CREATE OR REPLACE FUNCTION public.commerce_cart_persist_agentic_dva_provider_success(
  p_hold_id uuid,
  p_claim_reference text,
  p_account_number text,
  p_account_name text,
  p_bank_name text,
  p_currency text,
  p_subaccount_code text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_claims jsonb := auth.jwt();
  v_attestation jsonb;
  v_hold private.agentic_cart_dispatch_holds%ROWTYPE;
  v_existing private.agentic_cart_dispatch_provider_evidence%ROWTYPE;
  v_jti uuid;
  v_exp numeric;
  v_iat numeric;
BEGIN
  -- The only authority is a short-lived server-signed JWT minted by the
  -- server helper after its Paystack request returned and passed validation.
  -- checkout_sessions is deliberately not read: it is mutable by scoped
  -- authenticated callers and cannot establish provider success.
  IF auth.role() IS DISTINCT FROM 'agentic_dva_provider_evidence_writer'
     OR v_claims ->> 'aud' IS DISTINCT FROM 'authenticated'
     OR jsonb_typeof(v_claims -> 'exp') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_claims -> 'iat') IS DISTINCT FROM 'number'
     OR coalesce(v_claims ->> 'exp', '') !~ '^[0-9]{1,12}$'
     OR coalesce(v_claims ->> 'iat', '') !~ '^[0-9]{1,12}$' THEN
    RETURN jsonb_build_object('status', 'blocked');
  END IF;
  v_exp := (v_claims ->> 'exp')::numeric;
  v_iat := (v_claims ->> 'iat')::numeric;
  IF v_exp <= extract(epoch FROM clock_timestamp())
     OR v_exp > extract(epoch FROM clock_timestamp()) + 60
     OR v_iat > extract(epoch FROM clock_timestamp()) + 5
     OR v_iat < extract(epoch FROM clock_timestamp()) - 60 THEN
    RETURN jsonb_build_object('status', 'blocked');
  END IF;

  v_attestation := v_claims -> 'agentic_dva_provider_success';
  IF jsonb_typeof(v_attestation) IS DISTINCT FROM 'object'
     OR v_attestation ->> 'version' IS DISTINCT FROM '1'
     OR v_attestation ->> 'scope' IS DISTINCT FROM 'paystack_dva_assignment'
     OR nullif(v_attestation ->> 'jti', '') IS NULL
     OR (v_attestation ->> 'jti') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR v_attestation ->> 'hold_id' IS DISTINCT FROM p_hold_id::text
     OR v_attestation ->> 'claim_reference' IS DISTINCT FROM p_claim_reference
     OR v_attestation ->> 'account_number' IS DISTINCT FROM p_account_number
     OR v_attestation ->> 'account_name' IS DISTINCT FROM p_account_name
     OR v_attestation ->> 'bank_name' IS DISTINCT FROM p_bank_name
     OR v_attestation ->> 'currency' IS DISTINCT FROM p_currency
     OR v_attestation ->> 'subaccount_code' IS DISTINCT FROM p_subaccount_code
     OR coalesce(v_attestation ->> 'provider_status', '') IS DISTINCT FROM 'success'
     OR coalesce(v_attestation ->> 'assigned', '') IS DISTINCT FROM 'true'
     OR coalesce((SELECT enabled
       FROM private.agentic_cart_dispatch_rollout WHERE singleton), false) IS NOT TRUE
     OR p_account_number IS NULL
     OR p_account_number !~ '^[0-9]{10}$'
     OR p_account_name IS NULL OR btrim(p_account_name) IS DISTINCT FROM p_account_name
     OR octet_length(p_account_name) NOT BETWEEN 1 AND 120
     OR p_bank_name IS NULL OR btrim(p_bank_name) IS DISTINCT FROM p_bank_name
     OR octet_length(p_bank_name) NOT BETWEEN 1 AND 120
     OR p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$'
     OR p_subaccount_code IS NULL OR p_subaccount_code !~ '^ACCT_[A-Za-z0-9]{15}$'
     OR p_claim_reference IS NULL OR length(p_claim_reference) NOT BETWEEN 1 AND 256 THEN
    RETURN jsonb_build_object('status', 'blocked');
  END IF;

  BEGIN
    v_jti := (v_attestation ->> 'jti')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('status', 'blocked');
  END;

  SELECT * INTO v_hold
  FROM private.agentic_cart_dispatch_holds hold
  WHERE hold.id = p_hold_id
    AND hold.claim_reference = p_claim_reference
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'blocked');
  END IF;

  SELECT * INTO v_existing
  FROM private.agentic_cart_dispatch_provider_evidence evidence
  WHERE evidence.hold_id = p_hold_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.attestation_jti = v_jti
       AND v_existing.claim_reference = p_claim_reference
       AND v_existing.account_number = p_account_number
       AND v_existing.account_name = p_account_name
       AND v_existing.bank_name = p_bank_name
       AND v_existing.currency = p_currency
       AND v_existing.subaccount_code = p_subaccount_code THEN
      RETURN jsonb_build_object('status', 'existing');
    END IF;
    RETURN jsonb_build_object('status', 'blocked');
  END IF;

  IF v_hold.state IS DISTINCT FROM 'outcome_unknown'
     OR v_hold.evidence_reference IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'blocked');
  END IF;

  INSERT INTO private.agentic_cart_dispatch_provider_evidence(
    hold_id, merchant_id, cart_id, checkout_session_id,
    checkout_generation, cart_version, principal_id, claim_reference,
    attestation_jti, account_number, account_name, bank_name, currency,
    subaccount_code
  ) VALUES (
    v_hold.id, v_hold.merchant_id, v_hold.cart_id, v_hold.checkout_session_id,
    v_hold.checkout_generation, v_hold.cart_version, v_hold.principal_id,
    v_hold.claim_reference, v_jti, p_account_number, p_account_name,
    p_bank_name, p_currency, p_subaccount_code
  );

  UPDATE private.agentic_cart_dispatch_holds
  SET state = 'account_ready', evidence_reference = v_jti::text,
      reconciled_at = clock_timestamp()
  WHERE id = p_hold_id AND state = 'outcome_unknown'
    AND claim_reference = p_claim_reference;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'agentic DVA hold changed during evidence persistence'
      USING ERRCODE = '40001';
  END IF;

  RETURN jsonb_build_object('status', 'persisted');
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('status', 'blocked');
END;
$$;

ALTER FUNCTION public.commerce_cart_persist_agentic_dva_provider_success(
  uuid, text, text, text, text, text, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.commerce_cart_persist_agentic_dva_provider_success(
  uuid, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commerce_cart_persist_agentic_dva_provider_success(
  uuid, text, text, text, text, text, text
) TO agentic_dva_provider_evidence_writer;
