BEGIN;

-- Terminal immediate-notification delivery for the authenticated order
-- lookup. The guest/token branch of GET /api/storefront/orders/[id]
-- reads notification_delivered from the get_order_tracking projection,
-- but the signed-in branch selects the orders table directly, where no
-- such column exists — so signed-in shoppers polling the order-success
-- page always observe the flag as false and never record
-- invoice_generated. The claims table stays RLS-denied to
-- authenticated callers, so this narrow RPC exposes only the EXISTS(sent)
-- bit for orders the caller owns (the order's customer record belongs
-- to auth.uid(), the same ownership chain the verify authorization
-- uses) or may merchant-view. Denials read as not delivered (unknown
-- order, failing ownership, or no sent claim are indistinguishable).
CREATE OR REPLACE FUNCTION public.get_order_notification_delivered(
  p_order_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (
      SELECT EXISTS (
        SELECT 1
        FROM public.immediate_order_notification_claims AS c
        WHERE c.order_id = o.id
          AND c.status = 'sent'
      )
      FROM public.orders AS o
      LEFT JOIN public.customers AS c ON c.id = o.customer_id
      WHERE o.id = p_order_id
        AND (
          c.user_id = auth.uid()
          OR public.has_merchant_access(o.merchant_id)
        )
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.get_order_notification_delivered(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_notification_delivered(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_order_notification_delivered(uuid) IS
  'Terminal immediate-notification delivery bit for orders the caller owns or may merchant-view. Used by the authenticated GET /api/storefront/orders/[id] branch so signed-in success screens gate invoice_generated on server-confirmed delivery.';

COMMIT;
