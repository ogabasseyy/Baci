-- An idempotency hash deliberately omits payment method, so a generic hash
-- match is not sufficient to authorize a disabled POD checkout replay.
CREATE FUNCTION public.is_storefront_pod_order_idempotency_hash(
  p_merchant_id uuid,
  p_checkout_idempotency_key text,
  p_checkout_request_hash text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.orders AS o
    WHERE p_merchant_id IS NOT NULL
      AND p_checkout_idempotency_key IS NOT NULL
      AND p_checkout_request_hash IS NOT NULL
      AND octet_length(trim(p_checkout_idempotency_key)) BETWEEN 1 AND 128
      AND octet_length(trim(p_checkout_request_hash)) = 64
      AND o.merchant_id = p_merchant_id
      AND o.checkout_idempotency_key = trim(p_checkout_idempotency_key)
      AND o.checkout_request_hash = trim(p_checkout_request_hash)
      AND lower(btrim(coalesce(o.payment_method, ''))) IN ('pod', 'pay_on_delivery')
  );
$$;
REVOKE ALL ON FUNCTION public.is_storefront_pod_order_idempotency_hash(uuid, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_storefront_pod_order_idempotency_hash(uuid, text, text)
  TO anon, authenticated;
