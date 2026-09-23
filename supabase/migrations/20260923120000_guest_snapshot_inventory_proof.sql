-- Prove inventory confirmation inside the guest verification snapshot:
-- a paid order row alone no longer implies the guest sees success. The
-- gateway webhook flips payment_status inside the finalizer's atomic RPC
-- before the inventory-confirm step converges, so a paid row can exist
-- while serialized units are still expiring holds (or missing). The
-- sessionless verify path performs no service-role reads and must not
-- invoke the confirming RPC (it locks the order and writes holds), so the
-- proof is computed here, read-only, mirroring
-- private.confirm_order_inventory_reservations' skip + success conditions:
-- off-policy items are unconstrained; every other item needs at least its
-- ordered quantity durably held (sold, or reserved with no expiry) and no
-- attached-but-unconfirmed unit. Anchor resolution intentionally avoids
-- ensure_product_inventory_anchor_variant (a writer): the claim step at
-- order creation already ensures anchors, and ensure creates missing
-- anchors with 'inherit', which falls back to the product policy — the
-- same outcome this expression computes for a missing anchor.
--
-- PostgreSQL forbids CREATE OR REPLACE from changing a function's return
-- type, and 20260922220000 created this function with 12 OUT columns
-- versus the 13 here: drop the old signature first so timestamp-ordered
-- application never blocks deployment.

DROP FUNCTION IF EXISTS public.get_guest_payment_reference_snapshot(text, text);

CREATE OR REPLACE FUNCTION public.get_guest_payment_reference_snapshot(
  p_gateway_reference text,
  p_tracking_token text
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
                  ) <> 'off'
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
    JOIN public.orders AS o ON o.id = t.order_id
   WHERE t.gateway_reference = p_gateway_reference
     AND o.tracking_token IS NOT NULL
     AND o.tracking_token <> ''
     AND o.tracking_token = p_tracking_token;
$$;

COMMENT ON FUNCTION public.get_guest_payment_reference_snapshot(text, text) IS
  'Proof-bound guest read model for payment reference verification: returns verification fields (identity, status, amounts, inventory proof) only — never raw provider payloads or fee data. inventory_confirmed is true only when every serialized-tracked order item is durably held (sold or reserved with no expiry) in at least its ordered quantity; off-policy items are unconstrained. Returns a row only when the gateway reference belongs to an order carrying the supplied tracking token. Used by POST /api/payments/verify for sessionless checkouts (read-only; finalization stays on the webhook boundary).';

REVOKE ALL ON FUNCTION public.get_guest_payment_reference_snapshot(text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_guest_payment_reference_snapshot(text, text)
  TO anon, authenticated, service_role;
