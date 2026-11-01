-- Install the request guard before provisioning a worker credential. The
-- role remains unavailable to authenticator until a separate activation
-- after the serving fleet has observed the reload canary.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'immediate_notification_redrive') THEN
    RAISE EXCEPTION 'redrive role is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'immediate_notification_redrive'
    AND (rolcanlogin OR rolinherit OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) THEN
    RAISE EXCEPTION 'unexpected redrive role privileges';
  END IF;
  IF pg_has_role('authenticator', 'immediate_notification_redrive', 'MEMBER') THEN
    RAISE EXCEPTION 'redrive role was granted before the request guard';
  END IF;
END $$;

CREATE FUNCTION public.__immediate_notification_redrive_hook_reload_canary__()
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT 'immediate-notification-redrive-hook-canary-alive' $$;
REVOKE ALL ON FUNCTION public.__immediate_notification_redrive_hook_reload_canary__()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.__immediate_notification_redrive_hook_reload_canary__() TO anon;

DO $guard$
DECLARE
  definition text := pg_get_functiondef('public.enforce_gigl_tracking_worker_request_scope()'::regprocedure);
  anchor text := 'IF request_role = ''commerce_cart_quota'' THEN';
  insertion text := $scope$IF request_role = 'anon' AND request_method = 'POST'
    AND request_path = '/rpc/__immediate_notification_redrive_hook_reload_canary__' THEN
    RAISE EXCEPTION 'IMMEDIATE NOTIFICATION REDRIVE hook reload canary observed' USING ERRCODE = '42501';
  END IF;

  IF request_role = 'immediate_notification_redrive' THEN
    -- immediate_notification_redrive_request_scope_v1
    IF request_method IS DISTINCT FROM 'POST' OR request_path IS NULL OR request_path NOT IN (
      '/rpc/begin_immediate_notification_dispatch',
      '/rpc/record_immediate_notification_acceptance',
      '/rpc/release_immediate_notification_dispatch',
      '/rpc/recover_immediate_notification_completion',
      '/rpc/list_immediate_notification_recovery_candidates'
    ) THEN
      RAISE EXCEPTION 'Immediate notification redrive request is outside its capability scope' USING ERRCODE = '42501';
    END IF;
  ELSIF request_role = 'commerce_cart_quota' THEN$scope$;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles r, unnest(r.rolconfig) setting
    WHERE r.rolname = 'authenticator'
      AND setting = 'pgrst.db_pre_request=public.enforce_gigl_tracking_worker_request_scope') THEN
    RAISE EXCEPTION 'unexpected PostgREST request guard';
  END IF;
  IF position('immediate_notification_redrive_request_scope_v1' IN definition) > 0
    OR (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'unexpected PostgREST request guard definition';
  END IF;
  EXECUTE replace(definition, anchor, insertion);
END $guard$;

NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
