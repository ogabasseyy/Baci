BEGIN;

-- Inventory-confirmed proof for the storefront order status poll.
-- The Credit Direct launcher polls GET /api/storefront/orders/[id] and
-- treats bnpl_approved/paid as confirmed, but the webhook writes the
-- approved status BEFORE inventory confirmation lands (the confirm RPC
-- only confers a confirmed hold on paid/bnpl_approved rows, so the
-- write cannot move after confirmation). A slow confirmation lets two
-- consecutive reads observe approval that later rolls back. This
-- narrow RPC exposes only the EXISTS-style confirmed bit for orders
-- the caller may see (creation tracking token, order email,
-- auth.uid() customer ownership, or merchant view — the same
-- authorization the tracking and delivered lookups use). Denials
-- read as not confirmed (unknown
-- order, failing authorization, or unconfirmed inventory are
-- indistinguishable). The serialized_strict proof mirrors the guest
-- payment snapshot: every tracked unit must be sold or
-- expiry-cleared reserved, with nothing else outstanding.
CREATE OR REPLACE FUNCTION public.get_order_inventory_proof(
  p_order_id uuid,
  p_tracking_token text DEFAULT NULL,
  p_email text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT COALESCE(
    (
      SELECT NOT EXISTS (
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
      FROM public.orders AS o
      LEFT JOIN public.customers AS c ON c.id = o.customer_id
      WHERE o.id = p_order_id
        AND (
          (
            p_tracking_token IS NOT NULL
            AND trim(p_tracking_token) <> ''
            AND o.tracking_token = p_tracking_token
          )
          OR (
            p_email IS NOT NULL
            AND trim(p_email) <> ''
            AND lower(o.customer_email) = lower(trim(p_email))
          )
          OR c.user_id = auth.uid()
          OR public.has_merchant_access(o.merchant_id)
        )
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.get_order_inventory_proof(uuid, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_inventory_proof(uuid, text, text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_order_inventory_proof(uuid, text, text) IS
  'Inventory-confirmed bit for orders the caller may see via tracking token, order email, customer ownership, or merchant view. Used by GET /api/storefront/orders/[id] so status polls gate confirmation on server-confirmed inventory instead of the approved status alone.';

NOTIFY pgrst, 'reload schema';

COMMIT;
