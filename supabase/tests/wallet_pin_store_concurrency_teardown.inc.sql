-- Include-only part of wallet_pin_store_concurrency.sql and
-- wallet_pin_store_concurrency_clock.sql: closes the backends, deletes the
-- committed fixtures (reverse foreign-key order) and restores the
-- pre-test extension set (drops only what the setup made).

SELECT dblink_disconnect('wp_race_a');
SELECT dblink_disconnect('wp_race_b');

DELETE FROM wallet_pin_private.proofs WHERE customer_id = 'f1a10003-0000-4000-8000-000000000001';
DELETE FROM wallet_pin_private.customer_pins WHERE customer_id = 'f1a10003-0000-4000-8000-000000000001';
DELETE FROM wallet_pin_private.attestation_keys WHERE pepper_id = pg_catalog.decode('d0bc8ce070c22d11', 'hex');
DELETE FROM wallet_pin_private.merchant_authorities WHERE merchant_id = 'f1a10002-0000-4000-8000-000000000001';
DELETE FROM public.customers WHERE id = 'f1a10003-0000-4000-8000-000000000001';
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', false);
DELETE FROM public.merchants WHERE id = 'f1a10002-0000-4000-8000-000000000001';
SELECT pg_catalog.set_config('request.jwt.claims', '', false);
DELETE FROM auth.sessions WHERE id = 'f1a10001-0000-4000-8000-000000000001';
DELETE FROM auth.users WHERE id = 'f1a10000-0000-4000-8000-000000000001';
DROP FUNCTION pg_temp.wp_release_b(integer, integer, timestamptz);
DROP FUNCTION pg_temp.wp_attestation(text, text[]);
DROP FUNCTION pg_temp.wp_expect(boolean, text);

\if :wp_had_dblink
\else
DROP EXTENSION IF EXISTS dblink;
\endif
