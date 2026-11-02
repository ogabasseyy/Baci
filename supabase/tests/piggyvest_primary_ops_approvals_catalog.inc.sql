-- Part of piggyvest_primary_ops_approvals.sql (\ir): catalog and privilege
-- contract. Runs inside the entry file's rolled-back transaction.
--
-- Denials are asserted through the catalog (has_*_privilege, aclexplode),
-- never by calling a denied object as another role: on the pinned replay
-- image a denied EXECUTE cannot be trapped by an exception handler.

-- The approver role: NOLOGIN, no elevated attribute, member of nothing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'piggyvest_primary_approver'
      AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreaterole
      AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls
  ) THEN
    RAISE EXCEPTION 'piggyvest_primary_approver must exist as a plain NOLOGIN role';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members m
    WHERE m.member = 'piggyvest_primary_approver'::regrole
  ) THEN
    RAISE EXCEPTION 'piggyvest_primary_approver must not be a member of any role';
  END IF;
END
$$;

-- Tables: RLS with a restrictive deny-all policy, no privilege for API roles
-- or the approver role (it reads and writes only through the functions).
DO $$
DECLARE
  v_table text;
  v_role text;
  v_privilege text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'ops_approval_actions', 'ops_approval_requests', 'ops_approvals', 'ops_login_humans'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      WHERE c.oid = pg_catalog.to_regclass('piggyvest_primary.' || v_table)
        AND c.relrowsecurity
    ) OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies p
      WHERE p.schemaname = 'piggyvest_primary' AND p.tablename = v_table
        AND p.permissive = 'RESTRICTIVE' AND p.qual = 'false'
        AND p.with_check = 'false' AND p.roles = ARRAY['public']::name[]
    ) THEN
      RAISE EXCEPTION '% must have RLS with a restrictive deny-all policy', v_table;
    END IF;
    FOREACH v_role IN ARRAY ARRAY[
      'anon', 'authenticated', 'service_role', 'piggyvest_primary_approver'
    ] LOOP
      FOREACH v_privilege IN ARRAY ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
      ] LOOP
        IF pg_catalog.has_table_privilege(v_role, 'piggyvest_primary.' || v_table, v_privilege) THEN
          RAISE EXCEPTION '% must not hold % on %', v_role, v_privilege, v_table;
        END IF;
      END LOOP;
      IF pg_catalog.has_any_column_privilege(v_role, 'piggyvest_primary.' || v_table,
        'SELECT, INSERT, UPDATE, REFERENCES') THEN
        RAISE EXCEPTION '% holds a column grant on %', v_role, v_table;
      END IF;
    END LOOP;
  END LOOP;
END
$$;

-- Schemas: the approver uses piggyvest_approvals only; API roles use neither.
DO $$
DECLARE
  v_role text;
BEGIN
  IF NOT pg_catalog.has_schema_privilege('piggyvest_primary_approver', 'piggyvest_approvals', 'USAGE')
     OR pg_catalog.has_schema_privilege('piggyvest_primary_approver', 'piggyvest_primary', 'USAGE') THEN
    RAISE EXCEPTION 'the approver role must use piggyvest_approvals and not piggyvest_primary';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF pg_catalog.has_schema_privilege(v_role, 'piggyvest_approvals', 'USAGE')
       OR pg_catalog.has_schema_privilege(v_role, 'piggyvest_approvals', 'CREATE') THEN
      RAISE EXCEPTION '% must not use piggyvest_approvals', v_role;
    END IF;
  END LOOP;
END
$$;

-- Functions: the two approver entry points are executable by the approver
-- role alone; every other ops function (open, consume, helpers, guards) by
-- nobody but its owner. All are owned by the migration role and pin
-- search_path to pg_catalog, then pg_temp last, so a caller's temporary
-- types or tables can never stand in for a built-in one. No function takes
-- an approver name.
DO $$
DECLARE
  v_fn record;
  v_role text;
  v_approver_fn boolean;
BEGIN
  FOR v_fn IN
    SELECT p.oid, p.oid::regprocedure::text AS signature, p.prosecdef, p.proconfig,
      p.proowner, p.proargnames, p.proargtypes, p.proacl
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'piggyvest_approvals'
       OR (n.nspname = 'piggyvest_primary'
         AND (p.proname LIKE 'ops\_%' OR p.proname IN ('open_ops_request', 'consume_two_approvals')))
  LOOP
    v_approver_fn := v_fn.signature IN (
      'piggyvest_approvals.approve_ops_request(uuid,text,bigint,text)',
      'piggyvest_approvals.list_open_ops_requests()');
    IF pg_catalog.has_function_privilege('piggyvest_primary_approver', v_fn.oid, 'EXECUTE') <> v_approver_fn THEN
      RAISE EXCEPTION 'approver EXECUTE on % must be %', v_fn.signature, v_approver_fn;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF pg_catalog.has_function_privilege(v_role, v_fn.oid, 'EXECUTE') THEN
        RAISE EXCEPTION '% must not execute %', v_role, v_fn.signature;
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(v_fn.proacl) a WHERE a.grantee = 0) THEN
      RAISE EXCEPTION 'PUBLIC must not execute %', v_fn.signature;
    END IF;
    IF pg_catalog.pg_get_userbyid(v_fn.proowner) <> current_user
       OR v_fn.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp'] THEN
      RAISE EXCEPTION '% must be owned by the migration role with search_path = pg_catalog, pg_temp',
        v_fn.signature;
    END IF;
    -- The eligibility helpers take a role oid (to re-check stored decisions
    -- at consume time, and the requester's own login); they are granted to
    -- nobody. Every request and decision function takes no identity at all.
    IF v_fn.signature NOT IN ('piggyvest_primary.ops_login_is_approver(oid)',
                              'piggyvest_primary.ops_login_is_requester(oid)',
                              'piggyvest_primary.ops_human_of(oid)') AND (
       EXISTS (SELECT 1 FROM pg_catalog.unnest(COALESCE(v_fn.proargnames, ARRAY[]::text[])) a
               WHERE a ~* '(approver|login|user|role)')
       OR 'oid'::regtype::oid = ANY (v_fn.proargtypes::oid[])
       OR 'name'::regtype::oid = ANY (v_fn.proargtypes::oid[])
       OR 'regrole'::regtype::oid = ANY (v_fn.proargtypes::oid[])) THEN
      RAISE EXCEPTION '% must not take an approver identity argument', v_fn.signature;
    END IF;
  END LOOP;
  FOREACH v_role IN ARRAY ARRAY[
    'piggyvest_approvals.approve_ops_request(uuid,text,bigint,text)',
    'piggyvest_approvals.list_open_ops_requests()',
    'piggyvest_primary.open_ops_request(text,text,uuid,bigint,bigint,jsonb,jsonb)',
    'piggyvest_primary.consume_two_approvals(text,text,uuid,bigint,bigint,jsonb)'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                   WHERE p.oid = pg_catalog.to_regprocedure(v_role) AND p.prosecdef) THEN
      RAISE EXCEPTION '% must exist as SECURITY DEFINER', v_role;
    END IF;
  END LOOP;
END
$$;

-- The only explicit grants the approver role holds anywhere are the two
-- entry points and its schema usage.
DO $$
BEGIN
  IF (SELECT pg_catalog.array_agg(p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text)
      FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
      WHERE a.grantee = 'piggyvest_primary_approver'::regrole)
     IS DISTINCT FROM ARRAY[
       'piggyvest_approvals.approve_ops_request(uuid,text,bigint,text)',
       'piggyvest_approvals.list_open_ops_requests()'] THEN
    RAISE EXCEPTION 'the approver role must hold exactly two function grants';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c, pg_catalog.aclexplode(c.relacl) a
             WHERE a.grantee = 'piggyvest_primary_approver'::regrole) THEN
    RAISE EXCEPTION 'the approver role must hold no table grants';
  END IF;
END
$$;

-- Seeded actions and the binding constraints.
DO $$
BEGIN
  IF (SELECT pg_catalog.array_agg(action ORDER BY action) FROM piggyvest_primary.ops_approval_actions)
     IS DISTINCT FROM ARRAY[
       'checkout_tender_review_resolve', 'goal_residual_review', 'misrouted_interest_resolve',
       'obligation_approve', 'obligation_reject', 'onboarding_adopt', 'support_payout',
       'transfer_review_resolve', 'treasury_sweep'] THEN
    RAISE EXCEPTION 'ops_approval_actions must hold exactly the nine seeded actions';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                 WHERE conname = 'ops_approvals_request_approver_key' AND contype = 'u')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                    WHERE conname = 'ops_approvals_request_role_key' AND contype = 'u')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                    WHERE conname = 'ops_approvals_request_human_key' AND contype = 'u')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                    WHERE conname = 'ops_approval_requests_digest_check' AND contype = 'c') THEN
    RAISE EXCEPTION 'ops approval uniqueness and digest constraints are missing';
  END IF;
END
$$;

-- Approver eligibility, decided from the catalog. A plain login holding only
-- the approver role qualifies; an extra (engine) membership, ADMIN OPTION on
-- the approver role, CREATEROLE, CREATEDB, the owner and the NOLOGIN role do
-- not, and neither does anyone once the approver role itself can log in or
-- is a member of another role.
CREATE ROLE pvops_catalog_login LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT piggyvest_primary_approver TO pvops_catalog_login;
DO $$
BEGIN
  IF NOT piggyvest_primary.ops_login_is_approver('pvops_catalog_login'::regrole) THEN
    RAISE EXCEPTION 'a login holding only the approver role must qualify';
  END IF;
  IF piggyvest_primary.ops_login_is_approver('piggyvest_primary_approver'::regrole)
     OR piggyvest_primary.ops_login_is_approver(current_user::text::regrole) THEN
    RAISE EXCEPTION 'the NOLOGIN role and the migration owner must never qualify';
  END IF;
  -- Opening a request needs a dedicated login: not the owner, not a NOLOGIN
  -- role, not a shared API login such as PostgREST's authenticator.
  IF NOT piggyvest_primary.ops_login_is_requester('pvops_catalog_login'::regrole) THEN
    RAISE EXCEPTION 'a plain dedicated login must be able to open requests';
  END IF;
  IF piggyvest_primary.ops_login_is_requester(current_user::text::regrole)
     OR piggyvest_primary.ops_login_is_requester('piggyvest_primary_approver'::regrole)
     OR piggyvest_primary.ops_login_is_requester('authenticator'::regrole) THEN
    RAISE EXCEPTION 'the owner, a NOLOGIN role and the shared API login must never open requests';
  END IF;
END
$$;
ALTER ROLE pvops_catalog_login CREATEROLE;
DO $$
BEGIN
  IF piggyvest_primary.ops_login_is_approver('pvops_catalog_login'::regrole)
     OR piggyvest_primary.ops_login_is_requester('pvops_catalog_login'::regrole) THEN
    RAISE EXCEPTION 'CREATEROLE must disqualify an approver and a requester';
  END IF;
END
$$;
ALTER ROLE pvops_catalog_login NOCREATEROLE CREATEDB;
DO $$
BEGIN
  IF piggyvest_primary.ops_login_is_approver('pvops_catalog_login'::regrole)
     OR piggyvest_primary.ops_login_is_requester('pvops_catalog_login'::regrole) THEN
    RAISE EXCEPTION 'CREATEDB must disqualify an approver and a requester';
  END IF;
END
$$;
ALTER ROLE pvops_catalog_login NOCREATEDB;
GRANT piggyvest_primary_evidence TO piggyvest_primary_approver;
DO $$
BEGIN
  IF piggyvest_primary.ops_login_is_approver('pvops_catalog_login'::regrole) THEN
    RAISE EXCEPTION 'a membership held by the approver role itself must disqualify every approver';
  END IF;
END
$$;
REVOKE piggyvest_primary_evidence FROM piggyvest_primary_approver;
ALTER ROLE piggyvest_primary_approver LOGIN;
DO $$
BEGIN
  IF piggyvest_primary.ops_login_is_approver('pvops_catalog_login'::regrole) THEN
    RAISE EXCEPTION 'an approver role that can log in must disqualify every approver';
  END IF;
END
$$;
ALTER ROLE piggyvest_primary_approver NOLOGIN;
DO $$
BEGIN
  IF NOT piggyvest_primary.ops_login_is_approver('pvops_catalog_login'::regrole) THEN
    RAISE EXCEPTION 'the plain approver login must qualify again';
  END IF;
END
$$;
GRANT piggyvest_primary_evidence TO pvops_catalog_login;
DO $$
BEGIN
  IF piggyvest_primary.ops_login_is_approver('pvops_catalog_login'::regrole) THEN
    RAISE EXCEPTION 'an extra engine-role membership must disqualify an approver';
  END IF;
END
$$;
REVOKE piggyvest_primary_evidence FROM pvops_catalog_login;
GRANT piggyvest_primary_approver TO pvops_catalog_login WITH ADMIN OPTION;
DO $$
BEGIN
  IF piggyvest_primary.ops_login_is_approver('pvops_catalog_login'::regrole) THEN
    RAISE EXCEPTION 'ADMIN OPTION on the approver role must disqualify an approver';
  END IF;
END
$$;
