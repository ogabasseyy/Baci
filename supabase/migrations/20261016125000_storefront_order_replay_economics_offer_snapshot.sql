-- Append-only: project the surviving offer identity in replay economics.
--
-- get_storefront_order_replay_economics projected oi.offer_id verbatim.
-- After the merchant deletes two same-product offers, ON DELETE SET NULL
-- clears both lines' live FK even though offer_id_snapshot preserves
-- their distinct purchased identities — so the TS fold queued both
-- lines as offerless, the unambiguous-consume gate refused to restore
-- either, and the retry returned an idempotency conflict instead of
-- replaying the completed order. Project COALESCE(live, snapshot):
-- live rows are unchanged, deleted-offer lines keep distinct identity.
-- Grants, key floor, and return shape unchanged. Reruns converge.
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
            'offer_id', COALESCE(oi.offer_id, oi.offer_id_snapshot),
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
  'Returns only the stored tax_amount, discount_amount, and per-line offer conditions plus assurance fees (with the fee-determining quantity and has_assurance for repeated-line matching) for a merchant-scoped checkout idempotency key of at least 16 bytes, for guest-safe idempotent replay past changed offers. The projected offer_id falls back to the immutable creation-time snapshot when the live row was deleted, so deleted-offer lines keep distinct identity. Shorter keys fail open to the recompute path instead of projecting. No other order fields are exposed.';

COMMIT;
