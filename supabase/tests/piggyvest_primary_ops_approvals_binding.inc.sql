-- Part of piggyvest_primary_ops_approvals.sql (\ir): approvals bind to the
-- exact row version, amount and destination; expiry, rejection, a jsonb
-- 'approver' key and a later role grant never resolve a request.

-- 1. A changed row version, amount or destination invalidates; only the
--    approved values consume.
SELECT pg_temp.pvops_open('support_payout', '0a0e0000-0000-4000-8000-000000000011',
  7, 420000, pg_temp.pvops_bank('0123456789')) AS req11 \gset
SELECT pg_temp.pvops_digest(:'req11') AS dig11 \gset
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_a', :'req11', 'approve', 420000, :'dig11'), 'ok', 'a approves');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_b', :'req11', 'approve', 420000, :'dig11'), 'ok', 'b approves');
SELECT pg_temp.pvops_expect(pg_temp.pvops_consume('support_payout',
  '0a0e0000-0000-4000-8000-000000000011', 8, 420000, pg_temp.pvops_bank('0123456789')),
  'ops_approval_mismatch', 'row version changed');
SELECT pg_temp.pvops_expect(pg_temp.pvops_consume('support_payout',
  '0a0e0000-0000-4000-8000-000000000011', 7, 420100, pg_temp.pvops_bank('0123456789')),
  'ops_approval_mismatch', 'amount changed');
SELECT pg_temp.pvops_expect(pg_temp.pvops_consume('support_payout',
  '0a0e0000-0000-4000-8000-000000000011', 7, 420000, pg_temp.pvops_bank('0123456780')),
  'ops_approval_mismatch', 'destination changed');
SELECT pg_temp.pvops_expect(pg_temp.pvops_consume('treasury_sweep',
  '0a0e0000-0000-4000-8000-000000000011', 7, 420000, pg_temp.pvops_bank('0123456789')),
  'ops_approval_missing', 'another action');
SELECT pg_temp.pvops_expect(pg_temp.pvops_consume('support_payout',
  '0a0e0000-0000-4000-8000-000000000011', 7, 420000, pg_temp.pvops_bank('0123456789')),
  'ok', 'the approved values');

-- 2. Re-opening with a new row version supersedes; approvals never carry over.
SELECT pg_temp.pvops_open('goal_residual_review', '0a0e0000-0000-4000-8000-000000000012',
  1, 5000, '{"kind":"none"}'::jsonb) AS req12 \gset
SELECT pg_temp.pvops_digest(:'req12') AS dig12 \gset
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_a', :'req12', 'approve', 5000, :'dig12'), 'ok', 'a approves v1');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_b', :'req12', 'approve', 5000, :'dig12'), 'ok', 'b approves v1');
SELECT pg_temp.pvops_open('goal_residual_review', '0a0e0000-0000-4000-8000-000000000012',
  1, 5000, '{"kind":"none"}'::jsonb) AS req12_same \gset
SELECT pg_temp.pvops_open('goal_residual_review', '0a0e0000-0000-4000-8000-000000000012',
  2, 5000, '{"kind":"none"}'::jsonb) AS req12_v2 \gset
DO $$
BEGIN
  IF (SELECT pg_catalog.array_agg(r.state ORDER BY r.opened_at)
      FROM piggyvest_primary.ops_approval_requests r
      WHERE r.subject_id = '0a0e0000-0000-4000-8000-000000000012')
     IS DISTINCT FROM ARRAY['superseded', 'open'] THEN
    RAISE EXCEPTION 'reopening must be idempotent for the same values and supersede on a change';
  END IF;
END
$$;
SELECT pg_temp.pvops_expect(CASE WHEN :'req12_same' = :'req12' AND :'req12_v2' <> :'req12'
  THEN 'same' ELSE 'error: ids' END, 'ok', 'reopen ids');
SELECT pg_temp.pvops_expect(pg_temp.pvops_consume('goal_residual_review',
  '0a0e0000-0000-4000-8000-000000000012', 2, 5000, '{"kind":"none"}'::jsonb),
  'ops_approval_insufficient', 'approvals of v1 do not count for v2');
SELECT pg_temp.pvops_expect(pg_temp.pvops_consume('goal_residual_review',
  '0a0e0000-0000-4000-8000-000000000012', 1, 5000, '{"kind":"none"}'::jsonb),
  'ops_approval_mismatch', 'superseded values');

-- 3. Expired (24h) requests are refused for approving and consuming. The
--    owner moves the clock fields back with the guard lifted.
SELECT pg_temp.pvops_open('misrouted_interest_resolve', '0a0e0000-0000-4000-8000-000000000013',
  1, 1234, '{"kind":"wallet","ref":"pvw-interest-0001"}'::jsonb) AS req13 \gset
SELECT pg_temp.pvops_digest(:'req13') AS dig13 \gset
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_a', :'req13', 'approve', 1234, :'dig13'), 'ok', 'a approves');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_b', :'req13', 'approve', 1234, :'dig13'), 'ok', 'b approves');
BEGIN;
ALTER TABLE piggyvest_primary.ops_approval_requests DISABLE TRIGGER USER;
UPDATE piggyvest_primary.ops_approval_requests
SET opened_at = opened_at - interval '25 hours', expires_at = expires_at - interval '25 hours'
WHERE id = :'req13';
ALTER TABLE piggyvest_primary.ops_approval_requests ENABLE TRIGGER USER;
COMMIT;
SELECT pg_temp.pvops_expect(pg_temp.pvops_consume('misrouted_interest_resolve',
  '0a0e0000-0000-4000-8000-000000000013', 1, 1234, '{"kind":"wallet","ref":"pvw-interest-0001"}'::jsonb),
  'ops_approval_expired', 'expired consume');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_c', :'req13', 'approve', 1234, :'dig13'),
  'ops_approval_expired', 'expired approve');
-- The same values can be asked again after expiry: the old request closes as
-- expired, a fresh one opens, and the old approvals do not carry over.
SELECT pg_temp.pvops_open('misrouted_interest_resolve', '0a0e0000-0000-4000-8000-000000000013',
  1, 1234, '{"kind":"wallet","ref":"pvw-interest-0001"}'::jsonb) AS req13b \gset
SELECT pg_temp.pvops_digest(:'req13b') AS dig13b \gset
DO $$
BEGIN
  IF (SELECT pg_catalog.array_agg(r.state ORDER BY r.opened_at)
      FROM piggyvest_primary.ops_approval_requests r
      WHERE r.subject_id = '0a0e0000-0000-4000-8000-000000000013')
     IS DISTINCT FROM ARRAY['expired', 'open'] THEN
    RAISE EXCEPTION 'reopening after expiry must close the old request as expired and open a new one';
  END IF;
END
$$;
SELECT pg_temp.pvops_expect(CASE WHEN :'req13b' <> :'req13' THEN 'new' ELSE 'error: same id' END,
  'ok', 'a fresh request after expiry');
SELECT pg_temp.pvops_expect(pg_temp.pvops_consume('misrouted_interest_resolve',
  '0a0e0000-0000-4000-8000-000000000013', 1, 1234, '{"kind":"wallet","ref":"pvw-interest-0001"}'::jsonb),
  'ops_approval_insufficient', 'expired approvals do not carry over');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_a', :'req13b', 'approve', 1234, :'dig13b'), 'ok', 'a approves again');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_b', :'req13b', 'approve', 1234, :'dig13b'), 'ok', 'b approves again');
SELECT pg_temp.pvops_expect(pg_temp.pvops_consume('misrouted_interest_resolve',
  '0a0e0000-0000-4000-8000-000000000013', 1, 1234, '{"kind":"wallet","ref":"pvw-interest-0001"}'::jsonb),
  'ok', 'fresh approvals consume');

-- 4. Any reject closes the request for good.
SELECT pg_temp.pvops_open('obligation_reject', '0a0e0000-0000-4000-8000-000000000014',
  4, 80000, '{"kind":"none"}'::jsonb) AS req14 \gset
SELECT pg_temp.pvops_digest(:'req14') AS dig14 \gset
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_a', :'req14', 'approve', 80000, :'dig14'), 'ok', 'a approves');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_b', :'req14', 'reject', 80000, :'dig14'), 'ok', 'b rejects');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_c', :'req14', 'approve', 80000, :'dig14'),
  'ops_approval_closed', 'approve after reject');
SELECT pg_temp.pvops_expect(pg_temp.pvops_consume('obligation_reject',
  '0a0e0000-0000-4000-8000-000000000014', 4, 80000, '{"kind":"none"}'::jsonb),
  'ops_approval_rejected', 'consume after reject');

-- 5. A jsonb 'approver' key is data, never an approval or an identity.
SELECT pg_temp.pvops_open('onboarding_adopt', '0a0e0000-0000-4000-8000-000000000015', 1, 0,
  '{"kind":"none"}'::jsonb, pg_catalog.jsonb_build_object(
    'reason', 'Duplicate account check',
    'approver', 'pvops_test_approver_a',
    'approvals', pg_catalog.jsonb_build_array('pvops_test_approver_a', 'pvops_test_approver_b')))
  AS req15 \gset
SELECT pg_temp.pvops_expect(pg_temp.pvops_consume('onboarding_adopt',
  '0a0e0000-0000-4000-8000-000000000015', 1, 0, '{"kind":"none"}'::jsonb),
  'ops_approval_insufficient', 'jsonb approver ignored');
DO $$
DECLARE
  v_message text;
BEGIN
  IF EXISTS (SELECT 1 FROM piggyvest_primary.ops_approvals a
             JOIN piggyvest_primary.ops_approval_requests r ON r.id = a.request_id
             WHERE r.subject_id = '0a0e0000-0000-4000-8000-000000000015')
     OR NOT EXISTS (SELECT 1 FROM piggyvest_primary.ops_approval_requests r
                    WHERE r.subject_id = '0a0e0000-0000-4000-8000-000000000015'
                      AND r.requested_by = 'pvops_test_requester_r') THEN
    RAISE EXCEPTION 'a jsonb approver must record no approval and leave the requester unchanged';
  END IF;
  BEGIN
    PERFORM pg_temp.pvops_open('onboarding_adopt', '0a0e0000-0000-4000-8000-000000000016', 1, 0,
      '{"kind":"none","approver":"pvops_test_approver_a"}'::jsonb);
    v_message := 'allowed';
  EXCEPTION WHEN OTHERS THEN
    v_message := SQLERRM;
  END;
  IF v_message IS DISTINCT FROM 'ops_approval_invalid_request' THEN
    RAISE EXCEPTION 'a destination carrying an approver key must be refused: %', v_message;
  END IF;
END
$$;

-- 6. Approvals are re-checked at consume: an approver who gains an engine
--    role afterwards no longer counts, until the extra role is removed.
SELECT pg_temp.pvops_open('checkout_tender_review_resolve', '0a0e0000-0000-4000-8000-000000000017',
  1, 310000, '{"kind":"wallet","ref":"pvw-customer-main-0042"}'::jsonb) AS req17 \gset
SELECT pg_temp.pvops_digest(:'req17') AS dig17 \gset
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_a', :'req17', 'approve', 310000, :'dig17'), 'ok', 'a approves');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_b', :'req17', 'approve', 310000, :'dig17'), 'ok', 'b approves');
GRANT piggyvest_primary_evidence TO pvops_test_approver_b;
SELECT pg_temp.pvops_expect(pg_temp.pvops_consume('checkout_tender_review_resolve',
  '0a0e0000-0000-4000-8000-000000000017', 1, 310000, '{"kind":"wallet","ref":"pvw-customer-main-0042"}'::jsonb),
  'ops_approval_insufficient', 'approver later granted an engine role');
REVOKE piggyvest_primary_evidence FROM pvops_test_approver_b;
SELECT pg_temp.pvops_expect(pg_temp.pvops_consume('checkout_tender_review_resolve',
  '0a0e0000-0000-4000-8000-000000000017', 1, 310000, '{"kind":"wallet","ref":"pvw-customer-main-0042"}'::jsonb),
  'ok', 'approver eligible again');

-- 7. A requester never sees their own open request; other approvers do.
SELECT t.id AS req18 FROM dblink('pvops_a',
  $q$SELECT pvops_test.open_as_session('0a0e0000-0000-4000-8000-000000000018')::text$q$)
  AS t(id uuid) \gset
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM dblink('pvops_a',
       'SELECT subject FROM piggyvest_approvals.list_open_ops_requests()') AS t(subject text)
       WHERE t.subject LIKE '%000000000018')
     OR NOT EXISTS (SELECT 1 FROM dblink('pvops_b',
       'SELECT subject FROM piggyvest_approvals.list_open_ops_requests()') AS t(subject text)
       WHERE t.subject LIKE '%000000000018') THEN
    RAISE EXCEPTION 'the listing must hide the caller''s own requests only';
  END IF;
END
$$;

-- 8. Closed requests and recorded decisions are immutable, even for the owner.
DO $$
DECLARE
  v_message text;
BEGIN
  BEGIN
    UPDATE piggyvest_primary.ops_approval_requests SET state = 'open', closed_at = NULL,
      consumed_by = NULL WHERE subject_id = '0a0e0000-0000-4000-8000-000000000001';
    v_message := 'allowed';
  EXCEPTION WHEN OTHERS THEN
    v_message := SQLERRM;
  END;
  IF v_message IS DISTINCT FROM 'ops_approval_request_is_closed' THEN
    RAISE EXCEPTION 'a consumed request must not reopen: %', v_message;
  END IF;
  BEGIN
    DELETE FROM piggyvest_primary.ops_approvals;
    v_message := 'allowed';
  EXCEPTION WHEN OTHERS THEN
    v_message := SQLERRM;
  END;
  IF v_message IS DISTINCT FROM 'ops_approvals_are_append_only' THEN
    RAISE EXCEPTION 'recorded decisions must not be deleted: %', v_message;
  END IF;
END
$$;

-- 9. Consume re-checks every stored decision on its own: a row for the
--    requester or for a non-approver login (written here by the owner, as a
--    faulty caller might) never counts.
SELECT t.id AS req19 FROM dblink('pvops_a',
  $q$SELECT pvops_test.open_as_session('0a0e0000-0000-4000-8000-000000000019')::text$q$)
  AS t(id uuid) \gset
SELECT pg_temp.pvops_digest(:'req19') AS dig19 \gset
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_b', :'req19', 'approve', 250000, :'dig19'), 'ok', 'b approves');
INSERT INTO piggyvest_primary.ops_approvals (request_id, approver_login, approver_role_oid, decision, digest)
SELECT :'req19', r.rolname, r.oid, 'approve', :'dig19'
FROM pg_catalog.pg_roles r WHERE r.rolname IN ('pvops_test_approver_a', 'pvops_test_engine_e');
SELECT pg_temp.pvops_expect(pg_temp.pvops_consume('support_payout',
  '0a0e0000-0000-4000-8000-000000000019', 1, 250000,
  '{"kind":"bank_account","bank_code":"044","ref":"0234567891"}'::jsonb),
  'ops_approval_insufficient', 'requester and non-approver rows ignored');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_c', :'req19', 'approve', 250000, :'dig19'), 'ok', 'c approves');
DO $$
DECLARE
  v_message text;
BEGIN
  BEGIN
    PERFORM t.id FROM dblink('pvops_b',
      $q$SELECT pvops_test.consume_as_session('0a0e0000-0000-4000-8000-000000000019')::text$q$)
      AS t(id text);
    v_message := 'allowed';
  EXCEPTION WHEN OTHERS THEN
    v_message := SQLERRM;
  END;
  IF v_message IS DISTINCT FROM 'ops_approval_consumer_is_approver' THEN
    RAISE EXCEPTION 'an approver must never complete the action it approved: %', v_message;
  END IF;
END
$$;
SELECT pg_temp.pvops_expect(pg_temp.pvops_consume('support_payout',
  '0a0e0000-0000-4000-8000-000000000019', 1, 250000,
  '{"kind":"bank_account","bank_code":"044","ref":"0234567891"}'::jsonb),
  'ok', 'two real approvers');
