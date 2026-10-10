-- MCP guest carts: the worker-only privilege boundary. Assertion-specific
-- SQLSTATEs survive replay log sanitization without exposing row data.
-- P1117..P1121, P1127, P1129 identify fixed assertions.
--
-- Privilege note: the boundary is asserted with has_*_privilege as the
-- session user, never by invoking a denied RPC as a denied role — denied
-- function calls are untestable that way (Supabase Postgres 17 aborts the
-- backend instead of raising 42501), and the grants ARE the boundary.

BEGIN;
DO $$
DECLARE
  v_denied boolean;
  v_message text;
BEGIN
  -- The anon key is publicly distributed: anon holds EXECUTE on nothing,
  -- so direct writes cannot bypass the MCP server quota.
  IF has_function_privilege('anon',
      'public.get_mcp_guest_cart(text)'::regprocedure, 'EXECUTE')
    IS DISTINCT FROM FALSE
    OR has_function_privilege('anon',
      'public.upsert_mcp_guest_cart(text,jsonb,timestamptz,bigint)'::regprocedure,
      'EXECUTE') IS DISTINCT FROM FALSE
    OR has_function_privilege('anon',
      'public.delete_mcp_guest_cart(text,bigint)'::regprocedure,
      'EXECUTE') IS DISTINCT FROM FALSE
    OR has_function_privilege('anon',
      'public.cleanup_mcp_guest_carts(integer)'::regprocedure,
      'EXECUTE') IS DISTINCT FROM FALSE
  THEN RAISE EXCEPTION USING ERRCODE = 'P1117', MESSAGE = 'anon holds cart RPC access'; END IF;

  -- Authenticated callers share the public client: same denial.
  IF has_function_privilege('authenticated',
      'public.get_mcp_guest_cart(text)'::regprocedure, 'EXECUTE')
    IS DISTINCT FROM FALSE
    OR has_function_privilege('authenticated',
      'public.upsert_mcp_guest_cart(text,jsonb,timestamptz,bigint)'::regprocedure,
      'EXECUTE') IS DISTINCT FROM FALSE
    OR has_function_privilege('authenticated',
      'public.delete_mcp_guest_cart(text,bigint)'::regprocedure,
      'EXECUTE') IS DISTINCT FROM FALSE
    OR has_function_privilege('authenticated',
      'public.cleanup_mcp_guest_carts(integer)'::regprocedure,
      'EXECUTE') IS DISTINCT FROM FALSE
  THEN RAISE EXCEPTION USING ERRCODE = 'P1118', MESSAGE = 'authenticated holds cart RPC access'; END IF;

  -- The table itself stays unreachable: no DML for anon or authenticated.
  IF has_table_privilege('anon', 'public.mcp_guest_carts',
      'SELECT, INSERT, UPDATE, DELETE') IS DISTINCT FROM FALSE
    OR has_table_privilege('authenticated', 'public.mcp_guest_carts',
      'SELECT, INSERT, UPDATE, DELETE') IS DISTINCT FROM FALSE
  THEN RAISE EXCEPTION USING ERRCODE = 'P1119', MESSAGE = 'cart table directly reachable'; END IF;

  -- The worker role operates the caller RPCs; retention is not its job.
  IF has_function_privilege('mcp_guest_cart_worker',
      'public.get_mcp_guest_cart(text)'::regprocedure, 'EXECUTE')
    IS DISTINCT FROM TRUE
    OR has_function_privilege('mcp_guest_cart_worker',
      'public.upsert_mcp_guest_cart(text,jsonb,timestamptz,bigint)'::regprocedure,
      'EXECUTE') IS DISTINCT FROM TRUE
    OR has_function_privilege('mcp_guest_cart_worker',
      'public.delete_mcp_guest_cart(text,bigint)'::regprocedure,
      'EXECUTE') IS DISTINCT FROM TRUE
    OR has_function_privilege('mcp_guest_cart_worker',
      'public.cleanup_mcp_guest_carts(integer)'::regprocedure,
      'EXECUTE') IS DISTINCT FROM FALSE
  THEN RAISE EXCEPTION USING ERRCODE = 'P1120', MESSAGE = 'worker RPC scope wrong'; END IF;

  -- The service key bypasses all RLS, so it holds no caller RPCs either:
  -- user-facing cart operations run as the worker, never as service_role.
  -- Retention stays service-executable for the pg_cron schedule.
  IF has_function_privilege('service_role',
      'public.get_mcp_guest_cart(text)'::regprocedure, 'EXECUTE')
    IS DISTINCT FROM FALSE
    OR has_function_privilege('service_role',
      'public.upsert_mcp_guest_cart(text,jsonb,timestamptz,bigint)'::regprocedure,
      'EXECUTE') IS DISTINCT FROM FALSE
    OR has_function_privilege('service_role',
      'public.delete_mcp_guest_cart(text,bigint)'::regprocedure,
      'EXECUTE') IS DISTINCT FROM FALSE
    OR has_function_privilege('service_role',
      'public.cleanup_mcp_guest_carts(integer)'::regprocedure,
      'EXECUTE') IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION USING ERRCODE = 'P1121', MESSAGE = 'service_role RPC scope wrong'; END IF;

  -- PostgREST serves every request as authenticator and SET ROLEs to the
  -- JWT claim: without membership the gateway cannot assume the worker
  -- role and the worker EXECUTE grants above are unreachable in
  -- production. (Asserted as the session user, like the grants: invoking
  -- a denied path as another role aborts the Supabase backend.)
  IF pg_catalog.pg_has_role('authenticator', 'mcp_guest_cart_worker',
      'MEMBER') IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION USING ERRCODE = 'P1127', MESSAGE = 'authenticator cannot assume worker role'; END IF;


  -- The pre-request hook confines the worker role to the three cart
  -- RPCs: a leaked token inherits PUBLIC EXECUTE, so the allowlist —
  -- not the grants — is the PostgREST boundary. Executed with faked
  -- request settings, mirroring the blog-media scope check: the
  -- session user invokes the hook, never a denied role, so the
  -- backend stays up and denials surface as 42501.
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'mcp_guest_cart_worker', true);
  PERFORM pg_catalog.set_config('request.method', 'POST', true);
  BEGIN
    PERFORM pg_catalog.set_config('request.path', '/rpc/get_mcp_guest_cart', true);
    PERFORM public.enforce_gigl_tracking_worker_request_scope();
    PERFORM pg_catalog.set_config('request.path', '/rpc/upsert_mcp_guest_cart', true);
    PERFORM public.enforce_gigl_tracking_worker_request_scope();
    PERFORM pg_catalog.set_config('request.path', '/rpc/delete_mcp_guest_cart', true);
    PERFORM public.enforce_gigl_tracking_worker_request_scope();
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION USING ERRCODE = 'P1129', MESSAGE = 'worker scope refused an allowed path';
  END;
  -- Retention stays out of the worker allowlist: pg_cron runs it as
  -- the schedule owner, never through a worker JWT.
  PERFORM pg_catalog.set_config('request.path', '/rpc/cleanup_mcp_guest_carts', true);
  v_denied := FALSE;
  BEGIN
    PERFORM public.enforce_gigl_tracking_worker_request_scope();
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_denied := (v_message = 'Guest cart worker request is outside its capability scope');
  END;
  IF NOT v_denied
  THEN RAISE EXCEPTION USING ERRCODE = 'P1129', MESSAGE = 'worker request scope wrong'; END IF;
  -- The reload canary shadows for anonymous callers.
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'anon', true);
  PERFORM pg_catalog.set_config('request.path', '/rpc/__guest_cart_hook_reload_canary__', true);
  v_denied := FALSE;
  BEGIN
    PERFORM public.enforce_gigl_tracking_worker_request_scope();
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_denied := (v_message = 'GUEST CART hook reload canary observed');
  END;
  IF NOT v_denied
  THEN RAISE EXCEPTION USING ERRCODE = 'P1129', MESSAGE = 'worker canary not shadowing'; END IF;

END $$;
ROLLBACK;
