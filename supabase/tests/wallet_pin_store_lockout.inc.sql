-- Include-only part of wallet_pin_store.sql (no BEGIN/ROLLBACK).
--
-- Lockout for C2 (U2@M1): 5 consecutive wrong PINs lock for 30 minutes;
-- each later lockout doubles, capped at 24 hours; a correct PIN clears the
-- counters. Time passing is simulated by moving the stored lock window
-- back, so nothing depends on the wall clock.

CREATE FUNCTION pg_temp.wp_expire_lock(p_customer text)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE wallet_pin_private.customer_pins
     SET locked_at = locked_at - interval '25 hours',
         locked_until = locked_until - interval '25 hours'
   WHERE customer_id = pg_temp.wp_id(p_customer) AND locked_until IS NOT NULL;
$$;

-- Five wrong PINs; returns the last response.
CREATE FUNCTION pg_temp.wp_fail_five(p_user text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_result jsonb;
BEGIN
  FOR v_attempt IN 1..5 LOOP
    v_result := pg_temp.wp_rpc(p_user,
      pg_temp.wp_verify_sql('M1', 'pin_0000', 'vtu', 5000, 'idem1'));
  END LOOP;
  RETURN v_result;
END;
$$;

DO $lockout$
DECLARE
  v_result jsonb;
  v_pin wallet_pin_private.customer_pins;
  v_attempt integer;
BEGIN
  v_result := pg_temp.wp_rpc('U2', pg_temp.wp_set_sql('M1', 'pin_2580'), pg_temp.wp_fresh_amr());
  PERFORM pg_temp.wp_assert(v_result = '{"status":"set"}', 'C2 set: ' || v_result::text);

  -- Attempts 1-4 report what is left; nothing is locked yet.
  FOR v_attempt IN 1..4 LOOP
    v_result := pg_temp.wp_rpc('U2', pg_temp.wp_verify_sql('M1', 'pin_0000', 'vtu', 5000, 'idem1'));
    PERFORM pg_temp.wp_assert(
      v_result = pg_catalog.jsonb_build_object('status', 'incorrect', 'attemptsRemaining', 5 - v_attempt),
      pg_catalog.format('wrong PIN %s: %s', v_attempt, v_result));
  END LOOP;
  v_result := pg_temp.wp_rpc('U2', pg_temp.wp_state_sql('M1'));
  PERFORM pg_temp.wp_assert((v_result->>'attemptsRemaining')::integer = 1, 'state counts down: ' || v_result::text);

  -- The fifth locks for 30 minutes.
  v_result := pg_temp.wp_rpc('U2', pg_temp.wp_verify_sql('M1', 'pin_0000', 'vtu', 5000, 'idem1'));
  v_pin := pg_temp.wp_pin('C2');
  PERFORM pg_temp.wp_assert(
    v_result = pg_catalog.jsonb_build_object('status', 'locked', 'lockedUntil', v_pin.locked_until)
      AND v_pin.failed_attempts = 5 AND v_pin.lockout_count = 1
      AND v_pin.locked_until - v_pin.locked_at = interval '30 minutes',
    'fifth wrong PIN locks 30 minutes: ' || v_result::text);

  -- While locked even the correct PIN is refused and issues no proof; the
  -- lock is not extended by attempts made during it.
  v_result := pg_temp.wp_rpc('U2', pg_temp.wp_verify_sql('M1', 'pin_2580', 'vtu', 5000, 'idem1'));
  PERFORM pg_temp.wp_assert(v_result->>'status' = 'locked', 'correct PIN while locked: ' || v_result::text);
  PERFORM pg_temp.wp_assert(
    NOT EXISTS (SELECT 1 FROM wallet_pin_private.proofs WHERE customer_id = pg_temp.wp_id('C2')),
    'no proof while locked');
  PERFORM pg_temp.wp_assert((pg_temp.wp_pin('C2')).locked_until = v_pin.locked_until,
    'attempts during a lock do not move it');
  v_result := pg_temp.wp_rpc('U2', pg_temp.wp_state_sql('M1'));
  PERFORM pg_temp.wp_assert(
    v_result = pg_catalog.jsonb_build_object('status', 'locked', 'lockedUntil', v_pin.locked_until),
    'state while locked: ' || v_result::text);
  v_result := pg_temp.wp_rpc('U2', pg_temp.wp_change_sql('M1', 'pin_2580', 'salt2', 'pin_135790'));
  PERFORM pg_temp.wp_assert(v_result->>'status' = 'locked', 'change while locked: ' || v_result::text);

  -- After the lock ends there is a fresh window of five attempts, and the
  -- next lockout lasts twice as long.
  PERFORM pg_temp.wp_expire_lock('C2');
  v_result := pg_temp.wp_rpc('U2', pg_temp.wp_verify_sql('M1', 'pin_0000', 'vtu', 5000, 'idem1'));
  PERFORM pg_temp.wp_assert(
    v_result = '{"status":"incorrect","attemptsRemaining":4}', 'fresh window after lock: ' || v_result::text);
  v_pin := pg_temp.wp_pin('C2');
  PERFORM pg_temp.wp_assert(v_pin.locked_until IS NULL AND v_pin.failed_attempts = 1,
    'expired lock cleared');
  FOR v_attempt IN 2..5 LOOP
    v_result := pg_temp.wp_rpc('U2', pg_temp.wp_verify_sql('M1', 'pin_0000', 'vtu', 5000, 'idem1'));
  END LOOP;
  v_pin := pg_temp.wp_pin('C2');
  PERFORM pg_temp.wp_assert(
    v_result->>'status' = 'locked' AND v_pin.lockout_count = 2
      AND v_pin.locked_until - v_pin.locked_at = interval '60 minutes',
    'second lockout lasts 60 minutes');

  -- 30 min x 2^6 = 32 hours is capped at 24 hours, as is every later one.
  PERFORM pg_temp.wp_expire_lock('C2');
  UPDATE wallet_pin_private.customer_pins SET lockout_count = 6
   WHERE customer_id = pg_temp.wp_id('C2');
  v_result := pg_temp.wp_fail_five('U2');
  v_pin := pg_temp.wp_pin('C2');
  PERFORM pg_temp.wp_assert(
    v_result->>'status' = 'locked' AND v_pin.lockout_count = 7
      AND v_pin.locked_until - v_pin.locked_at = interval '24 hours',
    'seventh lockout is capped at 24 hours');
  PERFORM pg_temp.wp_expire_lock('C2');
  UPDATE wallet_pin_private.customer_pins SET lockout_count = 1000
   WHERE customer_id = pg_temp.wp_id('C2');
  v_result := pg_temp.wp_fail_five('U2');
  v_pin := pg_temp.wp_pin('C2');
  PERFORM pg_temp.wp_assert(
    v_result->>'status' = 'locked' AND v_pin.lockout_count = 1000
      AND v_pin.locked_until - v_pin.locked_at = interval '24 hours',
    'the lockout counter saturates and stays at 24 hours');

  -- A correct PIN after the lock clears every counter.
  PERFORM pg_temp.wp_expire_lock('C2');
  v_result := pg_temp.wp_rpc('U2', pg_temp.wp_verify_sql('M1', 'pin_2580', 'vtu', 5000, 'idem1'));
  v_pin := pg_temp.wp_pin('C2');
  PERFORM pg_temp.wp_assert(
    v_result->>'status' = 'verified' AND v_pin.failed_attempts = 0
      AND v_pin.lockout_count = 0 AND v_pin.locked_at IS NULL AND v_pin.locked_until IS NULL,
    'correct PIN resets the counters: ' || v_result::text);

  -- Change: a wrong current PIN counts like a wrong verify.
  v_result := pg_temp.wp_rpc('U2', pg_temp.wp_change_sql('M1', 'pin_0000', 'salt2', 'pin_135790'));
  PERFORM pg_temp.wp_assert(
    v_result = '{"status":"incorrect","attemptsRemaining":4}', 'change with a wrong PIN: ' || v_result::text);
  PERFORM pg_temp.wp_assert((pg_temp.wp_pin('C2')).failed_attempts = 1, 'change failure counted');
END;
$lockout$;
