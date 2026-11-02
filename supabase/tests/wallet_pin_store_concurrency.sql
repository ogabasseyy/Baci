-- REGRESSION TEST: wallet PIN row locks under two live backends (dblink).
--
-- wallet_pin_store.sql runs in one session, so it cannot show that the
-- row locks serialise concurrent requests. Here two backends race:
--   1. two wrong PINs for one customer: both attempts must count
--      (failed_attempts = 2), so parallel guesses cannot dodge the lockout;
--   2. an attempt that waited for the PIN row starts its lockout from when
--      it got the row;
--   3. two spends of one proof: exactly one is consumed and the other is
--      refused as used, so one proof can never authorise two debits;
--   4. a spend that got the proof row only after the proof expired is
--      refused as expired.
-- Backend A holds its transaction open; backend B is released only after
-- it is seen blocked by A (and, where it matters, after a given instant),
-- so the outcome does not depend on scheduling.
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
-- The merchants audit trigger refuses a write without an actor (28000), so
-- merchant writes run as the service actor.
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', false);
INSERT INTO public.merchants (id, email, business_name, slug)
VALUES ('f1a10002-0000-4000-8000-000000000001', 'wallet-pin-race-m@example.test',
  'Wallet PIN Race', 'wallet-pin-race');
SELECT pg_catalog.set_config('request.jwt.claims', '', false);
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

-- Waits until backend B is blocked by backend A and the clock has passed
-- p_not_before (when given), then commits A and returns B's single result.
CREATE FUNCTION pg_temp.wp_release_b(
  p_a_pid integer,
  p_b_pid integer,
  p_not_before timestamptz DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_spins integer := 0;
  v_result text;
BEGIN
  WHILE NOT (p_a_pid = ANY (pg_catalog.pg_blocking_pids(p_b_pid))) AND v_spins < 3000 LOOP
    PERFORM pg_catalog.pg_sleep(0.01);
    v_spins := v_spins + 1;
  END LOOP;
  IF NOT (p_a_pid = ANY (pg_catalog.pg_blocking_pids(p_b_pid))) THEN
    RAISE EXCEPTION 'wallet_pin_concurrency: backend B never waited for backend A';
  END IF;
  WHILE p_not_before IS NOT NULL AND pg_catalog.clock_timestamp() <= p_not_before LOOP
    PERFORM pg_catalog.pg_sleep(0.05);
  END LOOP;
  PERFORM dblink_exec('wp_race_a', 'COMMIT');
  SELECT result INTO v_result FROM dblink_get_result('wp_race_b') AS t(result text);
  PERFORM 1 FROM dblink_get_result('wp_race_b') AS t(result text);
  RETURN v_result;
END;
$$;

-- Both backends act as the customer, through the customer RPC.
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
\set wp_lock_pin 'SELECT 1 FROM wallet_pin_private.customer_pins WHERE customer_id = ''f1a10003-0000-4000-8000-000000000001'' FOR UPDATE'

-- Race 1: two wrong PINs at once both count.
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

-- Race 2: an attempt that waits for the PIN row times its lockout from
-- when it got the row, not from when it started. A holds the row (as the
-- owner, standing in for any other writer); B makes the fifth wrong try.
UPDATE wallet_pin_private.customer_pins SET failed_attempts = 4
 WHERE customer_id = 'f1a10003-0000-4000-8000-000000000001';
SELECT dblink_exec('wp_race_a', 'RESET ROLE');
SELECT dblink_exec('wp_race_a', 'BEGIN');
SELECT pg_temp.wp_expect(locked = 1, 'backend A holds the PIN row')
  FROM dblink('wp_race_a', :'wp_lock_pin') AS t(locked integer);
SELECT dblink_send_query('wp_race_b', :'wp_wrong_pin');
SELECT (pg_catalog.clock_timestamp() + interval '1 second') AS wp_not_before \gset
SELECT pg_temp.wp_release_b(:wp_a_pid, :wp_b_pid, :'wp_not_before') AS wp_b_result \gset
SELECT pg_temp.wp_expect(
  :'wp_b_result'::jsonb ->> 'status' = 'locked'
    AND (SELECT locked_at >= :'wp_not_before'::timestamptz
                AND locked_until = locked_at + interval '30 minutes'
           FROM wallet_pin_private.customer_pins
          WHERE customer_id = 'f1a10003-0000-4000-8000-000000000001'),
  'the lockout starts when the row was obtained; backend B got ' || :'wp_b_result');

-- Races 3 and 4 call the consumer as the owner, the way the spend hold
-- calls it. Tokens are derived, not stored secrets; each fixture proof
-- takes its issue time from one instant.
SELECT dblink_exec('wp_race_b', 'RESET ROLE');
INSERT INTO wallet_pin_private.proofs (
  token_sha256, customer_id, merchant_id, purpose, amount_kobo,
  idempotency_key_sha256, issued_at, expires_at
)
SELECT pg_catalog.sha256(pg_catalog.sha256(pg_catalog.convert_to(fixture.label || ':token', 'UTF8'))),
       'f1a10003-0000-4000-8000-000000000001', 'f1a10002-0000-4000-8000-000000000001',
       'vtu', 5000, pg_catalog.sha256(pg_catalog.convert_to(fixture.label || ':key', 'UTF8')),
       fixture.issued_at, fixture.issued_at + interval '120 seconds'
  FROM (SELECT pg_catalog.clock_timestamp() AS now_at) AS instant,
       LATERAL (VALUES
         ('wallet-pin-race-token', instant.now_at),
         ('wallet-pin-race-expiring-token', instant.now_at - interval '115 seconds')
       ) AS fixture(label, issued_at);
SELECT pg_catalog.format(
  'SELECT wallet_pin_private.consume_wallet_pin_proof(%L::uuid, %L::uuid, %L, 5000, %L, %L)',
  'f1a10003-0000-4000-8000-000000000001', 'f1a10002-0000-4000-8000-000000000001', 'vtu',
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(label || ':key', 'UTF8')), 'hex'),
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(label || ':token', 'UTF8')), 'hex')
) AS wp_consume
  FROM (VALUES ('wallet-pin-race-token')) AS v(label) \gset
SELECT pg_catalog.format(
  'SELECT wallet_pin_private.consume_wallet_pin_proof(%L::uuid, %L::uuid, %L, 5000, %L, %L)',
  'f1a10003-0000-4000-8000-000000000001', 'f1a10002-0000-4000-8000-000000000001', 'vtu',
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(label || ':key', 'UTF8')), 'hex'),
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(label || ':token', 'UTF8')), 'hex')
) AS wp_consume_expiring,
  pg_catalog.format(
  'SELECT 1 FROM wallet_pin_private.proofs WHERE token_sha256 = %L::bytea FOR UPDATE',
  pg_catalog.sha256(pg_catalog.sha256(pg_catalog.convert_to(label || ':token', 'UTF8')))
) AS wp_lock_expiring,
  (SELECT expires_at FROM wallet_pin_private.proofs
    WHERE token_sha256 = pg_catalog.sha256(pg_catalog.sha256(pg_catalog.convert_to(label || ':token', 'UTF8'))))
    AS wp_expiring_at
  FROM (VALUES ('wallet-pin-race-expiring-token')) AS v(label) \gset

-- Race 3: two spends of one proof; exactly one succeeds.
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

-- Race 4: a spend that starts before the proof expires but only gets the
-- proof row after it expired is refused as expired.
SELECT dblink_exec('wp_race_a', 'BEGIN');
SELECT pg_temp.wp_expect(locked = 1, 'backend A holds the expiring proof')
  FROM dblink('wp_race_a', :'wp_lock_expiring') AS t(locked integer);
SELECT dblink_send_query('wp_race_b', :'wp_consume_expiring');
SELECT pg_temp.wp_release_b(:wp_a_pid, :wp_b_pid, :'wp_expiring_at') AS wp_b_result \gset
SELECT pg_temp.wp_expect(
  :'wp_b_result' = 'expired'
    AND (SELECT consumed_at IS NULL FROM wallet_pin_private.proofs
          WHERE expires_at = :'wp_expiring_at'::timestamptz),
  'a proof obtained after its expiry is refused; backend B got ' || :'wp_b_result');

SELECT dblink_disconnect('wp_race_a');
SELECT dblink_disconnect('wp_race_b');

-- Cleanup (reverse FK order).
DELETE FROM wallet_pin_private.proofs WHERE customer_id = 'f1a10003-0000-4000-8000-000000000001';
DELETE FROM wallet_pin_private.customer_pins WHERE customer_id = 'f1a10003-0000-4000-8000-000000000001';
DELETE FROM wallet_pin_private.merchant_authorities WHERE merchant_id = 'f1a10002-0000-4000-8000-000000000001';
DELETE FROM public.customers WHERE id = 'f1a10003-0000-4000-8000-000000000001';
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', false);
DELETE FROM public.merchants WHERE id = 'f1a10002-0000-4000-8000-000000000001';
SELECT pg_catalog.set_config('request.jwt.claims', '', false);
DELETE FROM auth.users WHERE id = 'f1a10000-0000-4000-8000-000000000001';
DROP FUNCTION pg_temp.wp_release_b(integer, integer, timestamptz);
DROP FUNCTION pg_temp.wp_expect(boolean, text);

-- Restore the pre-test extension set (drop only what this file made).
\if :wp_had_dblink
\else
DROP EXTENSION IF EXISTS dblink;
\endif
