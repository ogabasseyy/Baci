-- Contract test: the database authority of the PiggyVest webhook capture
-- drain (R5).
--
-- Proves, against live PostgreSQL and through the catalog only:
--   * piggyvest_webhook_capture_worker exists, cannot log in, holds no
--     elevated attribute and is a member of no other role;
--   * it may lease, settle and count captures (claim / claim-bound
--     resolve / status) and nothing else: not the shared resolve function
--     (whose tokenless branch is the web receiver's), no capture, no
--     evidence trigger, no table or column privilege, no other schema
--     object granted to it here;
--   * everything it can use through PUBLIC as well is what anon can use
--     plus those three entry points (the PUBLIC-derived privileges every
--     login that inherits the role gets), and PUBLIC holds nothing on the
--     capture table;
--   * the claim-bound resolve refuses a call without a claim token;
--   * the functions it may run are SECURITY DEFINER with a pinned
--     search_path, and their ACLs name exactly the intended grantees (the
--     claim-bound resolve: the worker only), with no PUBLIC, anon or
--     authenticated entry;
--   * no login is a member of the worker yet: the drain login is
--     provisioned later from the runbook, so the migration alone leaves
--     the drain dark.
--
-- Denials are asserted through the catalog, never by calling a denied
-- object (a denied EXECUTE cannot be trapped on the pinned replay image),
-- and the suite never SETs ROLE into the new role (the managed replay
-- administrator cannot). The claim/resolve/status behaviour itself is
-- covered by piggyvest_webhook_durable_capture.sql, and the drain's session
-- check by piggyvest_webhook_capture_drain_session_check.sql.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/piggyvest_webhook_capture_worker_role.sql

BEGIN;

-- The role itself (ZROL1 missing, ZROL2 elevated, ZROL3 nested membership).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'piggyvest_webhook_capture_worker'
  ) THEN
    RAISE EXCEPTION 'piggyvest_webhook_capture_worker is missing' USING ERRCODE = 'ZROL1';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'piggyvest_webhook_capture_worker'
      AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb
        OR rolcreaterole OR rolreplication)
  ) THEN
    RAISE EXCEPTION 'piggyvest_webhook_capture_worker must be NOLOGIN and non-elevated'
      USING ERRCODE = 'ZROL2';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles r ON r.oid = m.member
    WHERE r.rolname = 'piggyvest_webhook_capture_worker'
  ) THEN
    RAISE EXCEPTION 'piggyvest_webhook_capture_worker must not be a member of another role'
      USING ERRCODE = 'ZROL3';
  END IF;
END
$$;

-- What the worker may run (ZGRT1) and what it must not (ZGRT2..ZGRT4).
-- The shared resolve function is denied: its tokenless branch can close a
-- row nobody leased, including a needs_review row.
DO $$
DECLARE
  v_fn regprocedure;
  v_privilege text;
BEGIN
  IF NOT pg_catalog.has_schema_privilege('piggyvest_webhook_capture_worker', 'public', 'USAGE') THEN
    RAISE EXCEPTION 'the worker needs USAGE on schema public' USING ERRCODE = 'ZGRT1';
  END IF;
  FOREACH v_fn IN ARRAY ARRAY[
    'public.claim_piggyvest_webhook_captures(integer,integer,integer)'::regprocedure,
    'public.resolve_claimed_piggyvest_webhook_capture(uuid,uuid,text,text)'::regprocedure,
    'public.piggyvest_webhook_capture_status()'::regprocedure
  ] LOOP
    IF NOT pg_catalog.has_function_privilege('piggyvest_webhook_capture_worker', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'the worker must execute %', v_fn USING ERRCODE = 'ZGRT1';
    END IF;
  END LOOP;

  FOREACH v_fn IN ARRAY ARRAY[
    'public.resolve_piggyvest_webhook_capture(uuid,uuid,text,text)'::regprocedure,
    'public.capture_piggyvest_webhook_delivery(jsonb)'::regprocedure,
    'public.piggyvest_webhook_captures_immutable_evidence()'::regprocedure
  ] LOOP
    IF pg_catalog.has_function_privilege('piggyvest_webhook_capture_worker', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'the worker must not execute %', v_fn USING ERRCODE = 'ZGRT2';
    END IF;
  END LOOP;

  FOREACH v_privilege IN ARRAY
    ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
  LOOP
    IF pg_catalog.has_table_privilege('piggyvest_webhook_capture_worker',
      'public.piggyvest_webhook_captures'::regclass, v_privilege) THEN
      RAISE EXCEPTION 'the worker must not hold % on piggyvest_webhook_captures', v_privilege
        USING ERRCODE = 'ZGRT3';
    END IF;
  END LOOP;
  IF pg_catalog.has_any_column_privilege('piggyvest_webhook_capture_worker',
    'public.piggyvest_webhook_captures'::regclass, 'SELECT, INSERT, UPDATE, REFERENCES') THEN
    RAISE EXCEPTION 'the worker holds a column-level grant on piggyvest_webhook_captures'
      USING ERRCODE = 'ZGRT3';
  END IF;

  -- Nothing else in public was granted to the worker by name: only the
  -- three drain functions carry an ACL entry for it.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace,
      LATERAL pg_catalog.aclexplode(p.proacl) AS acl
    WHERE n.nspname = 'public'
      AND acl.grantee = 'piggyvest_webhook_capture_worker'::regrole
      AND p.oid NOT IN (
        'public.claim_piggyvest_webhook_captures(integer,integer,integer)'::regprocedure,
        'public.resolve_claimed_piggyvest_webhook_capture(uuid,uuid,text,text)'::regprocedure,
        'public.piggyvest_webhook_capture_status()'::regprocedure
      )
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace,
      LATERAL pg_catalog.aclexplode(c.relacl) AS acl
    WHERE n.nspname = 'public'
      AND acl.grantee = 'piggyvest_webhook_capture_worker'::regrole
  ) THEN
    RAISE EXCEPTION 'the worker holds a grant beyond the three drain entry points'
      USING ERRCODE = 'ZGRT4';
  END IF;
END
$$;

-- Everything the worker can use through any route, PUBLIC included, is what
-- anon can use plus the three drain entry points (ZGRT5).
\ir piggyvest_webhook_capture_worker_privilege_comparison.inc.sql

-- The functions the worker reaches stay definer functions with a pinned
-- search_path (ZDEF1), and every ACL names exactly the intended grantees
-- (ZACL1). The owner and superusers are left out of the comparison (they
-- execute regardless); a missing ACL is read through acldefault, so it
-- counts as the default PUBLIC grant rather than as "no grantees".
DO $$
DECLARE
  v_fn regprocedure;
  v_grantees text[];
  v_expected text[];
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.claim_piggyvest_webhook_captures(integer,integer,integer)'::regprocedure,
    'public.resolve_piggyvest_webhook_capture(uuid,uuid,text,text)'::regprocedure,
    'public.resolve_claimed_piggyvest_webhook_capture(uuid,uuid,text,text)'::regprocedure,
    'public.piggyvest_webhook_capture_status()'::regprocedure,
    'public.capture_piggyvest_webhook_delivery(jsonb)'::regprocedure
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid = v_fn
        AND p.prosecdef
        AND p.proconfig = ARRAY['search_path=pg_catalog']
    ) THEN
      RAISE EXCEPTION '% must stay SECURITY DEFINER with search_path=pg_catalog', v_fn
        USING ERRCODE = 'ZDEF1';
    END IF;

    SELECT array_agg(DISTINCT named.grantee ORDER BY named.grantee)
      INTO v_grantees
      FROM (
        SELECT CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
            ELSE pg_catalog.pg_get_userbyid(acl.grantee) END AS grantee
        FROM pg_catalog.pg_proc p
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
        LEFT JOIN pg_catalog.pg_roles grantee_role ON grantee_role.oid = acl.grantee
        WHERE p.oid = v_fn
          AND acl.privilege_type = 'EXECUTE'
          AND acl.grantee <> p.proowner
          AND NOT COALESCE(grantee_role.rolsuper, false)
      ) AS named;

    v_expected := CASE
      WHEN v_fn IN (
        'public.capture_piggyvest_webhook_delivery(jsonb)'::regprocedure,
        'public.resolve_piggyvest_webhook_capture(uuid,uuid,text,text)'::regprocedure
      ) THEN ARRAY['service_role']
      WHEN v_fn = 'public.resolve_claimed_piggyvest_webhook_capture(uuid,uuid,text,text)'::regprocedure
        THEN ARRAY['piggyvest_webhook_capture_worker']
      ELSE ARRAY['piggyvest_webhook_capture_worker', 'service_role']
    END;

    IF v_grantees IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION '% execute grantees are %, expected %', v_fn, v_grantees, v_expected
        USING ERRCODE = 'ZACL1';
    END IF;
  END LOOP;

  FOREACH v_fn IN ARRAY ARRAY[
    'public.claim_piggyvest_webhook_captures(integer,integer,integer)'::regprocedure,
    'public.resolve_piggyvest_webhook_capture(uuid,uuid,text,text)'::regprocedure,
    'public.resolve_claimed_piggyvest_webhook_capture(uuid,uuid,text,text)'::regprocedure,
    'public.piggyvest_webhook_capture_status()'::regprocedure,
    'public.capture_piggyvest_webhook_delivery(jsonb)'::regprocedure
  ] LOOP
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
      OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'an API role can execute %', v_fn USING ERRCODE = 'ZACL2';
    END IF;
  END LOOP;
END
$$;

-- Dark until the runbook: the migration alone creates no drain login and
-- gives no login the worker's privileges (ZDRK1). An administrator
-- membership (admin_option, which PostgreSQL 16+ grants to the role that
-- ran CREATE ROLE) manages the role; it is not the drain login.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'baci_piggyvest_webhook_capture_drain'
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles member_role ON member_role.oid = m.member
    WHERE m.roleid = 'piggyvest_webhook_capture_worker'::regrole
      AND member_role.rolcanlogin
      AND NOT m.admin_option
  ) THEN
    RAISE EXCEPTION 'a login is already a member of piggyvest_webhook_capture_worker'
      USING ERRCODE = 'ZDRK1';
  END IF;
END
$$;

-- The claim-bound resolve refuses a call without a claim token before the
-- shared function is reached (ZCLM1). Run as the replay administrator; the
-- raised error is the function's own, so it is trappable.
DO $$
BEGIN
  BEGIN
    PERFORM public.resolve_claimed_piggyvest_webhook_capture(
      gen_random_uuid(), NULL, 'processed', NULL);
    RAISE EXCEPTION 'a tokenless claim-bound resolve was accepted' USING ERRCODE = 'ZCLM1';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;
END
$$;

ROLLBACK;
