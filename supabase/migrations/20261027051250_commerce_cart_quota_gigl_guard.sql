-- Stage the quota request guard before the later migration grants the role
-- to PostgREST. The deployment workflow must witness this hook before grant.
DO $$
DECLARE
  grant_already_recorded boolean := false;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = $1)'
      INTO grant_already_recorded USING '20261027051251';
  END IF;
  IF grant_already_recorded THEN
    RAISE EXCEPTION 'quota grant migration already recorded; reconcile before staging';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_cart_quota') THEN
    CREATE ROLE commerce_cart_quota NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
  ELSIF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'commerce_cart_quota'
      AND (rolcanlogin OR rolinherit OR rolsuper OR rolbypassrls
        OR rolcreatedb OR rolcreaterole OR rolreplication)
  ) THEN
    RAISE EXCEPTION 'Unexpected commerce_cart_quota role privileges';
  END IF;
END $$;

-- The later migration may grant membership only after the reload probe.
REVOKE commerce_cart_quota FROM authenticator;

CREATE OR REPLACE FUNCTION public.__commerce_cart_quota_hook_reload_canary__()
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT 'cart-quota-hook-canary-alive' $$;
REVOKE ALL ON FUNCTION public.__commerce_cart_quota_hook_reload_canary__()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.__commerce_cart_quota_hook_reload_canary__() TO anon;

DO $guard$
DECLARE
  definition text := pg_get_functiondef(
    'public.enforce_gigl_tracking_worker_request_scope()'::regprocedure
  );
  anchor text := 'IF request_role = ''gigl_tracking_worker'' THEN';
  insertion text := $scope$IF request_role = 'anon'
    AND request_method = 'POST'
    AND request_path = '/rpc/__commerce_cart_quota_hook_reload_canary__' THEN
    RAISE EXCEPTION 'CART QUOTA hook reload canary observed'
      USING ERRCODE = '42501';
  END IF;

  IF request_role = 'commerce_cart_quota' THEN
    -- commerce_cart_quota_request_scope_v1
    IF request_method IS DISTINCT FROM 'POST'
      OR request_path IS DISTINCT FROM '/rpc/increment_commerce_cart_quota' THEN
      RAISE EXCEPTION 'Cart quota request is outside its capability scope'
        USING ERRCODE = '42501';
    END IF;
  ELSIF request_role = 'gigl_tracking_worker' THEN$scope$;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles r, unnest(r.rolconfig) setting
    WHERE r.rolname = 'authenticator'
      AND setting = 'pgrst.db_pre_request=public.enforce_gigl_tracking_worker_request_scope'
  ) THEN
    RAISE EXCEPTION 'Unexpected PostgREST request guard';
  END IF;
  IF position('commerce_cart_quota_request_scope_v1' IN definition) > 0
    OR (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) != 1 THEN
    RAISE EXCEPTION 'Unexpected PostgREST request guard definition';
  END IF;
  EXECUTE replace(definition, anchor, insertion);
END $guard$;

NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
