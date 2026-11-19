-- Include-only part of wallet_pin_store_concurrency.sql and
-- wallet_pin_store_concurrency_clock.sql (the entry file owns the
-- connections' lifetime; wallet_pin_store_concurrency_teardown.inc.sql ends
-- them).
--
-- Opens two dblink backends, removes fixtures a failed earlier run left,
-- commits fresh ones (backend B must see them) and defines the helpers.
-- Both backends then act as the customer, through the customer RPCs.
-- Pass -v dblink_password=... for a non-default local DB; dblink is dropped
-- at the end only if the entry file made it.

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

-- Remove fixtures left by an earlier failed run (reverse foreign-key order).
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', false);
DELETE FROM wallet_pin_private.proofs WHERE customer_id = 'f1a10003-0000-4000-8000-000000000001';
DELETE FROM wallet_pin_private.customer_pins WHERE customer_id = 'f1a10003-0000-4000-8000-000000000001';
DELETE FROM wallet_pin_private.attestation_keys WHERE pepper_id = pg_catalog.decode('d0bc8ce070c22d11', 'hex');
DELETE FROM wallet_pin_private.merchant_authorities WHERE merchant_id = 'f1a10002-0000-4000-8000-000000000001';
DELETE FROM public.customers WHERE id = 'f1a10003-0000-4000-8000-000000000001';
DELETE FROM public.merchants WHERE id = 'f1a10002-0000-4000-8000-000000000001';
DELETE FROM auth.sessions WHERE id = 'f1a10001-0000-4000-8000-000000000001';
DELETE FROM auth.users WHERE id = 'f1a10000-0000-4000-8000-000000000001';
SELECT pg_catalog.set_config('request.jwt.claims', '', false);

-- Committed fixtures. The PIN row stores SHA-256 of the derived hash; the
-- hex constants are the KDF test vectors (PIN 2580 and 0000). The
-- attestation key is the one the server derives from the test pepper in
-- wallet-pin-kdf.test.ts.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) VALUES (
  'f1a10000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'wallet-pin-race@example.test', 'test',
  pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb, '{}'::jsonb
);
INSERT INTO auth.sessions (id, user_id, created_at, updated_at, aal)
VALUES ('f1a10001-0000-4000-8000-000000000001', 'f1a10000-0000-4000-8000-000000000001',
  pg_catalog.now(), pg_catalog.now(), 'aal1');
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
INSERT INTO wallet_pin_private.attestation_keys (pepper_id, attestation_key)
VALUES (pg_catalog.decode('d0bc8ce070c22d11', 'hex'), extensions.hmac(
  pg_catalog.convert_to('baci.wallet-pin.attestation-key.v1', 'UTF8'),
  pg_catalog.convert_to('baci-wallet-pin-test-pepper-000000000000', 'UTF8'), 'sha256'));
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

-- The server attestation for the fixture customer, as the route would sign
-- it now: '<attested_at_ms>.<hex HMAC>' over the lines
-- wallet_pin_private.require_attestation rebuilds.
CREATE FUNCTION pg_temp.wp_attestation(p_operation text, p_fields text[])
RETURNS text
LANGUAGE sql
AS $$
  SELECT request.at_ms::text || '.' || pg_catalog.encode(extensions.hmac(
    pg_catalog.convert_to(pg_catalog.array_to_string(ARRAY[
      'baci.wallet-pin.attestation.v1', p_operation,
      'f1a10000-0000-4000-8000-000000000001', 'f1a10002-0000-4000-8000-000000000001',
      'd0bc8ce070c22d11', request.at_ms::text] || p_fields, E'\n'), 'UTF8'),
    (SELECT attestation_key FROM wallet_pin_private.attestation_keys
      WHERE pepper_id = pg_catalog.decode('d0bc8ce070c22d11', 'hex')), 'sha256'), 'hex')
    FROM (SELECT (pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()) * 1000)::bigint AS at_ms) AS request;
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

\set wp_lock_pin 'SELECT 1 FROM wallet_pin_private.customer_pins WHERE customer_id = ''f1a10003-0000-4000-8000-000000000001'' FOR UPDATE'
