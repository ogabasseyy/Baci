-- Append-only: extend the replay-economics projection with the stored
-- discount and per-line assurance fees.
--
-- The F1 replay bypass skips the negotiation-discount recompute and the
-- offer-price map comes back empty, so a retry hashes a zero discount and
-- client-derived assurance fees while the first attempt hashed the
-- server-derived discount and canonicalized fees — every such retry
-- returns checkout_idempotency_conflict instead of replaying. Return the
-- stored discount_amount plus per-line assurance_fee alongside the tax
-- and conditions so the route restores the exact hashed economics.
-- Same narrow grants as the probe this replaces (anon/authenticated);
-- no other order fields cross the API boundary.
DROP FUNCTION IF EXISTS public.get_storefront_order_replay_economics(uuid, text);

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
            'assurance_fee', oi.assurance_fee
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
    AND octet_length(trim(p_checkout_idempotency_key)) BETWEEN 1 AND 128
    AND o.merchant_id = p_merchant_id
    AND o.checkout_idempotency_key = trim(p_checkout_idempotency_key)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_storefront_order_replay_economics(uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_storefront_order_replay_economics(uuid, text)
  TO anon, authenticated;

COMMENT ON FUNCTION public.get_storefront_order_replay_economics(uuid, text) IS
  'Returns only the stored tax_amount, discount_amount, and per-line offer conditions plus assurance fees for a merchant-scoped checkout idempotency key, for guest-safe idempotent replay past changed offers. No other order fields are exposed.';
