-- The prior canary predates the backlog RPC allowlist. This new canary is
-- injected only after verifying that complete allowlist, so its observed
-- 42501 proves the serving hook includes that later guard revision.
CREATE FUNCTION public.__immediate_notification_redrive_complete_hook_canary__()
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT 'immediate-notification-complete-hook-canary-alive' $$;
REVOKE ALL ON FUNCTION public.__immediate_notification_redrive_complete_hook_canary__()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.__immediate_notification_redrive_complete_hook_canary__() TO anon;

DO $guard$
DECLARE
  definition text := pg_get_functiondef('public.enforce_gigl_tracking_worker_request_scope()'::regprocedure);
  anchor text := 'IF request_role = ''immediate_notification_redrive'' THEN';
  insertion text := $scope$IF request_role = 'anon' AND request_method = 'POST'
    AND request_path = '/rpc/__immediate_notification_redrive_complete_hook_canary__' THEN
    RAISE EXCEPTION 'IMMEDIATE NOTIFICATION COMPLETE hook reload canary observed' USING ERRCODE = '42501';
  END IF;

  IF request_role = 'immediate_notification_redrive' THEN$scope$;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles r, unnest(r.rolconfig) setting
    WHERE r.rolname = 'authenticator'
      AND setting = 'pgrst.db_pre_request=public.enforce_gigl_tracking_worker_request_scope')
    OR position('immediate_notification_redrive_request_scope_v1' IN definition) = 0
    OR position('/rpc/has_immediate_notification_reconciliation_backlog' IN definition) = 0
    OR (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'unexpected complete redrive request guard definition';
  END IF;
  EXECUTE replace(definition, anchor, insertion);
END $guard$;
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
