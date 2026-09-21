-- Probe whether a merchant-scoped checkout key already stored a specific
-- request hash so retries can keep localeCompare item ordering after the
-- Unicode scalar sort rollout. Returns only a boolean.

CREATE OR REPLACE FUNCTION public.is_storefront_order_idempotency_hash(
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
    SELECT 1
    FROM public.orders AS o
    WHERE p_merchant_id IS NOT NULL
      AND p_checkout_idempotency_key IS NOT NULL
      AND p_checkout_request_hash IS NOT NULL
      AND octet_length(trim(p_checkout_idempotency_key)) BETWEEN 1 AND 128
      AND octet_length(trim(p_checkout_request_hash)) = 64
      AND o.merchant_id = p_merchant_id
      AND o.checkout_idempotency_key = trim(p_checkout_idempotency_key)
      AND o.checkout_request_hash = trim(p_checkout_request_hash)
  );
$$;

REVOKE ALL ON FUNCTION public.is_storefront_order_idempotency_hash(uuid, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_storefront_order_idempotency_hash(uuid, text, text)
  TO anon, authenticated;

COMMENT ON FUNCTION public.is_storefront_order_idempotency_hash(uuid, text, text) IS
  'Returns only whether a merchant-scoped checkout key already stored the supplied request hash; no order fields are exposed.';
