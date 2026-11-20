-- A payout may cover multiple orders. Evidence must identify an independently
-- verified allocation within that payout, and only one submission may consume it.
CREATE TABLE private.partner_order_settlements (
  submission_id uuid PRIMARY KEY REFERENCES private.partner_payment_captures (submission_id),
  source text NOT NULL CHECK (source ~ '^[a-z][a-z0-9_-]{0,39}$'),
  settlement_account text NOT NULL CHECK (length(settlement_account) BETWEEN 1 AND 200),
  payout_reference text NOT NULL CHECK (length(payout_reference) BETWEEN 1 AND 200),
  allocation_reference text NOT NULL CHECK (length(allocation_reference) BETWEEN 1 AND 200),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency = 'NGN'),
  settled_at timestamptz NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (source, settlement_account, payout_reference, allocation_reference)
);

ALTER TABLE private.partner_order_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.partner_order_settlements FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.record_verified_partner_settlement(
  p_submission_id uuid,
  p_merchant_id uuid,
  p_connection_id text,
  p_source text,
  p_settlement_account text,
  p_payout_reference text,
  p_allocation_reference text,
  p_amount_minor bigint,
  p_currency text,
  p_settled_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_submission private.partner_order_submissions%ROWTYPE;
  v_quote jsonb;
  v_captured_at timestamptz;
BEGIN
  SELECT s.* INTO v_submission
  FROM private.partner_order_submissions AS s
  WHERE s.id = p_submission_id AND s.merchant_id = p_merchant_id
    AND s.connection_id = p_connection_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'partner_submission_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT c.captured_at INTO v_captured_at
  FROM private.partner_payment_captures AS c
  WHERE c.submission_id = p_submission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'partner_capture_not_verified' USING ERRCODE = '22023';
  END IF;

  SELECT q.snapshot INTO STRICT v_quote
  FROM private.partner_delivery_quotes AS q
  WHERE q.id = v_submission.quote_id AND q.merchant_id = p_merchant_id
    AND q.connection_id = p_connection_id;

  IF v_quote->>'settlement_basis' IS DISTINCT FROM 'base_plus_delivery'
     OR jsonb_typeof(v_quote->'merchant_payable_minor') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'partner_settlement_terms_unavailable' USING ERRCODE = '22023';
  END IF;

  IF p_source IS NULL OR p_source !~ '^[a-z][a-z0-9_-]{0,39}$'
     OR p_settlement_account IS NULL OR NOT length(btrim(p_settlement_account)) BETWEEN 1 AND 200
     OR p_payout_reference IS NULL OR NOT length(btrim(p_payout_reference)) BETWEEN 1 AND 200
     OR p_allocation_reference IS NULL OR NOT length(btrim(p_allocation_reference)) BETWEEN 1 AND 200
     OR p_currency IS DISTINCT FROM 'NGN' OR p_currency IS DISTINCT FROM v_quote->>'currency'
     OR p_amount_minor IS NULL OR p_amount_minor <= 0
     OR v_quote->'merchant_payable_minor' IS DISTINCT FROM to_jsonb(p_amount_minor)
     OR p_settled_at IS NULL OR p_settled_at < v_captured_at
     OR p_settled_at > clock_timestamp() THEN
    RAISE EXCEPTION 'partner_settlement_evidence_mismatch' USING ERRCODE = '22023';
  END IF;

  INSERT INTO private.partner_order_settlements (
    submission_id, source, settlement_account, payout_reference, allocation_reference,
    amount_minor, currency, settled_at
  ) VALUES (
    p_submission_id, p_source, btrim(p_settlement_account), btrim(p_payout_reference),
    btrim(p_allocation_reference), p_amount_minor, p_currency, p_settled_at
  )
  ON CONFLICT DO NOTHING;

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM private.partner_order_settlements AS e
    WHERE e.submission_id = p_submission_id AND e.source = p_source
      AND e.settlement_account = btrim(p_settlement_account)
      AND e.payout_reference = btrim(p_payout_reference)
      AND e.allocation_reference = btrim(p_allocation_reference)
      AND e.amount_minor = p_amount_minor AND e.currency = p_currency
      AND e.settled_at = p_settled_at
  ) THEN
    RAISE EXCEPTION 'partner_settlement_evidence_conflict' USING ERRCODE = '23505';
  END IF;

  RETURN private.partner_order_receipt(v_submission);
END;
$$;

REVOKE ALL ON FUNCTION private.record_verified_partner_settlement(
  uuid, uuid, text, text, text, text, text, bigint, text, timestamptz
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
    'status', CASE
      WHEN EXISTS (
        SELECT 1 FROM private.partner_order_settlements AS e
        WHERE e.submission_id = s.id
      ) THEN 'settlement_verified'
      WHEN EXISTS (
        SELECT 1 FROM private.partner_payment_captures AS c
        WHERE c.submission_id = s.id
      ) THEN 'payment_verified'
      ELSE 'pending_verification'
    END
  );
$$;
