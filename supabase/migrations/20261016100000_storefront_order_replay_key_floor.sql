-- Append-only: require a minimum key length for the replay-economics
-- projection.
--
-- get_storefront_order_replay_economics is SECURITY DEFINER and granted
-- to anon/authenticated so guest checkout retries can restore stored
-- economics on the caller's normal client. Possession of the unguessable
-- idempotency key (native: 64-hex SHA-256 attempt key; web: UUID) is the
-- capability, but the projection accepted keys as short as one byte, so
-- any predictable or exposed short key projected the order's tax,
-- discount, product/offer ids, conditions, quantities, and assurance
-- choices to anonymous callers. Require at least 16 bytes: real clients
-- are far above the floor, while short keys fail open to the recompute
-- path (the pre-projection behavior) instead of projecting. Request-hash
-- binding is unworkable here (the hash covers the restored fields, so a
-- retry cannot match until after restoration) and tracking tokens are
-- null pre-payment; the length floor keeps the capability model while
-- closing trivially guessable keys. Grants and return shape unchanged.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_storefront_order_replay_economics(
  p_merchant_id uuid,
  p_checkout_idempotency_key text
)
RETURNS TABLE (tax_amount numeric, discount_amount numeric, items jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    o.tax_amount,
    o.discount_amount,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'product_id', oi.product_id,
            'offer_id', oi.offer_id,
            'condition', oi.condition,
            'assurance_fee', oi.assurance_fee,
            'quantity', oi.quantity,
            'has_assurance', oi.has_assurance
          )
          ORDER BY oi.line_id NULLS LAST, oi.id
        )
        FROM public.order_items AS oi
        WHERE oi.order_id = o.id
      ),
      '[]'::jsonb
    )
  FROM public.orders AS o
  WHERE p_merchant_id IS NOT NULL
    AND p_checkout_idempotency_key IS NOT NULL
    AND octet_length(trim(p_checkout_idempotency_key)) BETWEEN 16 AND 128
    AND o.merchant_id = p_merchant_id
    AND o.checkout_idempotency_key = trim(p_checkout_idempotency_key)
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_storefront_order_replay_economics(uuid, text) IS
  'Returns only the stored tax_amount, discount_amount, and per-line offer conditions plus assurance fees (with the fee-determining quantity and has_assurance for repeated-line matching) for a merchant-scoped checkout idempotency key of at least 16 bytes, for guest-safe idempotent replay past changed offers. Shorter keys fail open to the recompute path instead of projecting. No other order fields are exposed.';

COMMIT;
