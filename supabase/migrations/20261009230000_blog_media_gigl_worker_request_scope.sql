-- Confine the blog media sweep worker at the PostgREST request
-- boundary. Without a scope guard, a used or leaked
-- BLOG_MEDIA_SWEEP_WORKER_TOKEN reaches every PostgREST endpoint
-- through inherited PUBLIC EXECUTE grants — not just the two sweep
-- wrappers — from the moment any migration grants authenticator
-- membership. This extends the installed pre-request scope hook
-- (shared with the GIGL worker; its logic is preserved verbatim)
-- with the worker's two-RPC capability, following
-- 20260805113000_restore_gigl_tracking_postgrest_capability.
--
-- Deploy sequencing mirrors GIGL: apply through THIS migration,
-- observe unanimous canary acks fleet-wide with
-- .github/scripts/probe-blog-media-hook-reload.sh, then apply
-- 20261009240000 to grant membership. Membership is revoked below
-- (a no-op warning on first rollout, where no earlier migration
-- grants it; a real revocation on upgrade paths), so the token is
-- unusable (cron sweeps pause and recover on the next run) until
-- the isolate migration grants it behind a loaded hook. Never grant
-- here: PostgreSQL exposes membership at commit while PostgREST
-- reloads asynchronously.
CREATE OR REPLACE FUNCTION public.__blog_media_hook_reload_canary__()
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$ SELECT 'blog-media-hook-canary-alive' $$;

ALTER FUNCTION public.__blog_media_hook_reload_canary__()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.__blog_media_hook_reload_canary__()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.__blog_media_hook_reload_canary__()
  TO anon;

CREATE OR REPLACE FUNCTION
  public.enforce_gigl_tracking_worker_request_scope()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  request_method text := current_setting('request.method', true);
  request_path text := current_setting('request.path', true);
  request_role text := auth.role();
BEGIN
  -- Reload canaries, observed by the reload probes BEFORE the
  -- isolate migrations grant membership: an anonymous POST to a
  -- real canary RPC proves PostgREST loaded this hook when it
  -- answers the 42501 denial instead of the bare constant. The
  -- shadow is the signal, by design.
  IF request_role = 'anon'
    AND request_method = 'POST'
    AND request_path = '/rpc/__gigl_hook_reload_canary__' THEN
    RAISE EXCEPTION 'GIGL hook reload canary observed'
      USING ERRCODE = '42501';
  END IF;
  IF request_role = 'anon'
    AND request_method = 'POST'
    AND request_path = '/rpc/__blog_media_hook_reload_canary__' THEN
    RAISE EXCEPTION 'BLOG MEDIA hook reload canary observed'
      USING ERRCODE = '42501';
  END IF;

  IF request_role = 'gigl_tracking_worker' THEN
    -- PostgREST stores request.path WITH the leading slash (e.g.
    -- '/projects', '/rpc/<function>'): slashless literals would
    -- never match and would deny every worker RPC with 42501.
    IF request_method IS DISTINCT FROM 'POST'
      OR request_path IS NULL
      OR request_path NOT IN (
        '/rpc/gigl_worker_apply_tracking_result',
        '/rpc/gigl_worker_claim_due_tracking_monitors',
        '/rpc/gigl_worker_pause_tracking_monitor',
        '/rpc/gigl_worker_record_tracking_failure',
        '/rpc/gigl_worker_release_tracking_claim'
      ) THEN
      RAISE EXCEPTION 'GIGL worker request is outside its capability scope'
        USING ERRCODE = '42501';
    END IF;
  ELSIF request_role = 'blog_media_sweep_worker' THEN
    IF request_method IS DISTINCT FROM 'POST'
      OR request_path IS NULL
      OR request_path NOT IN (
        '/rpc/blog_media_sweep_worker_claim',
        '/rpc/blog_media_sweep_worker_release'
      ) THEN
      RAISE EXCEPTION 'Blog media worker request is outside its capability scope'
        USING ERRCODE = '42501';
    END IF;
  END IF;
END;
$$;

ALTER FUNCTION public.enforce_gigl_tracking_worker_request_scope()
  OWNER TO postgres;

-- The hook slot must still hold this function: if another hook
-- replaced it, extending this body confines nothing. A missing
-- setting (fresh databases that never installed the GIGL hook)
-- warns only — the body above is then the hook of record.
DO $$
DECLARE
  installed_hook text;
BEGIN
  SELECT setting INTO installed_hook
  FROM pg_db_role_setting AS role_setting
  JOIN pg_roles AS role_record ON role_record.oid = role_setting.setrole
  CROSS JOIN LATERAL unnest(role_setting.setconfig) AS config_item(setting)
  WHERE role_record.rolname = 'authenticator'
    AND setting LIKE 'pgrst.db_pre_request=%'
  LIMIT 1;

  IF installed_hook IS NULL THEN
    RAISE WARNING 'authenticator has no PostgREST pre-request hook; the extended guard above takes effect when installed';
  ELSIF installed_hook <>
    'pgrst.db_pre_request=public.enforce_gigl_tracking_worker_request_scope'
  THEN
    RAISE EXCEPTION 'authenticator has a different PostgREST pre-request hook: %', installed_hook;
  END IF;
END;
$$;

REVOKE blog_media_sweep_worker FROM authenticator;
