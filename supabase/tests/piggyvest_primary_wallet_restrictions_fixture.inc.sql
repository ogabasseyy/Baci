-- Shared fixture for the PiggyVest primary-wallet restriction suites. Each
-- suite includes it with \ir inside its own transaction, which it rolls back.
--
-- Two enabled integrations of one merchant:
--   * pg_temp.integration_a(), staging, whose evidence authority is this
--     session's login (the caller the helpers below act as);
--   * pg_temp.integration_b(), production, whose evidence authority is
--     another login until a suite hands it this session's login.
-- The helpers call the store as integration A in staging.

CREATE FUNCTION pg_temp.check(p_ok boolean, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', p_message; END IF;
END $$;

CREATE FUNCTION pg_temp.integration_a() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT 'c7e50000-0000-4000-8000-000000000002'::uuid
$$;

CREATE FUNCTION pg_temp.integration_b() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT 'c7e50000-0000-4000-8000-000000000003'::uuid
$$;

-- The merchant insert guards need a service_role claim, as in the other suites.
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO public.merchants(id, email)
  VALUES ('c7e50000-0000-4000-8000-000000000001', 'wallet-restrictions@example.com');
INSERT INTO piggyvest_primary.integrations(id, merchant_id, business_id, environment, executor_login, enabled)
  VALUES
    (pg_temp.integration_a(), 'c7e50000-0000-4000-8000-000000000001',
      'wr-business-a', 'staging', 'wr_fixture_provisioner_a', true),
    (pg_temp.integration_b(), 'c7e50000-0000-4000-8000-000000000001',
      'wr-business-b', 'production', 'wr_fixture_provisioner_b', true);
INSERT INTO piggyvest_primary.inflow_authorities(integration_id, executor_login, enabled)
  VALUES
    (pg_temp.integration_a(), session_user, true),
    (pg_temp.integration_b(), 'wr_fixture_evidence_b', true);

-- A creation event with the lien sample's snapshot unless told otherwise.
CREATE FUNCTION pg_temp.rec(
  p_wallet text, p_event text, p_restriction text, p_kind text,
  p_occurred timestamptz DEFAULT NULL, p_amount bigint DEFAULT 1000000
) RETURNS text LANGUAGE sql AS $$
  SELECT piggyvest_primary.record_wallet_restriction(
    pg_temp.integration_a(), 'staging',
    p_wallet, p_event, p_restriction, p_kind, p_amount, 650733, 1650733, p_occurred)
$$;

CREATE FUNCTION pg_temp.lift(
  p_wallet text, p_event text, p_restriction text, p_kind text, p_lifted timestamptz
) RETURNS text LANGUAGE sql AS $$
  SELECT piggyvest_primary.lift_wallet_restriction(
    pg_temp.integration_a(), 'staging', p_wallet, p_event, p_restriction, p_kind, p_lifted)
$$;

CREATE FUNCTION pg_temp.blocked(p_wallet text) RETURNS boolean LANGUAGE sql AS $$
  SELECT blocked FROM piggyvest_primary.wallet_restriction_state(p_wallet)
$$;

CREATE FUNCTION pg_temp.active(p_wallet text) RETURNS integer LANGUAGE sql AS $$
  SELECT active_count FROM piggyvest_primary.wallet_restriction_state(p_wallet)
$$;

CREATE FUNCTION pg_temp.kinds(p_wallet text) RETURNS text[] LANGUAGE sql AS $$
  SELECT active_kinds FROM piggyvest_primary.wallet_restriction_state(p_wallet)
$$;

CREATE FUNCTION pg_temp.rows(p_wallet text) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM piggyvest_primary.wallet_restrictions
  WHERE provider_wallet_id = p_wallet
$$;

-- Every event id the store has accepted for a wallet's restrictions.
CREATE FUNCTION pg_temp.events(p_wallet text) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM piggyvest_primary.wallet_restriction_events AS e
  JOIN piggyvest_primary.wallet_restrictions AS r ON r.id = e.restriction_id
  WHERE r.provider_wallet_id = p_wallet
$$;

-- Expects p_sql to raise 22023 (invalid_parameter_value).
CREATE FUNCTION pg_temp.rejects(p_sql text, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION 'accepted: %', p_message;
EXCEPTION WHEN invalid_parameter_value THEN
  NULL;
END $$;

-- Expects p_sql to raise 42501 from the store's own authority check.
CREATE FUNCTION pg_temp.unbound(p_sql text, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION 'accepted: %', p_message;
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;
