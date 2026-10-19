-- Split realtime authorization by role after 20261015165000 over-
-- narrowed the shared helper: commerce_cart_realtime_access() runs
-- under the shopper role and validates the grant through
-- commerce_cart_receive_authorized before minting the receive-only
-- token, so narrowing that helper to receiver-only broke token
-- minting for every normal session. Restore the shared helper to
-- grant validation for both scoped roles, and move the receiver-only
-- restriction into a dedicated predicate used by the realtime
-- subscription policies.
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
    AND auth.jwt()->>'role' IN ('commerce_cart_shopper','commerce_cart_receiver')
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
GRANT EXECUTE ON FUNCTION public.commerce_cart_receive_authorized(text) TO commerce_cart_shopper,commerce_cart_receiver;

-- Receiver-only subscription predicate: identical grant validation,
-- but only the five-minute receive token may satisfy it.
CREATE OR REPLACE FUNCTION public.commerce_cart_receiver_authorized(p_topic text)
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
ALTER FUNCTION public.commerce_cart_receiver_authorized(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.commerce_cart_receiver_authorized(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commerce_cart_receiver_authorized(text) TO commerce_cart_receiver;

-- Subscription policies now require the receiver-only predicate.
DROP POLICY IF EXISTS commerce_cart_receive_private ON realtime.messages;
CREATE POLICY commerce_cart_receive_private ON realtime.messages FOR SELECT TO commerce_cart_receiver
 USING (extension='broadcast' AND private IS TRUE
   AND topic=(SELECT realtime.topic())
   AND public.commerce_cart_receiver_authorized((SELECT realtime.topic())));
DROP POLICY IF EXISTS commerce_cart_receive_scope ON realtime.messages;
CREATE POLICY commerce_cart_receive_scope ON realtime.messages AS RESTRICTIVE FOR SELECT TO commerce_cart_receiver
 USING (extension='broadcast' AND private IS TRUE AND topic=(SELECT realtime.topic())
   AND public.commerce_cart_receiver_authorized((SELECT realtime.topic())));
