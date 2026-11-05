-- Contract test: the enforcing piggyvest_primary.engine_ready
-- (20261104130900_piggyvest_primary_engine_ready_enforcing.sql), which
-- replaces the fail-closed stub.
--
-- Proves, against live PostgreSQL:
--   * inflow: ready with every fence present, and not ready with each fence
--     missing on its own (one stable code per fence);
--   * bank_inbox: the same, one test per fence;
--   * an unknown surface, NULL and a listed-but-unchecked surface are never
--     ready; the verdict shape is the {ready, missing[]} contract;
--   * engine_ready answers for the session login and fails closed;
--   * grants are unchanged (catalog assertions): engine_ready is still
--     executable by the readiness reader only, and engine_fences by nobody.
-- The fences are driven through engine_fences(surface, login) with throwaway
-- logins, because the suite cannot log in as another role. Denials are
-- asserted through the catalog, never by calling.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/piggyvest_primary_engine_ready_enforcing.sql

BEGIN;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', p_message; END IF;
END $$;

CREATE FUNCTION pg_temp.id(p_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('e7e00000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid
$$;

-- Missing fence codes for a surface and login, as text for comparison.
-- bank_role_violations also lists the function and relation privileges every
-- login inherits from PUBLIC on the image under test (the baseline a login
-- that holds nothing, pv_er_bare, also has). For the bank inbox, a
-- bank_role_unsafe verdict is dropped only when EVERY violation row of the
-- login is such a baseline row; any other row (capability, membership,
-- missing, or a function or relation the bare login lacks) keeps the verdict.
-- The production check is never replaced; pg_temp.real_gaps reads it as is.
CREATE FUNCTION pg_temp.real_gaps(p_surface text, p_login text) RETURNS text
LANGUAGE sql AS $$
  SELECT array_to_string(piggyvest_primary.engine_fences(p_surface, p_login::name), ',')
$$;

CREATE FUNCTION pg_temp.gaps(p_surface text, p_login text) RETURNS text
LANGUAGE sql AS $$
  SELECT array_to_string(
    CASE WHEN p_surface = 'bank_inbox' AND NOT EXISTS (
        SELECT 1 FROM piggyvest_primary.bank_role_violations(p_login::name, true) v
        WHERE NOT (v ~ '^(function|relation):' AND v IN (
          SELECT piggyvest_primary.bank_role_violations('pv_er_bare'::name, true))))
      THEN array_remove(piggyvest_primary.engine_fences(p_surface, p_login::name), 'bank_role_unsafe')
      ELSE piggyvest_primary.engine_fences(p_surface, p_login::name) END, ',')
$$;

-- Throwaway logins. The bank worker authority only accepts the fixed login
-- name, so that role is created (or reshaped) inside this transaction.
CREATE ROLE pv_er_exec LOGIN;
GRANT piggyvest_primary_evidence TO pv_er_exec;
DO $$
BEGIN
  IF to_regrole('baci_primary_bank_worker') IS NULL THEN
    CREATE ROLE baci_primary_bank_worker LOGIN NOSUPERUSER NOBYPASSRLS NOREPLICATION;
  END IF;
END $$;
-- Only the attributes a role manager may change; the superuser-only ones
-- (SUPERUSER, BYPASSRLS, REPLICATION) are already off for a created role.
ALTER ROLE baci_primary_bank_worker LOGIN NOCREATEROLE NOCREATEDB VALID UNTIL '2100-01-01';
GRANT primary_bank_inbox_worker TO baci_primary_bank_worker;

-- A login that holds nothing: the baseline of PUBLIC privileges (see gaps).
CREATE ROLE pv_er_bare LOGIN;

-- Inserting a merchant fires the canonical audit trigger, which needs an actor;
-- run the fixture as the service role (transaction-local), as the other suites do.
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

-- Integration 1: inflow executor pv_er_exec. Integration 2: bank worker.
INSERT INTO public.merchants(id, email) VALUES
  (pg_temp.id(1), 'engine-ready-1@example.test');
INSERT INTO piggyvest_primary.integrations(id, merchant_id, business_id, environment, executor_login, enabled)
VALUES
  (pg_temp.id(11), pg_temp.id(1), 'engine-ready-inflow', 'staging', 'pv_er_exec', true),
  (pg_temp.id(12), pg_temp.id(1), 'engine-ready-bank', 'staging', 'pv_er_bank_integration', true);
INSERT INTO piggyvest_primary.inflow_authorities(integration_id, executor_login, enabled) VALUES
  (pg_temp.id(11), 'pv_er_exec', true),
  (pg_temp.id(12), 'pv_er_bank_inflow', true);
INSERT INTO piggyvest_primary.bank_inbox_authorities(integration_id, merchant_id, business_id,
  environment, intake_login, worker_login, enabled, expires_at)
VALUES (pg_temp.id(12), pg_temp.id(1), 'engine-ready-bank', 'staging',
  'baci_primary_bank_intake', 'baci_primary_bank_worker', true, now() + interval '1 day');

-- 1. Every fence present: ready, nothing missing.
SELECT pg_temp.check(pg_temp.gaps('inflow', 'pv_er_exec') = '',
  'inflow must be ready with every fence present, got: ' || pg_temp.gaps('inflow', 'pv_er_exec'));
SELECT pg_temp.check(pg_temp.gaps('bank_inbox', 'baci_primary_bank_worker') = '',
  'bank_inbox must be ready with every fence present, got: '
  || pg_temp.gaps('bank_inbox', 'baci_primary_bank_worker'));

-- 2. Inflow: one fence missing at a time.
SAVEPOINT inflow_ledger;
ALTER TABLE piggyvest_primary.inflow_receipts RENAME TO inflow_receipts_gone;
SELECT pg_temp.check(pg_temp.gaps('inflow', 'pv_er_exec') = 'ledger_objects_missing',
  'a missing ledger table must be reported alone');
ROLLBACK TO SAVEPOINT inflow_ledger;

SAVEPOINT inflow_login_elevated;
ALTER ROLE pv_er_exec CREATEROLE;
SELECT pg_temp.check(pg_temp.gaps('inflow', 'pv_er_exec') = 'login_role_unsafe',
  'an elevated login must be reported alone');
ROLLBACK TO SAVEPOINT inflow_login_elevated;

SAVEPOINT inflow_login_expired;
ALTER ROLE pv_er_exec VALID UNTIL '2000-01-01';
SELECT pg_temp.check(pg_temp.gaps('inflow', 'pv_er_exec') = 'login_role_unsafe',
  'an expired login must be reported alone');
ROLLBACK TO SAVEPOINT inflow_login_expired;

SAVEPOINT inflow_login_unknown;
SELECT pg_temp.check(pg_temp.gaps('inflow', 'pv_er_no_such_login') LIKE '%login_role_unsafe%',
  'a login that does not exist must be reported');
ROLLBACK TO SAVEPOINT inflow_login_unknown;

SAVEPOINT inflow_evidence_login;
ALTER ROLE piggyvest_primary_evidence LOGIN;
SELECT pg_temp.check(pg_temp.gaps('inflow', 'pv_er_exec') = 'evidence_role_unsafe',
  'an evidence role that can log in must be reported alone');
ROLLBACK TO SAVEPOINT inflow_evidence_login;

SAVEPOINT inflow_not_member;
REVOKE piggyvest_primary_evidence FROM pv_er_exec;
SELECT pg_temp.check(pg_temp.gaps('inflow', 'pv_er_exec') LIKE '%login_membership_unsafe%',
  'a login outside the evidence role must be reported');
ROLLBACK TO SAVEPOINT inflow_not_member;

SAVEPOINT inflow_extra_membership;
CREATE ROLE pv_er_extra NOLOGIN;
GRANT pv_er_extra TO pv_er_exec;
SELECT pg_temp.check(pg_temp.gaps('inflow', 'pv_er_exec') = 'login_membership_unsafe',
  'an extra membership must be reported alone');
ROLLBACK TO SAVEPOINT inflow_extra_membership;

SAVEPOINT inflow_execute;
REVOKE EXECUTE ON FUNCTION piggyvest_primary.apply_inflow_environment(uuid, text, jsonb)
  FROM piggyvest_primary_evidence;
SELECT pg_temp.check(pg_temp.gaps('inflow', 'pv_er_exec') = 'inflow_execute_missing',
  'a login that cannot execute the inflow ledger entry must be reported alone');
ROLLBACK TO SAVEPOINT inflow_execute;

SAVEPOINT inflow_authority_disabled;
UPDATE piggyvest_primary.inflow_authorities SET enabled = false
  WHERE integration_id = pg_temp.id(11);
SELECT pg_temp.check(pg_temp.gaps('inflow', 'pv_er_exec') = 'inflow_authority_not_enabled',
  'a disabled inflow authority must be reported alone');
ROLLBACK TO SAVEPOINT inflow_authority_disabled;

SAVEPOINT inflow_authority_absent;
DELETE FROM piggyvest_primary.inflow_authorities WHERE integration_id = pg_temp.id(11);
SELECT pg_temp.check(pg_temp.gaps('inflow', 'pv_er_exec') = 'inflow_authority_not_enabled',
  'a login with no inflow authority must be reported alone');
ROLLBACK TO SAVEPOINT inflow_authority_absent;

SAVEPOINT inflow_integration_disabled;
UPDATE piggyvest_primary.integrations SET enabled = false WHERE id = pg_temp.id(11);
SELECT pg_temp.check(pg_temp.gaps('inflow', 'pv_er_exec') = 'integration_not_enabled',
  'a disabled integration must be reported alone');
ROLLBACK TO SAVEPOINT inflow_integration_disabled;

-- 3. Bank inbox: one fence missing at a time.
SAVEPOINT bank_ledger;
ALTER TABLE piggyvest_primary.inflow_receipts RENAME TO inflow_receipts_gone;
SELECT pg_temp.check(pg_temp.gaps('bank_inbox', 'baci_primary_bank_worker') = 'ledger_objects_missing',
  'a missing ledger table must be reported alone for the bank inbox');
ROLLBACK TO SAVEPOINT bank_ledger;

SAVEPOINT bank_login_elevated;
ALTER ROLE baci_primary_bank_worker CREATEDB;
SELECT pg_temp.check(pg_temp.gaps('bank_inbox', 'baci_primary_bank_worker') = 'login_role_unsafe',
  'an elevated bank worker login must be reported alone');
ROLLBACK TO SAVEPOINT bank_login_elevated;

SAVEPOINT bank_login_no_expiry;
ALTER ROLE baci_primary_bank_worker VALID UNTIL 'infinity';
SELECT pg_temp.check(pg_temp.gaps('bank_inbox', 'baci_primary_bank_worker') = '',
  'a worker login valid until infinity is still valid');
ALTER ROLE baci_primary_bank_worker VALID UNTIL '2000-01-01';
SELECT pg_temp.check(pg_temp.gaps('bank_inbox', 'baci_primary_bank_worker') LIKE '%login_role_unsafe%',
  'an expired bank worker login must be reported');
ROLLBACK TO SAVEPOINT bank_login_no_expiry;

SAVEPOINT bank_role_unsafe;
CREATE ROLE pv_er_bank_extra NOLOGIN;
GRANT pv_er_bank_extra TO primary_bank_inbox_worker;
SELECT pg_temp.check(pg_temp.gaps('bank_inbox', 'baci_primary_bank_worker') = 'bank_role_unsafe',
  'an unsafe bank capability must be reported alone');
ROLLBACK TO SAVEPOINT bank_role_unsafe;

SAVEPOINT bank_reader_revoked;
REVOKE piggyvest_primary_readiness_reader FROM primary_bank_inbox_worker;
SELECT pg_temp.check(pg_temp.gaps('bank_inbox', 'baci_primary_bank_worker') = 'bank_role_unsafe',
  'a worker without the reader must be reported as an unsafe bank role');
ROLLBACK TO SAVEPOINT bank_reader_revoked;

SAVEPOINT bank_authority_disabled;
UPDATE piggyvest_primary.bank_inbox_authorities SET enabled = false
  WHERE integration_id = pg_temp.id(12);
SELECT pg_temp.check(pg_temp.gaps('bank_inbox', 'baci_primary_bank_worker') = 'bank_authority_not_enabled',
  'a disabled bank authority must be reported alone');
ROLLBACK TO SAVEPOINT bank_authority_disabled;

SAVEPOINT bank_integration_disabled;
UPDATE piggyvest_primary.integrations SET enabled = false WHERE id = pg_temp.id(12);
SELECT pg_temp.check(pg_temp.gaps('bank_inbox', 'baci_primary_bank_worker') = 'integration_not_enabled',
  'a disabled bank integration must be reported alone');
ROLLBACK TO SAVEPOINT bank_integration_disabled;

SAVEPOINT bank_binding_mismatch;
UPDATE piggyvest_primary.bank_inbox_authorities SET business_id = 'engine-ready-other'
  WHERE integration_id = pg_temp.id(12);
SELECT pg_temp.check(pg_temp.gaps('bank_inbox', 'baci_primary_bank_worker') = 'bank_binding_mismatch',
  'an authority that disagrees with its integration must be reported alone');
ROLLBACK TO SAVEPOINT bank_binding_mismatch;

SAVEPOINT bank_inflow_authority;
UPDATE piggyvest_primary.inflow_authorities SET enabled = false
  WHERE integration_id = pg_temp.id(12);
SELECT pg_temp.check(pg_temp.gaps('bank_inbox', 'baci_primary_bank_worker') = 'inflow_authority_not_enabled',
  'a disabled inflow authority must be reported alone for the bank inbox');
ROLLBACK TO SAVEPOINT bank_inflow_authority;

\ir piggyvest_primary_engine_ready_enforcing_shared_worker.inc.sql
\ir piggyvest_primary_engine_ready_enforcing_review.inc.sql

-- 4. Surfaces: unknown, NULL and listed-but-unchecked are never ready, and
-- the executor's own session reads the same verdict through engine_ready.
DO $$
DECLARE
  v_surface text;
  v_verdict jsonb;
BEGIN
  FOREACH v_surface IN ARRAY ARRAY['not_a_surface', '', 'INFLOW', 'inflow ', 'bank-inbox']
  LOOP
    PERFORM pg_temp.check(piggyvest_primary.engine_fences(v_surface, 'pv_er_exec'::name)
        = ARRAY['unknown_surface'],
      format('unknown surface %L must answer unknown_surface', v_surface));
    PERFORM pg_temp.check(piggyvest_primary.engine_ready(v_surface)
        = '{"ready": false, "missing": ["unknown_surface"]}'::jsonb,
      format('engine_ready(%L) must not be ready', v_surface));
  END LOOP;
  PERFORM pg_temp.check(piggyvest_primary.engine_ready(NULL)
      = '{"ready": false, "missing": ["unknown_surface"]}'::jsonb,
    'engine_ready(NULL) must not be ready');
  FOREACH v_surface IN ARRAY ARRAY['settlement_drain', 'settlement_full', 'spend',
    'spend_vtu', 'spend_imei', 'spend_checkout', 'goal_inflow', 'goal_exit',
    'legacy_migration', 'support_payout', 'treasury_sweep', 'approvals']
  LOOP
    PERFORM pg_temp.check(piggyvest_primary.engine_ready(v_surface)
        = '{"ready": false, "missing": ["surface_not_supported"]}'::jsonb,
      format('surface %L has no enforced fences and must not be ready', v_surface));
    PERFORM pg_temp.check(piggyvest_primary.engine_fences(v_surface, 'pv_er_exec'::name)
        = ARRAY['surface_not_supported'],
      format('engine_fences(%L) must not be ready even for a fully authorised login', v_surface));
  END LOOP;
  -- The suite session is a superuser or the migration owner, not a safe
  -- executor login, so the verdict is not ready and names the login fence.
  v_verdict := piggyvest_primary.engine_ready('inflow');
  PERFORM pg_temp.check((v_verdict->>'ready')::boolean = false
      AND jsonb_typeof(v_verdict->'missing') = 'array'
      AND jsonb_array_length(v_verdict->'missing') >= 1
      AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_verdict) k)
        = ARRAY['missing', 'ready'],
    'engine_ready must keep the {ready, missing[]} shape and refuse an unauthorised session');
  PERFORM pg_temp.check(NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(v_verdict->'missing') m
      WHERE m !~ '^[a-z][a-z0-9_]{0,62}$'),
    'every missing code must be a stable lowercase marker');
END $$;

\ir piggyvest_primary_engine_ready_enforcing_grants.inc.sql

ROLLBACK;
