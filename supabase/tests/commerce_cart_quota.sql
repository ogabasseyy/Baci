BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(37);
GRANT USAGE ON SCHEMA extensions TO commerce_cart_quota;

SELECT ok(
  position('commerce_cart_quota_request_scope_v1' IN pg_get_functiondef('public.enforce_gigl_tracking_worker_request_scope()'::regprocedure)) > 0
    AND position('request_role = ''cache_invalidation_worker''' IN pg_get_functiondef('public.enforce_gigl_tracking_worker_request_scope()'::regprocedure)) > 0,
  'shared request guard retains both quota and cache worker scopes'
);

SELECT ok(EXISTS(SELECT 1 FROM pg_roles WHERE rolname='commerce_cart_quota' AND NOT rolcanlogin AND NOT rolbypassrls), 'quota role cannot log in or bypass RLS');
SELECT ok(NOT has_schema_privilege('anon','cart_quota','USAGE'), 'anon cannot access private counter schema');
SELECT ok(NOT has_function_privilege('anon','public.increment_commerce_cart_quota()','EXECUTE'), 'anon cannot increment quotas');
SELECT ok(NOT has_function_privilege('authenticated','public.increment_commerce_cart_quota()','EXECUTE'), 'shopper sessions cannot increment quotas');
SELECT ok(NOT has_table_privilege('commerce_cart_quota','public.commerce_carts','SELECT'), 'quota role cannot read carts');
SELECT ok(NOT has_table_privilege('commerce_cart_quota','cart_quota.counters','DELETE'), 'quota role cannot clear counters');

SET LOCAL ROLE commerce_cart_quota;
SELECT set_config('request.jwt.claims', jsonb_build_object('role','commerce_cart_quota','cart_quota_key',repeat('a',64),'cart_quota_window_ms',60000,'iat',floor(extract(epoch FROM now())),'exp',floor(extract(epoch FROM now()))+60)::text,true);
SELECT is((public.increment_commerce_cart_quota()->>'count')::int,1,'first request starts at one');
SELECT is((public.increment_commerce_cart_quota()->>'count')::int,2,'next request increments the same window');
-- Create a fresh window after the delay, not relative to the transaction start.
SELECT set_config('request.jwt.claims', jsonb_build_object('role','commerce_cart_quota','cart_quota_key',repeat('f',64),'cart_quota_window_ms',60000,'iat',floor(extract(epoch FROM now())),'exp',floor(extract(epoch FROM now()))+60)::text,true);
SELECT pg_sleep(1.1);
WITH started AS MATERIALIZED (
  SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS started_ms
), incremented AS MATERIALIZED (
  SELECT started_ms,
    (public.increment_commerce_cart_quota()->>'resetTime')::bigint AS reset_at_ms
  FROM started
), finished AS MATERIALIZED (
  SELECT started_ms, reset_at_ms,
    floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS finished_ms
  FROM incremented
)
SELECT ok(
  reset_at_ms BETWEEN started_ms+60000 AND finished_ms+60000,
  'expiry comes from the database clock'
) FROM finished;
SELECT set_config('request.jwt.claims', jsonb_build_object('role','commerce_cart_quota','cart_quota_key',repeat('b',64),'cart_quota_window_ms',60000,'iat',floor(extract(epoch FROM now())),'exp',floor(extract(epoch FROM now()))+60)::text,true);
SELECT is((SELECT count(*)::int FROM cart_quota.counters),0,'a different scope cannot read the first counter');
SELECT is((public.increment_commerce_cart_quota()->>'count')::int,1,'a different scope has its own counter');
SELECT set_config('request.jwt.claims', jsonb_build_object('role','commerce_cart_quota','cart_quota_key',repeat('c',64),'cart_quota_window_ms',60000,'iat',floor(extract(epoch FROM now()))-61,'exp',floor(extract(epoch FROM now()))-1)::text,true);
SELECT throws_ok('SELECT public.increment_commerce_cart_quota()','42501','Invalid quota capability','expired capability fails closed');

SELECT set_config('request.jwt.claims', jsonb_build_object('role','commerce_cart_quota','cart_quota_key','invalid','cart_quota_window_ms',60000,'iat',floor(extract(epoch FROM now())),'exp',floor(extract(epoch FROM now()))+60)::text,true);
SELECT throws_ok('SELECT public.increment_commerce_cart_quota()','42501','Invalid quota capability','malformed counter keys fail closed');
SELECT set_config('request.jwt.claims', jsonb_build_object('role','commerce_cart_quota','cart_quota_key',repeat('d',64),'cart_quota_window_ms',3600001,'iat',floor(extract(epoch FROM now())),'exp',floor(extract(epoch FROM now()))+60)::text,true);
SELECT throws_ok('SELECT public.increment_commerce_cart_quota()','42501','Invalid quota capability','oversized windows fail closed');
SELECT set_config('request.jwt.claims', jsonb_build_object('role','commerce_cart_quota','cart_quota_key',repeat('d',64),'cart_quota_window_ms',60000,'iat',floor(extract(epoch FROM now())),'exp',floor(extract(epoch FROM now()))+3600)::text,true);
SELECT throws_ok('SELECT public.increment_commerce_cart_quota()','42501','Invalid quota capability','long-lived capabilities fail closed');
SELECT set_config('request.jwt.claims', jsonb_build_object('role','commerce_cart_quota','cart_quota_key',repeat('d',64),'cart_quota_window_ms',60000,'iat',floor(extract(epoch FROM now()))+30,'exp',floor(extract(epoch FROM now()))+90)::text,true);
SELECT throws_ok('SELECT public.increment_commerce_cart_quota()','42501','Invalid quota capability','future-issued capabilities fail closed');

RESET ROLE;
UPDATE cart_quota.counters SET expires_at=now()-interval '1 second' WHERE key=repeat('a',64);
SET LOCAL ROLE commerce_cart_quota;
SELECT set_config('request.jwt.claims', jsonb_build_object('role','commerce_cart_quota','cart_quota_key',repeat('a',64),'cart_quota_window_ms',60000,'iat',floor(extract(epoch FROM now())),'exp',floor(extract(epoch FROM now()))+60)::text,true);
SELECT is((public.increment_commerce_cart_quota()->>'count')::int,1,'expired windows restart atomically');
SELECT throws_ok('SELECT cart_quota.purge_expired(10000)','42501',NULL,'quota callers cannot invoke maintenance');

RESET ROLE;
INSERT INTO cart_quota.counters(key,window_ms,count,expires_at)
VALUES (repeat('e',64),60000,1,now()-interval '2 hours');
SELECT is(cart_quota.purge_expired(10000),1,'maintenance removes the expired synthetic counter');
SELECT is((SELECT count(*)::int FROM cart_quota.counters WHERE key IN (repeat('a',64),repeat('b',64))),2,'maintenance preserves current windows');

SELECT set_config('request.jwt.claims', '{"role":"commerce_cart_quota"}',true);
SELECT set_config('request.method','POST',true);
SELECT set_config('request.path','/rpc/increment_commerce_cart_quota',true);
SELECT lives_ok('SELECT public.enforce_gigl_tracking_worker_request_scope()','quota POST passes the existing request guard');
SELECT set_config('request.method','GET',true);
SELECT throws_ok('SELECT public.enforce_gigl_tracking_worker_request_scope()','42501','Cart quota request is outside its capability scope','quota GET cannot mutate through PostgREST');
SELECT set_config('request.method','POST',true);
SELECT set_config('request.path','/rpc/get_order_tracking',true);
SELECT throws_ok('SELECT public.enforce_gigl_tracking_worker_request_scope()','42501','Cart quota request is outside its capability scope','quota token cannot call unrelated PUBLIC RPCs');
SELECT set_config('request.jwt.claims', '{"role":"gigl_tracking_worker"}',true);
SELECT set_config('request.path','/rpc/gigl_worker_claim_due_tracking_monitors',true);
SELECT lives_ok('SELECT public.enforce_gigl_tracking_worker_request_scope()','existing GIGL request remains allowed');
SELECT set_config('request.path','/rpc/increment_commerce_cart_quota',true);
SELECT throws_ok('SELECT public.enforce_gigl_tracking_worker_request_scope()','42501','GIGL worker request is outside its capability scope','existing GIGL request isolation remains enforced');
SELECT set_config('request.jwt.claims', '{"role":"mcp_guest_oauth_worker"}',true);
SELECT throws_ok('SELECT public.enforce_gigl_tracking_worker_request_scope()','42501','Guest OAuth worker request is outside its capability scope','existing guest OAuth isolation remains enforced');
SELECT set_config('request.path','/rpc/mcp_guest_oauth_read',true);
SELECT lives_ok('SELECT public.enforce_gigl_tracking_worker_request_scope()','existing guest OAuth worker request remains allowed');
SELECT set_config('request.jwt.claims', '{"role":"blog_media_sweep_worker"}',true);
SELECT set_config('request.path','/rpc/blog_media_sweep_worker_claim',true);
SELECT lives_ok('SELECT public.enforce_gigl_tracking_worker_request_scope()','existing blog media worker request remains allowed');
SELECT set_config('request.path','/rpc/increment_commerce_cart_quota',true);
SELECT throws_ok('SELECT public.enforce_gigl_tracking_worker_request_scope()','42501','Blog media worker request is outside its capability scope','existing blog media worker isolation remains enforced');
SELECT set_config('request.jwt.claims', '{"role":"mcp_guest_cart_worker"}',true);
SELECT set_config('request.path','/rpc/get_mcp_guest_cart',true);
SELECT lives_ok('SELECT public.enforce_gigl_tracking_worker_request_scope()','existing MCP guest cart worker request remains allowed');
SELECT set_config('request.path','/rpc/increment_commerce_cart_quota',true);
SELECT throws_ok('SELECT public.enforce_gigl_tracking_worker_request_scope()','42501','Guest cart worker request is outside its capability scope','existing MCP guest cart worker isolation remains enforced');
SELECT set_config('request.jwt.claims', '{"role":"cache_invalidation_worker"}',true);
SELECT set_config('request.path','/rpc/claim_cache_invalidations',true);
SELECT lives_ok('SELECT public.enforce_gigl_tracking_worker_request_scope()','cache invalidation worker remains allowed by the shared guard');
SELECT set_config('request.path','/rpc/increment_commerce_cart_quota',true);
SELECT throws_ok('SELECT public.enforce_gigl_tracking_worker_request_scope()','42501','Cache invalidation worker request is outside its capability scope','cache worker remains confined to its own RPCs');
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}',true);
SELECT set_config('request.path','/rpc/ordinary_authenticated_rpc',true);
SELECT lives_ok('SELECT public.enforce_gigl_tracking_worker_request_scope()','ordinary authenticated requests remain allowed by the guard');
SELECT set_config('request.jwt.claims', '{"role":"anon"}',true);
SELECT set_config('request.path','/rpc/ordinary_anon_rpc',true);
SELECT lives_ok('SELECT public.enforce_gigl_tracking_worker_request_scope()','ordinary anonymous requests remain allowed by the guard');
SELECT set_config('request.path','/rpc/__guest_oauth_hook_reload_canary__',true);
SELECT throws_ok('SELECT public.enforce_gigl_tracking_worker_request_scope()','42501','GUEST OAUTH hook reload canary observed','existing reload canary remains enforced');

-- The replay runner uses psql rather than pg_prove, so failed TAP assertions
-- must become a SQL error for ON_ERROR_STOP to fail the release gate.
DO $$
DECLARE diagnostics text;
BEGIN
  SELECT string_agg(line, E'\n') INTO diagnostics FROM finish() AS line;
  IF diagnostics IS NOT NULL THEN
    RAISE EXCEPTION 'Cart quota SQL tests failed: %', diagnostics;
  END IF;
END $$;
ROLLBACK;
