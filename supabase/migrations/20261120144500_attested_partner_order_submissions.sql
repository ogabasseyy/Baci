-- A receipt records a partner's payment claim. Verification, stock mutation,
-- Baci order creation and dispatch are separate operations.
CREATE TABLE private.partner_order_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants (id),
  connection_id text NOT NULL CHECK (connection_id ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  quote_id uuid NOT NULL UNIQUE REFERENCES private.partner_delivery_quotes (id),
  partner_order_id text NOT NULL CHECK (length(partner_order_id) BETWEEN 1 AND 128),
  idempotency_hash text NOT NULL CHECK (idempotency_hash ~ '^[0-9a-f]{64}$'),
  submission jsonb NOT NULL CHECK (jsonb_typeof(submission) = 'object'),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (merchant_id, connection_id, partner_order_id),
  UNIQUE (merchant_id, connection_id, idempotency_hash)
);

ALTER TABLE private.partner_order_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.partner_order_submissions FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.partner_order_receipt(s private.partner_order_submissions)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'submission_id', s.id,
    'partner_order_id', s.partner_order_id,
    'received_at', s.received_at,
    'status', 'pending_verification'
  );
$$;

REVOKE ALL ON FUNCTION private.partner_order_receipt(private.partner_order_submissions)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.submit_partner_order(
  p_quote_id uuid,
  p_merchant_id uuid,
  p_connection_id text,
  p_partner_order_id text,
  p_idempotency_hash text,
  p_submission jsonb,
  p_route_proof jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_receipt private.partner_order_submissions%ROWTYPE;
BEGIN
  IF p_quote_id IS NULL OR p_merchant_id IS NULL
     OR p_connection_id IS NULL OR p_connection_id !~ '^[a-z0-9][a-z0-9_-]{0,79}$'
     OR p_partner_order_id IS NULL OR length(p_partner_order_id) NOT BETWEEN 1 AND 128
     OR p_idempotency_hash IS NULL OR p_idempotency_hash !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(p_submission) IS DISTINCT FROM 'object'
     OR pg_column_size(p_submission) > 8192
     OR pg_column_size(p_route_proof) > 16384 THEN
    RAISE EXCEPTION 'invalid_partner_order' USING ERRCODE = '22023';
  END IF;

  IF private.verify_shipping_quote_route_proof(
       p_route_proof, 'submit_partner_order', p_quote_id, p_merchant_id
     ) IS DISTINCT FROM true
     OR (p_route_proof->>'payload_text')::jsonb IS DISTINCT FROM jsonb_build_object(
       'connection_id', p_connection_id,
       'partner_order_id', p_partner_order_id,
       'idempotency_hash', p_idempotency_hash,
       'submission', p_submission
     ) THEN
    RAISE EXCEPTION 'invalid_partner_order_proof' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM private.partner_delivery_quotes AS q
  WHERE q.id = p_quote_id AND q.merchant_id = p_merchant_id
    AND q.connection_id = p_connection_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'partner_quote_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Record late captures for reconciliation too. The verified capture time
  -- and applicable deadline are checked before any order can be accepted.
  INSERT INTO private.partner_order_submissions (
    merchant_id, connection_id, quote_id, partner_order_id, idempotency_hash, submission
  ) VALUES (
    p_merchant_id, p_connection_id, p_quote_id, p_partner_order_id, p_idempotency_hash, p_submission
  )
  ON CONFLICT DO NOTHING
  RETURNING * INTO v_receipt;

  IF NOT FOUND THEN
    SELECT * INTO v_receipt FROM private.partner_order_submissions AS s
    WHERE s.merchant_id = p_merchant_id AND s.connection_id = p_connection_id
      AND s.quote_id = p_quote_id AND s.partner_order_id = p_partner_order_id
      AND s.idempotency_hash = p_idempotency_hash AND s.submission = p_submission;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'partner_order_conflict' USING ERRCODE = '23505';
    END IF;
  END IF;

  RETURN private.partner_order_receipt(v_receipt);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_partner_order(uuid, uuid, text, text, text, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_partner_order(uuid, uuid, text, text, text, jsonb, jsonb)
  TO anon, authenticated;

CREATE FUNCTION public.read_partner_order_submission(
  p_merchant_id uuid,
  p_request_id uuid,
  p_connection_id text,
  p_partner_order_id text,
  p_route_proof jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_response jsonb;
BEGIN
  IF p_connection_id IS NULL OR p_connection_id !~ '^[a-z0-9][a-z0-9_-]{0,79}$'
     OR p_partner_order_id IS NULL OR length(p_partner_order_id) NOT BETWEEN 1 AND 128
     OR pg_column_size(p_route_proof) > 4096
     OR private.verify_shipping_quote_route_proof(
       p_route_proof, 'read_partner_order_submission', p_request_id, p_merchant_id
     ) IS DISTINCT FROM true
     OR (p_route_proof->>'payload_text')::jsonb IS DISTINCT FROM jsonb_build_object(
       'connection_id', p_connection_id, 'partner_order_id', p_partner_order_id
     ) THEN
    RAISE EXCEPTION 'invalid_partner_order_lookup_proof' USING ERRCODE = '42501';
  END IF;

  SELECT private.partner_order_receipt(s)
  INTO v_response
  FROM private.partner_order_submissions AS s
  WHERE s.merchant_id = p_merchant_id AND s.connection_id = p_connection_id
    AND s.partner_order_id = p_partner_order_id;
  RETURN v_response;
END;
$$;

REVOKE ALL ON FUNCTION public.read_partner_order_submission(uuid, uuid, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_partner_order_submission(uuid, uuid, text, text, jsonb)
  TO anon, authenticated;
