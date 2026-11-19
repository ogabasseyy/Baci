-- REGRESSION TEST: wallet PIN row locks under two live backends (dblink).
--
-- wallet_pin_store.sql runs in one session, so it cannot show that the
-- row locks serialise concurrent requests. Here two backends race:
--   1. two wrong PINs for one customer: both attempts must count
--      (failed_attempts = 2), so parallel guesses cannot dodge the lockout;
--   2. an attempt that waited for the PIN row starts its lockout from when
--      it got the row, and one that got the row after a lock ended is
--      counted as a new attempt;
--   3. two spends of one proof: exactly one is consumed and the other is
--      refused as used, so one proof can never authorise two debits;
--   4. a spend that got the proof row only after the proof expired is
--      refused as expired.
-- wallet_pin_store_concurrency_clock.sql covers the other clock reads
-- (a new proof's issue time, a reset's sign-in age).
-- Backend A holds its transaction open; backend B is released only after
-- it is seen blocked by A (and, where it matters, after a given instant),
-- so the outcome does not depend on scheduling.
--
-- Fixtures are committed (backend B must see them), use ids of their own
-- and are deleted at the start and the end; see the setup include.

\ir wallet_pin_store_concurrency_setup.inc.sql

-- The wrong-PIN request, with the server attestation for the customer.
SELECT pg_catalog.format(
  'SELECT public.verify_wallet_pin(%L::uuid, %L, %L, %L, 5000, %L, %L)::text',
  request.merchant_id, request.pepper_id, request.pin_hash, 'vtu', request.idempotency,
  pg_temp.wp_attestation('verify', ARRAY[request.pin_hash, 'vtu', '5000', request.idempotency])
) AS wp_wrong_pin
  FROM (SELECT 'f1a10002-0000-4000-8000-000000000001' AS merchant_id,
               'd0bc8ce070c22d11' AS pepper_id,
               '822eb24bd3a5e7ae1db774c222b9ec82ce8bbd9f8e9ee663d43d6b81bcc1d789' AS pin_hash,
               'dc8fac035907b40165432a3b32d82df9f20d51706b0850a3290605d8a26e7e8e' AS idempotency
       ) AS request \gset

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

-- Race 2b: an attempt that starts while the PIN is locked but gets the row
-- only after the lock ended is counted as a new attempt, not refused.
UPDATE wallet_pin_private.customer_pins AS pin
   SET locked_at = instant.now_at + interval '3 seconds' - interval '30 minutes',
       locked_until = instant.now_at + interval '3 seconds'
  FROM (SELECT pg_catalog.clock_timestamp() AS now_at) AS instant
 WHERE pin.customer_id = 'f1a10003-0000-4000-8000-000000000001';
SELECT locked_until AS wp_lock_ends FROM wallet_pin_private.customer_pins
 WHERE customer_id = 'f1a10003-0000-4000-8000-000000000001' \gset
SELECT dblink_exec('wp_race_a', 'BEGIN');
SELECT pg_temp.wp_expect(locked = 1, 'backend A holds the locked PIN row')
  FROM dblink('wp_race_a', :'wp_lock_pin') AS t(locked integer);
SELECT dblink_send_query('wp_race_b', :'wp_wrong_pin');
SELECT pg_temp.wp_release_b(:wp_a_pid, :wp_b_pid, :'wp_lock_ends') AS wp_b_result \gset
SELECT pg_temp.wp_expect(
  :'wp_b_result'::jsonb = '{"status":"incorrect","attemptsRemaining":4}'::jsonb,
  'an attempt that got the row after the lock ended is counted; backend B got ' || :'wp_b_result');

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

\ir wallet_pin_store_concurrency_teardown.inc.sql
