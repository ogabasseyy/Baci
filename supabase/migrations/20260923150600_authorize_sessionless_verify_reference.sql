BEGIN;

-- Bearer authorization for sessionless POST /api/payments/verify without
-- a service-role client (AGENTS.md: never the admin client for
-- user-facing operations). The mobile Bearer lane must bind the
-- reference to the caller before the verification path runs: the
-- reference's transaction must belong to an order whose customer record
-- is owned by the authenticated user. Customer bearer tokens cannot read
-- the transactions table directly (transactions_select_policy is
-- merchant-scoped), so this narrow RPC performs the three-hop ownership
-- check inside a SECURITY DEFINER body and returns only the bound order
-- id — NULL for every denial, so a valid reference owned by someone
-- else is indistinguishable from a bogus one (no existence oracle).
CREATE OR REPLACE FUNCTION public.authorize_sessionless_verify_reference(
  p_gateway_reference text
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT o.id
  FROM public.transactions AS t
  JOIN public.orders AS o ON o.id = t.order_id
  JOIN public.customers AS c ON c.id = o.customer_id
  WHERE t.gateway_reference = p_gateway_reference
    AND c.user_id = auth.uid()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.authorize_sessionless_verify_reference(text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.authorize_sessionless_verify_reference(text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.authorize_sessionless_verify_reference(text) IS
  'Bearer authorization for sessionless payment verification: returns the order id when the gateway reference belongs to an order owned by the authenticated user, else NULL. Used by POST /api/payments/verify on the bearer-scoped client (no service role).';

COMMIT;
