-- Part of piggyvest_primary_ops_approvals.sql (\ir): committed fixture for
-- the runtime part. Five test logins, each with its own dblink connection,
-- so every call really runs under a different SESSION_USER:
--   r        the requester: a dedicated login that opens every request;
--   a, b, c  approver logins holding only piggyvest_primary_approver;
--   e        an approver login that also holds an engine role (refused).
-- Approver a also opens a few requests itself (pvops_test.open_as_session),
-- so the requester-as-approver rule is exercised.
--
-- Passwords come from a random secret made for this run and kept only in
-- this session, and every test login stops accepting it after 30 minutes,
-- so a login left behind by an aborted run cannot be signed in to.

SELECT pg_catalog.set_config('pvops.secret', pg_catalog.gen_random_uuid()::text, false);

CREATE FUNCTION pg_temp.pvops_password(p_login text) RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.current_setting('pvops.secret') || ':' || p_login, 'UTF8')), 'hex')
$$;

-- Runs one approver call on a dblink connection; returns the result text, or
-- 'error: <message>' when the remote function refused.
CREATE FUNCTION pg_temp.pvops_decide(
  p_conn text, p_request uuid, p_decision text, p_amount bigint, p_digest text
) RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_result text;
BEGIN
  SELECT t.r INTO v_result FROM dblink(p_conn, pg_catalog.format(
    'SELECT piggyvest_approvals.approve_ops_request(%L::uuid, %L, %s::bigint, %L)::text',
    p_request, p_decision, COALESCE(p_amount::text, 'NULL'), p_digest)) AS t(r text);
  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  RETURN 'error: ' || SQLERRM;
END
$$;

-- Consumes from this session; returns 'consumed', or 'error: <message>'.
CREATE FUNCTION pg_temp.pvops_consume(
  p_action text, p_subject uuid, p_version bigint, p_amount bigint, p_destination jsonb
) RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM piggyvest_primary.consume_two_approvals(
    p_action, 'pvops_test.subjects', p_subject, p_version, p_amount, p_destination);
  RETURN 'consumed';
EXCEPTION WHEN OTHERS THEN
  RETURN 'error: ' || SQLERRM;
END
$$;

-- 'ok' expects success; anything else is the exact refusal code expected.
CREATE FUNCTION pg_temp.pvops_expect(p_actual text, p_expected text, p_label text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_expected = 'ok' AND p_actual LIKE 'error: %' THEN
    RAISE EXCEPTION '%: expected success, got %', p_label, p_actual;
  ELSIF p_expected <> 'ok' AND p_actual IS DISTINCT FROM 'error: ' || p_expected THEN
    RAISE EXCEPTION '%: expected %, got %', p_label, p_expected, p_actual;
  END IF;
END
$$;

-- Opens a request as the requester login r; returns its id.
CREATE FUNCTION pg_temp.pvops_open(
  p_action text, p_subject uuid, p_version bigint, p_amount bigint, p_destination jsonb,
  p_context jsonb DEFAULT '{}'::jsonb, p_conn text DEFAULT 'pvops_r'
) RETURNS uuid
LANGUAGE sql
AS $$
  SELECT t.id FROM dblink(p_conn, pg_catalog.format(
    'SELECT pvops_test.open_request(%L, %L, %L::uuid, %s::bigint, %s::bigint, %L::jsonb, %L::jsonb)::text',
    p_action, 'pvops_test.subjects', p_subject, COALESCE(p_version::text, 'NULL'),
    COALESCE(p_amount::text, 'NULL'), p_destination, p_context)) AS t(id uuid)
$$;

-- The same, returning the refusal code instead of raising: 'ok' or
-- 'error: <message>'.
CREATE FUNCTION pg_temp.pvops_try_open(
  p_action text, p_subject_table text, p_subject uuid, p_version bigint, p_amount bigint,
  p_destination jsonb
) RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM t.id FROM dblink('pvops_r', pg_catalog.format(
    'SELECT pvops_test.open_request(%L, %L, %L::uuid, %s::bigint, %s::bigint, %L::jsonb, %L::jsonb)::text',
    p_action, p_subject_table, p_subject, COALESCE(p_version::text, 'NULL'),
    COALESCE(p_amount::text, 'NULL'), p_destination, '{}')) AS t(id uuid);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN 'error: ' || SQLERRM;
END
$$;

CREATE FUNCTION pg_temp.pvops_digest(p_request uuid) RETURNS text
LANGUAGE sql
AS $$ SELECT r.digest FROM piggyvest_primary.ops_approval_requests r WHERE r.id = p_request $$;

CREATE FUNCTION pg_temp.pvops_bank(p_ref text) RETURNS jsonb
LANGUAGE sql IMMUTABLE
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'kind', 'bank_account', 'bank_code', '058', 'ref', p_ref, 'label', 'Ogabassey GTBank')
$$;

DO $$
DECLARE
  v_login text;
BEGIN
  FOREACH v_login IN ARRAY ARRAY['pvops_test_requester_r', 'pvops_test_approver_a',
      'pvops_test_approver_b', 'pvops_test_approver_c', 'pvops_test_engine_e'] LOOP
    EXECUTE pg_catalog.format(
      'CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT '
      'PASSWORD %L VALID UNTIL %L',
      v_login, pg_temp.pvops_password(v_login), pg_catalog.clock_timestamp() + interval '30 minutes');
  END LOOP;
END
$$;

GRANT piggyvest_primary_approver TO pvops_test_approver_a, pvops_test_approver_b,
  pvops_test_approver_c, pvops_test_engine_e;
GRANT piggyvest_primary_evidence TO pvops_test_engine_e;

CREATE SCHEMA pvops_test;
REVOKE ALL ON SCHEMA pvops_test FROM PUBLIC;
-- Stand-ins for a money command's own SECURITY DEFINER functions.
CREATE FUNCTION pvops_test.open_request(
  p_action text, p_subject_table text, p_subject uuid, p_version bigint, p_amount bigint,
  p_destination jsonb, p_context jsonb
) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT piggyvest_primary.open_ops_request(p_action, p_subject_table, p_subject, p_version,
    p_amount, p_destination, p_context)
$$;
CREATE FUNCTION pvops_test.consume_request(
  p_action text, p_subject uuid, p_version bigint, p_amount bigint, p_destination jsonb
) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT piggyvest_primary.consume_two_approvals(p_action, 'pvops_test.subjects', p_subject,
    p_version, p_amount, p_destination)
$$;
-- Lets approver a open a request itself, so the requester-as-approver rule
-- is exercised with a login that is otherwise a valid approver.
CREATE FUNCTION pvops_test.open_as_session(p_subject uuid) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT piggyvest_primary.open_ops_request('support_payout', 'pvops_test.subjects', p_subject,
    1, 250000, '{"kind":"bank_account","bank_code":"044","ref":"0234567891"}'::jsonb, '{}'::jsonb)
$$;
-- Lets approver b try to complete a request it approved itself.
CREATE FUNCTION pvops_test.consume_as_session(p_subject uuid) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT piggyvest_primary.consume_two_approvals('support_payout', 'pvops_test.subjects', p_subject,
    1, 250000, '{"kind":"bank_account","bank_code":"044","ref":"0234567891"}'::jsonb)
$$;
REVOKE ALL ON FUNCTION pvops_test.open_request(text, text, uuid, bigint, bigint, jsonb, jsonb),
  pvops_test.consume_request(text, uuid, bigint, bigint, jsonb),
  pvops_test.open_as_session(uuid), pvops_test.consume_as_session(uuid) FROM PUBLIC;
GRANT USAGE ON SCHEMA pvops_test TO pvops_test_requester_r, pvops_test_approver_a,
  pvops_test_approver_b;
GRANT EXECUTE ON FUNCTION pvops_test.open_request(text, text, uuid, bigint, bigint, jsonb, jsonb),
  pvops_test.consume_request(text, uuid, bigint, bigint, jsonb) TO pvops_test_requester_r;
GRANT EXECUTE ON FUNCTION pvops_test.open_as_session(uuid) TO pvops_test_approver_a;
GRANT EXECUTE ON FUNCTION pvops_test.consume_as_session(uuid) TO pvops_test_approver_b;

SELECT dblink_connect(v.conn, pg_catalog.format(
  'host=%s port=%s dbname=%s user=%s password=%s',
  pg_catalog.host(pg_catalog.inet_server_addr()), pg_catalog.inet_server_port(),
  pg_catalog.current_database(), v.login, pg_temp.pvops_password(v.login)))
FROM (VALUES ('pvops_r', 'pvops_test_requester_r'), ('pvops_a', 'pvops_test_approver_a'),
             ('pvops_b', 'pvops_test_approver_b'), ('pvops_c', 'pvops_test_approver_c'),
             ('pvops_e', 'pvops_test_engine_e')) AS v(conn, login);

-- Each connection really is its own SESSION_USER.
DO $$
BEGIN
  IF (SELECT t.s FROM dblink('pvops_b', 'SELECT session_user::text') AS t(s text))
     IS DISTINCT FROM 'pvops_test_approver_b' THEN
    RAISE EXCEPTION 'dblink connection pvops_b must run as pvops_test_approver_b';
  END IF;
END
$$;
