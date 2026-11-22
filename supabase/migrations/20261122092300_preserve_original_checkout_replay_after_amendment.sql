-- Replay must match the original checkout request even after live lines
-- are replaced. Keep the guest key requirements and public projection.
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
        FROM (
          SELECT l.product_id, l.offer_id, l.offer_id_snapshot, l.condition,
            l.assurance_fee, l.quantity, l.has_assurance, l.line_id, l.id
          FROM public.order_items AS l
          WHERE l.order_id = o.id AND original.lines IS NULL
          UNION ALL
          SELECT l.product_id, l.offer_id, l.offer_id_snapshot, l.condition,
            l.assurance_fee, l.quantity, l.has_assurance, l.line_id, l.id
          FROM jsonb_to_recordset(original.lines) AS l(
            product_id uuid, offer_id uuid, offer_id_snapshot uuid, condition text,
            assurance_fee numeric, quantity integer, has_assurance boolean, line_id integer, id uuid
          )
        ) AS oi
      ),
      '[]'::jsonb
    )
  FROM public.orders AS o
  LEFT JOIN LATERAL (
    SELECT r.original_document_inputs->'items' AS lines
    FROM private.paid_order_amendments AS a
    JOIN private.paid_order_amendment_revisions AS r
      ON r.amendment_id = a.id AND r.revision = 1
    WHERE a.order_id = o.id AND a.merchant_id = o.merchant_id
  ) AS original ON true
  WHERE p_merchant_id IS NOT NULL
    AND p_checkout_idempotency_key IS NOT NULL
    AND octet_length(trim(p_checkout_idempotency_key)) BETWEEN 16 AND 128
    AND o.merchant_id = p_merchant_id
    AND o.checkout_idempotency_key = trim(p_checkout_idempotency_key)
  LIMIT 1;
$$;
