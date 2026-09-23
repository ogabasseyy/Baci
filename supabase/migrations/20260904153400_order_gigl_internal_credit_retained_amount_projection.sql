-- Expose wallet/savings/store-credit GIGL retention evidence through a
-- merchant/staff-authorized projection. Direct PostgREST selects on
-- customer_savings_redemptions are customer-only under RLS, and
-- customer_wallet_transactions excludes staff; partial mixed-credit checkouts
-- therefore looked unfunded to authorized booking callers.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_order_gigl_internal_credit_retained_amount(
  p_merchant_id uuid,
  p_order_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT GREATEST(
    COALESCE((
      SELECT SUM(GREATEST(COALESCE(t.amount, 0), 0))
      FROM public.transactions AS t
      WHERE t.merchant_id = p_merchant_id
        AND t.order_id = p_order_id
        AND t.status = 'completed'
        AND lower(btrim(COALESCE(t.gateway, ''))) = ANY (
          ARRAY['wallet', 'savings', 'store_credit']::text[]
        )
    ), 0),
    COALESCE((
      SELECT SUM(GREATEST(COALESCE(w.amount, 0), 0))
      FROM public.customer_wallet_transactions AS w
      WHERE w.merchant_id = p_merchant_id
        AND w.source_type = 'order_redemption'
        AND w.source_id = p_order_id
        AND w.status = 'completed'
    ), 0)
    + COALESCE((
      SELECT SUM(GREATEST(COALESCE(s.amount, 0), 0))
      FROM public.customer_savings_redemptions AS s
      WHERE s.merchant_id = p_merchant_id
        AND s.order_id = p_order_id
        AND s.metadata->>'reversed_at' IS NULL
    ), 0)
  )
  WHERE EXISTS (
      SELECT 1
      FROM public.orders AS o
      WHERE o.id = p_order_id
        AND o.merchant_id = p_merchant_id
    )
    AND (
      EXISTS (
        SELECT 1
        FROM public.merchants AS merchant
        WHERE merchant.id = p_merchant_id
          AND merchant.user_id = (SELECT auth.uid())
      )
      OR public.check_staff_permission(
        (SELECT auth.uid()), p_merchant_id, 'orders', 'fulfill'
      )
      OR public.check_staff_permission(
        (SELECT auth.uid()), p_merchant_id, 'orders', 'edit'
      )
    );
$$;

REVOKE ALL ON FUNCTION public.get_order_gigl_internal_credit_retained_amount(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_order_gigl_internal_credit_retained_amount(uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_order_gigl_internal_credit_retained_amount(uuid, uuid)
  IS 'Returns max(completed internal-credit transactions, wallet+savings order ledgers) for authorized merchant/staff GIGL prepaid checks.';

COMMIT;
