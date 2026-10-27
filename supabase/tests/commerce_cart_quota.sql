BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(27);
GRANT USAGE ON SCHEMA extensions TO commerce_cart_quota;

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
SELECT ok((public.increment_commerce_cart_quota()->>'resetTime')::bigint BETWEEN floor(extract(epoch FROM now())*1000)::bigint AND floor(extract(epoch FROM now())*1000)::bigint+61000,'expiry comes from the database clock');
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
SELECT set_config('request.jwt.claims', '{"role":"anon"}',true);
SELECT set_config('request.path','/rpc/__guest_oauth_hook_reload_canary__',true);
SELECT throws_ok('SELECT public.enforce_gigl_tracking_worker_request_scope()','42501','GUEST OAUTH hook reload canary observed','existing reload canary remains enforced');

SELECT * FROM finish();
ROLLBACK;
