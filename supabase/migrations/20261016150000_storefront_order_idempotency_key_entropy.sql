-- Enforce minimum entropy on checkout idempotency keys.
--
-- Both storefront clients mint high-entropy keys, but the Idempotency-Key
-- header is attacker-controlled and every layer previously accepted any
-- non-empty value: a one-character key from a second shopper could replay
-- the first shopper's pending order (same merchant + key = replay path).
--
-- Backstop the route's 400 gate at the storage layer so direct RPC writers
-- (admin tools, future entrypoints) get the same floor. INSERT-only
-- trigger (not a CHECK constraint): historical rows written with short
-- keys must remain updatable by fulfillment/payment follow-up writes, so
-- only newly created rows are gated. A NOT VALID CHECK would still reject
-- updates to legacy rows.
CREATE OR REPLACE FUNCTION public.reject_weak_storefront_order_idempotency_key()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.checkout_idempotency_key IS NOT NULL
    AND octet_length(trim(NEW.checkout_idempotency_key)) NOT BETWEEN 16 AND 128
  THEN
    RAISE EXCEPTION 'checkout_idempotency_key_invalid';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_storefront_order_idempotency_key_entropy
  ON public.orders;
CREATE TRIGGER trg_storefront_order_idempotency_key_entropy
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_weak_storefront_order_idempotency_key();

COMMENT ON FUNCTION public.reject_weak_storefront_order_idempotency_key() IS
  'New checkout idempotency keys must carry >=16 bytes of entropy (<=128 bytes); mirrors the /api/orders 400 gate. INSERT-only so legacy keys stay updatable.';

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
