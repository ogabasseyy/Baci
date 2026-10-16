-- Rename the preview pair's raw-token argument from p_token_hash to
-- p_token so the call-site convention is unambiguous: preview RPCs take
-- the raw pairing token and hash it internally (the stored hash is
-- never a credential), while the redeem family keeps its precomputed
-- hash contract under scoped shopper authority. Renaming an input
-- parameter requires dropping the old signature first.
DROP FUNCTION public.commerce_cart_handoff_merchant(uuid, text);
CREATE FUNCTION public.commerce_cart_handoff_merchant(
  p_handoff_id uuid, p_token text
) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT merchant_id FROM public.commerce_cart_handoffs
  WHERE id = p_handoff_id
    AND handoff_hash = encode(pg_catalog.sha256(p_token::bytea), 'hex');
$$;
ALTER FUNCTION public.commerce_cart_handoff_merchant(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.commerce_cart_handoff_merchant(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commerce_cart_handoff_merchant(uuid, text)
  TO anon, authenticated, service_role;

DO $repair$
DECLARE definition text;
BEGIN
  definition := pg_get_functiondef('public.commerce_cart_preview_handoff(uuid,text)'::regprocedure);
  IF position('p_token_hash' IN definition) = 0 THEN
    RETURN;
  END IF;
  definition := replace(definition, 'p_token_hash', 'p_token');
  DROP FUNCTION public.commerce_cart_preview_handoff(uuid, text);
  EXECUTE definition;
END $repair$;
REVOKE ALL ON FUNCTION public.commerce_cart_preview_handoff(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commerce_cart_preview_handoff(uuid, text)
  TO anon, authenticated, service_role;
