-- MCP guest carts: RPC outcomes, version gate, expiry, retention, capacity,
-- and the worker-only privilege boundary. Assertion-specific SQLSTATEs
-- survive replay log sanitization without exposing row data. P1101..P1128
-- identify fixed assertions.
--
-- Privilege note: the boundary is asserted with has_*_privilege as the
-- session user, never by invoking a denied RPC as a denied role — denied
-- function calls are untestable that way (Supabase Postgres 17 aborts the
-- backend instead of raising 42501), and the grants ARE the boundary.
BEGIN;
DO $$
DECLARE
  v_version bigint;
  v_outcome text;
  v_count integer;
  v_items jsonb;
  v_expires timestamptz;
  v_deleted boolean;
  v_cleaned integer;
BEGIN
  -- Creation reports ok at version 1.
  SELECT version, outcome INTO v_version, v_outcome
  FROM public.upsert_mcp_guest_cart(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '[]', pg_catalog.now() + interval '7 days', NULL);
  IF v_version <> 1 OR v_outcome <> 'ok'
  THEN RAISE EXCEPTION USING ERRCODE = 'P1101', MESSAGE = 'cart creation failed'; END IF;

  -- Recreating the same token reports conflict, never overwrites.
  SELECT version, outcome INTO v_version, v_outcome
  FROM public.upsert_mcp_guest_cart(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '[]', pg_catalog.now() + interval '7 days', NULL);
  IF v_outcome <> 'conflict'
  THEN RAISE EXCEPTION USING ERRCODE = 'P1102', MESSAGE = 'creation conflict missed'; END IF;

  -- Get returns items, expiry, and version.
  SELECT items, expires_at, version INTO v_items, v_expires, v_version
  FROM public.get_mcp_guest_cart(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  IF NOT FOUND OR v_version <> 1
  THEN RAISE EXCEPTION USING ERRCODE = 'P1103', MESSAGE = 'cart get failed'; END IF;

  -- Get of an unknown token returns zero rows.
  SELECT count(*) INTO v_count FROM public.get_mcp_guest_cart(
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  IF v_count <> 0
  THEN RAISE EXCEPTION USING ERRCODE = 'P1104', MESSAGE = 'unknown token returned rows'; END IF;

  -- Update on the current version reports ok and bumps the version.
  SELECT version, outcome INTO v_version, v_outcome
  FROM public.upsert_mcp_guest_cart(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '[{"quantity":1}]', pg_catalog.now() + interval '7 days', 1);
  IF v_version <> 2 OR v_outcome <> 'ok'
  THEN RAISE EXCEPTION USING ERRCODE = 'P1105', MESSAGE = 'versioned update failed'; END IF;

  -- Update on a stale version reports conflict with the current version.
  SELECT version, outcome INTO v_version, v_outcome
  FROM public.upsert_mcp_guest_cart(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '[]', pg_catalog.now() + interval '7 days', 1);
  IF v_version <> 2 OR v_outcome <> 'conflict'
  THEN RAISE EXCEPTION USING ERRCODE = 'P1106', MESSAGE = 'stale update not detected'; END IF;

  -- Update of a missing token reports missing.
  SELECT outcome INTO v_outcome
  FROM public.upsert_mcp_guest_cart(
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    '[]', pg_catalog.now() + interval '7 days', 1);
  IF v_outcome <> 'missing'
  THEN RAISE EXCEPTION USING ERRCODE = 'P1107', MESSAGE = 'missing token not reported'; END IF;

  -- An expired row is never resurrected: update reports expired.
  SELECT outcome INTO v_outcome
  FROM public.upsert_mcp_guest_cart(
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    '[]', pg_catalog.now() - interval '1 day', NULL);
  IF v_outcome <> 'ok'
  THEN RAISE EXCEPTION USING ERRCODE = 'P1108', MESSAGE = 'expired fixture not stored'; END IF;
  SELECT outcome INTO v_outcome
  FROM public.upsert_mcp_guest_cart(
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    '[]', pg_catalog.now() + interval '7 days', 1);
  IF v_outcome <> 'expired'
  THEN RAISE EXCEPTION USING ERRCODE = 'P1109', MESSAGE = 'expired row resurrected'; END IF;

  -- Version-gated delete removes once, then reports false.
  SELECT public.delete_mcp_guest_cart(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 2) INTO v_deleted;
  IF v_deleted IS NOT TRUE
  THEN RAISE EXCEPTION USING ERRCODE = 'P1110', MESSAGE = 'versioned delete failed'; END IF;
  SELECT public.delete_mcp_guest_cart(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 2) INTO v_deleted;
  IF v_deleted IS NOT FALSE
  THEN RAISE EXCEPTION USING ERRCODE = 'P1111', MESSAGE = 'repeat delete reported true'; END IF;

  -- Malformed inputs raise 22023 instead of persisting.
  BEGIN
    PERFORM public.upsert_mcp_guest_cart('nope', '[]', pg_catalog.now(), NULL);
    RAISE EXCEPTION USING ERRCODE = 'P1112', MESSAGE = 'bad token accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
  END;
  BEGIN
    PERFORM public.upsert_mcp_guest_cart(
      'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      '{}', pg_catalog.now(), NULL);
    RAISE EXCEPTION USING ERRCODE = 'P1113', MESSAGE = 'non-array items accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
  END;

  -- Retention deletes expired rows only, honoring the batch cap.
  PERFORM public.upsert_mcp_guest_cart(
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    '[]', pg_catalog.now() - interval '1 hour', NULL);
  PERFORM public.upsert_mcp_guest_cart(
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    '[]', pg_catalog.now() + interval '7 days', NULL);
  SELECT public.cleanup_mcp_guest_carts(1) INTO v_cleaned;
  IF v_cleaned <> 1
  THEN RAISE EXCEPTION USING ERRCODE = 'P1114', MESSAGE = 'cleanup cap ignored'; END IF;
  SELECT count(*) INTO v_count FROM public.get_mcp_guest_cart(
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
  IF v_count <> 1
  THEN RAISE EXCEPTION USING ERRCODE = 'P1115', MESSAGE = 'cleanup took a live row'; END IF;
  SELECT public.cleanup_mcp_guest_carts(1000) INTO v_cleaned;
  IF v_cleaned <> 1
  THEN RAISE EXCEPTION USING ERRCODE = 'P1116', MESSAGE = 'cleanup residue remains'; END IF;

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

  -- The capacity gate is only exact when creations serialize: concurrent
  -- transactions would otherwise share one pre-insert count and breach
  -- the bound together. The replay harness is single-session, so the race
  -- itself is verified outside replay with two concurrent creators; this
  -- probe pins the lock in place so a later edit cannot silently drop
  -- the serialization the bound depends on.
  IF (SELECT pg_catalog.pg_get_functiondef(
      'public.upsert_mcp_guest_cart(text,jsonb,timestamptz,bigint)'::regprocedure)
    ) NOT LIKE '%pg_advisory_xact_lock%baci_mcp_guest_cart_capacity%'
  THEN RAISE EXCEPTION USING ERRCODE = 'P1128', MESSAGE = 'capacity lock missing'; END IF;

  -- The store caps carts at 20 lines: the 21st is rejected, the 20th kept.
  BEGIN
    PERFORM public.upsert_mcp_guest_cart(
      '1212121212121212121212121212121212121212121212121212121212121212',
      (SELECT jsonb_agg(jsonb_build_object('n', g)) FROM generate_series(1, 21) g),
      pg_catalog.now() + interval '7 days', NULL);
    RAISE EXCEPTION USING ERRCODE = 'P1122', MESSAGE = 'oversized cart accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
  END;
  SELECT outcome INTO v_outcome
  FROM public.upsert_mcp_guest_cart(
    '1313131313131313131313131313131313131313131313131313131313131313',
    (SELECT jsonb_agg(jsonb_build_object('n', g)) FROM generate_series(1, 20) g),
    pg_catalog.now() + interval '7 days', NULL);
  IF v_outcome <> 'ok'
  THEN RAISE EXCEPTION USING ERRCODE = 'P1123', MESSAGE = '20-line cart rejected'; END IF;

  -- Retention is bounded: far-future expiry is rejected.
  BEGIN
    PERFORM public.upsert_mcp_guest_cart(
      '1414141414141414141414141414141414141414141414141414141414141414',
      '[]', pg_catalog.now() + interval '30 days', NULL);
    RAISE EXCEPTION USING ERRCODE = 'P1124', MESSAGE = 'far-future expiry accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
  END;

  -- Global capacity: creations fail with 'full' at 50,000 rows while
  -- updates to existing carts keep working. Two fixture rows are live
  -- above ('ffff', '1313'), so 49,997 bulk rows reach 49,999 (ok) and
  -- one more reaches the ceiling (full).
  INSERT INTO public.mcp_guest_carts (token, items, expires_at)
  SELECT md5(g::text) || md5((g + 1)::text), '[]',
    pg_catalog.now() + interval '7 days'
  FROM generate_series(1, 49997) g;
  SELECT outcome INTO v_outcome
  FROM public.upsert_mcp_guest_cart(
    '1515151515151515151515151515151515151515151515151515151515151515',
    '[]', pg_catalog.now() + interval '7 days', NULL);
  IF v_outcome <> 'ok'
  THEN RAISE EXCEPTION USING ERRCODE = 'P1125', MESSAGE = 'creation refused below capacity'; END IF;
  SELECT outcome INTO v_outcome
  FROM public.upsert_mcp_guest_cart(
    '1616161616161616161616161616161616161616161616161616161616161616',
    '[]', pg_catalog.now() + interval '7 days', NULL);
  IF v_outcome <> 'full'
  THEN RAISE EXCEPTION USING ERRCODE = 'P1125', MESSAGE = 'capacity gate missed'; END IF;
  SELECT outcome INTO v_outcome
  FROM public.upsert_mcp_guest_cart(
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    '[]', pg_catalog.now() + interval '7 days', 1);
  IF v_outcome <> 'ok'
  THEN RAISE EXCEPTION USING ERRCODE = 'P1125', MESSAGE = 'update blocked at capacity'; END IF;

  -- A NULL expected version deletes unconditionally for corrupt rows.
  SELECT public.delete_mcp_guest_cart(
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', NULL)
  INTO v_deleted;
  IF v_deleted IS NOT TRUE
  THEN RAISE EXCEPTION USING ERRCODE = 'P1126', MESSAGE = 'unconditional delete failed'; END IF;
END $$;
ROLLBACK;
