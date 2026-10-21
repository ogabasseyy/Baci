-- REGRESSION TESTS (in-gate): claim_vtu_intent two-backend race via
-- two live dblink sessions.
--
-- Closes the documented gap in vtu_intent_claim.sql ("cannot prove
-- two-backend race serialization directly"): two backends race the same
-- scope with different keys and the same admission proof. Exactly one
-- creates; the other must BLOCK on the advisory xact lock (not error,
-- not slip through with a second live mapping) and join the winner.
--
-- Auth: pass -v dblink_password=... for a non-default local DB (the
-- default is the supabase-local scratch password). dblink is dropped
-- at the end only if this file created it.

\set ON_ERROR_STOP on

\if :{?dblink_password}
\else
\set dblink_password postgres
\endif

SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'dblink') AS claim_had_dblink \gset

CREATE EXTENSION IF NOT EXISTS dblink;

SELECT dblink_connect('claim_race_a', format(
  'host=%s port=%s dbname=%s user=%s password=%s',
  inet_server_addr(), inet_server_port(), current_database(),
  current_user, :'dblink_password'));
SELECT dblink_connect('claim_race_b', format(
  'host=%s port=%s dbname=%s user=%s password=%s',
  inet_server_addr(), inet_server_port(), current_database(),
  current_user, :'dblink_password'));

-- Committed fixtures (own namespace; deleted at the end). The audit
-- trigger requires a service_role actor, mirroring the sequential
-- suite (dblink already connected above as the session superuser).
SET ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', false);
INSERT INTO public.merchants (id, email, business_name, slug)
VALUES (
  '01cc0000-0000-4000-8000-000000000001',
  'claim-race@example.com',
  'Claim Race',
  'intent-claim-race'
);
INSERT INTO public.customers (id, merchant_id, email)
VALUES (
  '01cc0000-0000-4000-8000-000000000011',
  '01cc0000-0000-4000-8000-000000000001',
  'claim-race-customer@example.com'
);
INSERT INTO public.vtu_transactions (
  id, merchant_id, customer_id, type, network_provider,
  phone_number, amount, request_reference
)
VALUES
  (
    '01cc0000-0000-4000-8000-000000000021',
    '01cc0000-0000-4000-8000-000000000001',
    '01cc0000-0000-4000-8000-000000000011',
    'airtime', 'mtn', '08030000021', 500, 'CLAIM-RACE-001'
  ),
  (
    '01cc0000-0000-4000-8000-000000000022',
    '01cc0000-0000-4000-8000-000000000001',
    '01cc0000-0000-4000-8000-000000000011',
    'airtime', 'mtn', '08030000021', 500, 'CLAIM-RACE-002'
  );
RESET ROLE;

-- Both race sessions authenticate as service_role (the claim gates
-- on auth.role(), mirroring the sequential suite).
SELECT dblink_exec('claim_race_a', 'SET ROLE service_role');
SELECT dblink_exec('claim_race_a', $exec$DO $$BEGIN PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', false); END;$$;$exec$);
SELECT dblink_exec('claim_race_b', 'SET ROLE service_role');
SELECT dblink_exec('claim_race_b', $exec$DO $$BEGIN PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', false); END;$$;$exec$);

-- Backend A claims first and holds the scope lock uncommitted.
SELECT dblink_exec('claim_race_a', 'BEGIN');
DO $race$
DECLARE
  v_a record;
BEGIN
  SELECT * INTO v_a
  FROM dblink('claim_race_a', $$SELECT * FROM public.claim_vtu_intent('01cc0000-0000-4000-8000-000000000031', 'fp-race', '01cc0000-0000-4000-8000-000000000021', '01cc0000-0000-4000-8000-000000000001', '01cc0000-0000-4000-8000-000000000011', pg_catalog.now(), '{}')$$)
    AS claimed(transaction_id uuid, idempotency_key uuid, created boolean);
  IF v_a.created IS DISTINCT FROM true
    OR v_a.transaction_id IS DISTINCT FROM '01cc0000-0000-4000-8000-000000000021'
    OR v_a.idempotency_key IS DISTINCT FROM '01cc0000-0000-4000-8000-000000000031'
  THEN
    RAISE EXCEPTION 'race setup: backend A must create (t1/k1), got %', v_a;
  END IF;
END;
$race$;

-- Backend B races the same scope with a different key (async).
SELECT dblink_send_query('claim_race_b', $$SELECT * FROM public.claim_vtu_intent('01cc0000-0000-4000-8000-000000000032', 'fp-race', '01cc0000-0000-4000-8000-000000000022', '01cc0000-0000-4000-8000-000000000001', '01cc0000-0000-4000-8000-000000000011', pg_catalog.now(), '{}')$$);

DO $$
BEGIN
  -- B must block on the scope advisory lock (not error, not slip
  -- through): still busy after 300ms proves serialization.
  PERFORM pg_sleep(0.3);
  IF dblink_is_busy('claim_race_b') = 0 THEN
    RAISE EXCEPTION 'race backend B did not block on the scope claim lock';
  END IF;
END;
$$;

-- Release A: B proceeds onto the committed winner mapping.
SELECT dblink_exec('claim_race_a', 'COMMIT');

DO $race$
DECLARE
  v_spins integer := 0;
  v_b record;
  v_rows integer;
BEGIN
  WHILE dblink_is_busy('claim_race_b') = 1 AND v_spins < 200 LOOP
    PERFORM pg_sleep(0.05);
    v_spins := v_spins + 1;
  END LOOP;
  IF dblink_is_busy('claim_race_b') = 1 THEN
    RAISE EXCEPTION 'race backend B never completed after A committed';
  END IF;
  SELECT * INTO v_b
  FROM dblink_get_result('claim_race_b')
    AS claimed(transaction_id uuid, idempotency_key uuid, created boolean);
  IF v_b.created IS DISTINCT FROM false
    OR v_b.transaction_id IS DISTINCT FROM '01cc0000-0000-4000-8000-000000000021'
    OR v_b.idempotency_key IS DISTINCT FROM '01cc0000-0000-4000-8000-000000000031'
  THEN
    RAISE EXCEPTION 'race loser must join the winner (t1/k1), got %', v_b;
  END IF;
  -- Exactly two mappings, both onto the winner; the loser's own
  -- transaction stays unmapped (orphaned, never vended twice).
  SELECT count(*) INTO v_rows
  FROM public.vtu_idempotency_keys
  WHERE merchant_id = '01cc0000-0000-4000-8000-000000000001'
    AND request_fingerprint = 'fp-race';
  IF v_rows IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'race must record exactly winner + loser mappings, got %', v_rows;
  END IF;
  PERFORM 1
  FROM public.vtu_idempotency_keys
  WHERE key = '01cc0000-0000-4000-8000-000000000032'
    AND vtu_transaction_id = '01cc0000-0000-4000-8000-000000000021';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'race must map loser key k2 to winner t1';
  END IF;
  PERFORM 1
  FROM public.vtu_idempotency_keys
  WHERE vtu_transaction_id = '01cc0000-0000-4000-8000-000000000022';
  IF FOUND THEN
    RAISE EXCEPTION 'race must leave the loser transaction unmapped';
  END IF;
END;
$race$;

SELECT dblink_disconnect('claim_race_a');
SELECT dblink_disconnect('claim_race_b');

-- Cleanup (reverse FK order; service_role actor for the audit trigger).
SET ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', false);
DELETE FROM public.vtu_idempotency_keys
WHERE merchant_id = '01cc0000-0000-4000-8000-000000000001';
DELETE FROM public.vtu_transactions
WHERE id IN (
  '01cc0000-0000-4000-8000-000000000021',
  '01cc0000-0000-4000-8000-000000000022'
);
DELETE FROM public.customers
WHERE id = '01cc0000-0000-4000-8000-000000000011';
DELETE FROM public.merchants
WHERE id = '01cc0000-0000-4000-8000-000000000001';
RESET ROLE;

-- Restore the pre-test extension set (drop only what this file made).
\if :claim_had_dblink
\else
DROP EXTENSION IF EXISTS dblink;
\endif
