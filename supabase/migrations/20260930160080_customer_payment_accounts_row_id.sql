-- Expose the payment-account row id to customer receipts. Duplicate
-- account numbers with divergent metadata are database-permitted, and
-- the shared TypeScript selector breaks full ties by row id descending
-- exactly like the atomic dispatch recheck — without the id, customer
-- surfaces fall back to input order and can print different account
-- metadata than the emailed document. Additive column only: existing
-- consumers ignore it. DROP before CREATE: OR REPLACE cannot change a
-- return type. Safe predeploy: pure projection widening, no enforcement.
DROP FUNCTION IF EXISTS public.get_customer_order_payment_accounts(uuid[]);
CREATE FUNCTION public.get_customer_order_payment_accounts(
  p_order_ids uuid[]
)
RETURNS TABLE (
  order_id uuid,
  account_number text,
  bank_name text,
  account_name text,
  provider text,
  assignment_customer_email_source text,
  created_at timestamptz,
  assigned_at timestamptz,
  expires_at timestamptz,
  id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    account.order_id,
    account.account_number,
    account.bank_name,
    account.account_name,
    account.provider,
    account.assignment_customer_email_source,
    account.created_at,
    account.assigned_at,
    account.expires_at,
    account.id
  FROM public.order_payment_accounts AS account
  INNER JOIN public.orders AS order_row ON order_row.id = account.order_id
  INNER JOIN public.customers AS customer ON customer.id = order_row.customer_id
  WHERE (SELECT auth.uid()) IS NOT NULL
    AND customer.user_id = (SELECT auth.uid())
    AND coalesce(array_length(p_order_ids, 1), 0) <= 100
    AND account.order_id = ANY(coalesce(p_order_ids, ARRAY[]::uuid[]))
  ORDER BY account.order_id, account.created_at DESC NULLS LAST, account.account_number;
$function$;

REVOKE ALL ON FUNCTION public.get_customer_order_payment_accounts(uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_order_payment_accounts(uuid[])
  TO authenticated;

COMMENT ON FUNCTION public.get_customer_order_payment_accounts(uuid[])
  IS 'Returns an ownership-checked, non-sensitive payment-account projection for customer receipts.';
