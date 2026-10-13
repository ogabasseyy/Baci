-- Extend the bounded order payment snapshot with the wallet amount so the
-- REDVAULT initialize route can read it without a direct orders table lookup.
-- Guest REDVAULT checkouts run through the scoped storefront client
-- (authenticated role, no sub), which has no grant on public.orders; the
-- snapshot function is SECURITY DEFINER and already enforces order context
-- (order_id + customer email match), so exposing this single numeric column
-- through it is safe for the scoped role.

DROP FUNCTION IF EXISTS public.get_order_payment_snapshot(uuid, text);
CREATE FUNCTION public.get_order_payment_snapshot(p_order_id uuid, p_email text)
RETURNS TABLE(merchant_id uuid, total numeric, currency text, tracking_token text, shipping_status text, payment_status text, merchant_country text, payment_method text, wallet_amount_used numeric)
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT o.merchant_id, o.total, o.currency, o.tracking_token, o.shipping_status, o.payment_status, m.country, o.payment_method, o.wallet_amount_used
  FROM public.orders AS o
  JOIN public.merchants AS m ON m.id = o.merchant_id
  WHERE o.id = p_order_id
    AND pg_catalog.lower(o.customer_email) = pg_catalog.lower(pg_catalog.btrim(p_email))
  LIMIT 1;
$$;
ALTER FUNCTION public.get_order_payment_snapshot(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_order_payment_snapshot(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_payment_snapshot(uuid, text) TO anon, authenticated, service_role;
