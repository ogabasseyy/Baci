-- Restore the GIGL worker to a signed PostgREST capability. A direct LOGIN can
-- set request.jwt.claim.* itself and therefore cannot be constrained by the
-- wrapper claim checks. Keep the signing key outside the VPS; the host receives
-- only a time-bounded JWT whose role is gigl_tracking_worker.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gigl_tracking_worker') THEN
    RAISE EXCEPTION 'gigl_tracking_worker capability role is missing';
  END IF;
END
$$;

ALTER ROLE gigl_tracking_worker NOLOGIN CONNECTION LIMIT -1 PASSWORD NULL;

COMMENT ON ROLE gigl_tracking_worker IS
  'Signed PostgREST capability for the VPS GIGL poller; no direct login';

-- Install and activate the request-scope hook HERE, a full migration before
-- authenticator membership is granted: PostgreSQL exposes a new membership
-- at commit while PostgREST reloads configuration asynchronously, so
-- granting membership in the same transaction as the hook activation would
-- leave a post-commit window where an issued worker JWT could invoke
-- PUBLIC-granted RPCs without the five-path restriction. With the hook
-- installed and reloaded first, the token is unusable until the isolate
-- migration grants membership, and already confined when that happens.
-- The gigl_tracking_worker role is reachable only through PostgREST, but
-- every PostgreSQL role inherits EXECUTE grants made to PUBLIC. Enforce
-- the worker's five-RPC capability at the Data API request boundary before
-- PostgREST invokes any exposed function or relation.

-- Reload canary: a REAL RPC the hook below shadows for anonymous
-- callers, observed by probe-gigl-hook-reload.sh BEFORE the isolate
-- migration grants membership. The function MUST exist: PostgREST
-- resolves the action plan (including RPC existence) BEFORE invoking
-- db_pre_request, so a nonexistent canary path would answer PGRST202
-- from the schema cache with the hook never firing, and the probe
-- could never ack. The function itself is inert (constant return, no
-- writes, no privileged access, anonymous-only EXECUTE): only the
-- loaded hook's 42501 denial satisfies the probe, while the bare
-- constant (schema fresh, hook stale) and 404 (schema stale) both
-- read as not-loaded-yet.
CREATE OR REPLACE FUNCTION public.__gigl_hook_reload_canary__()
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$ SELECT 'gigl-hook-canary-alive' $$;

ALTER FUNCTION public.__gigl_hook_reload_canary__()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.__gigl_hook_reload_canary__()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.__gigl_hook_reload_canary__()
  TO anon;

CREATE OR REPLACE FUNCTION public.enforce_gigl_tracking_worker_request_scope()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  request_method text := current_setting('request.method', true);
  request_path text := current_setting('request.path', true);
BEGIN
  -- Reload canary, observed by probe-gigl-hook-reload.sh BEFORE the
  -- isolate migration grants membership: an anonymous POST to the
  -- real canary RPC proves PostgREST loaded this hook when it
  -- answers the 42501 denial instead of the bare constant, so the
  -- grant can never commit ahead of an unloaded hook. The shadow is
  -- the signal, by design.
  IF auth.role() = 'anon'
    AND request_method = 'POST'
    AND request_path = '/rpc/__gigl_hook_reload_canary__' THEN
    RAISE EXCEPTION 'GIGL hook reload canary observed'
      USING ERRCODE = '42501';
  END IF;

  IF auth.role() IS DISTINCT FROM 'gigl_tracking_worker' THEN
    RETURN;
  END IF;

  -- PostgREST stores request.path WITH the leading slash (e.g.
  -- '/projects', '/rpc/<function>'): slashless literals would never
  -- match and would deny every worker RPC with 42501.
  IF request_method IS DISTINCT FROM 'POST' OR request_path IS NULL OR request_path NOT IN (
    '/rpc/gigl_worker_apply_tracking_result',
    '/rpc/gigl_worker_claim_due_tracking_monitors',
    '/rpc/gigl_worker_pause_tracking_monitor',
    '/rpc/gigl_worker_record_tracking_failure',
    '/rpc/gigl_worker_release_tracking_claim'
  ) THEN
    RAISE EXCEPTION 'GIGL worker request is outside its capability scope'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

ALTER FUNCTION public.enforce_gigl_tracking_worker_request_scope()
  OWNER TO postgres;
-- PostgREST invokes db_pre_request AFTER User Impersonation, so the hook
-- executes as the request's JWT role and every current and future API role
-- must hold EXECUTE; the auth.role() early return inside is the guard, not
-- the privilege. Never revoke EXECUTE here: revoking from normal roles
-- would fail every Data API request with permission denied before the
-- early return could run.
GRANT EXECUTE ON FUNCTION public.enforce_gigl_tracking_worker_request_scope()
  TO PUBLIC;

DO $$
DECLARE
  conflicting_hook text;
  installed_hook text;
BEGIN
  SELECT setting
  INTO conflicting_hook
  FROM pg_db_role_setting AS role_setting
  JOIN pg_roles AS role_record ON role_record.oid = role_setting.setrole
  CROSS JOIN LATERAL unnest(role_setting.setconfig) AS config_item(setting)
  WHERE role_record.rolname = 'authenticator'
    AND setting LIKE 'pgrst.db_pre_request=%'
    AND setting <> 'pgrst.db_pre_request=public.enforce_gigl_tracking_worker_request_scope'
  LIMIT 1;

  IF conflicting_hook IS NOT NULL THEN
    RAISE EXCEPTION 'authenticator already has a different PostgREST pre-request hook';
  END IF;

  ALTER ROLE authenticator
    SET pgrst.db_pre_request = 'public.enforce_gigl_tracking_worker_request_scope';

  SELECT setting
  INTO installed_hook
  FROM pg_db_role_setting AS role_setting
  JOIN pg_roles AS role_record ON role_record.oid = role_setting.setrole
  CROSS JOIN LATERAL unnest(role_setting.setconfig) AS config_item(setting)
  WHERE role_record.rolname = 'authenticator'
    AND setting = 'pgrst.db_pre_request=public.enforce_gigl_tracking_worker_request_scope'
  LIMIT 1;

  IF installed_hook IS NULL THEN
    RAISE EXCEPTION 'PostgREST pre-request hook failed to install';
  END IF;
END
$$;

NOTIFY pgrst, 'reload config';
-- The new gigl_worker_* wrappers are invisible to PostgREST until its schema
-- cache is reloaded; 'reload config' alone does not refresh it.
NOTIFY pgrst, 'reload schema';
