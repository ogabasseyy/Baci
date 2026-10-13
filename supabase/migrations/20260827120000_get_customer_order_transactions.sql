-- Expose the minimum transaction projection required by customer receipts.
-- The transactions table is merchant-only by design, so customer-facing
-- receipt paths must use this ownership-checked projection instead of relying
-- on a customer session's table SELECT policy.
CREATE OR REPLACE FUNCTION public.get_customer_order_transactions(
  p_order_ids uuid[]
)
RETURNS TABLE (
  id uuid,
  order_id uuid,
  amount numeric,
  created_at timestamptz,
  description text,
  gateway text,
  status text,
  transaction_type text,
  dva_account_number text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    t.id,
    t.order_id,
    t.amount,
    t.created_at,
    t.description,
    t.gateway,
    t.status,
    t.transaction_type,
    CASE
      WHEN lower(coalesce(t.gateway, '')) = 'paystack'
        AND NULLIF(btrim(t.metadata ->> 'dva_account_number'), '') ~ '^[0-9]{6,20}$'
      THEN NULLIF(btrim(t.metadata ->> 'dva_account_number'), '')
      ELSE NULL
    END AS dva_account_number
  FROM public.transactions AS t
  INNER JOIN public.orders AS o ON o.id = t.order_id
  INNER JOIN public.customers AS c ON c.id = o.customer_id
  WHERE (SELECT auth.uid()) IS NOT NULL
    AND c.user_id = (SELECT auth.uid())
    AND coalesce(array_length(p_order_ids, 1), 0) <= 100
    AND t.order_id = ANY(coalesce(p_order_ids, ARRAY[]::uuid[]))
  ORDER BY t.order_id, t.created_at ASC, t.id ASC;
$function$;

REVOKE ALL ON FUNCTION public.get_customer_order_transactions(uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_order_transactions(uuid[])
  TO authenticated;

COMMENT ON FUNCTION public.get_customer_order_transactions(uuid[])
  IS 'Returns an ownership-checked, non-sensitive transaction projection for customer receipts.';
