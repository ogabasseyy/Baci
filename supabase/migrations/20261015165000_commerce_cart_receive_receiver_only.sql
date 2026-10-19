-- Restrict realtime receive authorization to the dedicated
-- receive-only role. The realtime.messages policies already grant
-- SELECT only to commerce_cart_receiver, but the helper also accepted
-- the broader commerce_cart_shopper JWT: if a server-side shopper
-- token ever reached a client, it could satisfy the helper directly.
-- The shopper role keeps using the commerce_cart_realtime_access RPC
-- server-side; only the five-minute receive token may subscribe.
CREATE OR REPLACE FUNCTION public.commerce_cart_receive_authorized(p_topic text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.commerce_cart_grants g
  JOIN public.commerce_carts c ON c.id=g.cart_id AND c.merchant_id=g.merchant_id
  JOIN public.merchants m ON m.id=g.merchant_id
  WHERE g.id::text=auth.jwt()->>'cart_grant_id'
    AND g.cart_id::text=auth.jwt()->>'cart_id'
    AND g.merchant_id::text=auth.jwt()->>'cart_merchant_id'
    AND g.principal_id=auth.jwt()->>'cart_principal_id'
    AND auth.jwt()->>'cart_scope'='session'
    AND auth.jwt()->>'role' = 'commerce_cart_receiver'
    AND CASE WHEN auth.jwt()->>'exp' ~ '^[0-9]+(\.[0-9]+)?$'
      THEN (auth.jwt()->>'exp')::numeric > extract(epoch FROM now()) ELSE false END
    AND g.revoked_at IS NULL AND g.expires_at>now() AND c.expires_at>now()
    AND c.state IN ('active','checkout')
    AND m.premium_features @> '["shared_cart","shared_cart_realtime"]'::jsonb
    AND p_topic='cart:'||g.merchant_id::text||':'||g.cart_id::text
 );
$$;
ALTER FUNCTION public.commerce_cart_receive_authorized(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.commerce_cart_receive_authorized(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commerce_cart_receive_authorized(text) TO commerce_cart_receiver;
