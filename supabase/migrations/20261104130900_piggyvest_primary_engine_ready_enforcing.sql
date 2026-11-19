-- Enforcing readiness check for the PiggyVest ledger and transfer engine.
--
-- Replaces the fail-closed stub from 20261102032905 (CREATE OR REPLACE, same
-- signature, same {ready, missing[]} shape, same owner and grants). The
-- check answers ready for a surface only when every fence the code on that
-- surface actually depends on is present in the database, and lists each
-- missing fence by a stable code. It answers for the calling session login
-- (SESSION_USER), because the credit paths are authorised per login.
--
-- Surfaces with an enforced check today: inflow (the inline inflow executor,
-- before apply_inflow_environment) and bank_inbox (the bank-inbox worker,
-- before any claim). Any other surface in the engine's list answers
-- surface_not_supported until its own fences are defined; an unknown or NULL
-- surface answers unknown_surface. Any error while checking answers not ready
-- (engine_readiness_unavailable), so a failure never reads as ready.
--
-- The master kill switch (PIGGYVEST_PRIMARY_KILL_SWITCH) is a web runtime
-- setting and is not visible to the database. It stays enforced where it is
-- read, and is deliberately not part of this check.
--
-- Fence codes:
--   unknown_surface / surface_not_supported  the surface is not checked yet
--   ledger_objects_missing     inflow ledger tables or functions are absent
--   login_role_unsafe          the session login is missing, cannot log in,
--                              is elevated or has expired
--   evidence_role_unsafe       (inflow) the evidence capability role is
--                              missing, can log in or is elevated
--   login_membership_unsafe    (inflow) the login is not a member of the
--                              evidence role, or reaches any role other than
--                              the evidence role and the readiness reader,
--                              directly or through another role
--   inflow_execute_missing     (inflow) the login cannot execute
--                              apply_inflow_environment
--   inflow_authority_not_enabled  no enabled inflow authority names the login
--                              (inflow) or some bank integration of the
--                              worker login lacks one (bank_inbox)
--   integration_not_enabled    the authorised integration is disabled
--   bank_role_unsafe           (bank_inbox) bank_role_violations lists any
--                              violation for the login
--   bank_authority_not_enabled (bank_inbox) no enabled bank authority names
--                              the login as its worker
--   bank_binding_mismatch      (bank_inbox) the authority and integration
--                              disagree on merchant, business or environment
--
-- engine_fences(surface, login) holds the rules so the SQL suite can test
-- each fence for a throwaway login without logging in as one. Nobody but the
-- owner (through engine_ready) can execute it.

CREATE FUNCTION piggyvest_primary.engine_fences(p_surface text, p_login name)
RETURNS text[] LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
DECLARE
  v_missing text[] := ARRAY[]::text[];
  v_login_exists boolean;
  v_step boolean;
BEGIN
  IF p_surface IS NULL OR p_surface NOT IN ('inflow', 'bank_inbox', 'settlement_drain',
      'settlement_full', 'spend', 'spend_vtu', 'spend_imei', 'spend_checkout',
      'goal_inflow', 'goal_exit', 'legacy_migration', 'support_payout',
      'treasury_sweep', 'approvals') THEN
    RETURN ARRAY['unknown_surface'];
  END IF;
  IF p_surface NOT IN ('inflow', 'bank_inbox') THEN
    RETURN ARRAY['surface_not_supported'];
  END IF;

  -- The ledger the credit lands in.
  IF to_regclass('piggyvest_primary.inflow_receipts') IS NULL
    OR to_regclass('piggyvest_primary.inflow_authorities') IS NULL
    OR to_regclass('piggyvest_primary.integrations') IS NULL
    OR to_regprocedure('piggyvest_primary.apply_inflow(uuid,jsonb)') IS NULL
    OR to_regprocedure('piggyvest_primary.apply_inflow_environment(uuid,text,jsonb)') IS NULL THEN
    v_missing := array_append(v_missing, 'ledger_objects_missing'::text);
  END IF;

  -- The session login: it must exist, log in, be non-elevated and be valid.
  -- The bank worker's authority check also requires an explicit expiry.
  SELECT EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = p_login
    AND r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreaterole
    AND NOT r.rolcreatedb AND NOT r.rolreplication
    AND (r.rolvaliduntil > clock_timestamp()
      OR (r.rolvaliduntil IS NULL AND p_surface = 'inflow')))
  INTO v_login_exists;
  IF p_login IS NULL OR NOT v_login_exists THEN
    v_missing := array_append(v_missing, 'login_role_unsafe'::text);
  END IF;

  IF p_surface = 'inflow' THEN
    IF NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = 'piggyvest_primary_evidence'
      AND NOT r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreaterole
      AND NOT r.rolcreatedb AND NOT r.rolreplication) THEN
      v_missing := array_append(v_missing, 'evidence_role_unsafe'::text);
    END IF;
    IF v_login_exists AND to_regrole('piggyvest_primary_evidence') IS NOT NULL THEN
      -- Every role the login can reach, directly or through another role,
      -- must be the evidence role or the readiness reader it carries. A
      -- direct-only check would miss a privileged role inherited through them.
      IF NOT pg_has_role(p_login, 'piggyvest_primary_evidence', 'MEMBER')
        OR EXISTS (WITH RECURSIVE chain(roleid, admin_option) AS (
            SELECT m.roleid, m.admin_option FROM pg_auth_members m
              JOIN pg_roles member ON member.oid = m.member WHERE member.rolname = p_login
            UNION
            SELECT m.roleid, m.admin_option FROM pg_auth_members m JOIN chain c ON m.member = c.roleid)
          SELECT 1 FROM chain JOIN pg_roles parent ON parent.oid = chain.roleid
          WHERE parent.rolname NOT IN ('piggyvest_primary_evidence',
            'piggyvest_primary_readiness_reader')
            -- A delegable grant (WITH ADMIN OPTION) lets the login hand the
            -- evidence or reader role to others, so it is unsafe too.
            OR chain.admin_option) THEN
        v_missing := array_append(v_missing, 'login_membership_unsafe'::text);
      END IF;
    END IF;
    IF v_login_exists AND to_regprocedure('piggyvest_primary.apply_inflow_environment(uuid,text,jsonb)') IS NOT NULL THEN
      IF NOT has_function_privilege(p_login,
          'piggyvest_primary.apply_inflow_environment(uuid,text,jsonb)', 'EXECUTE') THEN
        v_missing := array_append(v_missing, 'inflow_execute_missing'::text);
      END IF;
    END IF;
    IF to_regclass('piggyvest_primary.inflow_authorities') IS NOT NULL
      AND to_regclass('piggyvest_primary.integrations') IS NOT NULL THEN
      SELECT EXISTS (SELECT 1 FROM piggyvest_primary.inflow_authorities a
        WHERE a.executor_login = p_login AND a.enabled) INTO v_step;
      IF NOT v_step THEN
        v_missing := array_append(v_missing, 'inflow_authority_not_enabled'::text);
      ELSIF NOT EXISTS (SELECT 1 FROM piggyvest_primary.inflow_authorities a
          JOIN piggyvest_primary.integrations i ON i.id = a.integration_id
          WHERE a.executor_login = p_login AND a.enabled AND i.enabled) THEN
        v_missing := array_append(v_missing, 'integration_not_enabled'::text);
      END IF;
    END IF;
  ELSE
    -- bank_inbox: the worker's session safety, then its authority chain.
    IF v_login_exists THEN
      IF EXISTS (SELECT 1 FROM piggyvest_primary.bank_role_violations(p_login, true)) THEN
        v_missing := array_append(v_missing, 'bank_role_unsafe'::text);
      END IF;
    END IF;
    IF to_regclass('piggyvest_primary.bank_inbox_authorities') IS NULL
      OR to_regclass('piggyvest_primary.integrations') IS NULL
      OR to_regclass('piggyvest_primary.inflow_authorities') IS NULL
      OR to_regclass('piggyvest_primary.bank_signed_inbox') IS NULL THEN
      v_missing := array_append(v_missing, 'ledger_objects_missing'::text);
    -- The worker login is a fixed name, so several integrations can share
    -- it, and engine_ready is asked without an integration id. The verdict
    -- therefore holds only if EVERY binding of the login satisfies every
    -- fence: a healthy integration B must never make the worker look ready
    -- while integration A's chain is broken, because the worker would claim
    -- deposits it cannot process.
    ELSIF NOT EXISTS (SELECT 1 FROM piggyvest_primary.bank_inbox_authorities b
        WHERE b.worker_login = p_login)
      OR EXISTS (SELECT 1 FROM piggyvest_primary.bank_inbox_authorities b
        WHERE b.worker_login = p_login AND NOT b.enabled) THEN
      v_missing := array_append(v_missing, 'bank_authority_not_enabled'::text);
    ELSIF EXISTS (SELECT 1 FROM piggyvest_primary.bank_inbox_authorities b
        JOIN piggyvest_primary.integrations i ON i.id = b.integration_id
        WHERE b.worker_login = p_login AND NOT i.enabled) THEN
      v_missing := array_append(v_missing, 'integration_not_enabled'::text);
    ELSIF EXISTS (SELECT 1 FROM piggyvest_primary.bank_inbox_authorities b
        JOIN piggyvest_primary.integrations i ON i.id = b.integration_id
        WHERE b.worker_login = p_login
          AND NOT (b.merchant_id = i.merchant_id AND b.business_id = i.business_id
            AND b.environment = i.environment)) THEN
      v_missing := array_append(v_missing, 'bank_binding_mismatch'::text);
    ELSIF EXISTS (SELECT 1 FROM piggyvest_primary.bank_inbox_authorities b
        WHERE b.worker_login = p_login
          AND NOT EXISTS (SELECT 1 FROM piggyvest_primary.inflow_authorities a
            WHERE a.integration_id = b.integration_id AND a.enabled)) THEN
      v_missing := array_append(v_missing, 'inflow_authority_not_enabled'::text);
    END IF;
  END IF;
  RETURN v_missing;
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.engine_fences(text, name)
  FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_readiness_reader,
    piggyvest_primary_evidence, piggyvest_primary_authorizer,
    primary_bank_signed_intake, primary_bank_inbox_worker;
COMMENT ON FUNCTION piggyvest_primary.engine_fences(text, name) IS
  'Lists the missing engine fences for a surface and session login, by stable code. Not callable by any role but the owner; engine_ready is the entry point.';

CREATE OR REPLACE FUNCTION piggyvest_primary.engine_ready(p_surface text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_missing text[];
BEGIN
  v_missing := piggyvest_primary.engine_fences(p_surface, SESSION_USER);
  IF v_missing IS NULL THEN
    RETURN jsonb_build_object('ready', false, 'missing', jsonb_build_array('engine_readiness_unavailable'));
  END IF;
  RETURN jsonb_build_object('ready', cardinality(v_missing) = 0, 'missing', to_jsonb(v_missing));
EXCEPTION WHEN OTHERS THEN
  -- Fail closed: an error while checking is never a ready answer.
  RETURN jsonb_build_object('ready', false, 'missing', jsonb_build_array('engine_readiness_unavailable'));
END $$;
COMMENT ON FUNCTION piggyvest_primary.engine_ready(text) IS
  'Enforcing readiness check for the PiggyVest engine: ready only when every fence the surface depends on is present; lists missing fences by stable code; any error is not ready.';
