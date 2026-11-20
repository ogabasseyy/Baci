-- This boundary is for trusted payment verifiers. A capture confirms only
-- the buyer charge. Merchant settlement and dispatch are separate decisions.
CREATE TABLE private.partner_payment_captures (
  submission_id uuid PRIMARY KEY REFERENCES private.partner_order_submissions (id),
  source text NOT NULL CHECK (source ~ '^[a-z][a-z0-9_-]{0,39}$'),
  provider_account text NOT NULL CHECK (length(provider_account) BETWEEN 1 AND 200),
  payment_reference text NOT NULL CHECK (length(payment_reference) BETWEEN 1 AND 200),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  captured_at timestamptz NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (source, provider_account, payment_reference)
);

ALTER TABLE private.partner_payment_captures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.partner_payment_captures FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.record_verified_partner_capture(
  p_submission_id uuid,
  p_merchant_id uuid,
  p_connection_id text,
  p_quote_id uuid,
  p_partner_order_id text,
  p_source text,
  p_provider_account text,
  p_payment_reference text,
  p_amount_minor bigint,
  p_currency text,
  p_captured_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_submission private.partner_order_submissions%ROWTYPE;
  v_quote private.partner_delivery_quotes%ROWTYPE;
  v_payment jsonb;
BEGIN
  SELECT * INTO v_submission
  FROM private.partner_order_submissions AS s
  WHERE s.id = p_submission_id AND s.merchant_id = p_merchant_id
    AND s.connection_id = p_connection_id AND s.quote_id = p_quote_id
    AND s.partner_order_id = p_partner_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'partner_submission_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO STRICT v_quote
  FROM private.partner_delivery_quotes AS q
  WHERE q.id = p_quote_id AND q.merchant_id = p_merchant_id
    AND q.connection_id = p_connection_id;

  v_payment := v_submission.submission->'payment';
  IF p_source IS NULL OR p_source !~ '^[a-z][a-z0-9_-]{0,39}$'
     OR p_provider_account IS NULL OR NOT length(p_provider_account) BETWEEN 1 AND 200
     OR p_provider_account IS DISTINCT FROM btrim(p_provider_account)
     OR p_payment_reference IS NULL OR NOT length(p_payment_reference) BETWEEN 1 AND 200
     OR p_amount_minor IS NULL OR p_amount_minor <= 0
     OR p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$'
     OR p_captured_at IS NULL
     OR p_captured_at < v_quote.created_at OR p_captured_at >= v_quote.expires_at
     OR p_captured_at > v_submission.received_at
     OR v_payment->>'source' IS DISTINCT FROM p_source
     OR v_payment->>'reference' IS DISTINCT FROM p_payment_reference
     OR v_payment->'amount_minor' IS DISTINCT FROM to_jsonb(p_amount_minor)
     OR v_payment->>'currency' IS DISTINCT FROM p_currency THEN
    RAISE EXCEPTION 'partner_payment_evidence_mismatch' USING ERRCODE = '22023';
  END IF;

  INSERT INTO private.partner_payment_captures (
    submission_id, source, provider_account, payment_reference, amount_minor, currency, captured_at
  ) VALUES (
    p_submission_id, p_source, p_provider_account, p_payment_reference,
    p_amount_minor, p_currency, p_captured_at
  )
  ON CONFLICT DO NOTHING;

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM private.partner_payment_captures AS c
    WHERE c.submission_id = p_submission_id AND c.source = p_source
      AND c.provider_account = p_provider_account AND c.payment_reference = p_payment_reference
      AND c.amount_minor = p_amount_minor AND c.currency = p_currency
      AND c.captured_at = p_captured_at
  ) THEN
    RAISE EXCEPTION 'partner_payment_evidence_conflict' USING ERRCODE = '23505';
  END IF;

  RETURN private.partner_order_receipt(v_submission);
END;
$$;

-- No partner or general service-role RPC can assert verification. This is a
-- building block for a verifier that has independent provider evidence.
REVOKE ALL ON FUNCTION private.record_verified_partner_capture(
  uuid, uuid, text, uuid, text, text, text, text, bigint, text, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.partner_order_receipt(s private.partner_order_submissions)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'submission_id', s.id,
    'partner_order_id', s.partner_order_id,
    'received_at', s.received_at,
    'status', CASE WHEN EXISTS (
      SELECT 1
      FROM private.partner_payment_captures AS c
      WHERE c.submission_id = s.id
    ) THEN 'payment_verified' ELSE 'pending_verification' END
  );
$$;
