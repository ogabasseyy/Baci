-- Include-only part of wallet_pin_store.sql (no BEGIN/ROLLBACK).
--
-- The database refuses a set, change, reset or verify that does not carry
-- the server's attestation for exactly this caller and request. A client
-- calling the API directly with a hash it chose is refused (42501), and
-- nothing is stored, counted or issued. With no key for the pepper the
-- answer is "unavailable". C8 (U1@M4) has no PIN yet; C1 (U1@M1) has 2580.

-- SQL for an RPC call carrying the given attestation text.
CREATE FUNCTION pg_temp.wp_call_with(p_call text, p_args text[], p_attestation text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT pg_catalog.format('SELECT public.%s(%s, %L)', p_call,
    (SELECT pg_catalog.string_agg(pg_catalog.quote_literal(arg), ', ' ORDER BY ord)
       FROM pg_catalog.unnest(p_args) WITH ORDINALITY AS a(arg, ord)),
    p_attestation);
$$;

-- SQLSTATE of a statement run as the owner (the private helper is closed to
-- every client role), or 'no error'.
CREATE FUNCTION pg_temp.wp_owner_state(p_sql text)
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'no error';
EXCEPTION
  WHEN OTHERS THEN
    RETURN SQLSTATE;
END;
$$;

DO $attestation$
DECLARE
  v_key bytea := pg_temp.wp_attestation_key('pepper');
  v_forged_key bytea := pg_catalog.sha256(pg_catalog.convert_to('wallet-pin-forged-key', 'UTF8'));
  v_u1 uuid := pg_temp.wp_id('U1');
  v_m1 uuid := pg_temp.wp_id('M1');
  v_m4 uuid := pg_temp.wp_id('M4');
  v_now bigint := pg_temp.wp_now_ms();
  v_set_args text[] := ARRAY[v_m4::text, pg_temp.wp_hex('pepper'), '1', pg_temp.wp_hex('salt'), pg_temp.wp_hex('pin_0000')];
  v_set_fields text[] := ARRAY['1', pg_temp.wp_hex('salt'), pg_temp.wp_hex('pin_0000')];
  v_verify_fields text[] := ARRAY[pg_temp.wp_hex('pin_2580'), 'vtu', '5000', pg_temp.wp_hex('idem3')];
  v_attestation text;
  v_error text;
  v_proofs bigint;
  v_sql text;
BEGIN
  -- The SQL check and the server signer (wallet-pin-kdf.test.ts) agree on
  -- the message layout and the key derivation.
  PERFORM pg_temp.wp_assert(
    pg_temp.wp_mac(v_key, v_u1, 'verify', v_m1, pg_temp.wp_hex('pepper'), 1793600000000,
      ARRAY[pg_temp.wp_hex('pin_2580'), 'vtu', '5000', pg_temp.wp_hex('idem1')])
      = '1793600000000.c084dfadf428afad472ba1983d80ed8bff5827bf75027bd17644694eb79f1404',
    'attestation vector matches the server signer');

  -- A first set with a self-chosen hash: forged key, another caller, another
  -- request, another operation, too old, too far ahead.
  FOREACH v_attestation IN ARRAY ARRAY[
    pg_temp.wp_mac(v_forged_key, v_u1, 'set', v_m4, pg_temp.wp_hex('pepper'), v_now, v_set_fields),
    pg_temp.wp_mac(v_key, pg_temp.wp_id('U2'), 'set', v_m4, pg_temp.wp_hex('pepper'), v_now, v_set_fields),
    pg_temp.wp_mac(v_key, v_u1, 'set', v_m4, pg_temp.wp_hex('pepper'), v_now,
      ARRAY['1', pg_temp.wp_hex('salt'), pg_temp.wp_hex('pin_2580')]),
    pg_temp.wp_mac(v_key, v_u1, 'reset', v_m4, pg_temp.wp_hex('pepper'), v_now, v_set_fields),
    pg_temp.wp_mac(v_key, v_u1, 'set', v_m4, pg_temp.wp_hex('pepper'), v_now - 121000, v_set_fields),
    pg_temp.wp_mac(v_key, v_u1, 'set', v_m4, pg_temp.wp_hex('pepper'), v_now + 60000, v_set_fields)
  ] LOOP
    v_error := pg_temp.wp_rpc_error('U1',
      pg_temp.wp_call_with('set_wallet_pin', v_set_args, v_attestation), pg_temp.wp_fresh_amr());
    PERFORM pg_temp.wp_assert(v_error = '42501 wallet_pin_attestation_invalid',
      pg_catalog.format('unattested set %s: %s', v_attestation, v_error));
  END LOOP;
  PERFORM pg_temp.wp_assert(
    NOT EXISTS (SELECT 1 FROM wallet_pin_private.customer_pins WHERE customer_id = pg_temp.wp_id('C8')),
    'an unattested set stores nothing');

  -- Verify, change and reset with a forged attestation change nothing.
  SELECT pg_catalog.count(*) INTO v_proofs FROM wallet_pin_private.proofs
   WHERE customer_id = pg_temp.wp_id('C1');
  v_error := pg_temp.wp_rpc_error('U1', pg_temp.wp_call_with('verify_wallet_pin',
    ARRAY[v_m1::text, pg_temp.wp_hex('pepper'), pg_temp.wp_hex('pin_2580'), 'vtu', '5000', pg_temp.wp_hex('idem3')],
    pg_temp.wp_mac(v_forged_key, v_u1, 'verify', v_m1, pg_temp.wp_hex('pepper'), v_now, v_verify_fields)));
  PERFORM pg_temp.wp_assert(v_error = '42501 wallet_pin_attestation_invalid', 'unattested verify: ' || v_error);
  v_error := pg_temp.wp_rpc_error('U1', pg_temp.wp_call_with('change_wallet_pin',
    ARRAY[v_m1::text, pg_temp.wp_hex('pepper'), pg_temp.wp_hex('pin_2580'), '1', pg_temp.wp_hex('salt2'), pg_temp.wp_hex('pin_0000')],
    pg_temp.wp_mac(v_forged_key, v_u1, 'change', v_m1, pg_temp.wp_hex('pepper'), v_now,
      ARRAY[pg_temp.wp_hex('pin_2580'), '1', pg_temp.wp_hex('salt2'), pg_temp.wp_hex('pin_0000')])));
  PERFORM pg_temp.wp_assert(v_error = '42501 wallet_pin_attestation_invalid', 'unattested change: ' || v_error);
  v_error := pg_temp.wp_rpc_error('U1', pg_temp.wp_call_with('reset_wallet_pin',
    ARRAY[v_m1::text, pg_temp.wp_hex('pepper'), '1', pg_temp.wp_hex('salt2'), pg_temp.wp_hex('pin_0000')],
    pg_temp.wp_mac(v_forged_key, v_u1, 'reset', v_m1, pg_temp.wp_hex('pepper'), v_now,
      ARRAY['1', pg_temp.wp_hex('salt2'), pg_temp.wp_hex('pin_0000')])), pg_temp.wp_fresh_amr());
  PERFORM pg_temp.wp_assert(v_error = '42501 wallet_pin_attestation_invalid', 'unattested reset: ' || v_error);
  PERFORM pg_temp.wp_assert(
    (pg_temp.wp_pin('C1')).pin_hash = pg_catalog.sha256(pg_catalog.decode(pg_temp.wp_hex('pin_2580'), 'hex'))
      AND (pg_temp.wp_pin('C1')).failed_attempts = 0
      AND (SELECT pg_catalog.count(*) FROM wallet_pin_private.proofs
            WHERE customer_id = pg_temp.wp_id('C1')) = v_proofs,
    'unattested calls change, count and issue nothing');

  -- A switched-off merchant (M3) answers "unavailable" whatever the
  -- attestation says: the switch is judged before the attestation.
  FOREACH v_sql IN ARRAY ARRAY[
    pg_temp.wp_call_with('set_wallet_pin',
      ARRAY[pg_temp.wp_id('M3')::text, pg_temp.wp_hex('pepper'), '1', pg_temp.wp_hex('salt'), pg_temp.wp_hex('pin_0000')],
      pg_temp.wp_hex('attest_dummy')),
    pg_temp.wp_call_with('change_wallet_pin',
      ARRAY[pg_temp.wp_id('M3')::text, pg_temp.wp_hex('pepper'), pg_temp.wp_hex('pin_2580'), '1', pg_temp.wp_hex('salt2'), pg_temp.wp_hex('pin_0000')],
      pg_temp.wp_hex('attest_dummy')),
    pg_temp.wp_call_with('reset_wallet_pin',
      ARRAY[pg_temp.wp_id('M3')::text, pg_temp.wp_hex('pepper'), '1', pg_temp.wp_hex('salt2'), pg_temp.wp_hex('pin_0000')],
      pg_temp.wp_hex('attest_dummy')),
    pg_temp.wp_call_with('verify_wallet_pin',
      ARRAY[pg_temp.wp_id('M3')::text, pg_temp.wp_hex('pepper'), pg_temp.wp_hex('pin_2580'), 'vtu', '5000', pg_temp.wp_hex('idem3')],
      pg_temp.wp_hex('attest_dummy'))
  ] LOOP
    PERFORM pg_temp.wp_assert(
      pg_temp.wp_rpc('U1', v_sql, pg_temp.wp_fresh_amr()) = '{"status":"unavailable"}',
      'switched-off merchant, bad attestation: ' || v_sql);
  END LOOP;

  -- The helper itself refuses a NULL anywhere in the signed message instead
  -- of signing a shorter one (array_to_string would skip a NULL field).
  FOREACH v_sql IN ARRAY ARRAY[
    pg_catalog.format('SELECT wallet_pin_private.require_attestation(%L, %L::uuid, %L::bytea, %L, ARRAY[''1'', NULL, %L])',
      'set', v_m4, '\xd0bc8ce070c22d11', pg_temp.wp_hex('attest_dummy'), pg_temp.wp_hex('pin_0000')),
    pg_catalog.format('SELECT wallet_pin_private.require_attestation(NULL, %L::uuid, %L::bytea, %L, ARRAY[''1''])',
      v_m4, '\xd0bc8ce070c22d11', pg_temp.wp_hex('attest_dummy')),
    pg_catalog.format('SELECT wallet_pin_private.require_attestation(%L, NULL, %L::bytea, %L, ARRAY[''1''])',
      'set', '\xd0bc8ce070c22d11', pg_temp.wp_hex('attest_dummy')),
    pg_catalog.format('SELECT wallet_pin_private.require_attestation(%L, %L::uuid, NULL, %L, ARRAY[''1''])',
      'set', v_m4, pg_temp.wp_hex('attest_dummy')),
    pg_catalog.format('SELECT wallet_pin_private.require_attestation(%L, %L::uuid, %L::bytea, NULL, ARRAY[''1''])',
      'set', v_m4, '\xd0bc8ce070c22d11'),
    pg_catalog.format('SELECT wallet_pin_private.require_attestation(%L, %L::uuid, %L::bytea, %L, NULL)',
      'set', v_m4, '\xd0bc8ce070c22d11', pg_temp.wp_hex('attest_dummy'))
  ] LOOP
    PERFORM pg_temp.wp_assert(pg_temp.wp_owner_state(v_sql) = '22023', 'NULL in the attestation message: ' || v_sql);
  END LOOP;

  -- No key for the pepper: the feature is not provisioned under it.
  PERFORM pg_temp.wp_assert(
    pg_temp.wp_rpc('U1', pg_temp.wp_set_sql('M4', 'pin_2580', 'salt', 'unkeyed_pepper'),
      pg_temp.wp_fresh_amr()) = '{"status":"unavailable"}'
      AND pg_temp.wp_rpc('U1', pg_temp.wp_verify_sql('M1', 'pin_2580', 'vtu', 5000, 'idem3',
        'unkeyed_pepper')) = '{"status":"unavailable"}'
      AND NOT EXISTS (SELECT 1 FROM wallet_pin_private.customer_pins WHERE customer_id = pg_temp.wp_id('C8')),
    'no attestation key: unavailable');
END;
$attestation$;
