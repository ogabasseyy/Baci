-- Part of piggyvest_primary_ops_approvals.sql (\ir): time is read once a
-- call holds its locks, not when it started. In each case this session holds
-- a lock a call needs (the request's row lock, or the subject's advisory
-- lock), starts the call on a test login's own connection, waits until that
-- call is blocked, then lets it go on, after moving the request's expiry to
-- "now" (a moment after the call started) or after noting the time of the
-- release. The call must treat the request as expired, or stamp its own
-- writes with a time at or after the release. The wait is on a condition
-- (the call shows up as blocked in pg_locks), never a fixed delay.

-- Returns once some other session is waiting on this transaction.
CREATE FUNCTION pg_temp.pvops_wait_until_blocked() RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_xid xid := (pg_catalog.pg_current_xact_id()::text)::xid;
BEGIN
  FOR i IN 1..12000 LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_locks l
               WHERE l.locktype = 'transactionid' AND l.transactionid = v_xid
                 AND NOT l.granted) THEN
      RETURN;
    END IF;
    PERFORM pg_catalog.pg_sleep(0.01);
  END LOOP;
  RAISE EXCEPTION 'no call ever waited on the request lock';
END
$$;

-- Holds the subject's advisory lock until this transaction ends.
CREATE FUNCTION pg_temp.pvops_hold_subject(p_action text, p_subject uuid) RETURNS void
LANGUAGE sql
AS $$
  SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'ops-approval:' || p_action || ':pvops_test.subjects:' || p_subject::text, 0))
$$;

-- Returns once some other session is waiting for that advisory lock.
CREATE FUNCTION pg_temp.pvops_wait_until_subject_blocked(p_action text, p_subject uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_key bigint := pg_catalog.hashtextextended(
    'ops-approval:' || p_action || ':pvops_test.subjects:' || p_subject::text, 0);
BEGIN
  FOR i IN 1..12000 LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_locks l
               WHERE l.locktype = 'advisory' AND NOT l.granted AND l.objsubid = 1
                 AND l.classid = ((v_key >> 32) & 4294967295)::bigint::oid
                 AND l.objid = (v_key & 4294967295)::bigint::oid) THEN
      RETURN;
    END IF;
    PERFORM pg_catalog.pg_sleep(0.01);
  END LOOP;
  RAISE EXCEPTION 'no call ever waited on the subject lock';
END
$$;

-- Collects the started call's outcome: its text result, or 'error: <message>'.
CREATE FUNCTION pg_temp.pvops_collect(p_conn text) RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_result text;
BEGIN
  BEGIN
    SELECT t.r INTO v_result FROM dblink_get_result(p_conn) AS t(r text);
  EXCEPTION WHEN OTHERS THEN
    v_result := 'error: ' || SQLERRM;
  END;
  -- Every sent query ends with one empty result; read it so the connection
  -- is free again.
  PERFORM t.r FROM dblink_get_result(p_conn) AS t(r text);
  RETURN v_result;
END
$$;

-- Moves a request's expiry to now, keeping expires_at = opened_at + 24h.
CREATE FUNCTION pg_temp.pvops_expire_now(p_request uuid) RETURNS void
LANGUAGE sql
AS $$
  UPDATE piggyvest_primary.ops_approval_requests r
  SET opened_at = v.t - interval '24 hours', expires_at = v.t
  FROM (SELECT pg_catalog.clock_timestamp() AS t) AS v
  WHERE r.id = p_request
$$;

-- 1. Consume: two approvals, but the request expires while consume waits.
SELECT pg_temp.pvops_open('support_payout', '0a0e0000-0000-4000-8000-000000000030',
  1, 70000, pg_temp.pvops_bank('0123456789')) AS req30 \gset
SELECT pg_temp.pvops_digest(:'req30') AS dig30 \gset
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_a', :'req30', 'approve', 70000, :'dig30'), 'ok', 'a approves');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_b', :'req30', 'approve', 70000, :'dig30'), 'ok', 'b approves');
BEGIN;
ALTER TABLE piggyvest_primary.ops_approval_requests DISABLE TRIGGER USER;
SELECT 1 AS pvops_locked FROM piggyvest_primary.ops_approval_requests
WHERE id = :'req30' FOR UPDATE \gset
SELECT dblink_send_query('pvops_r', pg_catalog.format(
  'SELECT pvops_test.consume_request(%L, %L::uuid, 1, 70000, %L::jsonb)::text',
  'support_payout', '0a0e0000-0000-4000-8000-000000000030', pg_temp.pvops_bank('0123456789')))
  AS pvops_sent \gset
SELECT pg_temp.pvops_wait_until_blocked();
SELECT pg_temp.pvops_expire_now(:'req30');
ALTER TABLE piggyvest_primary.ops_approval_requests ENABLE TRIGGER USER;
COMMIT;
SELECT pg_temp.pvops_expect(pg_temp.pvops_collect('pvops_r'), 'ops_approval_expired',
  'consume that waited past expiry');

-- 2. Approve: the request expires while the decision waits.
SELECT pg_temp.pvops_open('support_payout', '0a0e0000-0000-4000-8000-000000000031',
  1, 71000, pg_temp.pvops_bank('0123456789')) AS req31 \gset
SELECT pg_temp.pvops_digest(:'req31') AS dig31 \gset
BEGIN;
ALTER TABLE piggyvest_primary.ops_approval_requests DISABLE TRIGGER USER;
SELECT 1 AS pvops_locked FROM piggyvest_primary.ops_approval_requests
WHERE id = :'req31' FOR UPDATE \gset
SELECT dblink_send_query('pvops_b', pg_catalog.format(
  'SELECT piggyvest_approvals.approve_ops_request(%L::uuid, %L, 71000, %L)::text',
  :'req31', 'approve', :'dig31')) AS pvops_sent \gset
SELECT pg_temp.pvops_wait_until_blocked();
SELECT pg_temp.pvops_expire_now(:'req31');
ALTER TABLE piggyvest_primary.ops_approval_requests ENABLE TRIGGER USER;
COMMIT;
SELECT pg_temp.pvops_expect(pg_temp.pvops_collect('pvops_b'), 'ops_approval_expired',
  'approval that waited past expiry');
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM piggyvest_primary.ops_approvals a
             JOIN piggyvest_primary.ops_approval_requests r ON r.id = a.request_id
             WHERE r.subject_id = '0a0e0000-0000-4000-8000-000000000031') THEN
    RAISE EXCEPTION 'a decision that waited past expiry must not be recorded';
  END IF;
END
$$;

-- 3. Re-open with the same values: the request expires while the call
--    waits, so it must close as expired and a fresh request open, rather
--    than the expired one being handed back.
SELECT pg_temp.pvops_open('support_payout', '0a0e0000-0000-4000-8000-000000000032',
  1, 72000, pg_temp.pvops_bank('0123456789')) AS req32 \gset
BEGIN;
ALTER TABLE piggyvest_primary.ops_approval_requests DISABLE TRIGGER USER;
SELECT 1 AS pvops_locked FROM piggyvest_primary.ops_approval_requests
WHERE id = :'req32' FOR UPDATE \gset
SELECT dblink_send_query('pvops_r', pg_catalog.format(
  'SELECT pvops_test.open_request(%L, %L, %L::uuid, 1, 72000, %L::jsonb, %L::jsonb)::text',
  'support_payout', 'pvops_test.subjects', '0a0e0000-0000-4000-8000-000000000032',
  pg_temp.pvops_bank('0123456789'), '{}')) AS pvops_sent \gset
SELECT pg_temp.pvops_wait_until_blocked();
SELECT pg_temp.pvops_expire_now(:'req32');
ALTER TABLE piggyvest_primary.ops_approval_requests ENABLE TRIGGER USER;
COMMIT;
SELECT pg_temp.pvops_collect('pvops_r') AS req32b \gset
SELECT pg_temp.pvops_expect(
  CASE WHEN :'req32b' LIKE 'error: %' THEN :'req32b'
       WHEN :'req32b' <> :'req32' THEN 'new' ELSE 'error: the expired request came back' END,
  'ok', 'reopen that waited past expiry');
DO $$
BEGIN
  IF (SELECT pg_catalog.array_agg(r.state ORDER BY r.opened_at)
      FROM piggyvest_primary.ops_approval_requests r
      WHERE r.subject_id = '0a0e0000-0000-4000-8000-000000000032')
     IS DISTINCT FROM ARRAY['expired', 'open'] THEN
    RAISE EXCEPTION 'a reopen that waited past expiry must close the old request as expired';
  END IF;
  -- The fresh request starts after the old one expired, and keeps a full
  -- 24 hours: its times come from after the wait, not from the call's start.
  IF NOT EXISTS (
    SELECT 1
    FROM piggyvest_primary.ops_approval_requests o
    JOIN piggyvest_primary.ops_approval_requests n
      ON n.subject_id = o.subject_id AND n.state = 'open'
    WHERE o.subject_id = '0a0e0000-0000-4000-8000-000000000032' AND o.state = 'expired'
      AND o.closed_at >= o.expires_at AND n.opened_at >= o.expires_at
      AND n.expires_at = n.opened_at + interval '24 hours'
  ) THEN
    RAISE EXCEPTION 'a reopen that waited must be stamped after the wait';
  END IF;
END
$$;

-- 4. A reject waits on the row lock and the request expires: refused, never
--    recorded, and the request is not closed as rejected.
SELECT pg_temp.pvops_open('support_payout', '0a0e0000-0000-4000-8000-000000000033',
  1, 73000, pg_temp.pvops_bank('0123456789')) AS req33 \gset
SELECT pg_temp.pvops_digest(:'req33') AS dig33 \gset
BEGIN;
ALTER TABLE piggyvest_primary.ops_approval_requests DISABLE TRIGGER USER;
SELECT 1 AS pvops_locked FROM piggyvest_primary.ops_approval_requests
WHERE id = :'req33' FOR UPDATE \gset
SELECT dblink_send_query('pvops_c', pg_catalog.format(
  'SELECT piggyvest_approvals.approve_ops_request(%L::uuid, %L, 73000, %L)::text',
  :'req33', 'reject', :'dig33')) AS pvops_sent \gset
SELECT pg_temp.pvops_wait_until_blocked();
SELECT pg_temp.pvops_expire_now(:'req33');
ALTER TABLE piggyvest_primary.ops_approval_requests ENABLE TRIGGER USER;
COMMIT;
SELECT pg_temp.pvops_expect(pg_temp.pvops_collect('pvops_c'), 'ops_approval_expired',
  'reject that waited past expiry');
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM piggyvest_primary.ops_approvals a
             WHERE a.request_id = (SELECT r.id FROM piggyvest_primary.ops_approval_requests r
                                   WHERE r.subject_id = '0a0e0000-0000-4000-8000-000000000033'))
     OR (SELECT r.state FROM piggyvest_primary.ops_approval_requests r
         WHERE r.subject_id = '0a0e0000-0000-4000-8000-000000000033') IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'a reject that waited past expiry must not be recorded or close the request';
  END IF;
END
$$;

-- 5. Open with the same values while the call waits on the SUBJECT lock (the
--    advisory lock, taken before the row lock): the request expires
--    meanwhile, so it closes as expired and a fresh one opens.
SELECT pg_temp.pvops_open('support_payout', '0a0e0000-0000-4000-8000-000000000034',
  1, 74000, pg_temp.pvops_bank('0123456789')) AS req34 \gset
BEGIN;
ALTER TABLE piggyvest_primary.ops_approval_requests DISABLE TRIGGER USER;
SELECT pg_temp.pvops_hold_subject('support_payout', '0a0e0000-0000-4000-8000-000000000034');
SELECT dblink_send_query('pvops_r', pg_catalog.format(
  'SELECT pvops_test.open_request(%L, %L, %L::uuid, 1, 74000, %L::jsonb, %L::jsonb)::text',
  'support_payout', 'pvops_test.subjects', '0a0e0000-0000-4000-8000-000000000034',
  pg_temp.pvops_bank('0123456789'), '{}')) AS pvops_sent \gset
SELECT pg_temp.pvops_wait_until_subject_blocked('support_payout',
  '0a0e0000-0000-4000-8000-000000000034');
SELECT pg_temp.pvops_expire_now(:'req34');
ALTER TABLE piggyvest_primary.ops_approval_requests ENABLE TRIGGER USER;
COMMIT;
SELECT pg_temp.pvops_collect('pvops_r') AS req34b \gset
SELECT pg_temp.pvops_expect(
  CASE WHEN :'req34b' LIKE 'error: %' THEN :'req34b'
       WHEN :'req34b' <> :'req34' THEN 'new' ELSE 'error: the expired request came back' END,
  'ok', 'reopen that waited on the subject lock past expiry');
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM piggyvest_primary.ops_approval_requests o
    JOIN piggyvest_primary.ops_approval_requests n
      ON n.subject_id = o.subject_id AND n.state = 'open'
    WHERE o.subject_id = '0a0e0000-0000-4000-8000-000000000034' AND o.state = 'expired'
      AND o.closed_at >= o.expires_at AND n.opened_at >= o.expires_at
      AND n.expires_at = n.opened_at + interval '24 hours'
  ) THEN
    RAISE EXCEPTION 'a reopen that waited on the subject lock must be stamped after the wait';
  END IF;
END
$$;

-- 6. Consume waits on the SUBJECT lock with two real approvals and the
--    request expires meanwhile: refused as expired, not consumed.
SELECT pg_temp.pvops_open('support_payout', '0a0e0000-0000-4000-8000-000000000035',
  1, 75000, pg_temp.pvops_bank('0123456789')) AS req35 \gset
SELECT pg_temp.pvops_digest(:'req35') AS dig35 \gset
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_a', :'req35', 'approve', 75000, :'dig35'), 'ok', 'a approves');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_b', :'req35', 'approve', 75000, :'dig35'), 'ok', 'b approves');
BEGIN;
ALTER TABLE piggyvest_primary.ops_approval_requests DISABLE TRIGGER USER;
SELECT pg_temp.pvops_hold_subject('support_payout', '0a0e0000-0000-4000-8000-000000000035');
SELECT dblink_send_query('pvops_r', pg_catalog.format(
  'SELECT pvops_test.consume_request(%L, %L::uuid, 1, 75000, %L::jsonb)::text',
  'support_payout', '0a0e0000-0000-4000-8000-000000000035', pg_temp.pvops_bank('0123456789')))
  AS pvops_sent \gset
SELECT pg_temp.pvops_wait_until_subject_blocked('support_payout',
  '0a0e0000-0000-4000-8000-000000000035');
SELECT pg_temp.pvops_expire_now(:'req35');
ALTER TABLE piggyvest_primary.ops_approval_requests ENABLE TRIGGER USER;
COMMIT;
SELECT pg_temp.pvops_expect(pg_temp.pvops_collect('pvops_r'), 'ops_approval_expired',
  'consume that waited on the subject lock past expiry');

-- 7. Nothing expires, but each call waits: what it writes carries a time at
--    or after the release, never the time it started. A decision first.
SELECT pg_temp.pvops_open('support_payout', '0a0e0000-0000-4000-8000-000000000036',
  1, 76000, pg_temp.pvops_bank('0123456789')) AS req36 \gset
SELECT pg_temp.pvops_digest(:'req36') AS dig36 \gset
BEGIN;
SELECT 1 AS pvops_locked FROM piggyvest_primary.ops_approval_requests
WHERE id = :'req36' FOR UPDATE \gset
SELECT dblink_send_query('pvops_b', pg_catalog.format(
  'SELECT piggyvest_approvals.approve_ops_request(%L::uuid, %L, 76000, %L)::text',
  :'req36', 'approve', :'dig36')) AS pvops_sent \gset
SELECT pg_temp.pvops_wait_until_blocked();
SELECT pg_catalog.clock_timestamp() AS pvops_released \gset
COMMIT;
SELECT pg_temp.pvops_expect(pg_temp.pvops_collect('pvops_b'), 'ok', 'approval after a wait');
SELECT pg_temp.pvops_assert(
  (SELECT a.decided_at FROM piggyvest_primary.ops_approvals a
   WHERE a.request_id = (SELECT r.id FROM piggyvest_primary.ops_approval_requests r
                         WHERE r.subject_id = '0a0e0000-0000-4000-8000-000000000036'))
  >= :'pvops_released'::timestamptz,
  'a decision must be stamped after its wait, not when the call started');

-- 8. A request replaced (the amount changed) after a wait on the subject
--    lock: the old one's closed_at and the new one's opened_at/expires_at
--    come from after the wait.
SELECT pg_temp.pvops_open('support_payout', '0a0e0000-0000-4000-8000-000000000037',
  1, 77000, pg_temp.pvops_bank('0123456789')) AS req37 \gset
BEGIN;
SELECT pg_temp.pvops_hold_subject('support_payout', '0a0e0000-0000-4000-8000-000000000037');
SELECT dblink_send_query('pvops_r', pg_catalog.format(
  'SELECT pvops_test.open_request(%L, %L, %L::uuid, 1, 77500, %L::jsonb, %L::jsonb)::text',
  'support_payout', 'pvops_test.subjects', '0a0e0000-0000-4000-8000-000000000037',
  pg_temp.pvops_bank('0123456789'), '{}')) AS pvops_sent \gset
SELECT pg_temp.pvops_wait_until_subject_blocked('support_payout',
  '0a0e0000-0000-4000-8000-000000000037');
SELECT pg_catalog.clock_timestamp() AS pvops_released \gset
COMMIT;
SELECT pg_temp.pvops_collect('pvops_r') AS req37b \gset
SELECT pg_temp.pvops_expect(
  CASE WHEN :'req37b' LIKE 'error: %' THEN :'req37b'
       WHEN :'req37b' <> :'req37' THEN 'new' ELSE 'error: not replaced' END,
  'ok', 'replacement after a wait');
SELECT pg_temp.pvops_assert(EXISTS (
    SELECT 1
    FROM piggyvest_primary.ops_approval_requests o
    JOIN piggyvest_primary.ops_approval_requests n
      ON n.subject_id = o.subject_id AND n.state = 'open'
    WHERE o.subject_id = '0a0e0000-0000-4000-8000-000000000037' AND o.state = 'superseded'
      AND o.closed_at >= :'pvops_released'::timestamptz
      AND n.opened_at >= :'pvops_released'::timestamptz
      AND n.expires_at = n.opened_at + interval '24 hours'),
  'a replacement must be stamped after its wait, not when the call started');

-- 9. A consume after a wait: closed_at comes from after the wait.
SELECT pg_temp.pvops_open('support_payout', '0a0e0000-0000-4000-8000-000000000038',
  1, 78000, pg_temp.pvops_bank('0123456789')) AS req38 \gset
SELECT pg_temp.pvops_digest(:'req38') AS dig38 \gset
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_a', :'req38', 'approve', 78000, :'dig38'), 'ok', 'a approves');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_b', :'req38', 'approve', 78000, :'dig38'), 'ok', 'b approves');
BEGIN;
SELECT pg_temp.pvops_hold_subject('support_payout', '0a0e0000-0000-4000-8000-000000000038');
SELECT dblink_send_query('pvops_r', pg_catalog.format(
  'SELECT pvops_test.consume_request(%L, %L::uuid, 1, 78000, %L::jsonb)::text',
  'support_payout', '0a0e0000-0000-4000-8000-000000000038', pg_temp.pvops_bank('0123456789')))
  AS pvops_sent \gset
SELECT pg_temp.pvops_wait_until_subject_blocked('support_payout',
  '0a0e0000-0000-4000-8000-000000000038');
SELECT pg_catalog.clock_timestamp() AS pvops_released \gset
COMMIT;
SELECT pg_temp.pvops_expect(pg_temp.pvops_collect('pvops_r'), 'ok', 'consume after a wait');
SELECT pg_temp.pvops_assert(EXISTS (
    SELECT 1 FROM piggyvest_primary.ops_approval_requests r
    WHERE r.subject_id = '0a0e0000-0000-4000-8000-000000000038' AND r.state = 'consumed'
      AND r.closed_at >= :'pvops_released'::timestamptz),
  'a consume must be stamped after its wait, not when the call started');
