-- Part of piggyvest_primary_ops_approvals.sql (\ir): expiry is judged once a
-- call holds its locks, not when it started. In each case this session
-- holds the request's row lock, starts the call on a test login's own
-- connection, waits until that call is blocked on the lock, then moves the
-- request's expiry to "now" (a moment after the call started) and lets it
-- go on. The call must treat the request as expired. The wait is on a
-- condition (the call shows up as blocked in pg_locks), never a fixed delay.

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
END
$$;
