-- Include-only part of wallet_pin_store.sql (no BEGIN/ROLLBACK).
--
-- First set, state, verify, input validation and tenant isolation, for
-- C1 (U1@M1). C3 (U1@M2, no authority) and C4 (U1@M3, disabled) prove the
-- per-merchant switch. The database keeps SHA-256 of the derived hash, so
-- the stored value itself is not a usable PIN.

DO $set_verify$
DECLARE
  v_result jsonb;
  v_error text;
  v_merchant text;
  v_pin wallet_pin_private.customer_pins;
  v_proof wallet_pin_private.proofs;
BEGIN
  -- Nothing set yet.
  v_result := pg_temp.wp_rpc('U1', pg_temp.wp_state_sql('M1'));
  PERFORM pg_temp.wp_assert(v_result = '{"status":"not_set"}', 'C1 starts not_set: ' || v_result::text);
  v_result := pg_temp.wp_rpc('U1', pg_temp.wp_verify_sql('M1', 'pin_2580', 'vtu', 5000, 'idem1'));
  PERFORM pg_temp.wp_assert(v_result = '{"status":"not_set"}', 'verify before set: ' || v_result::text);

  -- A merchant without an enabled authority row cannot hold PINs.
  FOREACH v_merchant IN ARRAY ARRAY['M2', 'M3'] LOOP
    v_result := pg_temp.wp_rpc('U1', pg_temp.wp_state_sql(v_merchant));
    PERFORM pg_temp.wp_assert(v_result = '{"status":"unavailable"}', v_merchant || ' state: ' || v_result::text);
    v_result := pg_temp.wp_rpc('U1', pg_temp.wp_set_sql(v_merchant, 'pin_2580'));
    PERFORM pg_temp.wp_assert(v_result = '{"status":"unavailable"}', v_merchant || ' set: ' || v_result::text);
  END LOOP;
  PERFORM pg_temp.wp_assert(
    NOT EXISTS (SELECT 1 FROM wallet_pin_private.customer_pins
                 WHERE customer_id IN (pg_temp.wp_id('C3'), pg_temp.wp_id('C4'))),
    'no PIN row for disabled merchants');

  -- A first set needs a recent sign-in, like a reset: an old session alone
  -- cannot create the spending credential.
  v_result := pg_temp.wp_rpc('U1', pg_temp.wp_set_sql('M1', 'pin_2580'));
  PERFORM pg_temp.wp_assert(v_result = '{"status":"reauthentication_required"}',
    'set on an old sign-in: ' || v_result::text);
  PERFORM pg_temp.wp_assert(
    NOT EXISTS (SELECT 1 FROM wallet_pin_private.customer_pins WHERE customer_id = pg_temp.wp_id('C1')),
    'a refused set stores nothing');

  -- First set stores the salt, the hash's SHA-256, the pepper id and the
  -- account that set it.
  v_result := pg_temp.wp_rpc('U1', pg_temp.wp_set_sql('M1', 'pin_2580'), pg_temp.wp_fresh_amr());
  PERFORM pg_temp.wp_assert(v_result = '{"status":"set"}', 'first set: ' || v_result::text);
  v_pin := pg_temp.wp_pin('C1');
  PERFORM pg_temp.wp_assert(
    v_pin.merchant_id = pg_temp.wp_id('M1') AND v_pin.kdf_version = 1
      AND v_pin.user_id = pg_temp.wp_id('U1')
      AND v_pin.salt = pg_catalog.decode(pg_temp.wp_hex('salt'), 'hex')
      AND v_pin.pin_hash = pg_catalog.sha256(pg_catalog.decode(pg_temp.wp_hex('pin_2580'), 'hex'))
      AND v_pin.pepper_id = pg_catalog.decode(pg_temp.wp_hex('pepper'), 'hex')
      AND v_pin.failed_attempts = 0 AND v_pin.lockout_count = 0
      AND v_pin.locked_until IS NULL AND v_pin.last_reset_at IS NULL,
    'stored PIN row');

  -- Set is first-time only; it never overwrites.
  v_result := pg_temp.wp_rpc('U1', pg_temp.wp_set_sql('M1', 'pin_0000', 'salt2'), pg_temp.wp_fresh_amr());
  PERFORM pg_temp.wp_assert(v_result = '{"status":"already_set"}', 'second set: ' || v_result::text);
  PERFORM pg_temp.wp_assert(
    (pg_temp.wp_pin('C1')).pin_hash = pg_catalog.sha256(pg_catalog.decode(pg_temp.wp_hex('pin_2580'), 'hex')),
    'second set left the hash alone');

  -- State returns the salt for hashing, never the hash.
  v_result := pg_temp.wp_rpc('U1', pg_temp.wp_state_sql('M1'));
  PERFORM pg_temp.wp_assert(
    v_result = pg_catalog.jsonb_build_object('status', 'set', 'kdfVersion', 1,
      'salt', pg_temp.wp_hex('salt'), 'attemptsRemaining', 5),
    'state after set: ' || v_result::text);
  PERFORM pg_temp.wp_assert(
    pg_catalog.strpos(v_result::text, pg_temp.wp_hex('pin_2580')) = 0
      AND pg_catalog.strpos(v_result::text, pg_catalog.encode(v_pin.pin_hash, 'hex')) = 0,
    'state never exposes the hash');

  -- A hash made with another pepper is refused without counting a failure.
  v_result := pg_temp.wp_rpc('U1', pg_temp.wp_state_sql('M1', 'other_pepper'));
  PERFORM pg_temp.wp_assert(v_result = '{"status":"reset_required"}', 'other pepper state: ' || v_result::text);
  v_result := pg_temp.wp_rpc('U1',
    pg_temp.wp_verify_sql('M1', 'pin_2580', 'vtu', 5000, 'idem1', 'other_pepper'));
  PERFORM pg_temp.wp_assert(v_result = '{"status":"reset_required"}', 'other pepper verify: ' || v_result::text);
  PERFORM pg_temp.wp_assert((pg_temp.wp_pin('C1')).failed_attempts = 0,
    'pepper mismatch is not a failed attempt');

  -- Malformed input raises 22023 before any state change. Raw calls carry
  -- a well-formed dummy attestation, so only the malformed field fails.
  FOREACH v_error IN ARRAY ARRAY[
    pg_catalog.format('SELECT public.verify_wallet_pin(%L::uuid, %L, %L, %L, 5000, %L, %L)',
      pg_temp.wp_id('M1'), pg_temp.wp_hex('pepper'), pg_catalog.upper(pg_temp.wp_hex('pin_0000')),
      'vtu', pg_temp.wp_hex('idem1'), pg_temp.wp_hex('attest_dummy')),
    pg_temp.wp_verify_sql('M1', 'pin_0000', 'transfer', 5000, 'idem1'),
    pg_temp.wp_verify_sql('M1', 'pin_0000', 'vtu', 0, 'idem1'),
    pg_temp.wp_verify_sql('M1', 'pin_0000', 'vtu', 10000000000, 'idem1'),
    pg_catalog.format('SELECT public.verify_wallet_pin(%L::uuid, %L, %L, %L, 5000, %L, %L)',
      pg_temp.wp_id('M1'), pg_temp.wp_hex('pepper'), pg_temp.wp_hex('pin_0000'), 'vtu', 'abcd',
      pg_temp.wp_hex('attest_dummy')),
    pg_catalog.format('SELECT public.verify_wallet_pin(%L::uuid, %L, %L, %L, 5000, %L, %L)',
      pg_temp.wp_id('M1'), 'd0bc8ce0', pg_temp.wp_hex('pin_0000'), 'vtu', pg_temp.wp_hex('idem1'),
      pg_temp.wp_hex('attest_dummy')),
    pg_temp.wp_set_sql('M1', 'pin_0000', 'salt', 'pepper', 2),
    pg_catalog.format('SELECT public.set_wallet_pin(%L::uuid, %L, 1, %L, NULL, %L)',
      pg_temp.wp_id('M1'), pg_temp.wp_hex('pepper'), pg_temp.wp_hex('salt'),
      pg_temp.wp_hex('attest_dummy')),
    -- A missing or malformed attestation is malformed input too.
    pg_catalog.format('SELECT public.verify_wallet_pin(%L::uuid, %L, %L, %L, 5000, %L, NULL)',
      pg_temp.wp_id('M1'), pg_temp.wp_hex('pepper'), pg_temp.wp_hex('pin_0000'), 'vtu',
      pg_temp.wp_hex('idem1')),
    pg_catalog.format('SELECT public.set_wallet_pin(%L::uuid, %L, 1, %L, %L, %L)',
      pg_temp.wp_id('M1'), pg_temp.wp_hex('pepper'), pg_temp.wp_hex('salt'),
      pg_temp.wp_hex('pin_0000'), '1700000000000.' || pg_catalog.repeat('A', 64)),
    -- A wrong current PIN with a malformed new PIN is refused before the
    -- attempt is checked, so it does not use up one of the five tries.
    pg_catalog.format('SELECT public.change_wallet_pin(%L::uuid, %L, %L, 1, %L, %L, %L)',
      pg_temp.wp_id('M1'), pg_temp.wp_hex('pepper'), pg_temp.wp_hex('pin_0000'),
      pg_catalog.upper(pg_temp.wp_hex('salt2')), pg_temp.wp_hex('pin_135790'),
      pg_temp.wp_hex('attest_dummy')),
    pg_catalog.format('SELECT public.change_wallet_pin(%L::uuid, %L, %L, 1, %L, %L, %L)',
      pg_temp.wp_id('M1'), pg_temp.wp_hex('pepper'), pg_temp.wp_hex('pin_0000'),
      pg_temp.wp_hex('salt2'), 'abcd', pg_temp.wp_hex('attest_dummy')),
    pg_catalog.format('SELECT public.reset_wallet_pin(%L::uuid, %L, 1, %L, %L, %L)',
      pg_temp.wp_id('M1'), pg_temp.wp_hex('pepper'), 'abcd', pg_temp.wp_hex('pin_135790'),
      pg_temp.wp_hex('attest_dummy'))
  ] LOOP
    PERFORM pg_temp.wp_assert(
      pg_temp.wp_rpc_error('U1', v_error) LIKE '22023 %',
      'malformed input raises 22023: ' || v_error);
  END LOOP;
  PERFORM pg_temp.wp_assert((pg_temp.wp_pin('C1')).failed_attempts = 0,
    'malformed input is not a failed attempt');

  -- The stored value is not a PIN: sending it back is a wrong attempt.
  v_result := pg_temp.wp_rpc('U1', pg_temp.wp_verify_sql('M1', NULL, 'vtu', 5000, 'idem1',
    'pepper', pg_catalog.encode(v_pin.pin_hash, 'hex')));
  PERFORM pg_temp.wp_assert(v_result = '{"status":"incorrect","attemptsRemaining":4}',
    'the stored hash does not verify: ' || v_result::text);

  -- Correct PIN: a proof bound to this debit, valid for 120 seconds.
  v_result := pg_temp.wp_rpc('U1', pg_temp.wp_verify_sql('M1', 'pin_2580', 'checkout', 123456, 'idem1'));
  PERFORM pg_temp.wp_assert(
    v_result->>'status' = 'verified' AND (v_result->>'proof') ~ '^[0-9a-f]{64}$'
      AND (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_result)) = 3,
    'verify returns status, proof and expiresAt only: ' || v_result::text);
  SELECT proof.* INTO v_proof FROM wallet_pin_private.proofs AS proof
   WHERE proof.token_sha256 = pg_catalog.sha256(pg_catalog.decode(v_result->>'proof', 'hex'));
  PERFORM pg_temp.wp_assert(
    v_proof.customer_id = pg_temp.wp_id('C1') AND v_proof.merchant_id = pg_temp.wp_id('M1')
      AND v_proof.purpose = 'checkout' AND v_proof.amount_kobo = 123456
      AND v_proof.idempotency_key_sha256 = pg_catalog.decode(pg_temp.wp_hex('idem1'), 'hex')
      AND v_proof.expires_at - v_proof.issued_at = interval '120 seconds'
      AND (v_result->>'expiresAt')::timestamptz = v_proof.expires_at
      AND v_proof.consumed_at IS NULL,
    'stored proof binding');
  PERFORM pg_temp.wp_assert(
    NOT EXISTS (SELECT 1 FROM wallet_pin_private.proofs
                 WHERE token_sha256 = pg_catalog.decode(v_result->>'proof', 'hex')),
    'the raw token is not stored');

  -- Tenant isolation: U2's customer row at M1 has no PIN, and U1's PIN hash
  -- does not verify for U2.
  v_result := pg_temp.wp_rpc('U2', pg_temp.wp_state_sql('M1'));
  PERFORM pg_temp.wp_assert(v_result = '{"status":"not_set"}', 'U2 sees no PIN: ' || v_result::text);
  v_result := pg_temp.wp_rpc('U2', pg_temp.wp_verify_sql('M1', 'pin_2580', 'vtu', 5000, 'idem2'));
  PERFORM pg_temp.wp_assert(v_result = '{"status":"not_set"}', 'U1 hash under U2: ' || v_result::text);

  -- The same person at another enabled merchant is a different customer
  -- row with no PIN; M1's proof binds to M1's customer row.
  v_result := pg_temp.wp_rpc('U1', pg_temp.wp_state_sql('M4'));
  PERFORM pg_temp.wp_assert(v_result = '{"status":"not_set"}', 'U1 at M4 has no PIN: ' || v_result::text);
  v_result := pg_temp.wp_rpc('U1', pg_temp.wp_verify_sql('M4', 'pin_2580', 'vtu', 5000, 'idem2'));
  PERFORM pg_temp.wp_assert(v_result = '{"status":"not_set"}', 'U1 hash at M4: ' || v_result::text);
  PERFORM pg_temp.wp_assert(
    NOT EXISTS (SELECT 1 FROM wallet_pin_private.customer_pins WHERE customer_id = pg_temp.wp_id('C8')),
    'no PIN row for C8');

  -- Identity checks.
  v_error := pg_temp.wp_rpc_error('U6', pg_temp.wp_state_sql('M1'));
  PERFORM pg_temp.wp_assert(v_error = '42501 wallet_pin_customer_unavailable', 'no customer row: ' || v_error);
  v_error := pg_temp.wp_rpc_error('U1', pg_temp.wp_state_sql('M1'), '{"sub": null}');
  PERFORM pg_temp.wp_assert(v_error = '42501 wallet_pin_authentication_required', 'no subject: ' || v_error);
  v_error := pg_temp.wp_rpc_error('U1', pg_temp.wp_state_sql('M1'), '{"is_anonymous": true}');
  PERFORM pg_temp.wp_assert(v_error = '42501 wallet_pin_authentication_required', 'anonymous user: ' || v_error);
  v_error := pg_temp.wp_rpc_error('U1', pg_temp.wp_state_sql('M1'), '{"role": "anon"}');
  PERFORM pg_temp.wp_assert(v_error = '42501 wallet_pin_authentication_required', 'anon claims: ' || v_error);
END;
$set_verify$;
