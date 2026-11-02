-- Part of piggyvest_primary_ops_approvals.sql (\ir): who may open a request,
-- what a request may carry, a rejection as a veto on the same values, and a
-- caller's temporary objects never running inside the functions. Runs after
-- the binding part, outside a transaction.

-- 1. Only a dedicated login opens a request: this suite's own login (the
--    migration owner) is refused, and so is a login with an elevated
--    attribute, until the attribute is removed.
DO $$
DECLARE
  v_message text;
BEGIN
  BEGIN
    PERFORM piggyvest_primary.open_ops_request('support_payout', 'pvops_test.subjects',
      '0a0e0000-0000-4000-8000-000000000020', 1, 5000, '{"kind":"none"}'::jsonb, '{}'::jsonb);
    v_message := 'allowed';
  EXCEPTION WHEN OTHERS THEN
    v_message := SQLERRM;
  END;
  IF v_message IS DISTINCT FROM 'ops_approval_invalid_requester' THEN
    RAISE EXCEPTION 'the owner session must not open a request: %', v_message;
  END IF;
END
$$;
ALTER ROLE pvops_test_requester_r CREATEROLE;
SELECT pg_temp.pvops_expect(pg_temp.pvops_try_open('support_payout', 'pvops_test.subjects',
  '0a0e0000-0000-4000-8000-000000000020', 1, 5000, '{"kind":"none"}'::jsonb),
  'ops_approval_invalid_requester', 'requester with an elevated attribute');
ALTER ROLE pvops_test_requester_r NOCREATEROLE;
SELECT pg_temp.pvops_expect(pg_temp.pvops_try_open('support_payout', 'pvops_test.subjects',
  '0a0e0000-0000-4000-8000-000000000020', 1, 5000, '{"kind":"none"}'::jsonb),
  'ok', 'a dedicated requester login');

-- 2. Malformed requests are refused before anything is recorded: unknown
--    action, bad subject table, negative or out-of-range amount or version,
--    and a destination label that could carry an account number or pose as
--    the masked destination.
SELECT pg_temp.pvops_expect(pg_temp.pvops_try_open(v.action, v.subject_table,
    '0a0e0000-0000-4000-8000-000000000021', v.version, v.amount, v.destination),
  v.expected, v.case_label)
FROM (VALUES
  ('not_an_action', 'pvops_test.subjects', 1::bigint, 5000::bigint, '{"kind":"none"}'::jsonb,
   'ops_approval_unknown_action', 'unknown action'),
  ('support_payout', 'Bad.Table', 1, 5000, '{"kind":"none"}', 'ops_approval_invalid_request',
   'malformed subject table'),
  ('support_payout', 'pvops_test.subjects', -1, 5000, '{"kind":"none"}',
   'ops_approval_invalid_request', 'negative row version'),
  ('support_payout', 'pvops_test.subjects', 1, -1, '{"kind":"none"}',
   'ops_approval_invalid_request', 'negative amount'),
  ('support_payout', 'pvops_test.subjects', 1, 100000000000001, '{"kind":"none"}',
   'ops_approval_invalid_request', 'amount above the limit'),
  ('support_payout', 'pvops_test.subjects', 1, 5000,
   '{"kind":"bank_account","bank_code":"058","ref":"0123456789","label":"GTB 0123456789"}',
   'ops_approval_invalid_request', 'label with a full account number'),
  ('support_payout', 'pvops_test.subjects', 1, 5000,
   '{"kind":"bank_account","bank_code":"058","ref":"0123456789","label":"GTB 0123 4567 89"}',
   'ops_approval_invalid_request', 'label with a spaced-out account number'),
  ('support_payout', 'pvops_test.subjects', 1, 5000,
   '{"kind":"bank_account","bank_code":"044","ref":"0999999913","label":"Ogabassey GTBank (bank 058) ••••4821"}',
   'ops_approval_invalid_request', 'label posing as another masked account'),
  ('support_payout', 'pvops_test.subjects', 1, 5000,
   '{"kind":"wallet","ref":"pvw-collection-0001","label":"Collection  wallet"}',
   'ops_approval_invalid_request', 'label with repeated spaces'),
  ('support_payout', 'pvops_test.subjects', 1, 5000,
   '{"kind":"wallet","ref":"pvw-collection-0001","label":"Collection wallet "}',
   'ops_approval_invalid_request', 'label with trailing space')
) AS v(action, subject_table, version, amount, destination, expected, case_label);

-- 3. A rejection is a veto on those exact values: asking again with the same
--    values is refused, and only a real change (here the row version) can be
--    asked again.
SELECT pg_temp.pvops_open('treasury_sweep', '0a0e0000-0000-4000-8000-000000000022',
  1, 900000, pg_temp.pvops_bank('0123456789')) AS req22 \gset
SELECT pg_temp.pvops_digest(:'req22') AS dig22 \gset
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_a', :'req22', 'reject', 900000, :'dig22'), 'ok', 'a rejects');
SELECT pg_temp.pvops_expect(pg_temp.pvops_try_open('treasury_sweep', 'pvops_test.subjects',
  '0a0e0000-0000-4000-8000-000000000022', 1, 900000, pg_temp.pvops_bank('0123456789')),
  'ops_approval_rejected', 'same values after a reject');
SELECT pg_temp.pvops_expect(pg_temp.pvops_consume('treasury_sweep',
  '0a0e0000-0000-4000-8000-000000000022', 1, 900000, pg_temp.pvops_bank('0123456789')),
  'ops_approval_rejected', 'consume after a reject and a re-ask');
SELECT pg_temp.pvops_open('treasury_sweep', '0a0e0000-0000-4000-8000-000000000022',
  2, 900000, pg_temp.pvops_bank('0123456789')) AS req22_v2 \gset
DO $$
BEGIN
  IF (SELECT pg_catalog.array_agg(r.state ORDER BY r.opened_at)
      FROM piggyvest_primary.ops_approval_requests r
      WHERE r.subject_id = '0a0e0000-0000-4000-8000-000000000022')
     IS DISTINCT FROM ARRAY['rejected', 'open'] THEN
    RAISE EXCEPTION 'a reject must stay on record and only changed values may be asked again';
  END IF;
END
$$;

-- 4. A caller's temporary objects never run inside the functions. Fresh
--    sessions for the requester and two approvers each shadow the common
--    type names with temporary domains whose check raises when it is
--    evaluated as anyone other than the session itself. Opening, listing,
--    deciding and consuming must all still work.
SELECT dblink_connect(v.conn, pg_catalog.format(
  'host=%s port=%s dbname=%s user=%s password=%s',
  pg_catalog.host(pg_catalog.inet_server_addr()), pg_catalog.inet_server_port(),
  pg_catalog.current_database(), v.login, pg_temp.pvops_password(v.login)))
FROM (VALUES ('pvops_xr', 'pvops_test_requester_r'), ('pvops_xa', 'pvops_test_approver_a'),
             ('pvops_xc', 'pvops_test_approver_c')) AS v(conn, login);
SELECT dblink_exec(v.conn, $q$
  CREATE FUNCTION pg_temp.pvops_probe(v pg_catalog.anyelement) RETURNS pg_catalog.bool
  LANGUAGE plpgsql AS $f$
  BEGIN
    IF current_user <> session_user THEN
      RAISE EXCEPTION 'pvops_owner_context';
    END IF;
    RETURN true;
  END
  $f$;
  CREATE DOMAIN pg_temp.text AS pg_catalog.text CHECK (pg_temp.pvops_probe(VALUE));
  CREATE DOMAIN pg_temp.jsonb AS pg_catalog.jsonb CHECK (pg_temp.pvops_probe(VALUE));
  CREATE DOMAIN pg_temp.uuid AS pg_catalog.uuid CHECK (pg_temp.pvops_probe(VALUE));
  CREATE DOMAIN pg_temp.timestamptz AS pg_catalog.timestamptz CHECK (pg_temp.pvops_probe(VALUE));
  CREATE DOMAIN pg_temp.oid AS pg_catalog.oid CHECK (pg_temp.pvops_probe(VALUE));
$q$)
FROM (VALUES ('pvops_xr'), ('pvops_xa'), ('pvops_xc')) AS v(conn);

SELECT pg_temp.pvops_open('support_payout', '0a0e0000-0000-4000-8000-000000000023',
  1, 64000, pg_temp.pvops_bank('0123456789'), '{"reason":"Shadowed session"}'::jsonb,
  'pvops_xr') AS req23 \gset
SELECT pg_temp.pvops_digest(:'req23') AS dig23 \gset
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM dblink('pvops_xc',
       'SELECT subject FROM piggyvest_approvals.list_open_ops_requests()') AS t(subject text)
       WHERE t.subject LIKE '%000000000023') THEN
    RAISE EXCEPTION 'a shadowed approver session must still list requests';
  END IF;
END
$$;
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_xc', :'req23', 'approve', 64000, :'dig23'), 'ok', 'shadowed c approves');
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_xa', :'req23', 'approve', 64000, :'dig23'), 'ok', 'shadowed a approves');
DO $$
DECLARE
  v_message text;
BEGIN
  BEGIN
    PERFORM t.id FROM dblink('pvops_xr', pg_catalog.format(
      'SELECT pvops_test.consume_request(%L, %L::uuid, 1, 64000, %L::jsonb)::text',
      'support_payout', '0a0e0000-0000-4000-8000-000000000023',
      pg_temp.pvops_bank('0123456789'))) AS t(id text);
    v_message := 'consumed';
  EXCEPTION WHEN OTHERS THEN
    v_message := SQLERRM;
  END;
  IF v_message IS DISTINCT FROM 'consumed' THEN
    RAISE EXCEPTION 'a shadowed consumer session must still consume: %', v_message;
  END IF;
END
$$;
