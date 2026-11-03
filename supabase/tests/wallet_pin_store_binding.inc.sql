-- Include-only part of wallet_pin_store.sql (no BEGIN/ROLLBACK).
--
-- A PIN belongs to the sign-in account that set it. C8 (U1@M4): when the
-- customer row is pointed at another account (a direct write to
-- public.customers), that account gets "unavailable" from every PIN call,
-- cannot replace the PIN, and the PIN's unspent proofs cannot be spent.
-- Pointing the row back restores both. The same holds when the row is
-- moved to another merchant (C7, U5@M1, moved to M4). A soft-deleted
-- customer cannot use the PIN at all.

DO $binding$
DECLARE
  v_result jsonb;
  v_error text;
  v_proof text;
  v_sql text;
  v_pin wallet_pin_private.customer_pins;
BEGIN
  v_result := pg_temp.wp_rpc('U1', pg_temp.wp_set_sql('M4', 'pin_2580'), pg_temp.wp_fresh_amr());
  PERFORM pg_temp.wp_assert(v_result = '{"status":"set"}', 'C8 set: ' || v_result::text);
  v_proof := pg_temp.wp_rpc('U1', pg_temp.wp_verify_sql('M4', 'pin_2580', 'vtu', 900, 'idem1'))->>'proof';
  PERFORM pg_temp.wp_assert(v_proof ~ '^[0-9a-f]{64}$', 'C8 proof issued');

  -- Re-point C8 at U6, who has no customer row at M4.
  UPDATE public.customers SET user_id = pg_temp.wp_id('U6') WHERE id = pg_temp.wp_id('C8');
  FOREACH v_sql IN ARRAY ARRAY[
    pg_temp.wp_state_sql('M4'),
    pg_temp.wp_verify_sql('M4', 'pin_2580', 'vtu', 900, 'idem2'),
    pg_temp.wp_change_sql('M4', 'pin_2580', 'salt2', 'pin_0000'),
    pg_temp.wp_reset_sql('M4', 'pin_0000')
  ] LOOP
    v_result := pg_temp.wp_rpc('U6', v_sql, pg_temp.wp_fresh_amr());
    PERFORM pg_temp.wp_assert(v_result = '{"status":"unavailable"}',
      pg_catalog.format('another account at C8: %s -> %s', v_sql, v_result));
  END LOOP;
  v_result := pg_temp.wp_rpc('U6', pg_temp.wp_set_sql('M4', 'pin_0000', 'salt2'), pg_temp.wp_fresh_amr());
  PERFORM pg_temp.wp_assert(v_result = '{"status":"already_set"}', 'set never takes over: ' || v_result::text);
  v_pin := pg_temp.wp_pin('C8');
  PERFORM pg_temp.wp_assert(
    v_pin.user_id = pg_temp.wp_id('U1') AND v_pin.failed_attempts = 0
      AND v_pin.salt = pg_catalog.decode(pg_temp.wp_hex('salt'), 'hex')
      AND v_pin.pin_hash = pg_catalog.sha256(pg_catalog.decode(pg_temp.wp_hex('pin_2580'), 'hex')),
    'the PIN is untouched while its customer row points elsewhere');
  PERFORM pg_temp.wp_assert(
    NOT EXISTS (SELECT 1 FROM wallet_pin_private.proofs
                 WHERE customer_id = pg_temp.wp_id('C8')
                   AND idempotency_key_sha256 = pg_catalog.decode(pg_temp.wp_hex('idem2'), 'hex')),
    'no proof for another account');
  PERFORM pg_temp.wp_assert(
    wallet_pin_private.consume_wallet_pin_proof(pg_temp.wp_id('C8'), pg_temp.wp_id('M4'),
      'vtu', 900, pg_temp.wp_hex('idem1'), v_proof) = 'unavailable',
    'a proof cannot be spent while its customer row points elsewhere');

  -- Pointing it back restores the PIN and the unspent proof.
  UPDATE public.customers SET user_id = pg_temp.wp_id('U1') WHERE id = pg_temp.wp_id('C8');
  PERFORM pg_temp.wp_assert(
    wallet_pin_private.consume_wallet_pin_proof(pg_temp.wp_id('C8'), pg_temp.wp_id('M4'),
      'vtu', 900, pg_temp.wp_hex('idem1'), v_proof) = 'consumed',
    'the refused consume did not burn the proof');

  -- C7 moved to M4 (where U5 has no row): the PIN stays with M1.
  v_proof := pg_temp.wp_rpc('U5', pg_temp.wp_verify_sql('M1', 'pin_2580', 'imei', 950, 'idem3'))->>'proof';
  PERFORM pg_temp.wp_assert(v_proof ~ '^[0-9a-f]{64}$', 'C7 proof before the move');
  UPDATE public.customers SET merchant_id = pg_temp.wp_id('M4') WHERE id = pg_temp.wp_id('C7');
  FOREACH v_sql IN ARRAY ARRAY[
    pg_temp.wp_state_sql('M4'),
    pg_temp.wp_verify_sql('M4', 'pin_2580', 'vtu', 951, 'idem3'),
    pg_temp.wp_change_sql('M4', 'pin_2580', 'salt2', 'pin_0000'),
    pg_temp.wp_reset_sql('M4', 'pin_0000')
  ] LOOP
    v_result := pg_temp.wp_rpc('U5', v_sql, pg_temp.wp_fresh_amr());
    PERFORM pg_temp.wp_assert(v_result = '{"status":"unavailable"}',
      pg_catalog.format('C7 at another merchant: %s -> %s', v_sql, v_result));
  END LOOP;
  PERFORM pg_temp.wp_assert(
    wallet_pin_private.consume_wallet_pin_proof(pg_temp.wp_id('C7'), pg_temp.wp_id('M1'),
      'imei', 950, pg_temp.wp_hex('idem3'), v_proof) = 'unavailable',
    'a proof cannot be spent while its customer row is at another merchant');
  UPDATE public.customers SET merchant_id = pg_temp.wp_id('M1') WHERE id = pg_temp.wp_id('C7');
  PERFORM pg_temp.wp_assert(
    (pg_temp.wp_pin('C7')).failed_attempts = 0
      AND wallet_pin_private.consume_wallet_pin_proof(pg_temp.wp_id('C7'), pg_temp.wp_id('M1'),
        'imei', 950, pg_temp.wp_hex('idem3'), v_proof) = 'consumed',
    'moving C7 back restores the PIN and the proof');

  -- Soft delete: no PIN call resolves the customer, and an unspent proof
  -- cannot be spent.
  v_proof := pg_temp.wp_rpc('U1', pg_temp.wp_verify_sql('M4', 'pin_2580', 'vtu', 901, 'idem2'))->>'proof';
  PERFORM pg_temp.wp_assert(v_proof ~ '^[0-9a-f]{64}$', 'C8 proof before deletion');
  UPDATE public.customers SET deleted_at = pg_catalog.now() WHERE id = pg_temp.wp_id('C8');
  FOREACH v_sql IN ARRAY ARRAY[
    pg_temp.wp_state_sql('M4'),
    pg_temp.wp_set_sql('M4', 'pin_0000'),
    pg_temp.wp_verify_sql('M4', 'pin_2580', 'vtu', 902, 'idem3'),
    pg_temp.wp_reset_sql('M4', 'pin_0000')
  ] LOOP
    v_error := pg_temp.wp_rpc_error('U1', v_sql, pg_temp.wp_fresh_amr());
    PERFORM pg_temp.wp_assert(v_error = '42501 wallet_pin_customer_unavailable',
      pg_catalog.format('soft-deleted customer: %s -> %s', v_sql, v_error));
  END LOOP;
  PERFORM pg_temp.wp_assert(
    NOT EXISTS (SELECT 1 FROM wallet_pin_private.proofs
                 WHERE customer_id = pg_temp.wp_id('C8')
                   AND idempotency_key_sha256 = pg_catalog.decode(pg_temp.wp_hex('idem3'), 'hex')),
    'no proof for a soft-deleted customer');
  PERFORM pg_temp.wp_assert(
    wallet_pin_private.consume_wallet_pin_proof(pg_temp.wp_id('C8'), pg_temp.wp_id('M4'),
      'vtu', 901, pg_temp.wp_hex('idem2'), v_proof) = 'unavailable',
    'a soft-deleted customer cannot spend a proof');
END;
$binding$;
