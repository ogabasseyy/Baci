-- Restrict the POD replay bit to the existing server-minted storefront-order
-- context; ordinary authenticated and direct anonymous callers cannot probe it.
CREATE OR REPLACE FUNCTION public.is_storefront_pod_order_idempotency_hash(
  p_merchant_id uuid,
  p_checkout_idempotency_key text,
  p_checkout_request_hash text
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.orders AS o
    WHERE p_merchant_id IS NOT NULL
      AND p_checkout_idempotency_key IS NOT NULL
      AND p_checkout_request_hash IS NOT NULL
      AND coalesce(auth.jwt() ->> 'storefront_order_context', '') = 'route'
      AND coalesce(auth.jwt() ->> 'storefront_order_merchant_id', '') = p_merchant_id::text
      AND octet_length(trim(p_checkout_idempotency_key)) BETWEEN 16 AND 128
      AND octet_length(trim(p_checkout_request_hash)) = 64
      AND o.merchant_id = p_merchant_id
      AND o.checkout_idempotency_key = trim(p_checkout_idempotency_key)
      AND o.checkout_request_hash = trim(p_checkout_request_hash)
      AND private.is_pay_on_delivery_method(o.payment_method)
  );
$$;
REVOKE ALL ON FUNCTION public.is_storefront_pod_order_idempotency_hash(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_storefront_pod_order_idempotency_hash(uuid, text, text)
  TO authenticated;
