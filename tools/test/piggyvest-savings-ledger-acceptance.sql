CREATE SCHEMA ledger_test;
CREATE FUNCTION ledger_test.apply(command jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT piggyvest_savings_ledger.apply(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', command);
$$;
CREATE FUNCTION ledger_test.command(number integer, kind text, principal bigint DEFAULT 0,
  interest bigint DEFAULT 0, reference integer DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('operationId', '50000000-0000-4000-8000-' || lpad(number::text,12,'0'),
    'kind', kind, 'principalKobo', principal, 'interestKobo', interest,
    'referenceId', CASE WHEN reference IS NOT NULL THEN '50000000-0000-4000-8000-' || lpad(reference::text,12,'0') END,
    'evidenceId', 'synthetic-' || number);
$$;
CREATE FUNCTION ledger_test.reject(command jsonb, expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM ledger_test.apply(command);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = expected THEN RETURN; END IF;
    RAISE;
  END;
  RAISE EXCEPTION 'expected rejection: %', expected;
END $$;
INSERT INTO piggyvest_savings_ledger.bindings
  (integration_id, merchant_id, customer_id, goal_id, authorized_login, enabled)
VALUES ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'harness_admin', true);
DO $$
DECLARE original jsonb;
BEGIN
  original := ledger_test.apply(ledger_test.command(1, 'credit_principal', 1000));
  IF ledger_test.apply(ledger_test.command(1, 'credit_principal', 1000)) <> original THEN
    RAISE EXCEPTION 'replay changed result';
  END IF;
  PERFORM ledger_test.reject(ledger_test.command(1, 'credit_principal', 999), 'ledger idempotency conflict');
  PERFORM ledger_test.apply(ledger_test.command(2, 'record_pending_interest', 0, 900));
  PERFORM ledger_test.reject(ledger_test.command(3, 'reserve_purchase', 0, 1), 'ledger insufficient funds');
  PERFORM ledger_test.apply(ledger_test.command(4, 'credit_eligible_paid_interest', 0, 100));
  PERFORM ledger_test.apply(ledger_test.command(5, 'reserve_purchase', 800, 100));
  PERFORM ledger_test.reject(ledger_test.command(6, 'reserve_refund', 1), 'ledger reservation conflict');
  PERFORM ledger_test.reject(ledger_test.command(7, 'reverse_credit', 0, 0, 1), 'ledger insufficient funds');
  PERFORM ledger_test.apply(ledger_test.command(8, 'release_purchase', 0, 0, 5));
  PERFORM ledger_test.reject(ledger_test.command(9, 'settle_reservation', 0, 0, 5), 'ledger reference consumed');
  PERFORM ledger_test.apply(ledger_test.command(10, 'reverse_credit', 0, 0, 4));
  PERFORM ledger_test.reject(ledger_test.command(11, 'reverse_credit', 0, 0, 4), 'ledger reference consumed');
  PERFORM ledger_test.apply(ledger_test.command(12, 'reserve_refund', 1000));
  PERFORM ledger_test.reject(ledger_test.command(13, 'release_purchase', 0, 0, 12), 'ledger invalid reference');
  PERFORM ledger_test.apply(ledger_test.command(14, 'credit_principal', 50));
  PERFORM ledger_test.apply(ledger_test.command(15, 'settle_reservation', 0, 0, 12));
  IF EXISTS (SELECT operation_id FROM piggyvest_savings_ledger.postings GROUP BY operation_id HAVING sum(amount_kobo) <> 0) THEN
    RAISE EXCEPTION 'unbalanced ledger';
  END IF;
END $$;
BEGIN;
SELECT ledger_test.apply(ledger_test.command(400, 'credit_eligible_paid_interest', 0, 10));
SELECT piggyvest_savings_ledger.apply(
  '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  '{"operationId":"50000000-0000-4000-8000-000000000401","kind":"reserve_purchase",
    "principalKobo":40.0,"interestKobo":10.0,"evidenceId":"synthetic-401","referenceId":null}'::jsonb);
SELECT ledger_test.apply(ledger_test.command(402, 'release_purchase', 0, 0, 401));
SELECT piggyvest_savings_ledger.apply(
  '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  '{"operationId":"50000000-0000-4000-8000-000000000403","kind":"reserve_purchase",
    "principalKobo":40.0,"interestKobo":10.0,"evidenceId":"synthetic-403","referenceId":null}'::jsonb);
SELECT ledger_test.apply(ledger_test.command(404, 'settle_reservation', 0, 0, 403));
DO $$
DECLARE snapshot jsonb;
BEGIN
  snapshot := piggyvest_savings_ledger.snapshot(
    '40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001');
  IF snapshot->'ledger'->>'confirmedPrincipalKobo' <> '10'
    OR snapshot->'ledger'->>'paidEligibleInterestKobo' <> '0'
    OR snapshot->'activeReservation' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'decimal numeric reservation release/settle regression';
  END IF;
END $$;
ROLLBACK;
CREATE FUNCTION ledger_test.assert_restart() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF ledger_test.apply(ledger_test.command(1, 'credit_principal', 1000))->>'operationId' <> '50000000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'lost durable replay';
  END IF;
  IF (SELECT sum(posting.amount_kobo) FROM piggyvest_savings_ledger.postings posting
    JOIN piggyvest_savings_ledger.operations operation ON operation.id = posting.operation_id
    WHERE posting.account = 'principal' AND operation.goal_id = '30000000-0000-4000-8000-000000000001') <> 50 THEN
    RAISE EXCEPTION 'lost late principal';
  END IF;
END $$;
