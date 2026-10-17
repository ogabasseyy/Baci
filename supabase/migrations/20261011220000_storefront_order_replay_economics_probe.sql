-- Narrowly scoped replay-economics projection for checkout validation.
--
-- Companion to has_storefront_order_idempotency_key: on a confirmed
-- idempotent retry past a changed offer, the orders route must reuse the
-- stored order's tax_amount AND per-line conditions. Recomputing VAT from
-- parent prices would drift tax_amount, and the first attempt rewrites
-- canonical-alias line conditions (e.g. open_box) to the live offer
-- spelling (e.g. refurbished) before hashing; either drift changes the
-- request hash and turns the retry into an idempotency conflict instead
-- of replaying it.
--
-- Returns only the stored tax plus [{product_id, offer_id, condition}]
-- (or zero rows when no keyed order exists) through the caller's normal
-- (anon/authenticated) client, so the user-facing route never needs a
-- service-role orders read. No other order fields cross the API boundary.
DROP FUNCTION IF EXISTS public.get_storefront_order_replay_tax(uuid, text);

CREATE OR REPLACE FUNCTION public.get_storefront_order_replay_economics(
  p_merchant_id uuid,
  p_checkout_idempotency_key text
)
RETURNS TABLE (tax_amount numeric, items jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    o.tax_amount,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'product_id', oi.product_id,
            'offer_id', oi.offer_id,
            'condition', oi.condition
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
  'Returns only the stored tax_amount and per-line offer conditions for a merchant-scoped checkout idempotency key, for guest-safe idempotent replay past changed offers. No other order fields are exposed.';
