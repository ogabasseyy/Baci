-- Part of piggyvest_primary_ops_approvals.sql (\ir): who may approve, and
-- consuming exactly once. Runs after the fixture, outside a transaction.

-- 1. A single approval is not enough; two distinct approvals consume once.
SELECT pg_temp.pvops_open('treasury_sweep', '0a0e0000-0000-4000-8000-000000000001',
  3, 1500000, pg_temp.pvops_bank('0123456789')) AS req1 \gset
SELECT pg_temp.pvops_digest(:'req1') AS dig1 \gset

SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_a', :'req1', 'approve', 1500000, :'dig1'), 'ok', 'a approves');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_consume('treasury_sweep', '0a0e0000-0000-4000-8000-000000000001',
    3, 1500000, pg_temp.pvops_bank('0123456789')),
  'ops_approval_insufficient', 'one approval');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_b', :'req1', 'approve', 1500000, :'dig1'), 'ok', 'b approves');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_consume('treasury_sweep', '0a0e0000-0000-4000-8000-000000000001',
    3, 1500000, pg_temp.pvops_bank('0123456789')),
  'ok', 'two distinct approvals consume');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_consume('treasury_sweep', '0a0e0000-0000-4000-8000-000000000001',
    3, 1500000, pg_temp.pvops_bank('0123456789')),
  'ops_approval_already_consumed', 'second consume');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_c', :'req1', 'approve', 1500000, :'dig1'),
  'ops_approval_closed', 'approval after consume');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM piggyvest_primary.ops_approval_requests r
    WHERE r.subject_id = '0a0e0000-0000-4000-8000-000000000001'
      AND r.state = 'consumed' AND r.consumed_by = session_user::text
      AND r.requested_by = session_user::text AND r.closed_at IS NOT NULL
  ) OR (SELECT pg_catalog.array_agg(a.approver_login ORDER BY a.approver_login)
        FROM piggyvest_primary.ops_approvals a
        JOIN piggyvest_primary.ops_approval_requests r ON r.id = a.request_id
        WHERE r.subject_id = '0a0e0000-0000-4000-8000-000000000001')
     IS DISTINCT FROM ARRAY['pvops_test_approver_a', 'pvops_test_approver_b'] THEN
    RAISE EXCEPTION 'the consumed request must record its requester, consumer and both approvers';
  END IF;
END
$$;

-- 2. The same login twice is one approval, and cannot flip to a reject.
SELECT pg_temp.pvops_open('obligation_approve', '0a0e0000-0000-4000-8000-000000000002',
  1, 9900, '{"kind":"none"}'::jsonb) AS req2 \gset
SELECT pg_temp.pvops_digest(:'req2') AS dig2 \gset
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_a', :'req2', 'approve', 9900, :'dig2'), 'ok', 'a approves once');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_a', :'req2', 'approve', 9900, :'dig2'),
  'ops_approval_already_decided', 'a approves twice');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_a', :'req2', 'reject', 9900, :'dig2'),
  'ops_approval_already_decided', 'a then rejects');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_consume('obligation_approve', '0a0e0000-0000-4000-8000-000000000002',
    1, 9900, '{"kind":"none"}'::jsonb),
  'ops_approval_insufficient', 'same login twice');

-- 3. The requester cannot approve their own request; two others can.
SELECT t.id AS req3 FROM dblink('pvops_a',
  $q$SELECT pvops_test.open_as_session('0a0e0000-0000-4000-8000-000000000003')::text$q$)
  AS t(id uuid) \gset
SELECT pg_temp.pvops_digest(:'req3') AS dig3 \gset
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM piggyvest_primary.ops_approval_requests r
                 WHERE r.subject_id = '0a0e0000-0000-4000-8000-000000000003'
                   AND r.requested_by = 'pvops_test_approver_a') THEN
    RAISE EXCEPTION 'the requester must be the SESSION_USER that opened the request';
  END IF;
END
$$;
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_a', :'req3', 'approve', 250000, :'dig3'),
  'ops_approval_requester_cannot_approve', 'requester approves');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_b', :'req3', 'approve', 250000, :'dig3'), 'ok', 'b approves');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_consume('support_payout', '0a0e0000-0000-4000-8000-000000000003', 1, 250000,
    '{"kind":"bank_account","bank_code":"044","ref":"0234567891"}'::jsonb),
  'ops_approval_insufficient', 'requester excluded from the count');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_c', :'req3', 'approve', 250000, :'dig3'), 'ok', 'c approves');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_consume('support_payout', '0a0e0000-0000-4000-8000-000000000003', 1, 250000,
    '{"kind":"bank_account","bank_code":"044","ref":"0234567891"}'::jsonb),
  'ok', 'two approvers other than the requester');

-- 4. The decision is bound to what the approver confirmed.
SELECT pg_temp.pvops_open('transfer_review_resolve', '0a0e0000-0000-4000-8000-000000000004',
  2, 700000, '{"kind":"wallet","ref":"pvw-collection-0001","label":"Collection wallet"}'::jsonb) AS req4 \gset
SELECT pg_temp.pvops_digest(:'req4') AS dig4 \gset
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_a', :'req4', 'approve', 700001, :'dig4'),
  'ops_approval_confirmation_mismatch', 'mistyped amount');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_a', :'req4', 'approve', 700000, repeat('0', 64)),
  'ops_approval_confirmation_mismatch', 'stale digest');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_a', :'req4', 'maybe', 700000, :'dig4'),
  'ops_approval_invalid_decision', 'unknown decision');

-- 5. Only approver logins decide: this suite's own login (the owner) and an
--    approver login that also holds an engine role are both refused.
DO $$
DECLARE
  v_message text;
BEGIN
  BEGIN
    PERFORM piggyvest_approvals.approve_ops_request(
      (SELECT r.id FROM piggyvest_primary.ops_approval_requests r
       WHERE r.subject_id = '0a0e0000-0000-4000-8000-000000000004'),
      'approve', 700000, (SELECT r.digest FROM piggyvest_primary.ops_approval_requests r
       WHERE r.subject_id = '0a0e0000-0000-4000-8000-000000000004'));
    v_message := 'allowed';
  EXCEPTION WHEN OTHERS THEN
    v_message := SQLERRM;
  END;
  IF v_message IS DISTINCT FROM 'ops_approval_not_an_approver' THEN
    RAISE EXCEPTION 'the owner session must not approve: %', v_message;
  END IF;
END
$$;
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_e', :'req4', 'approve', 700000, :'dig4'),
  'ops_approval_not_an_approver', 'approver with an engine role');
DO $$
DECLARE
  v_message text;
BEGIN
  BEGIN
    PERFORM t.r FROM dblink('pvops_e',
      'SELECT request_id::text FROM piggyvest_approvals.list_open_ops_requests()') AS t(r text);
    v_message := 'allowed';
  EXCEPTION WHEN OTHERS THEN
    v_message := SQLERRM;
  END;
  IF v_message IS DISTINCT FROM 'ops_approval_not_an_approver' THEN
    RAISE EXCEPTION 'an approver with an engine role must not list requests: %', v_message;
  END IF;
END
$$;

-- 6. The listing: plain label, naira, masked destination, own requests
--    hidden, own decision flagged.
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_a', :'req4', 'approve', 700000, :'dig4'), 'ok', 'a approves req4');
SELECT pg_temp.pvops_open('support_payout', '0a0e0000-0000-4000-8000-000000000005',
  1, 123456789, pg_temp.pvops_bank('0123456789'), '{"reason":"Account deletion payout"}'::jsonb) AS req5 \gset
DO $$
DECLARE
  v_row record;
BEGIN
  SELECT t.* INTO v_row FROM dblink('pvops_a', $q$
    SELECT label, amount_kobo, amount_naira, destination, approvals, decided_by_you, expires_at
    FROM piggyvest_approvals.list_open_ops_requests()
    WHERE subject = 'pvops_test.subjects:0a0e0000-0000-4000-8000-000000000004'$q$)
    AS t(label text, amount_kobo bigint, amount_naira text, destination text,
         approvals integer, decided_by_you boolean, expires_at timestamptz);
  IF v_row.label IS DISTINCT FROM 'Resolve a transfer that is under review'
     OR v_row.amount_kobo IS DISTINCT FROM 700000::bigint
     OR v_row.amount_naira IS DISTINCT FROM '₦7,000.00'
     OR v_row.destination IS DISTINCT FROM 'Collection wallet ••••0001'
     OR v_row.approvals IS DISTINCT FROM 1 OR v_row.decided_by_you IS NOT TRUE
     OR v_row.expires_at <= pg_catalog.now() + interval '23 hours' THEN
    RAISE EXCEPTION 'unexpected listing row: %', v_row;
  END IF;
  SELECT t.* INTO v_row FROM dblink('pvops_c', $q$
    SELECT amount_naira, destination, reason, requested_by
    FROM piggyvest_approvals.list_open_ops_requests()
    WHERE subject = 'pvops_test.subjects:0a0e0000-0000-4000-8000-000000000005'$q$)
    AS t(amount_naira text, destination text, reason text, requested_by text);
  IF v_row.amount_naira IS DISTINCT FROM '₦1,234,567.89'
     OR v_row.destination IS DISTINCT FROM 'Ogabassey GTBank (bank 058) ••••6789'
     OR v_row.reason IS DISTINCT FROM 'Account deletion payout'
     OR v_row.requested_by IS DISTINCT FROM session_user::text THEN
    RAISE EXCEPTION 'unexpected bank listing row: %', v_row;
  END IF;
  IF EXISTS (SELECT 1 FROM dblink('pvops_c', $q$
      SELECT destination FROM piggyvest_approvals.list_open_ops_requests()$q$) AS t(destination text)
      WHERE t.destination ~ '[0-9]{5}') THEN
    RAISE EXCEPTION 'the listing must never show a full account or wallet number';
  END IF;
END
$$;
