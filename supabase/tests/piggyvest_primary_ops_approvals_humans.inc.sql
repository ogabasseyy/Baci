-- Part of piggyvest_primary_ops_approvals.sql (\ir): the two-person rule is
-- about humans, not database logins. A human has an ops login and an approver
-- login, and the two names never match, so comparing logins alone would let
-- one human open a request and approve it. The owner therefore records which
-- human_id each login belongs to (ops_login_humans) and every rule compares
-- human_ids. Registrations are changed here by the owner, as they would be by
-- hand, and put back.

-- 1. One human with two logins (an ops login that opens, an approver login
--    that approves; the names differ): the request opened by the first
--    cannot be approved by the second, and is hidden from the second's
--    listing.
UPDATE piggyvest_primary.ops_login_humans SET human_id = 'pvops_human_a'
WHERE login = 'pvops_test_requester_r';
SELECT pg_temp.pvops_open('support_payout', '0a0e0000-0000-4000-8000-000000000040',
  1, 80000, pg_temp.pvops_bank('0123456789')) AS req40 \gset
SELECT pg_temp.pvops_digest(:'req40') AS dig40 \gset
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_a', :'req40', 'approve', 80000, :'dig40'),
  'ops_approval_requester_cannot_approve', 'same human, other login');
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM dblink('pvops_a',
       'SELECT subject FROM piggyvest_approvals.list_open_ops_requests()') AS t(subject text)
       WHERE t.subject LIKE '%000000000040') THEN
    RAISE EXCEPTION 'a request must be hidden from every login of the human who opened it';
  END IF;
  IF (SELECT r.requester_human_id FROM piggyvest_primary.ops_approval_requests r
      WHERE r.subject_id = '0a0e0000-0000-4000-8000-000000000040') IS DISTINCT FROM 'pvops_human_a' THEN
    RAISE EXCEPTION 'the request must record the requester''s human_id';
  END IF;
END
$$;
UPDATE piggyvest_primary.ops_login_humans SET human_id = 'pvops_human_r'
WHERE login = 'pvops_test_requester_r';
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_b', :'req40', 'approve', 80000, :'dig40'), 'ok', 'b approves');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_c', :'req40', 'approve', 80000, :'dig40'), 'ok', 'c approves');
SELECT pg_temp.pvops_expect(pg_temp.pvops_consume('support_payout',
  '0a0e0000-0000-4000-8000-000000000040', 1, 80000, pg_temp.pvops_bank('0123456789')),
  'ok', 'two other humans');

-- 2. One human's two approver logins count once: the second login cannot
--    add a decision.
SELECT pg_temp.pvops_open('support_payout', '0a0e0000-0000-4000-8000-000000000041',
  1, 81000, pg_temp.pvops_bank('0123456789')) AS req41 \gset
SELECT pg_temp.pvops_digest(:'req41') AS dig41 \gset
UPDATE piggyvest_primary.ops_login_humans SET human_id = 'pvops_human_b'
WHERE login = 'pvops_test_approver_c';
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_b', :'req41', 'approve', 81000, :'dig41'), 'ok', 'b approves');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_c', :'req41', 'approve', 81000, :'dig41'),
  'ops_approval_already_decided', 'the same human''s second login');
SELECT pg_temp.pvops_expect(pg_temp.pvops_consume('support_payout',
  '0a0e0000-0000-4000-8000-000000000041', 1, 81000, pg_temp.pvops_bank('0123456789')),
  'ops_approval_insufficient', 'one human is one approval');
UPDATE piggyvest_primary.ops_login_humans SET human_id = 'pvops_human_c'
WHERE login = 'pvops_test_approver_c';
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_c', :'req41', 'approve', 81000, :'dig41'), 'ok', 'c approves');
SELECT pg_temp.pvops_expect(pg_temp.pvops_consume('support_payout',
  '0a0e0000-0000-4000-8000-000000000041', 1, 81000, pg_temp.pvops_bank('0123456789')),
  'ok', 'two humans');

-- 3. A changed registration voids a recorded approval until it is put back.
SELECT pg_temp.pvops_open('support_payout', '0a0e0000-0000-4000-8000-000000000042',
  1, 82000, pg_temp.pvops_bank('0123456789')) AS req42 \gset
SELECT pg_temp.pvops_digest(:'req42') AS dig42 \gset
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_a', :'req42', 'approve', 82000, :'dig42'), 'ok', 'a approves');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_b', :'req42', 'approve', 82000, :'dig42'), 'ok', 'b approves');
UPDATE piggyvest_primary.ops_login_humans SET human_id = 'pvops_human_x'
WHERE login = 'pvops_test_approver_b';
SELECT pg_temp.pvops_expect(pg_temp.pvops_consume('support_payout',
  '0a0e0000-0000-4000-8000-000000000042', 1, 82000, pg_temp.pvops_bank('0123456789')),
  'ops_approval_insufficient', 'approver registered to someone else since');
UPDATE piggyvest_primary.ops_login_humans SET human_id = 'pvops_human_b'
WHERE login = 'pvops_test_approver_b';

-- 4. Whoever completes the action is never an approver, by human either.
UPDATE piggyvest_primary.ops_login_humans SET human_id = 'pvops_human_a'
WHERE login = 'pvops_test_requester_r';
DO $$
DECLARE
  v_message text;
BEGIN
  BEGIN
    PERFORM t.id FROM dblink('pvops_r', pg_catalog.format(
      'SELECT pvops_test.consume_request(%L, %L::uuid, 1, 82000, %L::jsonb)::text',
      'support_payout', '0a0e0000-0000-4000-8000-000000000042',
      pg_temp.pvops_bank('0123456789'))) AS t(id text);
    v_message := 'consumed';
  EXCEPTION WHEN OTHERS THEN
    v_message := SQLERRM;
  END;
  IF v_message IS DISTINCT FROM 'ops_approval_consumer_is_approver' THEN
    RAISE EXCEPTION 'a consumer whose human approved must be refused: %', v_message;
  END IF;
END
$$;
UPDATE piggyvest_primary.ops_login_humans SET human_id = 'pvops_human_r'
WHERE login = 'pvops_test_requester_r';
SELECT pg_temp.pvops_expect(pg_temp.pvops_consume('support_payout',
  '0a0e0000-0000-4000-8000-000000000042', 1, 82000, pg_temp.pvops_bank('0123456789')),
  'ok', 'registration put back');

-- 5. A login with no registration can neither open, list nor decide.
SELECT pg_temp.pvops_open('support_payout', '0a0e0000-0000-4000-8000-000000000043',
  1, 83000, pg_temp.pvops_bank('0123456789')) AS req43 \gset
SELECT pg_temp.pvops_digest(:'req43') AS dig43 \gset
DELETE FROM piggyvest_primary.ops_login_humans
WHERE login IN ('pvops_test_requester_r', 'pvops_test_approver_c');
SELECT pg_temp.pvops_expect(pg_temp.pvops_try_open('support_payout', 'pvops_test.subjects',
  '0a0e0000-0000-4000-8000-000000000044', 1, 84000, pg_temp.pvops_bank('0123456789')),
  'ops_approval_unregistered_login', 'unregistered requester');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_c', :'req43', 'approve', 83000, :'dig43'),
  'ops_approval_unregistered_login', 'unregistered approver');
DO $$
DECLARE
  v_message text;
BEGIN
  BEGIN
    PERFORM t.r FROM dblink('pvops_c',
      'SELECT request_id::text FROM piggyvest_approvals.list_open_ops_requests()') AS t(r text);
    v_message := 'allowed';
  EXCEPTION WHEN OTHERS THEN
    v_message := SQLERRM;
  END;
  IF v_message IS DISTINCT FROM 'ops_approval_unregistered_login' THEN
    RAISE EXCEPTION 'an unregistered approver must not list requests: %', v_message;
  END IF;
END
$$;
INSERT INTO piggyvest_primary.ops_login_humans (login_oid, login, human_id)
SELECT r.oid, r.rolname, 'pvops_human_' || pg_catalog.right(r.rolname::text, 1)
FROM pg_catalog.pg_roles r
WHERE r.rolname IN ('pvops_test_requester_r', 'pvops_test_approver_c');

-- 6. Consume re-checks humans on its own: a stored decision under the
--    requester's human_id (written here by the owner, as a faulty caller
--    might, with the login registered to that human) never counts, even
--    when someone else consumes.
SELECT pg_temp.pvops_open('support_payout', '0a0e0000-0000-4000-8000-000000000045',
  1, 85000, pg_temp.pvops_bank('0123456789')) AS req45 \gset
SELECT pg_temp.pvops_digest(:'req45') AS dig45 \gset
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_a', :'req45', 'approve', 85000, :'dig45'), 'ok', 'a approves');
UPDATE piggyvest_primary.ops_login_humans SET human_id = 'pvops_human_r'
WHERE login = 'pvops_test_approver_b';
INSERT INTO piggyvest_primary.ops_approvals
  (request_id, approver_login, approver_role_oid, approver_human_id, decision, digest)
SELECT :'req45', r.rolname, r.oid, 'pvops_human_r', 'approve', :'dig45'
FROM pg_catalog.pg_roles r WHERE r.rolname = 'pvops_test_approver_b';
-- The requester's login completes it under another human_id, so the
-- consumer check does not fire and the approval count decides.
UPDATE piggyvest_primary.ops_login_humans SET human_id = 'pvops_human_w'
WHERE login = 'pvops_test_requester_r';
SELECT pg_temp.pvops_expect(pg_temp.pvops_consume('support_payout',
  '0a0e0000-0000-4000-8000-000000000045', 1, 85000, pg_temp.pvops_bank('0123456789')),
  'ops_approval_insufficient', 'a stored decision under the requester''s human_id');
UPDATE piggyvest_primary.ops_login_humans SET human_id = 'pvops_human_r'
WHERE login = 'pvops_test_requester_r';
UPDATE piggyvest_primary.ops_login_humans SET human_id = 'pvops_human_b'
WHERE login = 'pvops_test_approver_b';

-- 7. Completing an action needs a registered login too. An unregistered
--    consumer has no human_id to compare, and a NULL comparison must never
--    let it through (here with two valid approvals in place).
SELECT pg_temp.pvops_open('support_payout', '0a0e0000-0000-4000-8000-000000000046',
  1, 86000, pg_temp.pvops_bank('0123456789')) AS req46 \gset
SELECT pg_temp.pvops_digest(:'req46') AS dig46 \gset
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_a', :'req46', 'approve', 86000, :'dig46'), 'ok', 'a approves');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_b', :'req46', 'approve', 86000, :'dig46'), 'ok', 'b approves');
DELETE FROM piggyvest_primary.ops_login_humans WHERE login = 'pvops_test_requester_r';
SELECT pg_temp.pvops_expect(pg_temp.pvops_consume('support_payout',
  '0a0e0000-0000-4000-8000-000000000046', 1, 86000, pg_temp.pvops_bank('0123456789')),
  'ops_approval_unregistered_login', 'unregistered consumer');
INSERT INTO piggyvest_primary.ops_login_humans (login_oid, login, human_id)
SELECT r.oid, r.rolname, 'pvops_human_r' FROM pg_catalog.pg_roles r
WHERE r.rolname = 'pvops_test_requester_r';
DO $$
BEGIN
  IF (SELECT r.state FROM piggyvest_primary.ops_approval_requests r
      WHERE r.subject_id = '0a0e0000-0000-4000-8000-000000000046') IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'a refused consume must leave the request open';
  END IF;
END
$$;
SELECT pg_temp.pvops_expect(pg_temp.pvops_consume('support_payout',
  '0a0e0000-0000-4000-8000-000000000046', 1, 86000, pg_temp.pvops_bank('0123456789')),
  'ok', 'registered consumer');

-- 8. A registration belongs to the login's name: a renamed login has none
--    until the owner records it again. Registrations are well formed, one
--    per login, and writable only by the owner: neither the requester login
--    nor an approver login can read or change them.
DO $$
DECLARE
  v_oid oid := 'pvops_test_approver_c'::regrole;
BEGIN
  IF piggyvest_primary.ops_human_of(v_oid) IS DISTINCT FROM 'pvops_human_c' THEN
    RAISE EXCEPTION 'a registered login must resolve to its human_id';
  END IF;
  ALTER ROLE pvops_test_approver_c RENAME TO pvops_test_approver_c_renamed;
  IF piggyvest_primary.ops_human_of(v_oid) IS NOT NULL THEN
    RAISE EXCEPTION 'a renamed login must not resolve to a human_id';
  END IF;
  ALTER ROLE pvops_test_approver_c_renamed RENAME TO pvops_test_approver_c;
  IF piggyvest_primary.ops_human_of(v_oid) IS DISTINCT FROM 'pvops_human_c' THEN
    RAISE EXCEPTION 'a login renamed back must resolve to its human_id again';
  END IF;
END
$$;
DO $$
DECLARE
  v_message text;
BEGIN
  FOR v_message IN SELECT m FROM (VALUES
    ('INSERT INTO piggyvest_primary.ops_login_humans VALUES (1, ''x'', ''bad human'')'),
    ('INSERT INTO piggyvest_primary.ops_login_humans VALUES (1, ''x'', '''')'),
    ('INSERT INTO piggyvest_primary.ops_login_humans (login_oid, login, human_id) '
     'SELECT oid, rolname, ''pvops_human_dup'' FROM pg_roles WHERE rolname = ''pvops_test_approver_a''')
  ) AS v(m) LOOP
    BEGIN
      EXECUTE v_message;
      RAISE EXCEPTION 'a malformed or duplicate registration must be refused: %', v_message;
    EXCEPTION WHEN check_violation OR unique_violation THEN
      NULL;
    END;
  END LOOP;
END
$$;
DO $$
DECLARE
  v_conn text;
  v_sql text;
  v_message text;
BEGIN
  FOREACH v_conn IN ARRAY ARRAY['pvops_r', 'pvops_a'] LOOP
    FOREACH v_sql IN ARRAY ARRAY[
      'SELECT human_id FROM piggyvest_primary.ops_login_humans',
      'INSERT INTO piggyvest_primary.ops_login_humans (login_oid, login, human_id) VALUES (1, ''x'', ''mallory'')',
      'UPDATE piggyvest_primary.ops_login_humans SET human_id = ''mallory''',
      'DELETE FROM piggyvest_primary.ops_login_humans'] LOOP
      BEGIN
        PERFORM dblink_exec(v_conn, v_sql);
        v_message := 'allowed';
      EXCEPTION WHEN OTHERS THEN
        v_message := SQLERRM;
      END;
      IF v_message NOT LIKE 'permission denied%' THEN
        RAISE EXCEPTION '% must not touch ops_login_humans (%): %', v_conn, v_sql, v_message;
      END IF;
    END LOOP;
  END LOOP;
END
$$;
