-- REGRESSION TEST: wallet PIN row locks under two live backends (dblink).
--
-- wallet_pin_store.sql runs in one session, so it cannot show that the
-- row locks serialise concurrent requests. Here two backends race:
--   1. two wrong PINs for one customer: both attempts must count
--      (failed_attempts = 2), so parallel guesses cannot dodge the lockout;
--   2. two spends of one proof: exactly one is consumed and the other is
--      refused as used, so one proof can never authorise two debits.
-- Backend A holds its transaction open; backend B is released only after
-- it is seen blocked by A, so the outcome does not depend on timing.
--
-- Fixtures are committed (backend B must see them), use ids of their own
-- and are deleted at the end. Auth: pass -v dblink_password=... for a
-- non-default local DB (the default is the supabase-local scratch
-- password). dblink is dropped at the end only if this file created it.

\set ON_ERROR_STOP on

\if :{?dblink_password}
\else
\set dblink_password postgres
\endif

SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'dblink') AS wp_had_dblink \gset

CREATE EXTENSION IF NOT EXISTS dblink;

SELECT dblink_connect('wp_race_a', pg_catalog.format(
  'host=%s port=%s dbname=%s user=%s password=%s',
  pg_catalog.inet_server_addr(), pg_catalog.inet_server_port(), pg_catalog.current_database(),
  CURRENT_USER, :'dblink_password'));
SELECT dblink_connect('wp_race_b', pg_catalog.format(
  'host=%s port=%s dbname=%s user=%s password=%s',
  pg_catalog.inet_server_addr(), pg_catalog.inet_server_port(), pg_catalog.current_database(),
  CURRENT_USER, :'dblink_password'));
SELECT pid AS wp_a_pid FROM dblink('wp_race_a', 'SELECT pg_catalog.pg_backend_pid()') AS t(pid integer) \gset
SELECT pid AS wp_b_pid FROM dblink('wp_race_b', 'SELECT pg_catalog.pg_backend_pid()') AS t(pid integer) \gset

-- Committed fixtures. The PIN row stores SHA-256 of the derived hash; the
-- hex constants are the KDF test vectors (PIN 2580 and 0000).
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) VALUES (
  'f1a10000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'wallet-pin-race@example.test', 'test',
  pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb, '{}'::jsonb
);
INSERT INTO public.merchants (id, email, business_name, slug)
VALUES ('f1a10002-0000-4000-8000-000000000001', 'wallet-pin-race-m@example.test',
  'Wallet PIN Race', 'wallet-pin-race');
INSERT INTO public.customers (id, merchant_id, email, user_id)
VALUES ('f1a10003-0000-4000-8000-000000000001', 'f1a10002-0000-4000-8000-000000000001',
  'wallet-pin-race-c@example.test', 'f1a10000-0000-4000-8000-000000000001');
INSERT INTO wallet_pin_private.merchant_authorities (merchant_id, enabled)
VALUES ('f1a10002-0000-4000-8000-000000000001', true);
INSERT INTO wallet_pin_private.customer_pins (
  customer_id, user_id, merchant_id, kdf_version, pepper_id, salt, pin_hash
) VALUES (
  'f1a10003-0000-4000-8000-000000000001', 'f1a10000-0000-4000-8000-000000000001',
  'f1a10002-0000-4000-8000-000000000001', 1,
  pg_catalog.decode('d0bc8ce070c22d11', 'hex'),
  pg_catalog.decode('000102030405060708090a0b0c0d0e0f', 'hex'),
  pg_catalog.sha256(pg_catalog.decode(
    '4582efeab2c2c9c37c747389ab8d1a8c9e5f3968b71f77ee49c866c0564b4e3a', 'hex'))
);

CREATE FUNCTION pg_temp.wp_expect(p_ok boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'wallet_pin_concurrency: %', p_message;
  END IF;
END;
$$;

-- Waits until backend B is blocked by backend A, then commits A and
-- returns B's single result row as text.
CREATE FUNCTION pg_temp.wp_release_b(p_a_pid integer, p_b_pid integer)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_spins integer := 0;
  v_result text;
BEGIN
  WHILE NOT (p_a_pid = ANY (pg_catalog.pg_blocking_pids(p_b_pid))) AND v_spins < 1000 LOOP
    PERFORM pg_catalog.pg_sleep(0.01);
    v_spins := v_spins + 1;
  END LOOP;
  IF NOT (p_a_pid = ANY (pg_catalog.pg_blocking_pids(p_b_pid))) THEN
    RAISE EXCEPTION 'wallet_pin_concurrency: backend B never waited for backend A';
  END IF;
  PERFORM dblink_exec('wp_race_a', 'COMMIT');
  SELECT result INTO v_result FROM dblink_get_result('wp_race_b') AS t(result text);
  PERFORM 1 FROM dblink_get_result('wp_race_b') AS t(result text);
  RETURN v_result;
END;
$$;

-- Race 1: two wrong PINs, through the customer RPC as the customer.
SELECT dblink_exec(conn, 'SET ROLE authenticated'),
       dblink_exec(conn, $exec$DO $$BEGIN PERFORM pg_catalog.set_config('request.jwt.claims',
         '{"sub":"f1a10000-0000-4000-8000-000000000001","role":"authenticated","aud":"authenticated"}',
         false); END;$$;$exec$)
  FROM (VALUES ('wp_race_a'), ('wp_race_b')) AS v(conn);

SELECT pg_catalog.format(
  'SELECT public.verify_wallet_pin(%L::uuid, %L, %L, %L, 5000, %L)::text',
  'f1a10002-0000-4000-8000-000000000001', 'd0bc8ce070c22d11',
  '822eb24bd3a5e7ae1db774c222b9ec82ce8bbd9f8e9ee663d43d6b81bcc1d789', 'vtu',
  'dc8fac035907b40165432a3b32d82df9f20d51706b0850a3290605d8a26e7e8e'
) AS wp_wrong_pin \gset

SELECT dblink_exec('wp_race_a', 'BEGIN');
SELECT pg_temp.wp_expect(
    result::jsonb = '{"status":"incorrect","attemptsRemaining":4}'::jsonb,
    'backend A first wrong PIN: ' || result)
  FROM dblink('wp_race_a', :'wp_wrong_pin') AS t(result text);
SELECT dblink_send_query('wp_race_b', :'wp_wrong_pin');
SELECT pg_temp.wp_release_b(:wp_a_pid, :wp_b_pid) AS wp_b_result \gset
SELECT pg_temp.wp_expect(
  :'wp_b_result'::jsonb = '{"status":"incorrect","attemptsRemaining":3}'::jsonb
    AND (SELECT failed_attempts FROM wallet_pin_private.customer_pins
          WHERE customer_id = 'f1a10003-0000-4000-8000-000000000001') = 2,
  'both wrong PINs must count; backend B got ' || :'wp_b_result');

-- Race 2: two spends of one proof, called as the owner the way the spend
-- hold calls it. The token is derived, not a stored secret.
SELECT dblink_exec(conn, 'RESET ROLE') FROM (VALUES ('wp_race_a'), ('wp_race_b')) AS v(conn);
INSERT INTO wallet_pin_private.proofs (
  token_sha256, customer_id, merchant_id, purpose, amount_kobo,
  idempotency_key_sha256, issued_at, expires_at
) VALUES (
  pg_catalog.sha256(pg_catalog.sha256(pg_catalog.convert_to('wallet-pin-race-token', 'UTF8'))),
  'f1a10003-0000-4000-8000-000000000001', 'f1a10002-0000-4000-8000-000000000001',
  'vtu', 5000,
  pg_catalog.decode('dc8fac035907b40165432a3b32d82df9f20d51706b0850a3290605d8a26e7e8e', 'hex'),
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp() + interval '120 seconds'
);
SELECT pg_catalog.format(
  'SELECT wallet_pin_private.consume_wallet_pin_proof(%L::uuid, %L::uuid, %L, 5000, %L, %L)',
  'f1a10003-0000-4000-8000-000000000001', 'f1a10002-0000-4000-8000-000000000001', 'vtu',
  'dc8fac035907b40165432a3b32d82df9f20d51706b0850a3290605d8a26e7e8e',
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('wallet-pin-race-token', 'UTF8')), 'hex')
) AS wp_consume \gset

SELECT dblink_exec('wp_race_a', 'BEGIN');
SELECT pg_temp.wp_expect(result = 'consumed', 'backend A consume: ' || result)
  FROM dblink('wp_race_a', :'wp_consume') AS t(result text);
SELECT dblink_send_query('wp_race_b', :'wp_consume');
SELECT pg_temp.wp_release_b(:wp_a_pid, :wp_b_pid) AS wp_b_result \gset
SELECT pg_temp.wp_expect(
  :'wp_b_result' = 'used'
    AND (SELECT pg_catalog.count(*) FROM wallet_pin_private.proofs
          WHERE customer_id = 'f1a10003-0000-4000-8000-000000000001'
            AND consumed_at IS NOT NULL) = 1,
  'a proof is spent once; the second spend got ' || :'wp_b_result');

SELECT dblink_disconnect('wp_race_a');
SELECT dblink_disconnect('wp_race_b');

-- Cleanup (reverse FK order).
DELETE FROM wallet_pin_private.proofs WHERE customer_id = 'f1a10003-0000-4000-8000-000000000001';
DELETE FROM wallet_pin_private.customer_pins WHERE customer_id = 'f1a10003-0000-4000-8000-000000000001';
DELETE FROM wallet_pin_private.merchant_authorities WHERE merchant_id = 'f1a10002-0000-4000-8000-000000000001';
DELETE FROM public.customers WHERE id = 'f1a10003-0000-4000-8000-000000000001';
DELETE FROM public.merchants WHERE id = 'f1a10002-0000-4000-8000-000000000001';
DELETE FROM auth.users WHERE id = 'f1a10000-0000-4000-8000-000000000001';
DROP FUNCTION pg_temp.wp_release_b(integer, integer);
DROP FUNCTION pg_temp.wp_expect(boolean, text);

-- Restore the pre-test extension set (drop only what this file made).
\if :wp_had_dblink
\else
DROP EXTENSION IF EXISTS dblink;
\endif
