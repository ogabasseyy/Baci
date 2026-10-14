-- Parenthesize JSON text extraction before string concatenation. PostgreSQL
-- otherwise applies ->> to concatenated text and raises SQLSTATE 42883.
-- Preserve the proof format, validation checks, Vault lookup and existing ACLs.

CREATE OR REPLACE FUNCTION private.verify_shipping_quote_route_proof(
  p_proof jsonb,
  p_action text,
  p_subject_id uuid,
  p_merchant_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret text;
  v_payload_text text;
  v_canonical text;
  v_expected text;
  v_issued_at timestamptz;
  v_signature text := COALESCE(p_proof->>'signature', '');
BEGIN
  IF p_proof IS NULL
     OR p_action IS NULL OR p_subject_id IS NULL OR p_merchant_id IS NULL
     OR p_proof->>'version' <> 'baci-shipping-quote-proof:v1'
     OR p_proof->>'action' <> p_action
     OR p_proof->>'subject_id' <> p_subject_id::text
     OR p_proof->>'merchant_id' <> p_merchant_id::text
     OR p_proof->>'issued_at' IS NULL
     OR pg_catalog.btrim(p_proof->>'issued_at') = ''
     OR p_proof->>'payload_text' IS NULL
     OR v_signature !~ '^[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;
  BEGIN
    v_issued_at := (p_proof->>'issued_at')::timestamptz;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;
  IF v_issued_at IS NULL
     OR v_issued_at < pg_catalog.now() - interval '5 minutes'
     OR v_issued_at > pg_catalog.now() + interval '30 seconds' THEN
    RETURN false;
  END IF;
  -- Sign the exact JSON text emitted by the server. This avoids cross-runtime
  -- JSON canonicalization differences and prevents payload substitution.
  v_payload_text := p_proof->>'payload_text';
  BEGIN
    PERFORM v_payload_text::jsonb;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;
  v_canonical := 'baci:shipping-quote-rpc:v1' || E'\n'
    || (p_proof->>'version') || E'\n' || p_action || E'\n'
    || p_subject_id::text || E'\n' || p_merchant_id::text || E'\n'
    || (p_proof->>'issued_at') || E'\n' || v_payload_text;
  IF pg_catalog.to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1'
      INTO v_secret USING 'service_role_key';
  END IF;
  IF v_secret IS NULL OR pg_catalog.btrim(v_secret) = '' THEN RETURN false; END IF;
  v_expected := pg_catalog.encode(extensions.hmac(v_canonical, v_secret, 'sha256'), 'hex');
  RETURN COALESCE(
    pg_catalog.encode(extensions.digest(v_signature, 'sha256'), 'hex')
      = pg_catalog.encode(extensions.digest(v_expected, 'sha256'), 'hex'),
    false
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
