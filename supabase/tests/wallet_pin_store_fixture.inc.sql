-- Include-only part of wallet_pin_store.sql (no BEGIN/ROLLBACK): the entry
-- point owns the transaction.
--
-- Merchants: M1 and M4 have PIN enabled, M2 has no authority row, M3 is
-- disabled. Customers (user@merchant): C1=U1@M1 (set/verify), C2=U2@M1
-- (lockout), C3=U1@M2, C4=U1@M3, C5=U3@M1 (verified MFA), C6=U4@M1
-- (reset; unverified MFA enrollment), C7=U5@M1 (proofs), C8=U1@M4
-- (account binding, soft delete). U6 has no customer row. Each user has
-- one live session S<n>; S7 is U4's expired session. Setting a PIN needs a recent sign-in, so set
-- calls pass pg_temp.wp_fresh_amr().
-- Hex constants are the KDF test vectors from wallet-pin-kdf.test.ts. The
-- attestation helpers and RPC builders are in wallet_pin_store_calls.inc.sql.

CREATE FUNCTION pg_temp.wp_id(p_name text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_kind text := pg_catalog.left(p_name, 1);
  v_index integer := pg_catalog.substr(p_name, 2)::integer;
BEGIN
  IF v_index NOT BETWEEN 1 AND 9 OR v_kind NOT IN ('U', 'S', 'M', 'C') THEN
    RAISE EXCEPTION 'unknown fixture id %', p_name;
  END IF;
  RETURN pg_catalog.format(
    'f1a0%s-0000-4000-8000-00000000000%s',
    CASE v_kind WHEN 'U' THEN '0000' WHEN 'S' THEN '0001'
      WHEN 'M' THEN '0002' ELSE '0003' END,
    v_index
  )::uuid;
END;
$$;

CREATE FUNCTION pg_temp.wp_hex(p_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE p_name
    WHEN 'pepper' THEN 'd0bc8ce070c22d11'
    WHEN 'other_pepper' THEN 'fa2b4b51bb36dd21'
    WHEN 'unkeyed_pepper' THEN '0123456789abcdef'
    WHEN 'attest_dummy' THEN '1700000000000.' || pg_catalog.repeat('0', 64)
    WHEN 'salt' THEN '000102030405060708090a0b0c0d0e0f'
    WHEN 'salt2' THEN 'ffffffffffffffffffffffffffffffff'
    WHEN 'pin_2580' THEN
      '4582efeab2c2c9c37c747389ab8d1a8c9e5f3968b71f77ee49c866c0564b4e3a'
    WHEN 'pin_0000' THEN
      '822eb24bd3a5e7ae1db774c222b9ec82ce8bbd9f8e9ee663d43d6b81bcc1d789'
    WHEN 'pin_135790' THEN
      '6573367178c4814da7dd9e2e5172b3b074c3c088ec923e7743a09b38d5aa33b5'
    WHEN 'idem1' THEN
      'dc8fac035907b40165432a3b32d82df9f20d51706b0850a3290605d8a26e7e8e'
    WHEN 'idem2' THEN
      '438ec7dd1ce96629e1cb11831c82d41e3eb52502b7d7c5865169c1ddd915bdcc'
    WHEN 'idem3' THEN
      '4e22ff0d88d3d012026c51626e7a8551d3aa8677a404f91ecc2cd59fc5189ca4'
    ELSE pg_catalog.format('unknown-%s', p_name)
  END;
END;
$$;

CREATE FUNCTION pg_temp.wp_assert(p_ok boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'wallet_pin_store: %', p_message;
  END IF;
END;
$$;

-- JWT claims for a user: live session, AAL1, a password sign-in one hour
-- ago (too old for a reset). p_extra overrides any key.
CREATE FUNCTION pg_temp.wp_claims(p_user text, p_extra jsonb DEFAULT '{}')
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'sub', pg_temp.wp_id(p_user),
    'role', 'authenticated',
    'aud', 'authenticated',
    'session_id', pg_temp.wp_id('S' || pg_catalog.substr(p_user, 2)),
    'aal', 'aal1',
    'amr', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'method', 'password',
      'timestamp',
      (pg_catalog.date_part('epoch', pg_catalog.now()) - 3600)::bigint
    ))
  ) || p_extra;
$$;

-- One amr entry: p_method used p_age_seconds ago (negative = in the future).
CREATE FUNCTION pg_temp.wp_amr_entry(p_method text, p_age_seconds integer)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'method', p_method,
    'timestamp', (pg_catalog.date_part('epoch', pg_catalog.now()) - p_age_seconds)::bigint
  );
$$;

-- A sign-in (password by default) one minute ago.
CREATE FUNCTION pg_temp.wp_fresh_amr(p_method text DEFAULT 'password')
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT pg_catalog.jsonb_build_object('amr',
    pg_catalog.jsonb_build_array(pg_temp.wp_amr_entry(p_method, 60)));
$$;

-- Runs p_sql as the authenticated role with p_user's claims. A plain
-- (invoker) function may switch roles; the role switch is undone when the
-- statement or its subtransaction ends.
CREATE FUNCTION pg_temp.wp_rpc(
  p_user text,
  p_sql text,
  p_extra jsonb DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    pg_temp.wp_claims(p_user, p_extra)::text,
    true
  );
  SET LOCAL ROLE authenticated;
  EXECUTE p_sql INTO v_result;
  RESET ROLE;
  PERFORM pg_catalog.set_config('request.jwt.claims', '', true);
  RETURN v_result;
END;
$$;

-- Same, but returns '<SQLSTATE> <message>' for an error the RPC itself
-- raises (input and identity checks), or 'no error'.
CREATE FUNCTION pg_temp.wp_rpc_error(
  p_user text,
  p_sql text,
  p_extra jsonb DEFAULT '{}'
)
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_temp.wp_rpc(p_user, p_sql, p_extra);
  RETURN 'no error';
EXCEPTION
  WHEN OTHERS THEN
    RETURN SQLSTATE || ' ' || SQLERRM;
END;
$$;

CREATE FUNCTION pg_temp.wp_pin(p_customer text)
RETURNS wallet_pin_private.customer_pins
LANGUAGE sql
STABLE
AS $$
  SELECT pin.* FROM wallet_pin_private.customer_pins AS pin
  WHERE pin.customer_id = pg_temp.wp_id(p_customer);
$$;

DO $fixture$
DECLARE
  v_index integer;
BEGIN
  FOR v_index IN 1..6 LOOP
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data
    ) VALUES (
      pg_temp.wp_id('U' || v_index), '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated',
      pg_catalog.format('wallet-pin-u%s@example.test', v_index), 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(),
      '{}'::jsonb, '{}'::jsonb
    );
    INSERT INTO auth.sessions (id, user_id, created_at, updated_at, aal)
    VALUES (
      pg_temp.wp_id('S' || v_index), pg_temp.wp_id('U' || v_index),
      pg_catalog.now(), pg_catalog.now(), 'aal1'
    );
  END LOOP;
  -- S7: a second session for U4 that ran past its time box (not_after) and
  -- has not been swept yet.
  INSERT INTO auth.sessions (id, user_id, created_at, updated_at, aal, not_after)
  VALUES (
    pg_temp.wp_id('S7'), pg_temp.wp_id('U4'), pg_catalog.now() - interval '2 hours',
    pg_catalog.now() - interval '2 hours', 'aal1', pg_catalog.now() - interval '1 minute'
  );

  -- The merchants audit trigger refuses a write without an actor (28000);
  -- the fixture writes as the service actor, then clears the claims.
  PERFORM pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
  FOR v_index IN 1..4 LOOP
    INSERT INTO public.merchants (id, email, business_name, slug)
    VALUES (
      pg_temp.wp_id('M' || v_index),
      pg_catalog.format('wallet-pin-m%s@example.test', v_index),
      pg_catalog.format('Wallet PIN M%s', v_index),
      pg_catalog.format('wallet-pin-m%s', v_index)
    );
  END LOOP;
  PERFORM pg_catalog.set_config('request.jwt.claims', '', true);

  INSERT INTO public.customers (id, merchant_id, email, user_id)
  SELECT pg_temp.wp_id(row_value.customer), pg_temp.wp_id(row_value.merchant),
    pg_catalog.format('wallet-pin-%s@example.test', pg_catalog.lower(row_value.customer)),
    pg_temp.wp_id(row_value.app_user)
  FROM (VALUES
    ('C1', 'M1', 'U1'), ('C2', 'M1', 'U2'), ('C3', 'M2', 'U1'),
    ('C4', 'M3', 'U1'), ('C5', 'M1', 'U3'), ('C6', 'M1', 'U4'),
    ('C7', 'M1', 'U5'), ('C8', 'M4', 'U1')
  ) AS row_value(customer, merchant, app_user);

  -- U3 has a verified factor (AAL2 needed). U4 only started an enrollment
  -- and never verified it, which must not demand AAL2.
  INSERT INTO auth.mfa_factors (
    id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret
  ) VALUES (
    'f1a00004-0000-4000-8000-000000000003', pg_temp.wp_id('U3'),
    'Wallet PIN regression authenticator', 'totp', 'verified',
    pg_catalog.now(), pg_catalog.now(), 'TESTSECRET'
  ), (
    'f1a00004-0000-4000-8000-000000000004', pg_temp.wp_id('U4'),
    'Wallet PIN abandoned enrollment', 'totp', 'unverified',
    pg_catalog.now(), pg_catalog.now(), 'TESTSECRET'
  );

  -- Owner SQL in production (runbook); the suite stands in for it here.
  INSERT INTO wallet_pin_private.merchant_authorities (merchant_id, enabled)
  VALUES (pg_temp.wp_id('M1'), true), (pg_temp.wp_id('M3'), false),
    (pg_temp.wp_id('M4'), true);
END;
$fixture$;
