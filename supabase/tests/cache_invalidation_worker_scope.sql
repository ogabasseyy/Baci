-- Run with a local database after migrations 20261028010000 and
-- 20261028020000 are applied. The test runs inside a transaction and rolls
-- back; it does not grant authenticator membership or create a token.
BEGIN;

DO $$
BEGIN
  IF pg_catalog.pg_has_role(
    'authenticator', 'cache_invalidation_worker', 'MEMBER'
  ) THEN
    RAISE EXCEPTION 'cache worker activation must remain separately gated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'cache_invalidation_worker'
      AND NOT rolcanlogin AND NOT rolbypassrls AND NOT rolinherit
      AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
  ) THEN
    RAISE EXCEPTION 'cache worker role is not restricted';
  END IF;
END
$$;

SET LOCAL ROLE cache_invalidation_worker;
SELECT pg_catalog.set_config(
  'request.jwt.claim.role', 'cache_invalidation_worker', true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims', '{"role":"cache_invalidation_worker"}', true
);
SELECT pg_catalog.set_config('request.method', 'POST', true);
SELECT pg_catalog.set_config(
  'request.path', '/rpc/has_cache_invalidation_dead_letters', true
);
SELECT public.enforce_gigl_tracking_worker_request_scope();
SELECT public.has_cache_invalidation_dead_letters();

DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.cache_invalidation_outbox LIMIT 1;
    RAISE EXCEPTION 'cache worker unexpectedly has direct table access';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM = 'cache worker unexpectedly has direct table access' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.enqueue_cache_invalidation_target(
      NULL::uuid, 'storefront_slug', 'not-a-real-tenant',
      ARRAY[]::text[], ARRAY[]::text[]
    );
    RAISE EXCEPTION 'cache worker unexpectedly has enqueue RPC access';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM = 'cache worker unexpectedly has enqueue RPC access' THEN
      RAISE;
    END IF;
  END;
END
$$;

SELECT pg_catalog.set_config('request.method', 'GET', true);
SELECT pg_catalog.set_config('request.path', '/products', true);
DO $$
BEGIN
  BEGIN
    PERFORM public.enforce_gigl_tracking_worker_request_scope();
    RAISE EXCEPTION 'cache worker out-of-scope request unexpectedly passed';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE '%Cache invalidation worker request is outside its capability scope%' THEN
      RAISE;
    END IF;
  END;
END
$$;

RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'anon', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT pg_catalog.set_config('request.method', 'POST', true);
SELECT pg_catalog.set_config(
  'request.path', '/rpc/__cache_invalidation_hook_reload_canary__', true
);
DO $$
BEGIN
  BEGIN
    PERFORM public.enforce_gigl_tracking_worker_request_scope();
    RAISE EXCEPTION 'cache worker hook reload canary was not intercepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE '%CACHE INVALIDATION hook reload canary observed%' THEN
      RAISE;
    END IF;
  END;
END
$$;

ROLLBACK;
