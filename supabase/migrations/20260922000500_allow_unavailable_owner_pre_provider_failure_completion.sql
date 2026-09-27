-- Let the current owner persist definitive pre-provider failures and reclaim
-- fenced-but-resultless expired receipts. Unknown and success completions still
-- require fencing (a provider charge may exist); only failure codes that prove
-- no charge can exist may complete unfenced, and only by the claim owner.
-- 'unavailable' covers a device or quote deactivated after the initial
-- catalogue check: createRepairBooking maps quote_unavailable,
-- device_unavailable, and catalog_disabled to that definitive pre-provider
-- code before provider initialization is fenced, so without this entry the
-- completion RPC rejects it, the route returns 503, and the durable request
-- repeats the same failure instead of completing.

CREATE OR REPLACE FUNCTION public.mobile_repair_pickup_payment_receipt_v2(
  p_merchant_id uuid, p_request_id uuid, p_request_hash text,
  p_owner uuid, p_result jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_receipt public.mobile_repair_pickup_payment_receipts%ROWTYPE;
BEGIN
  IF COALESCE(auth.jwt() ->> 'repair_pickup_receiver_context', '') <> 'server-payment-start'
    OR COALESCE(auth.jwt() ->> 'repair_pickup_receiver_merchant_id', '') IS DISTINCT FROM p_merchant_id::text
    OR p_merchant_id IS NULL OR p_request_id IS NULL OR p_owner IS NULL
    OR p_request_hash IS NULL OR p_request_hash !~ '^[a-f0-9]{64}$'
  THEN RAISE EXCEPTION 'forbidden_mobile_repair_pickup_receipt' USING ERRCODE = '42501'; END IF;
  IF p_result IS NULL THEN
    INSERT INTO public.mobile_repair_pickup_payment_receipts
      (merchant_id, request_id, request_hash, owner_token)
    VALUES (p_merchant_id, p_request_id, p_request_hash, p_owner)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN RETURN jsonb_build_object('state', 'claimed'); END IF;
  END IF;
  SELECT receipt.merchant_id, receipt.request_id, receipt.request_hash,
    receipt.owner_token, receipt.result, receipt.created_at,
    receipt.execution_started_at, receipt.claim_expires_at
  INTO v_receipt FROM public.mobile_repair_pickup_payment_receipts AS receipt
  WHERE receipt.merchant_id = p_merchant_id AND receipt.request_id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_receipt.request_hash <> p_request_hash THEN
    RAISE EXCEPTION 'mobile_repair_pickup_request_mismatch' USING ERRCODE = '22023';
  END IF;
  IF p_result IS NULL AND v_receipt.result IS NULL
    AND v_receipt.claim_expires_at <= clock_timestamp() THEN
    UPDATE public.mobile_repair_pickup_payment_receipts AS receipt
    -- A fenced but resultless expired claim never completed, so no live worker
    -- owns it: clear the fence and let the new owner retry. Paystack references
    -- stay idempotent, so a charge that did land cannot double.
    SET owner_token = p_owner, execution_started_at = NULL,
      claim_expires_at = clock_timestamp() + interval '2 minutes'
    WHERE receipt.merchant_id = p_merchant_id AND receipt.request_id = p_request_id;
    RETURN jsonb_build_object('state', 'claimed');
  END IF;
  IF p_result IS NOT NULL AND (v_receipt.result IS NULL
    OR v_receipt.result ->> 'code' = 'payment_initialization_unknown') THEN
    -- Unfenced completions are allowed only for owner-matched definitive
    -- pre-provider failures (no charge can exist for these codes); unknown,
    -- success, and uncoded completions still require fencing.
    IF v_receipt.owner_token <> p_owner
      OR jsonb_typeof(p_result) <> 'object'
      OR jsonb_typeof(p_result -> 'success') IS DISTINCT FROM 'boolean'
      OR (
        v_receipt.execution_started_at IS NULL
        AND (
          (p_result ->> 'success') IS DISTINCT FROM 'false'
          OR (p_result ->> 'code') IS NULL
          OR NOT (
            (p_result ->> 'code') = ANY (
              ARRAY[
                'rate_limited', 'validation_failed',
                'payment_initialization_failed', 'not_found',
                'pickup_unavailable', 'quote_changed',
                'resume_invalid', 'lookup_failed',
                'unavailable'
              ]
            )
          )
        )
      )
    THEN RAISE EXCEPTION 'invalid_mobile_repair_pickup_completion' USING ERRCODE = '42501'; END IF;
    UPDATE public.mobile_repair_pickup_payment_receipts AS receipt SET result = p_result
    WHERE receipt.merchant_id = p_merchant_id AND receipt.request_id = p_request_id;
    v_receipt.result := p_result;
  END IF;
  IF v_receipt.result IS NULL THEN RETURN jsonb_build_object('state', 'pending'); END IF;
  IF v_receipt.result ->> 'code' = 'payment_initialization_unknown' THEN
    RETURN jsonb_build_object('state', 'unknown', 'result', v_receipt.result);
  END IF;
  RETURN jsonb_build_object('state', 'complete', 'result', v_receipt.result);
END;
$$;

