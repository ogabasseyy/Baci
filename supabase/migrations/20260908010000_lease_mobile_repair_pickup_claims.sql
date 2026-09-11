-- Historical pending receipts may already have reached the provider.
ALTER TABLE public.mobile_repair_pickup_payment_receipts
  ADD COLUMN execution_started_at timestamptz,
  ADD COLUMN claim_expires_at timestamptz NOT NULL DEFAULT (now() + interval '2 minutes');
UPDATE public.mobile_repair_pickup_payment_receipts SET execution_started_at = created_at;

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
    AND v_receipt.execution_started_at IS NULL AND v_receipt.claim_expires_at <= clock_timestamp() THEN
    UPDATE public.mobile_repair_pickup_payment_receipts AS receipt
    SET owner_token = p_owner, claim_expires_at = clock_timestamp() + interval '2 minutes'
    WHERE receipt.merchant_id = p_merchant_id AND receipt.request_id = p_request_id;
    RETURN jsonb_build_object('state', 'claimed');
  END IF;
  IF p_result IS NOT NULL AND (v_receipt.result IS NULL
    OR v_receipt.result ->> 'code' = 'payment_initialization_unknown') THEN
    IF v_receipt.owner_token <> p_owner OR v_receipt.execution_started_at IS NULL
      OR jsonb_typeof(p_result) <> 'object'
      OR jsonb_typeof(p_result -> 'success') IS DISTINCT FROM 'boolean'
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

CREATE OR REPLACE FUNCTION public.begin_mobile_repair_pickup_payment(
  p_merchant_id uuid, p_request_id uuid, p_request_hash text, p_owner uuid
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF COALESCE(auth.jwt() ->> 'repair_pickup_receiver_context', '') <> 'server-payment-start'
    OR COALESCE(auth.jwt() ->> 'repair_pickup_receiver_merchant_id', '') IS DISTINCT FROM p_merchant_id::text
    OR p_merchant_id IS NULL OR p_request_id IS NULL OR p_owner IS NULL
  THEN RAISE EXCEPTION 'forbidden_mobile_repair_pickup_receipt' USING ERRCODE = '42501'; END IF;
  UPDATE public.mobile_repair_pickup_payment_receipts AS receipt
  SET execution_started_at = clock_timestamp()
  WHERE receipt.merchant_id = p_merchant_id AND receipt.request_id = p_request_id
    AND receipt.request_hash = p_request_hash AND receipt.owner_token = p_owner
    AND receipt.result IS NULL AND receipt.execution_started_at IS NULL
    AND receipt.claim_expires_at > clock_timestamp();
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.begin_mobile_repair_pickup_payment(uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role, repair_pickup_receiver;
GRANT EXECUTE ON FUNCTION public.begin_mobile_repair_pickup_payment(uuid, uuid, text, uuid)
  TO repair_pickup_receiver;
REVOKE ALL ON FUNCTION public.mobile_repair_pickup_payment_receipt_v2(uuid, uuid, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role, repair_pickup_receiver;
GRANT EXECUTE ON FUNCTION public.mobile_repair_pickup_payment_receipt_v2(uuid, uuid, text, uuid, jsonb)
  TO repair_pickup_receiver;

-- Legacy deployments do not call begin: fence their claims atomically here.
CREATE OR REPLACE FUNCTION public.mobile_repair_pickup_payment_receipt(
  p_merchant_id uuid, p_request_id uuid, p_request_hash text,
  p_owner uuid, p_result jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  v_result := public.mobile_repair_pickup_payment_receipt_v2(
    p_merchant_id,p_request_id,p_request_hash,p_owner,p_result);
  IF v_result ->> 'state' = 'claimed' THEN
    IF NOT public.begin_mobile_repair_pickup_payment(p_merchant_id,p_request_id,p_request_hash,p_owner) THEN
      RAISE EXCEPTION 'mobile_repair_pickup_claim_changed';
    END IF;
  END IF;
  RETURN v_result;
END;
$$;
NOTIFY pgrst, 'reload schema';
