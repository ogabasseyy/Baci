-- Separate clock discrepancies from other evidence failures without moving the payment window.
CREATE OR REPLACE FUNCTION private.record_verified_partner_capture(
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
     OR v_payment->>'source' IS DISTINCT FROM p_source
     OR v_payment->>'reference' IS DISTINCT FROM p_payment_reference
     OR v_payment->'amount_minor' IS DISTINCT FROM to_jsonb(p_amount_minor)
     OR v_payment->>'currency' IS DISTINCT FROM p_currency THEN
    RAISE EXCEPTION 'partner_payment_evidence_mismatch' USING ERRCODE = '22023';
  END IF;

  IF p_captured_at > v_submission.received_at THEN
    RAISE EXCEPTION 'partner_capture_timestamp_after_receipt' USING ERRCODE = '22023';
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

CREATE OR REPLACE FUNCTION private.record_verified_partner_settlement(
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
     OR p_settled_at IS NULL OR p_settled_at < v_captured_at THEN
    RAISE EXCEPTION 'partner_settlement_evidence_mismatch' USING ERRCODE = '22023';
  END IF;

  IF p_settled_at > clock_timestamp() THEN
    RAISE LOG 'partner_settlement_timestamp_in_future';
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
