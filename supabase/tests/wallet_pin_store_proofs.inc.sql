-- Include-only part of wallet_pin_store.sql (no BEGIN/ROLLBACK).
--
-- Proofs for C7 (U5@M1). consume_wallet_pin_proof is called here as its
-- owner, which is how the spend hold will call it (definer to definer,
-- inside the hold transaction). A proof is consumed once, only for the
-- exact customer, merchant, purpose, amount and Idempotency-Key digest it
-- was issued for, and only within 120 seconds. A refused consume never
-- burns a valid proof. Spent proofs are kept as the record of an approved
-- debit.

CREATE FUNCTION pg_temp.wp_consume(
  p_proof text,
  p_purpose text,
  p_amount bigint,
  p_idem text,
  p_customer text DEFAULT 'C7',
  p_merchant text DEFAULT 'M1'
)
RETURNS text
LANGUAGE sql
AS $$
  SELECT wallet_pin_private.consume_wallet_pin_proof(
    pg_temp.wp_id(p_customer), pg_temp.wp_id(p_merchant), p_purpose, p_amount,
    CASE WHEN p_idem ~ '^[0-9a-f]{64}$' THEN p_idem ELSE pg_temp.wp_hex(p_idem) END,
    p_proof
  );
$$;

CREATE FUNCTION pg_temp.wp_issue(p_purpose text, p_amount bigint, p_idem text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_result jsonb := pg_temp.wp_rpc('U5',
    pg_temp.wp_verify_sql('M1', 'pin_2580', p_purpose, p_amount, p_idem));
BEGIN
  PERFORM pg_temp.wp_assert(v_result->>'status' = 'verified', 'C7 verify: ' || v_result::text);
  RETURN v_result->>'proof';
END;
$$;

DO $proofs$
DECLARE
  v_proof text;
  v_first text;
  v_error text;
  v_live integer;
  v_result jsonb;
BEGIN
  PERFORM pg_temp.wp_assert(
    pg_temp.wp_rpc('U5', pg_temp.wp_set_sql('M1', 'pin_2580'), pg_temp.wp_fresh_amr())
      = '{"status":"set"}', 'C7 set');

  -- Single use.
  v_proof := pg_temp.wp_issue('vtu', 5000, 'idem1');
  PERFORM pg_temp.wp_assert(pg_temp.wp_consume(v_proof, 'vtu', 5000, 'idem1') = 'consumed', 'first consume');
  PERFORM pg_temp.wp_assert(pg_temp.wp_consume(v_proof, 'vtu', 5000, 'idem1') = 'used', 'second consume');

  -- Reason precedence: the binding is judged before the proof's state, so
  -- used only describes the debit the proof was issued for. A spent proof
  -- presented for anything else is a mismatch.
  PERFORM pg_temp.wp_assert(pg_temp.wp_consume(v_proof, 'vtu', 5001, 'idem1') = 'mismatch', 'spent proof, other amount');
  PERFORM pg_temp.wp_assert(pg_temp.wp_consume(v_proof, 'imei', 5000, 'idem1') = 'mismatch', 'spent proof, other purpose');
  PERFORM pg_temp.wp_assert(pg_temp.wp_consume(v_proof, 'vtu', 5000, 'idem2') = 'mismatch', 'spent proof, other key');
  PERFORM pg_temp.wp_assert(pg_temp.wp_consume(v_proof, 'vtu', 5000, 'idem1', 'C1') = 'mismatch', 'spent proof, other customer');
  PERFORM pg_temp.wp_assert(pg_temp.wp_consume(v_proof, 'vtu', 5000, 'idem1') = 'used', 'spent proof, same debit');

  -- Any other binding is refused and leaves the proof usable.
  v_proof := pg_temp.wp_issue('checkout', 250000, 'idem2');
  PERFORM pg_temp.wp_assert(pg_temp.wp_consume(v_proof, 'checkout', 250001, 'idem2') = 'mismatch', 'other amount');
  PERFORM pg_temp.wp_assert(pg_temp.wp_consume(v_proof, 'imei', 250000, 'idem2') = 'mismatch', 'other purpose');
  PERFORM pg_temp.wp_assert(pg_temp.wp_consume(v_proof, 'checkout', 250000, 'idem3') = 'mismatch', 'other key');
  PERFORM pg_temp.wp_assert(pg_temp.wp_consume(v_proof, 'checkout', 250000, 'idem2', 'C1') = 'mismatch', 'other customer');
  PERFORM pg_temp.wp_assert(pg_temp.wp_consume(v_proof, 'checkout', 250000, 'idem2', 'C7', 'M3') = 'mismatch', 'other merchant');
  PERFORM pg_temp.wp_assert(pg_temp.wp_consume(v_proof, 'checkout', 250000, 'idem2') = 'consumed', 'exact binding after refusals');

  -- Expiry: 120 seconds after issue (time moved back, not waited for).
  v_proof := pg_temp.wp_issue('imei', 1500, 'idem3');
  UPDATE wallet_pin_private.proofs
     SET issued_at = issued_at - interval '121 seconds',
         expires_at = expires_at - interval '121 seconds'
   WHERE token_sha256 = pg_catalog.sha256(pg_catalog.decode(v_proof, 'hex'));
  PERFORM pg_temp.wp_assert(pg_temp.wp_consume(v_proof, 'imei', 1500, 'idem3') = 'expired', 'expired proof');
  PERFORM pg_temp.wp_assert(
    EXISTS (SELECT 1 FROM wallet_pin_private.proofs
             WHERE token_sha256 = pg_catalog.sha256(pg_catalog.decode(v_proof, 'hex'))
               AND consumed_at IS NULL),
    'an expired proof is not marked consumed');
  PERFORM pg_temp.wp_assert(pg_temp.wp_consume(v_proof, 'imei', 1501, 'idem3') = 'mismatch', 'expired proof, other amount');
  PERFORM pg_temp.wp_assert(pg_temp.wp_consume(v_proof, 'vtu', 1500, 'idem3') = 'mismatch', 'expired proof, other purpose');
  PERFORM pg_temp.wp_assert(pg_temp.wp_consume(v_proof, 'imei', 1500, 'idem3') = 'expired', 'expired proof, same debit');

  -- Missing, malformed and unknown tokens.
  PERFORM pg_temp.wp_assert(pg_temp.wp_consume(NULL, 'vtu', 5000, 'idem1') = 'missing', 'NULL token');
  PERFORM pg_temp.wp_assert(pg_temp.wp_consume('', 'vtu', 5000, 'idem1') = 'missing', 'empty token');
  PERFORM pg_temp.wp_assert(pg_temp.wp_consume('abc', 'vtu', 5000, 'idem1') = 'invalid', 'short token');
  PERFORM pg_temp.wp_assert(
    pg_temp.wp_consume(pg_catalog.upper(pg_temp.wp_hex('idem1')), 'vtu', 5000, 'idem1') = 'invalid', 'upper-case token');
  PERFORM pg_temp.wp_assert(
    pg_temp.wp_consume(pg_temp.wp_hex('idem1'), 'vtu', 5000, 'idem1') = 'invalid', 'unknown token');

  -- A missing binding is a caller bug, not a refusal.
  BEGIN
    PERFORM wallet_pin_private.consume_wallet_pin_proof(
      pg_temp.wp_id('C7'), pg_temp.wp_id('M1'), 'vtu', 5000, NULL, v_proof);
    v_error := 'no error';
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLSTATE;
  END;
  PERFORM pg_temp.wp_assert(v_error = '22023', 'NULL binding raises 22023: ' || v_error);

  -- Verifying again for the same purpose and key replaces the live proof.
  v_first := pg_temp.wp_issue('vtu', 100, 'idem2');
  v_proof := pg_temp.wp_issue('vtu', 120, 'idem2');
  PERFORM pg_temp.wp_assert(pg_temp.wp_consume(v_first, 'vtu', 100, 'idem2') = 'invalid', 'replaced proof');
  PERFORM pg_temp.wp_assert(pg_temp.wp_consume(v_proof, 'vtu', 120, 'idem2') = 'consumed', 'replacement proof');

  -- Verifying again for a spent binding issues a new proof and keeps the
  -- spent one; a spent proof past its expiry also survives the purge.
  v_first := pg_temp.wp_issue('vtu', 120, 'idem2');
  PERFORM pg_temp.wp_assert(v_first <> v_proof, 'a new proof for a spent binding');
  UPDATE wallet_pin_private.proofs
     SET issued_at = issued_at - interval '121 seconds',
         expires_at = expires_at - interval '121 seconds',
         consumed_at = consumed_at - interval '121 seconds'
   WHERE token_sha256 = pg_catalog.sha256(pg_catalog.decode(v_proof, 'hex'));
  PERFORM pg_temp.wp_issue('imei', 130, 'idem2');
  PERFORM pg_temp.wp_assert(
    EXISTS (SELECT 1 FROM wallet_pin_private.proofs
             WHERE token_sha256 = pg_catalog.sha256(pg_catalog.decode(v_proof, 'hex'))
               AND consumed_at IS NOT NULL),
    'spent proofs are kept by verify');

  -- At most 10 live proofs per customer; expired ones are purged on issue.
  SELECT pg_catalog.count(*) INTO v_live FROM wallet_pin_private.proofs
   WHERE customer_id = pg_temp.wp_id('C7') AND consumed_at IS NULL
     AND expires_at > pg_catalog.clock_timestamp();
  FOR v_index IN 1..(10 - v_live) LOOP
    PERFORM pg_temp.wp_issue('vtu', 100,
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('cap-' || v_index, 'UTF8')), 'hex'));
  END LOOP;
  PERFORM pg_temp.wp_assert(
    NOT EXISTS (SELECT 1 FROM wallet_pin_private.proofs
                 WHERE customer_id = pg_temp.wp_id('C7') AND consumed_at IS NULL
                   AND expires_at <= pg_catalog.clock_timestamp()),
    'expired proofs were purged');
  v_result := pg_temp.wp_rpc('U5', pg_temp.wp_verify_sql('M1', 'pin_2580', 'vtu', 100,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('cap-11', 'UTF8')), 'hex')));
  PERFORM pg_temp.wp_assert(v_result = '{"status":"too_many_proofs"}', 'eleventh live proof: ' || v_result::text);
  PERFORM pg_temp.wp_assert((pg_temp.wp_pin('C7')).failed_attempts = 0, 'the cap is not a failed attempt');

  -- Kill switch: disabling the merchant stops consume, verify, state, change
  -- and reset.
  v_proof := pg_temp.wp_issue('vtu', 100,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('cap-1', 'UTF8')), 'hex'));
  UPDATE wallet_pin_private.merchant_authorities SET enabled = false
   WHERE merchant_id = pg_temp.wp_id('M1');
  PERFORM pg_temp.wp_assert(
    pg_temp.wp_consume(v_proof, 'vtu', 100,
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('cap-1', 'UTF8')), 'hex')) = 'unavailable',
    'consume while disabled');
  v_result := pg_temp.wp_rpc('U5', pg_temp.wp_verify_sql('M1', 'pin_2580', 'vtu', 100, 'idem1'));
  PERFORM pg_temp.wp_assert(v_result = '{"status":"unavailable"}', 'verify while disabled: ' || v_result::text);
  v_result := pg_temp.wp_rpc('U5', pg_temp.wp_state_sql('M1'));
  PERFORM pg_temp.wp_assert(v_result = '{"status":"unavailable"}', 'state while disabled: ' || v_result::text);
  v_result := pg_temp.wp_rpc('U5', pg_temp.wp_change_sql('M1', 'pin_2580', 'salt2', 'pin_0000'));
  PERFORM pg_temp.wp_assert(v_result = '{"status":"unavailable"}', 'change while disabled: ' || v_result::text);
  v_result := pg_temp.wp_rpc('U5', pg_temp.wp_reset_sql('M1', 'pin_0000'), pg_temp.wp_fresh_amr());
  PERFORM pg_temp.wp_assert(v_result = '{"status":"unavailable"}', 'reset while disabled: ' || v_result::text);
  PERFORM pg_temp.wp_assert(
    (pg_temp.wp_pin('C7')).pin_hash = pg_catalog.sha256(pg_catalog.decode(pg_temp.wp_hex('pin_2580'), 'hex'))
      AND (pg_temp.wp_pin('C7')).salt = pg_catalog.decode(pg_temp.wp_hex('salt'), 'hex'),
    'nothing changes the PIN while disabled');
  UPDATE wallet_pin_private.merchant_authorities SET enabled = true
   WHERE merchant_id = pg_temp.wp_id('M1');
  PERFORM pg_temp.wp_assert(
    pg_temp.wp_consume(v_proof, 'vtu', 100,
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('cap-1', 'UTF8')), 'hex')) = 'consumed',
    'the refused consume did not burn the proof');
END;
$proofs$;
