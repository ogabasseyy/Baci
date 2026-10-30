CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE authenticator LOGIN NOINHERIT;
CREATE ROLE commerce_cart_quota NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
 $$ SELECT current_setting('request.jwt.claims', true)::jsonb->>'role' $$;
CREATE FUNCTION public.enforce_gigl_tracking_worker_request_scope()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 request_method text := current_setting('request.method', true);
 request_path text := current_setting('request.path', true);
 request_role text := auth.role();
BEGIN
 IF request_role = 'commerce_cart_quota' THEN
  IF request_method IS DISTINCT FROM 'POST' OR request_path IS DISTINCT FROM '/rpc/increment_commerce_cart_quota' THEN
   RAISE EXCEPTION 'Cart quota request is outside its capability scope' USING ERRCODE='42501';
  END IF;
 ELSIF request_role = 'gigl_tracking_worker' THEN
  IF request_path IS DISTINCT FROM '/rpc/gigl_worker_claim_due_tracking_monitors' THEN
   RAISE EXCEPTION 'GIGL worker request is outside its capability scope' USING ERRCODE='42501';
  END IF;
 END IF;
END $$;
ALTER ROLE authenticator SET pgrst.db_pre_request='public.enforce_gigl_tracking_worker_request_scope';
