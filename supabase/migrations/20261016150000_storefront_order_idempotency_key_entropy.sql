-- Enforce minimum entropy on checkout idempotency keys.
--
-- Both storefront clients mint high-entropy keys, but the Idempotency-Key
-- header is attacker-controlled and every layer previously accepted any
-- non-empty value: a one-character key from a second shopper could replay
-- the first shopper's pending order (same merchant + key = replay path).
--
-- Backstop the route's 400 gate at the storage layer so direct RPC writers
-- (admin tools, future entrypoints) get the same floor. NOT VALID: keys
-- written before this migration are grandfathered rather than failing the
-- deploy on historical rows; every new write is checked.
ALTER TABLE public.orders
  ADD CONSTRAINT orders_checkout_idempotency_key_entropy_check
  CHECK (
    checkout_idempotency_key IS NULL
    OR octet_length(trim(checkout_idempotency_key)) BETWEEN 16 AND 128
  ) NOT VALID;

COMMENT ON CONSTRAINT orders_checkout_idempotency_key_entropy_check
  ON public.orders IS
  'New checkout idempotency keys must carry >=16 bytes of entropy (<=128 bytes); mirrors the /api/orders 400 gate.';

-- Align the guest-safe replay probe with the same floor: a degenerate key
-- must never report a replay hit.
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
      AND octet_length(trim(p_checkout_idempotency_key)) BETWEEN 16 AND 128
      AND o.merchant_id = p_merchant_id
      AND o.checkout_idempotency_key = trim(p_checkout_idempotency_key)
  );
$$;
