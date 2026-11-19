-- Include-only part of wallet_pin_store.sql (no BEGIN/ROLLBACK), loaded
-- right after the fixture.
--
-- Server attestation helpers and the RPC call builders. Every builder
-- attaches a valid attestation for whoever runs the call (pg_temp.wp_attest
-- runs inside the call, as the calling customer); the attestation part
-- sends wrong ones on purpose. The key rows stand in for the owner SQL of
-- the enablement runbook; 'unkeyed_pepper' deliberately has none.

-- The attestation key the server derives from a test pepper (the pepper
-- strings are the ones in wallet-pin-kdf.test.ts).
CREATE FUNCTION pg_temp.wp_attestation_key(p_pepper text)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT extensions.hmac(
    pg_catalog.convert_to('baci.wallet-pin.attestation-key.v1', 'UTF8'),
    pg_catalog.convert_to(CASE p_pepper
      WHEN 'pepper' THEN 'baci-wallet-pin-test-pepper-000000000000'
      WHEN 'other_pepper' THEN 'baci-wallet-pin-other-pepper-11111111111'
      ELSE 'baci-wallet-pin-unknown-pepper-' || p_pepper END, 'UTF8'),
    'sha256');
$$;

-- '<attested_at_ms>.<hex HMAC>' as the server builds it.
CREATE FUNCTION pg_temp.wp_mac(
  p_key bytea, p_user uuid, p_operation text, p_merchant uuid,
  p_pepper_hex text, p_at_ms bigint, p_fields text[]
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_at_ms::text || '.' || pg_catalog.encode(extensions.hmac(
    pg_catalog.convert_to(pg_catalog.array_to_string(
      ARRAY['baci.wallet-pin.attestation.v1', p_operation, p_user::text,
            p_merchant::text, p_pepper_hex, p_at_ms::text] || p_fields, E'\n'), 'UTF8'),
    p_key, 'sha256'), 'hex');
$$;

CREATE FUNCTION pg_temp.wp_now_ms()
RETURNS bigint
LANGUAGE sql
AS $$
  SELECT (pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()) * 1000)::bigint;
$$;

-- Evaluated inside the RPC call, as the calling customer: a valid
-- attestation for auth.uid() under the stored key for the pepper (or a key
-- no row holds, for a pepper with no key).
CREATE FUNCTION pg_temp.wp_attest(
  p_operation text, p_merchant uuid, p_pepper_hex text, p_fields text[]
)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_temp.wp_mac(
    COALESCE((SELECT attestation.attestation_key FROM wallet_pin_private.attestation_keys AS attestation
               WHERE attestation.pepper_id = pg_catalog.decode(p_pepper_hex, 'hex')),
             pg_temp.wp_attestation_key('none')),
    auth.uid(), p_operation, p_merchant, p_pepper_hex, pg_temp.wp_now_ms(), p_fields);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.wp_attest(text, uuid, text, text[]) TO authenticated;

INSERT INTO wallet_pin_private.attestation_keys (pepper_id, attestation_key)
VALUES (pg_catalog.decode(pg_temp.wp_hex('pepper'), 'hex'), pg_temp.wp_attestation_key('pepper')),
  (pg_catalog.decode(pg_temp.wp_hex('other_pepper'), 'hex'), pg_temp.wp_attestation_key('other_pepper'));

CREATE FUNCTION pg_temp.wp_state_sql(p_merchant text, p_pepper text DEFAULT 'pepper')
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT pg_catalog.format(
    'SELECT public.get_wallet_pin_state(%L::uuid, %L)',
    pg_temp.wp_id(p_merchant), pg_temp.wp_hex(p_pepper)
  );
$$;

CREATE FUNCTION pg_temp.wp_set_sql(
  p_merchant text,
  p_pin text,
  p_salt text DEFAULT 'salt',
  p_pepper text DEFAULT 'pepper',
  p_kdf integer DEFAULT 1
)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT pg_catalog.format(
    'SELECT public.set_wallet_pin(%1$L::uuid, %2$L, %3$s, %4$L, %5$L, '
      'pg_temp.wp_attest(''set'', %1$L::uuid, %2$L, ARRAY[''1'', %4$L, %5$L]))',
    pg_temp.wp_id(p_merchant), pg_temp.wp_hex(p_pepper), p_kdf,
    pg_temp.wp_hex(p_salt), pg_temp.wp_hex(p_pin)
  );
$$;

CREATE FUNCTION pg_temp.wp_change_sql(
  p_merchant text,
  p_current text,
  p_salt text,
  p_pin text,
  p_pepper text DEFAULT 'pepper'
)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT pg_catalog.format(
    'SELECT public.change_wallet_pin(%1$L::uuid, %2$L, %3$L, 1, %4$L, %5$L, '
      'pg_temp.wp_attest(''change'', %1$L::uuid, %2$L, ARRAY[%3$L, ''1'', %4$L, %5$L]))',
    pg_temp.wp_id(p_merchant), pg_temp.wp_hex(p_pepper), pg_temp.wp_hex(p_current),
    pg_temp.wp_hex(p_salt), pg_temp.wp_hex(p_pin)
  );
$$;

CREATE FUNCTION pg_temp.wp_verify_sql(
  p_merchant text,
  p_pin text,
  p_purpose text,
  p_amount bigint,
  p_idem text,
  p_pepper text DEFAULT 'pepper',
  p_pin_hash_hex text DEFAULT NULL
)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT pg_catalog.format(
    'SELECT public.verify_wallet_pin(%1$L::uuid, %2$L, %3$L, %4$L, %5$s, %6$L, '
      'pg_temp.wp_attest(''verify'', %1$L::uuid, %2$L, ARRAY[%3$L, %4$L, %5$L, %6$L]))',
    pg_temp.wp_id(p_merchant), pg_temp.wp_hex(p_pepper),
    COALESCE(p_pin_hash_hex, pg_temp.wp_hex(p_pin)), p_purpose, p_amount,
    CASE WHEN p_idem ~ '^[0-9a-f]{64}$' THEN p_idem ELSE pg_temp.wp_hex(p_idem) END
  );
$$;
