-- Install the three-RPC request boundary before any cache worker JWT can
-- assume the role. As with GIGL and blog-media workers, do not grant role
-- membership here: PostgREST reload is asynchronous and must be observed over
-- the pre-activation canary sampling window before membership is granted.
CREATE OR REPLACE FUNCTION public.__cache_invalidation_hook_reload_canary__()
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$ SELECT 'cache-invalidation-hook-canary-alive' $$;

ALTER FUNCTION public.__cache_invalidation_hook_reload_canary__()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.__cache_invalidation_hook_reload_canary__()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.__cache_invalidation_hook_reload_canary__()
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
  request_role text := auth.role();
BEGIN
  IF request_role = 'anon' AND request_method = 'POST'
    AND request_path = '/rpc/__gigl_hook_reload_canary__' THEN
    RAISE EXCEPTION 'GIGL hook reload canary observed' USING ERRCODE = '42501';
  END IF;
  IF request_role = 'anon' AND request_method = 'POST'
    AND request_path = '/rpc/__blog_media_hook_reload_canary__' THEN
    RAISE EXCEPTION 'BLOG MEDIA hook reload canary observed' USING ERRCODE = '42501';
  END IF;
  IF request_role = 'anon' AND request_method = 'POST'
    AND request_path = '/rpc/__guest_cart_hook_reload_canary__' THEN
    RAISE EXCEPTION 'GUEST CART hook reload canary observed' USING ERRCODE = '42501';
  END IF;
  IF request_role = 'anon' AND request_method = 'POST'
    AND request_path = '/rpc/__guest_oauth_hook_reload_canary__' THEN
    RAISE EXCEPTION 'GUEST OAUTH hook reload canary observed' USING ERRCODE = '42501';
  END IF;
  IF request_role = 'anon' AND request_method = 'POST'
    AND request_path = '/rpc/__cache_invalidation_hook_reload_canary__' THEN
    RAISE EXCEPTION 'CACHE INVALIDATION hook reload canary observed' USING ERRCODE = '42501';
  END IF;

  IF request_role = 'gigl_tracking_worker' THEN
    IF request_method IS DISTINCT FROM 'POST' OR request_path IS NULL
      OR request_path NOT IN (
        '/rpc/gigl_worker_apply_tracking_result',
        '/rpc/gigl_worker_claim_due_tracking_monitors',
        '/rpc/gigl_worker_pause_tracking_monitor',
        '/rpc/gigl_worker_record_tracking_failure',
        '/rpc/gigl_worker_release_tracking_claim'
      ) THEN
      RAISE EXCEPTION 'GIGL worker request is outside its capability scope' USING ERRCODE = '42501';
    END IF;
  ELSIF request_role = 'blog_media_sweep_worker' THEN
    IF request_method IS DISTINCT FROM 'POST' OR request_path IS NULL
      OR request_path NOT IN (
        '/rpc/blog_media_sweep_worker_claim',
        '/rpc/blog_media_sweep_worker_release'
      ) THEN
      RAISE EXCEPTION 'Blog media worker request is outside its capability scope' USING ERRCODE = '42501';
    END IF;
  ELSIF request_role = 'mcp_guest_oauth_worker' THEN
    IF request_method IS DISTINCT FROM 'POST' OR request_path IS NULL
      OR request_path NOT IN (
        '/rpc/mcp_guest_oauth_read', '/rpc/mcp_guest_oauth_cas',
        '/rpc/mcp_guest_oauth_purge_expired', '/rpc/mcp_guest_oauth_seed_cart'
      ) THEN
      RAISE EXCEPTION 'Guest OAuth worker request is outside its capability scope' USING ERRCODE = '42501';
    END IF;
  ELSIF request_role = 'mcp_guest_cart_worker' THEN
    IF request_method IS DISTINCT FROM 'POST' OR request_path IS NULL
      OR request_path NOT IN (
        '/rpc/get_mcp_guest_cart',
        '/rpc/upsert_mcp_guest_cart',
        '/rpc/delete_mcp_guest_cart'
      ) THEN
      RAISE EXCEPTION 'Guest cart worker request is outside its capability scope' USING ERRCODE = '42501';
    END IF;
  ELSIF request_role = 'cache_invalidation_worker' THEN
    IF request_method IS DISTINCT FROM 'POST' OR request_path IS NULL
      OR request_path NOT IN (
        '/rpc/claim_cache_invalidations',
        '/rpc/finish_cache_invalidation',
        '/rpc/has_cache_invalidation_dead_letters'
      ) THEN
      RAISE EXCEPTION 'Cache invalidation worker request is outside its capability scope' USING ERRCODE = '42501';
    END IF;
  END IF;
END;
$$;

ALTER FUNCTION public.enforce_gigl_tracking_worker_request_scope()
  OWNER TO postgres;

DO $$
DECLARE
  installed_hook text;
BEGIN
  SELECT setting INTO installed_hook
  FROM pg_catalog.pg_db_role_setting AS role_setting
  JOIN pg_catalog.pg_roles AS role_record
    ON role_record.oid = role_setting.setrole
  CROSS JOIN LATERAL unnest(role_setting.setconfig) AS config_item(setting)
  WHERE role_record.rolname = 'authenticator'
    AND setting LIKE 'pgrst.db_pre_request=%'
  LIMIT 1;

  IF installed_hook IS NULL OR installed_hook <>
    'pgrst.db_pre_request=public.enforce_gigl_tracking_worker_request_scope'
  THEN
    RAISE EXCEPTION 'Expected the installed shared worker request-scope hook before extending it';
  END IF;
END;
$$;

-- Make any pre-provisioned JWT unusable until the fleet-wide reload probe
-- confirms that the new scope is active. A later activation must be gated by
-- that probe; do not add authenticator membership in this migration.
REVOKE cache_invalidation_worker FROM authenticator;
ALTER ROLE authenticator
  SET pgrst.db_pre_request = 'public.enforce_gigl_tracking_worker_request_scope';
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
