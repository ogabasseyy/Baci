-- Include-only part of wallet_pin_store.sql (no BEGIN/ROLLBACK).
--
-- Reset needs a recent sign-in on a live session (and AAL2 when the user
-- has a verified MFA factor). Only a real sign-in counts: password, a code
-- or link sent to the customer, or an identity provider. An MFA step-up or
-- any other entry on an old sign-in does not. It clears any lockout and
-- revokes outstanding proofs. Change needs the current PIN and also
-- revokes proofs. C6 = U4@M1 (an unverified enrollment only); C5 = U3@M1
-- has a verified TOTP factor.

CREATE FUNCTION pg_temp.wp_reset_sql(
  p_merchant text,
  p_pin text,
  p_salt text DEFAULT 'salt2',
  p_pepper text DEFAULT 'pepper'
)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT pg_catalog.format(
    'SELECT public.reset_wallet_pin(%1$L::uuid, %2$L, 1, %3$L, %4$L, '
      'pg_temp.wp_attest(''reset'', %1$L::uuid, %2$L, ARRAY[''1'', %3$L, %4$L]))',
    pg_temp.wp_id(p_merchant), pg_temp.wp_hex(p_pepper),
    pg_temp.wp_hex(p_salt), pg_temp.wp_hex(p_pin)
  );
$$;

DO $reset$
DECLARE
  v_result jsonb;
  v_pin wallet_pin_private.customer_pins;
  v_old_proof text;
  v_consumed_proof text;
  v_claims jsonb;
  v_attempt integer;
  v_method text;
BEGIN
  -- Reset before any PIN exists.
  v_result := pg_temp.wp_rpc('U4', pg_temp.wp_reset_sql('M1', 'pin_135790'), pg_temp.wp_fresh_amr());
  PERFORM pg_temp.wp_assert(v_result = '{"status":"not_set"}', 'reset before set: ' || v_result::text);

  -- Set, issue two proofs (one is consumed), then lock C6 out.
  v_result := pg_temp.wp_rpc('U4', pg_temp.wp_set_sql('M1', 'pin_2580'), pg_temp.wp_fresh_amr());
  PERFORM pg_temp.wp_assert(v_result = '{"status":"set"}', 'C6 set: ' || v_result::text);
  v_old_proof := pg_temp.wp_rpc('U4', pg_temp.wp_verify_sql('M1', 'pin_2580', 'vtu', 700, 'idem1'))->>'proof';
  v_consumed_proof := pg_temp.wp_rpc('U4', pg_temp.wp_verify_sql('M1', 'pin_2580', 'imei', 800, 'idem2'))->>'proof';
  PERFORM pg_temp.wp_assert(
    wallet_pin_private.consume_wallet_pin_proof(pg_temp.wp_id('C6'), pg_temp.wp_id('M1'),
      'imei', 800, pg_temp.wp_hex('idem2'), v_consumed_proof) = 'consumed',
    'C6 consumes one proof before the reset');
  FOR v_attempt IN 1..5 LOOP
    v_result := pg_temp.wp_rpc('U4', pg_temp.wp_verify_sql('M1', 'pin_0000', 'vtu', 5000, 'idem3'));
  END LOOP;
  PERFORM pg_temp.wp_assert(v_result->>'status' = 'locked', 'C6 locked before reset');

  -- Refused: sign-in too old, unknown, another user's or an expired session,
  -- a method that is not a sign-in, a sign-in dated in the future, a
  -- malformed amr claim, no amr.
  FOREACH v_claims IN ARRAY ARRAY[
    '{}'::jsonb,
    pg_temp.wp_fresh_amr() || pg_catalog.jsonb_build_object('session_id', pg_temp.wp_id('S9')),
    pg_temp.wp_fresh_amr() || pg_catalog.jsonb_build_object('session_id', pg_temp.wp_id('S1')),
    pg_temp.wp_fresh_amr() || pg_catalog.jsonb_build_object('session_id', pg_temp.wp_id('S7')),
    pg_temp.wp_fresh_amr() || '{"session_id": "not-a-uuid"}'::jsonb,
    pg_temp.wp_fresh_amr('anonymous'),
    pg_temp.wp_fresh_amr('token_refresh'),
    pg_temp.wp_fresh_amr('totp'),
    pg_temp.wp_fresh_amr('email_change'),
    pg_temp.wp_fresh_amr('custom_hook'),
    pg_catalog.jsonb_build_object('amr', pg_catalog.jsonb_build_array(pg_temp.wp_amr_entry('password', -3600))),
    '{"amr": "password"}'::jsonb,
    '{"amr": [{"method": "password", "timestamp": "soon"}]}'::jsonb,
    '{"amr": null}'::jsonb
  ] LOOP
    v_result := pg_temp.wp_rpc('U4', pg_temp.wp_reset_sql('M1', 'pin_135790'), v_claims);
    PERFORM pg_temp.wp_assert(v_result = '{"status":"reauthentication_required"}',
      pg_catalog.format('reset refused for %s: %s', v_claims, v_result));
  END LOOP;
  v_pin := pg_temp.wp_pin('C6');
  PERFORM pg_temp.wp_assert(
    v_pin.locked_until IS NOT NULL AND v_pin.pin_hash = pg_catalog.sha256(pg_catalog.decode(pg_temp.wp_hex('pin_2580'), 'hex')),
    'refused resets change nothing');

  -- Accepted: a password sign-in a minute ago on the live session.
  v_result := pg_temp.wp_rpc('U4', pg_temp.wp_reset_sql('M1', 'pin_135790'), pg_temp.wp_fresh_amr());
  v_pin := pg_temp.wp_pin('C6');
  PERFORM pg_temp.wp_assert(
    v_result = '{"status":"reset"}' AND v_pin.locked_until IS NULL AND v_pin.locked_at IS NULL
      AND v_pin.failed_attempts = 0 AND v_pin.lockout_count = 0 AND v_pin.last_reset_at IS NOT NULL
      AND v_pin.salt = pg_catalog.decode(pg_temp.wp_hex('salt2'), 'hex')
      AND v_pin.pin_hash = pg_catalog.sha256(pg_catalog.decode(pg_temp.wp_hex('pin_135790'), 'hex')),
    'reset replaces the PIN and clears the lockout: ' || v_result::text);
  PERFORM pg_temp.wp_assert(
    wallet_pin_private.consume_wallet_pin_proof(pg_temp.wp_id('C6'), pg_temp.wp_id('M1'),
      'vtu', 700, pg_temp.wp_hex('idem1'), v_old_proof) = 'invalid',
    'a proof issued before the reset is revoked');
  PERFORM pg_temp.wp_assert(
    EXISTS (SELECT 1 FROM wallet_pin_private.proofs
             WHERE token_sha256 = pg_catalog.sha256(pg_catalog.decode(v_consumed_proof, 'hex'))
               AND consumed_at IS NOT NULL),
    'consumed proofs are kept');

  -- The old PIN no longer verifies; the new one does.
  v_result := pg_temp.wp_rpc('U4', pg_temp.wp_verify_sql('M1', 'pin_2580', 'vtu', 700, 'idem1'));
  PERFORM pg_temp.wp_assert(v_result->>'status' = 'incorrect', 'old PIN after reset: ' || v_result::text);
  v_old_proof := pg_temp.wp_rpc('U4', pg_temp.wp_verify_sql('M1', 'pin_135790', 'vtu', 700, 'idem1'))->>'proof';
  PERFORM pg_temp.wp_assert(v_old_proof ~ '^[0-9a-f]{64}$', 'new PIN verifies after reset');

  -- Change with the current PIN: new salt and hash, proofs revoked.
  v_result := pg_temp.wp_rpc('U4', pg_temp.wp_change_sql('M1', 'pin_135790', 'salt', 'pin_0000'));
  v_pin := pg_temp.wp_pin('C6');
  PERFORM pg_temp.wp_assert(
    v_result = '{"status":"changed"}'
      AND v_pin.salt = pg_catalog.decode(pg_temp.wp_hex('salt'), 'hex')
      AND v_pin.pin_hash = pg_catalog.sha256(pg_catalog.decode(pg_temp.wp_hex('pin_0000'), 'hex')),
    'change replaces the PIN: ' || v_result::text);
  PERFORM pg_temp.wp_assert(
    wallet_pin_private.consume_wallet_pin_proof(pg_temp.wp_id('C6'), pg_temp.wp_id('M1'),
      'vtu', 700, pg_temp.wp_hex('idem1'), v_old_proof) = 'invalid',
    'a proof issued before the change is revoked');

  -- Reset with a new pepper re-establishes the PIN under that pepper.
  v_result := pg_temp.wp_rpc('U4',
    pg_temp.wp_reset_sql('M1', 'pin_2580', 'salt', 'other_pepper'), pg_temp.wp_fresh_amr('otp'));
  PERFORM pg_temp.wp_assert(v_result = '{"status":"reset"}', 'reset under a new pepper: ' || v_result::text);
  v_result := pg_temp.wp_rpc('U4', pg_temp.wp_state_sql('M1', 'other_pepper'));
  PERFORM pg_temp.wp_assert(v_result->>'status' = 'set', 'state under the new pepper: ' || v_result::text);

  -- MFA user: a fresh AAL1 sign-in is not enough; AAL2 is.
  v_result := pg_temp.wp_rpc('U3', pg_temp.wp_set_sql('M1', 'pin_2580'),
    pg_temp.wp_fresh_amr() || '{"aal": "aal2"}'::jsonb);
  PERFORM pg_temp.wp_assert(v_result = '{"status":"set"}', 'C5 set: ' || v_result::text);
  v_result := pg_temp.wp_rpc('U3', pg_temp.wp_reset_sql('M1', 'pin_135790'), pg_temp.wp_fresh_amr());
  PERFORM pg_temp.wp_assert(v_result = '{"status":"reauthentication_required"}', 'MFA user at AAL1: ' || v_result::text);
  -- An old sign-in stepped up with a new MFA entry (for example a factor
  -- enrolled from a stolen session) is still an old sign-in.
  FOREACH v_method IN ARRAY ARRAY['totp', 'mfa/totp', 'mfa/phone', 'mfa/webauthn'] LOOP
    v_result := pg_temp.wp_rpc('U3', pg_temp.wp_reset_sql('M1', 'pin_135790'),
      pg_catalog.jsonb_build_object('aal', 'aal2', 'amr', pg_catalog.jsonb_build_array(
        pg_temp.wp_amr_entry('password', 3600), pg_temp.wp_amr_entry(v_method, 60))));
    PERFORM pg_temp.wp_assert(v_result = '{"status":"reauthentication_required"}',
      pg_catalog.format('MFA step-up %s on an old sign-in: %s', v_method, v_result));
  END LOOP;
  v_result := pg_temp.wp_rpc('U3', pg_temp.wp_reset_sql('M1', 'pin_135790'),
    pg_temp.wp_fresh_amr() || '{"aal": "aal2"}'::jsonb);
  PERFORM pg_temp.wp_assert(v_result = '{"status":"reset"}', 'MFA user at AAL2: ' || v_result::text);
END;
$reset$;
