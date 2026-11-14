-- REGRESSION TEST: the clock is read after the lock, not before the wait
-- (two live dblink backends; see wallet_pin_store_concurrency.sql for the
-- PIN attempt and proof consume races).
--   5. a verify whose proof purge waits for a spend holding the proof row
--      stamps the new proof with the time the purge finished, so the proof
--      is not issued already partly expired;
--   6. a reset that waits for the PIN row judges the sign-in's age once it
--      holds the row: a sign-in that was recent when the call began but is
--      older than 15 minutes by the time the row is free does not reset.
-- Backend A holds its transaction open; backend B is released only after
-- it is seen blocked by A and after a given instant.

\ir wallet_pin_store_concurrency_setup.inc.sql

-- Race 5: the customer has a live proof for (vtu, key). A, as the owner,
-- holds that proof row (standing in for a spend hold); B verifies the right
-- PIN for the same purpose and key, so its purge waits for A.
SELECT dblink_exec('wp_race_a', 'RESET ROLE');
INSERT INTO wallet_pin_private.proofs (
  token_sha256, customer_id, merchant_id, purpose, amount_kobo,
  idempotency_key_sha256, issued_at, expires_at
)
SELECT pg_catalog.sha256(pg_catalog.convert_to('wallet-pin-clock-token', 'UTF8')),
       'f1a10003-0000-4000-8000-000000000001', 'f1a10002-0000-4000-8000-000000000001',
       'vtu', 5000,
       pg_catalog.decode('dc8fac035907b40165432a3b32d82df9f20d51706b0850a3290605d8a26e7e8e', 'hex'),
       instant.now_at, instant.now_at + interval '120 seconds'
  FROM (SELECT pg_catalog.clock_timestamp() AS now_at) AS instant;
SELECT pg_catalog.format(
  'SELECT public.verify_wallet_pin(%L::uuid, %L, %L, %L, 5000, %L, %L)::text',
  request.merchant_id, request.pepper_id, request.pin_hash, 'vtu', request.idempotency,
  pg_temp.wp_attestation('verify', ARRAY[request.pin_hash, 'vtu', '5000', request.idempotency])
) AS wp_verify
  FROM (SELECT 'f1a10002-0000-4000-8000-000000000001' AS merchant_id,
               'd0bc8ce070c22d11' AS pepper_id,
               '4582efeab2c2c9c37c747389ab8d1a8c9e5f3968b71f77ee49c866c0564b4e3a' AS pin_hash,
               'dc8fac035907b40165432a3b32d82df9f20d51706b0850a3290605d8a26e7e8e' AS idempotency
       ) AS request \gset
SELECT dblink_exec('wp_race_a', 'BEGIN');
SELECT pg_temp.wp_expect(locked = 1, 'backend A holds the live proof')
  FROM dblink('wp_race_a', $q$SELECT 1 FROM wallet_pin_private.proofs
    WHERE customer_id = 'f1a10003-0000-4000-8000-000000000001' FOR UPDATE$q$) AS t(locked integer);
SELECT dblink_send_query('wp_race_b', :'wp_verify');
SELECT (pg_catalog.clock_timestamp() + interval '1 second') AS wp_not_before \gset
SELECT pg_temp.wp_release_b(:wp_a_pid, :wp_b_pid, :'wp_not_before') AS wp_b_result \gset
SELECT pg_temp.wp_expect(
  :'wp_b_result'::jsonb ->> 'status' = 'verified'
    AND (SELECT proof.issued_at >= :'wp_not_before'::timestamptz
           FROM wallet_pin_private.proofs AS proof
          WHERE proof.customer_id = 'f1a10003-0000-4000-8000-000000000001'
            AND proof.consumed_at IS NULL),
  'a proof is stamped after its purge finished; backend B got ' || :'wp_b_result');

-- Race 6: a reset whose sign-in was 898 seconds old when it began. A holds
-- the PIN row (as the owner); B resets with a fresh attestation. B is
-- released once the sign-in is more than 15 minutes old.
SELECT floor(pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()))::bigint - 898 AS wp_signed_in_at \gset
SELECT dblink_exec('wp_race_b', pg_catalog.format($exec$DO $$BEGIN PERFORM pg_catalog.set_config('request.jwt.claims',
  '{"sub":"f1a10000-0000-4000-8000-000000000001","role":"authenticated","aud":"authenticated",
    "session_id":"f1a10001-0000-4000-8000-000000000001","aal":"aal1",
    "amr":[{"method":"password","timestamp":%s}]}', false); END;$$;$exec$, :wp_signed_in_at));
SELECT pg_catalog.format(
  'SELECT public.reset_wallet_pin(%L::uuid, %L, 1, %L, %L, %L)::text',
  request.merchant_id, request.pepper_id, request.salt, request.pin_hash,
  pg_temp.wp_attestation('reset', ARRAY['1', request.salt, request.pin_hash])
) AS wp_reset
  FROM (SELECT 'f1a10002-0000-4000-8000-000000000001' AS merchant_id,
               'd0bc8ce070c22d11' AS pepper_id,
               'ffffffffffffffffffffffffffffffff' AS salt,
               '822eb24bd3a5e7ae1db774c222b9ec82ce8bbd9f8e9ee663d43d6b81bcc1d789' AS pin_hash
       ) AS request \gset
SELECT dblink_exec('wp_race_a', 'BEGIN');
SELECT pg_temp.wp_expect(locked = 1, 'backend A holds the PIN row')
  FROM dblink('wp_race_a', :'wp_lock_pin') AS t(locked integer);
SELECT dblink_send_query('wp_race_b', :'wp_reset');
SELECT pg_catalog.to_timestamp(:wp_signed_in_at + 902) AS wp_stale_at \gset
SELECT pg_temp.wp_release_b(:wp_a_pid, :wp_b_pid, :'wp_stale_at') AS wp_b_result \gset
SELECT pg_temp.wp_expect(
  :'wp_b_result'::jsonb = '{"status":"reauthentication_required"}'::jsonb
    AND (SELECT pin.pin_hash = pg_catalog.sha256(pg_catalog.decode(
                '4582efeab2c2c9c37c747389ab8d1a8c9e5f3968b71f77ee49c866c0564b4e3a', 'hex'))
           FROM wallet_pin_private.customer_pins AS pin
          WHERE pin.customer_id = 'f1a10003-0000-4000-8000-000000000001'),
  'a reset judges the sign-in after it holds the row; backend B got ' || :'wp_b_result');

\ir wallet_pin_store_concurrency_teardown.inc.sql
