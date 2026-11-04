-- REGRESSION TEST: wallet PIN status is unavailable when the pepper has no
-- signing key (migration *_wallet_pin_state_requires_signing_key).
-- Reuses the wallet_pin_store fixture; runs in one rolled-back transaction.

BEGIN;

SET LOCAL search_path = pg_catalog, public, extensions;

\ir wallet_pin_store_fixture.inc.sql
\ir wallet_pin_store_calls.inc.sql

DO $key$
DECLARE
  v_result jsonb;
BEGIN
  -- Keyed pepper: unchanged behaviour.
  v_result := pg_temp.wp_rpc('U1', pg_temp.wp_state_sql('M1'));
  PERFORM pg_temp.wp_assert(v_result = '{"status":"not_set"}',
    'keyed pepper keeps reporting not_set: ' || v_result::text);

  -- A pepper whose key row is absent: unavailable, for an enabled merchant.
  v_result := pg_temp.wp_rpc('U1', pg_temp.wp_state_sql('M1', 'unkeyed_pepper'));
  PERFORM pg_temp.wp_assert(v_result = '{"status":"unavailable"}',
    'unkeyed pepper is unavailable: ' || v_result::text);

  -- Deleting the key (emergency stop) flips a keyed pepper to unavailable.
  DELETE FROM wallet_pin_private.attestation_keys
   WHERE pepper_id = pg_catalog.decode(pg_temp.wp_hex('pepper'), 'hex');
  v_result := pg_temp.wp_rpc('U1', pg_temp.wp_state_sql('M1'));
  PERFORM pg_temp.wp_assert(v_result = '{"status":"unavailable"}',
    'deleted key is unavailable: ' || v_result::text);
END
$key$;

ROLLBACK;
