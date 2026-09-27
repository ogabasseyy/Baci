-- Round-33 review fixes.
-- P1 (service-role boundary): user-facing payment verification
-- classifies the order's payment method before capture. That read
-- used the route's service-role client; it now runs through this
-- narrow merchant-bound RPC on the scoped route client instead, so
-- the user-facing call graph never crosses the service-role
-- boundary. The RPC discloses only the payment method, enforces the
-- merchant binding in the query, and accepts service_role or the
-- merchant-bound scoped route JWT (NULL-proof: claimless callers
-- fail closed).
CREATE FUNCTION public.get_redvault_order_payment_method(p_order_id uuid, p_merchant_id uuid)
RETURNS TABLE (payment_method text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    IF (SELECT auth.role()) IS DISTINCT FROM 'authenticated'
      OR COALESCE(auth.jwt()->>'storefront_order_context', '') <> 'route'
      OR COALESCE(auth.jwt()->>'storefront_order_merchant_id', '')
        IS DISTINCT FROM p_merchant_id::text THEN
      RAISE EXCEPTION 'forbidden: get_redvault_order_payment_method requires service_role or scoped route context';
    END IF;
  END IF;
  RETURN QUERY
  SELECT o.payment_method FROM public.orders AS o
  WHERE o.id = p_order_id AND o.merchant_id = p_merchant_id
  LIMIT 1;
END;
$$;
ALTER FUNCTION public.get_redvault_order_payment_method(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_redvault_order_payment_method(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_redvault_order_payment_method(uuid, uuid)
  TO authenticated, service_role;
