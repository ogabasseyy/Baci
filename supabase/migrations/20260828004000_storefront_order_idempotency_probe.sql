-- A narrowly scoped replay probe for checkout validation.
--
-- Guest checkout cannot read `orders` through RLS, while the order-create
-- RPC must be allowed to replay a pending order before request validation
-- rejects a stale client fee. Expose only a boolean existence check through
-- the caller's normal (anon/authenticated) client; no order fields or
-- service-role credentials cross the API boundary.
CREATE OR REPLACE FUNCTION public.has_storefront_order_idempotency_key(
  p_merchant_id uuid,
  p_checkout_idempotency_key text
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
      AND octet_length(trim(p_checkout_idempotency_key)) BETWEEN 1 AND 128
      AND o.merchant_id = p_merchant_id
      AND o.checkout_idempotency_key = trim(p_checkout_idempotency_key)
  );
$$;

REVOKE ALL ON FUNCTION public.has_storefront_order_idempotency_key(uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_storefront_order_idempotency_key(uuid, text)
  TO anon, authenticated;

COMMENT ON FUNCTION public.has_storefront_order_idempotency_key(uuid, text) IS
  'Returns only whether a merchant-scoped checkout idempotency key already exists, for guest-safe stale-fee replay handling. No order fields are exposed.';
