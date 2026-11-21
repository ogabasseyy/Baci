CREATE OR REPLACE FUNCTION public.submit_partner_order(
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
  v_quote_total_minor jsonb;
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

  SELECT q.snapshot->'total_minor' INTO v_quote_total_minor
  FROM private.partner_delivery_quotes AS q
  WHERE q.id = p_quote_id AND q.merchant_id = p_merchant_id
    AND q.connection_id = p_connection_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'partner_quote_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- A typo must not consume the quote's single submission slot. Compare
  -- JSON numbers exactly while the quote remains locked against cleanup.
  IF jsonb_typeof(v_quote_total_minor) IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'partner_quote_amount_unavailable' USING ERRCODE = '22023';
  END IF;
  IF p_submission #> '{payment,amount_minor}' IS DISTINCT FROM v_quote_total_minor THEN
    RAISE EXCEPTION 'partner_order_payment_amount_mismatch' USING ERRCODE = '22023';
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
