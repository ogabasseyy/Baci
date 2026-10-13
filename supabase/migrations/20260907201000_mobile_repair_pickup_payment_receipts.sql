-- Durable, server-only replay of mobile payment starts. Unknown attempts are
-- never reclaimed by time: the provider may already have accepted the write.
CREATE TABLE IF NOT EXISTS public.mobile_repair_pickup_payment_receipts (
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  owner_token uuid NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (merchant_id, request_id)
);
ALTER TABLE public.mobile_repair_pickup_payment_receipts ENABLE ROW LEVEL SECURITY;
-- No direct callers receive table privileges or an RLS policy. Only the
-- narrow SECURITY DEFINER capability below may access stored payment URLs.
REVOKE ALL ON public.mobile_repair_pickup_payment_receipts
  FROM PUBLIC, anon, authenticated, service_role, repair_pickup_receiver;

CREATE OR REPLACE FUNCTION public.mobile_repair_pickup_payment_receipt(
  p_merchant_id uuid, p_request_id uuid, p_request_hash text,
  p_owner uuid, p_result jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_receipt public.mobile_repair_pickup_payment_receipts%ROWTYPE;
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
    receipt.owner_token, receipt.result, receipt.created_at
  INTO v_receipt FROM public.mobile_repair_pickup_payment_receipts AS receipt
    WHERE receipt.merchant_id = p_merchant_id AND receipt.request_id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_receipt.request_hash <> p_request_hash THEN
    RAISE EXCEPTION 'mobile_repair_pickup_request_mismatch' USING ERRCODE = '22023';
  END IF;
  IF p_result IS NOT NULL AND v_receipt.result IS NULL THEN
    IF v_receipt.owner_token <> p_owner OR jsonb_typeof(p_result) <> 'object'
      OR jsonb_typeof(p_result -> 'success') IS DISTINCT FROM 'boolean'
    THEN RAISE EXCEPTION 'invalid_mobile_repair_pickup_completion' USING ERRCODE = '42501'; END IF;
    UPDATE public.mobile_repair_pickup_payment_receipts AS receipt SET result = p_result
      WHERE receipt.merchant_id = p_merchant_id AND receipt.request_id = p_request_id;
    v_receipt.result := p_result;
  END IF;
  IF v_receipt.result IS NULL THEN RETURN jsonb_build_object('state', 'pending'); END IF;
  RETURN jsonb_build_object('state', 'complete', 'result', v_receipt.result);
END;
$$;
REVOKE ALL ON FUNCTION public.mobile_repair_pickup_payment_receipt(uuid, uuid, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role, repair_pickup_receiver;
GRANT EXECUTE ON FUNCTION public.mobile_repair_pickup_payment_receipt(uuid, uuid, text, uuid, jsonb)
  TO repair_pickup_receiver;
NOTIFY pgrst, 'reload schema';
