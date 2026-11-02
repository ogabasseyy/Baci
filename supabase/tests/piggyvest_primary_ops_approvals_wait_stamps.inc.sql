-- Part of piggyvest_primary_ops_approvals.sql (\ir): the same rule as the
-- expiry race part, for calls that wait on the SUBJECT's advisory lock (taken
-- before the row lock), and for calls that wait but whose request does not
-- expire: what they write carries a time at or after the release, never the
-- time the call started. Uses the helpers the expiry race part defines.

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
