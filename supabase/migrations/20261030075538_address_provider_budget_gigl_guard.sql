-- Install and witness the request guard before the following ledger grants membership.
-- Rollback: revoke address_budget_reserver from authenticator; retain ledgers/evidence.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'address_budget_reserver'
    AND (rolcanlogin OR rolinherit OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) THEN
    RAISE EXCEPTION 'Unexpected address budget role privileges';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'address_budget_reserver') THEN
    CREATE ROLE address_budget_reserver NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
  ELSIF pg_has_role('authenticator', 'address_budget_reserver', 'MEMBER') THEN
    RAISE EXCEPTION 'Address budget role already granted; reconcile before staging';
  END IF;
END $$;
REVOKE address_budget_reserver FROM authenticator;

CREATE OR REPLACE FUNCTION public.__address_budget_hook_reload_canary__()
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT 'address-budget-hook-canary-alive' $$;
REVOKE ALL ON FUNCTION public.__address_budget_hook_reload_canary__() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.__address_budget_hook_reload_canary__() TO anon;

DO $guard$
DECLARE
  definition text := pg_get_functiondef('public.enforce_gigl_tracking_worker_request_scope()'::regprocedure);
  anchor text := 'IF request_role = ''commerce_cart_quota'' THEN';
  insertion text := $scope$IF request_role = 'anon' AND request_method = 'POST'
    AND request_path = '/rpc/__address_budget_hook_reload_canary__' THEN
    RAISE EXCEPTION 'ADDRESS BUDGET hook reload canary observed' USING ERRCODE = '42501';
  END IF;
  IF request_role = 'address_budget_reserver' THEN
    -- address_provider_budget_request_scope_v1
    IF request_method IS DISTINCT FROM 'POST'
      OR request_path IS DISTINCT FROM '/rpc/reserve_address_provider_request' THEN
      RAISE EXCEPTION 'Address budget request is outside its capability scope' USING ERRCODE = '42501';
    END IF;
  ELSIF request_role = 'commerce_cart_quota' THEN$scope$;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles r, unnest(r.rolconfig) setting
    WHERE r.rolname = 'authenticator'
      AND setting = 'pgrst.db_pre_request=public.enforce_gigl_tracking_worker_request_scope') THEN
    RAISE EXCEPTION 'Unexpected PostgREST request guard';
  END IF;
  IF position('address_provider_budget_request_scope_v1' IN definition) > 0
    OR (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) != 1 THEN
    RAISE EXCEPTION 'Unexpected PostgREST request guard definition';
  END IF;
  EXECUTE replace(definition, anchor, insertion);
END $guard$;
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';

