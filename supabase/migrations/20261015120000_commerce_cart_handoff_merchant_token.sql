-- Upgrade existing databases without rewriting the original handoff migration.
-- Remove the identifier-only locator so callers must hold the bearer token.
DROP FUNCTION IF EXISTS public.commerce_cart_handoff_merchant(uuid);
CREATE OR REPLACE FUNCTION public.commerce_cart_handoff_merchant(
  p_handoff_id uuid, p_token_hash text
) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT merchant_id FROM public.commerce_cart_handoffs
  WHERE id = p_handoff_id AND handoff_hash = p_token_hash;
$$;
ALTER FUNCTION public.commerce_cart_handoff_merchant(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.commerce_cart_handoff_merchant(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commerce_cart_handoff_merchant(uuid, text)
  TO anon, authenticated, service_role;
