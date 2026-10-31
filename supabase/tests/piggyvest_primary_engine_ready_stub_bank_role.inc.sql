-- Part of piggyvest_primary_engine_ready_stub.sql (\ir): the bank inbox
-- session safety check after the bank-inbox worker gained the readiness
-- reader. Runs inside the entry file's transaction; not a standalone suite.
--
-- bank_role_safe cannot be called as another login here (no superuser on
-- the replay image), so the suite drives bank_role_violations, the check it
-- now delegates to, with throwaway logins created in this transaction. The
-- privilege scan sees everything PUBLIC may execute on the database under
-- test, so effects are compared against a login that holds nothing.

-- Both functions: SECURITY DEFINER where needed, pinned search_path, and
-- executable only by the intended roles.
DO $$
DECLARE
  v_role text;
BEGIN
  PERFORM pg_temp.check((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=pg_catalog']
      FROM pg_proc p WHERE p.oid = 'piggyvest_primary.bank_role_safe(boolean)'::regprocedure),
    'bank_role_safe must stay SECURITY DEFINER with a pinned search_path');
  PERFORM pg_temp.check((SELECT NOT p.prosecdef AND p.proconfig = ARRAY['search_path=pg_catalog']
      AND p.proacl IS NOT NULL AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
      FROM pg_proc p
      WHERE p.oid = 'piggyvest_primary.bank_role_violations(name,boolean)'::regprocedure),
    'bank_role_violations must be an invoker function with a pinned search_path and no PUBLIC grant');
  FOREACH v_role IN ARRAY ARRAY['primary_bank_signed_intake', 'primary_bank_inbox_worker'] LOOP
    PERFORM pg_temp.check(has_function_privilege(v_role,
      'piggyvest_primary.bank_role_safe(boolean)', 'EXECUTE'),
      format('%s must execute bank_role_safe', v_role));
  END LOOP;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role',
    'piggyvest_primary_readiness_reader', 'piggyvest_primary_evidence',
    'piggyvest_primary_authorizer'] LOOP
    PERFORM pg_temp.check(NOT has_function_privilege(v_role,
      'piggyvest_primary.bank_role_safe(boolean)', 'EXECUTE'),
      format('%s must not execute bank_role_safe', v_role));
  END LOOP;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role',
    'primary_bank_signed_intake', 'primary_bank_inbox_worker',
    'piggyvest_primary_readiness_reader', 'piggyvest_primary_evidence',
    'piggyvest_primary_authorizer'] LOOP
    PERFORM pg_temp.check(NOT has_function_privilege(v_role,
      'piggyvest_primary.bank_role_violations(name,boolean)', 'EXECUTE'),
      format('%s must not execute bank_role_violations', v_role));
  END LOOP;
END $$;

CREATE ROLE pv_ready_test_worker LOGIN;
CREATE ROLE pv_ready_test_intake LOGIN;
CREATE ROLE pv_ready_test_bare LOGIN;
CREATE ROLE pv_ready_test_extra NOLOGIN;
GRANT primary_bank_inbox_worker TO pv_ready_test_worker;
GRANT primary_bank_signed_intake TO pv_ready_test_intake;

CREATE FUNCTION pg_temp.violations(p_login text, p_worker boolean)
RETURNS SETOF text LANGUAGE sql AS $$
  SELECT piggyvest_primary.bank_role_violations(p_login::name, p_worker)
$$;
-- What a capability login holds beyond a login that holds nothing.
CREATE FUNCTION pg_temp.added(p_login text, p_worker boolean)
RETURNS SETOF text LANGUAGE sql AS $$
  SELECT pg_temp.violations(p_login, p_worker)
  EXCEPT SELECT pg_temp.violations('pv_ready_test_bare', p_worker)
$$;
CREATE FUNCTION pg_temp.flags(p_login text, p_worker boolean, p_violation text)
RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM pg_temp.violations(p_login, p_worker) v WHERE v = p_violation)
$$;

-- As installed: neither capability role is unsafe, the reader membership
-- and engine_ready add nothing over a bare login, nothing is missing, and
-- the intake login still cannot read readiness.
DO $$
BEGIN
  PERFORM pg_temp.check(NOT EXISTS (
      SELECT 1 FROM pg_temp.violations('pv_ready_test_worker', true) v
      WHERE v LIKE 'capability:%' OR v LIKE 'membership:%'),
    'the worker capability role must be safe with the reader membership');
  PERFORM pg_temp.check(NOT EXISTS (
      SELECT 1 FROM pg_temp.violations('pv_ready_test_intake', false) v
      WHERE v LIKE 'capability:%' OR v LIKE 'membership:%'),
    'the intake capability role must stay safe');
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM pg_temp.added('pv_ready_test_worker', true)),
    'a worker login must hold nothing beyond its allowlist');
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM pg_temp.added('pv_ready_test_intake', false)),
    'an intake login must hold nothing beyond its allowlist');
  PERFORM pg_temp.check(NOT EXISTS (
      SELECT 1 FROM pg_temp.violations('pv_ready_test_worker', true) v WHERE v LIKE 'missing:%'),
    'a worker login must be able to execute its whole allowlist');
  PERFORM pg_temp.check(NOT EXISTS (
      SELECT 1 FROM pg_temp.violations('pv_ready_test_intake', false) v WHERE v LIKE 'missing:%'),
    'an intake login must be able to execute its whole allowlist');
  PERFORM pg_temp.check(
    pg_temp.flags('pv_ready_test_bare', true, 'missing:engine_ready(p_surface text)'),
    'the worker allowlist must require engine_ready');
  PERFORM pg_temp.check(NOT EXISTS (
      SELECT 1 FROM pg_temp.violations('pv_ready_test_bare', false) v WHERE v LIKE 'missing:engine_ready%'),
    'the intake allowlist must not include engine_ready');
  PERFORM pg_temp.check(NOT has_function_privilege('pv_ready_test_intake',
      'piggyvest_primary.engine_ready(text)', 'EXECUTE'),
    'an intake login must not execute engine_ready');
  PERFORM pg_temp.check(piggyvest_primary.bank_role_safe(true) = NOT EXISTS (
      SELECT 1 FROM piggyvest_primary.bank_role_violations(session_user, true)),
    'bank_role_safe must be exactly the absence of violations for the session login');
END $$;

-- Each unsafe change is still refused.
SAVEPOINT reader_revoked;
REVOKE piggyvest_primary_readiness_reader FROM primary_bank_inbox_worker;
SELECT pg_temp.check(
  pg_temp.flags('pv_ready_test_worker', true, 'missing:engine_ready(p_surface text)'),
  'a worker without the reader must be unsafe');
ROLLBACK TO SAVEPOINT reader_revoked;

SAVEPOINT worker_extra_role;
GRANT pv_ready_test_extra TO primary_bank_inbox_worker;
SELECT pg_temp.check(
  pg_temp.flags('pv_ready_test_worker', true, 'membership:pv_ready_test_extra'),
  'any other worker membership must stay unsafe');
ROLLBACK TO SAVEPOINT worker_extra_role;

SAVEPOINT reader_nested;
GRANT pv_ready_test_extra TO piggyvest_primary_readiness_reader;
SELECT pg_temp.check(
  pg_temp.flags('pv_ready_test_worker', true, 'membership:piggyvest_primary_readiness_reader'),
  'a reader that is itself a member of a role must make the worker unsafe');
ROLLBACK TO SAVEPOINT reader_nested;

SAVEPOINT reader_login;
ALTER ROLE piggyvest_primary_readiness_reader LOGIN;
SELECT pg_temp.check(
  pg_temp.flags('pv_ready_test_worker', true, 'membership:piggyvest_primary_readiness_reader'),
  'a reader that can log in must make the worker unsafe');
ROLLBACK TO SAVEPOINT reader_login;

SAVEPOINT reader_extra_function;
GRANT EXECUTE ON FUNCTION piggyvest_primary.enqueue_bank_inbox(uuid,text,jsonb,jsonb)
  TO piggyvest_primary_readiness_reader;
SELECT pg_temp.check(
  pg_temp.flags('pv_ready_test_worker', true,
    'function:piggyvest_primary.enqueue_bank_inbox(uuid,text,jsonb,jsonb)'),
  'a function reached through the reader outside the allowlist must be unsafe');
ROLLBACK TO SAVEPOINT reader_extra_function;

SAVEPOINT reader_extra_relation;
GRANT SELECT ON piggyvest_primary.bank_signed_inbox TO piggyvest_primary_readiness_reader;
SELECT pg_temp.check(
  pg_temp.flags('pv_ready_test_worker', true, 'relation:piggyvest_primary.bank_signed_inbox'),
  'a relation reached through the reader must be unsafe');
ROLLBACK TO SAVEPOINT reader_extra_relation;

SAVEPOINT intake_reader;
GRANT piggyvest_primary_readiness_reader TO primary_bank_signed_intake;
SELECT pg_temp.check(
  pg_temp.flags('pv_ready_test_intake', false, 'membership:piggyvest_primary_readiness_reader')
  AND pg_temp.flags('pv_ready_test_intake', false, 'function:piggyvest_primary.engine_ready(text)'),
  'the intake must stay unsafe if it is ever given the reader');
ROLLBACK TO SAVEPOINT intake_reader;
