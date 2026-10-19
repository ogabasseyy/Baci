-- Preview callers must pass the server's HTTP quotas before receiving this
-- server-only authority. Public PostgREST credentials cannot call either RPC.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_cart_previewer') THEN
    CREATE ROLE commerce_cart_previewer NOLOGIN;
  END IF;
END $roles$;
GRANT commerce_cart_previewer TO authenticator;
GRANT USAGE ON SCHEMA public, auth TO commerce_cart_previewer;
GRANT EXECUTE ON FUNCTION auth.jwt() TO commerce_cart_previewer;

CREATE OR REPLACE FUNCTION public.commerce_cart_handoff_merchant(
  p_handoff_id uuid, p_token text
) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT merchant_id FROM public.commerce_cart_handoffs
  WHERE id = p_handoff_id
    AND auth.jwt()->>'role' = 'commerce_cart_previewer'
    AND auth.jwt()->>'cart_handoff_id' = p_handoff_id::text
    AND handoff_hash = encode(pg_catalog.sha256(p_token::bytea), 'hex');
$$;

-- Preserve the existing redaction, expiry, enrollment and pricing contract.
-- Assert the insertion point so an unexpected prior definition fails closed.
DO $repair$
DECLARE
  definition text;
  body_start integer;
  guard text := E'  -- commerce_cart_previewer_authority_v1\n  IF auth.jwt()->>\'role\' IS DISTINCT FROM \'commerce_cart_previewer\' OR auth.jwt()->>\'cart_handoff_id\' IS DISTINCT FROM p_handoff_id::text THEN\n    RETURN pg_catalog.jsonb_build_object(\'ok\', false, \'code\', \'not_found\');\n  END IF;\n';
BEGIN
  definition := pg_get_functiondef('public.commerce_cart_preview_handoff(uuid,text)'::regprocedure);
  IF position('-- commerce_cart_previewer_authority_v1' IN definition) > 0 THEN
    RETURN;
  END IF;
  body_start := position(E'BEGIN\n' IN definition);
  IF body_start = 0 OR position('LANGUAGE plpgsql' IN definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected commerce_cart_preview_handoff definition';
  END IF;
  -- Insert once at the first top-level BEGIN; never rewrite nested blocks.
  definition := substring(definition FROM 1 FOR body_start + 5)
    || guard || substring(definition FROM body_start + 6);
  EXECUTE definition;
END $repair$;
ALTER FUNCTION public.commerce_cart_handoff_merchant(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.commerce_cart_handoff_merchant(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.commerce_cart_preview_handoff(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commerce_cart_handoff_merchant(uuid, text)
  TO commerce_cart_previewer;
GRANT EXECUTE ON FUNCTION public.commerce_cart_preview_handoff(uuid, text)
  TO commerce_cart_previewer;
