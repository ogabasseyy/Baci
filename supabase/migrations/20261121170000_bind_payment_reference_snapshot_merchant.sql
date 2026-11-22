-- Bind payment, order and customer to the same merchant in the buyer-owned
-- snapshot. Keep the existing execute grants and inventory proof.
CREATE OR REPLACE FUNCTION public.get_sessionless_payment_reference_snapshot(
  p_gateway_reference text
)
RETURNS TABLE (
  transaction_id uuid,
  order_id uuid,
  merchant_id uuid,
  amount numeric,
  currency text,
  transaction_status text,
  gateway text,
  gateway_reference text,
  order_number text,
  order_payment_status text,
  order_shipping_status text,
  order_total numeric,
  inventory_confirmed boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT t.id,
         t.order_id,
         t.merchant_id,
         t.amount,
         t.currency,
         t.status,
         t.gateway,
         t.gateway_reference,
         o.order_number,
         o.payment_status,
         o.shipping_status,
         o.total,
         NOT EXISTS (
           SELECT 1
             FROM public.order_items AS oi
             JOIN public.products AS p
               ON p.id = oi.product_id
              AND p.merchant_id = o.merchant_id
             LEFT JOIN public.product_variants AS vv
               ON vv.id = CASE
                    WHEN (p.has_variants IS DISTINCT FROM TRUE
                          AND COALESCE(p.variant_model, 'legacy') <> 'sku_matrix')
                    THEN p.inventory_anchor_variant_id
                    ELSE oi.variant_id
                  END
            WHERE oi.order_id = o.id
              AND COALESCE(
                    NULLIF(vv.inventory_tracking_policy, 'inherit'),
                    p.inventory_tracking_policy,
                    'off'
                  ) = 'serialized_strict'
              AND (
                (SELECT count(*)::integer
                   FROM public.variant_inventory AS vi
                  WHERE vi.order_item_id = oi.id
                    AND (vi.status = 'sold'
                         OR (vi.status = 'reserved'
                             AND vi.reservation_expires_at IS NULL))
                ) < oi.quantity
                OR EXISTS (
                  SELECT 1
                    FROM public.variant_inventory AS vi
                   WHERE vi.order_item_id = oi.id
                     AND NOT (vi.status = 'sold'
                              OR (vi.status = 'reserved'
                                  AND vi.reservation_expires_at IS NULL))
                )
              )
         )
    FROM public.transactions AS t
    JOIN public.orders AS o ON o.id = t.order_id AND o.merchant_id = t.merchant_id
    JOIN public.customers AS c ON c.id = o.customer_id AND c.merchant_id = o.merchant_id
   WHERE t.gateway_reference = p_gateway_reference
     AND c.user_id = auth.uid();
$$;
