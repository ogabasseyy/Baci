-- Stop treating the stored handoff hash as a bearer credential for the
-- unauthenticated preview pair: both RPCs now accept the raw pairing
-- token (still passed as p_token_hash) and hash it inside the function,
-- so a leaked handoff_hash (log, backup, read replica) no longer
-- previews a cart by itself. The redeem family keeps its existing hash
-- contract under scoped shopper authority. Direct anon callers still
-- need the high-entropy pairing token itself; route-level quotas remain
-- the abuse control for the intended web flow.
CREATE OR REPLACE FUNCTION public.commerce_cart_handoff_merchant(
  p_handoff_id uuid, p_token_hash text
) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT merchant_id FROM public.commerce_cart_handoffs
  WHERE id = p_handoff_id
    AND handoff_hash = encode(pg_catalog.sha256(p_token_hash::bytea), 'hex');
$$;
ALTER FUNCTION public.commerce_cart_handoff_merchant(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.commerce_cart_handoff_merchant(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commerce_cart_handoff_merchant(uuid, text)
  TO anon, authenticated, service_role;

DO $repair$
DECLARE definition text; old text;
BEGIN
  definition := pg_get_functiondef('public.commerce_cart_preview_handoff(uuid,text)'::regprocedure);
  IF position('pg_catalog.sha256' IN definition) > 0 THEN
    RETURN;
  END IF;
  old := $old$IF FOUND AND v_row.handoff_hash <> p_token_hash THEN$old$;
  IF (length(definition) - length(replace(definition, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'handoff preview token source mismatch';
  END IF;
  definition := replace(definition, old,
    $new$IF FOUND AND v_row.handoff_hash <> encode(pg_catalog.sha256(p_token_hash::bytea), 'hex') THEN$new$);
  EXECUTE definition;
END $repair$;
REVOKE ALL ON FUNCTION public.commerce_cart_preview_handoff(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commerce_cart_preview_handoff(uuid, text)
  TO anon, authenticated, service_role;
