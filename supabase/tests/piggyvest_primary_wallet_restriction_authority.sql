-- Contract test: the PiggyVest primary-wallet restriction writers are bound
-- to one integration, like every other piggyvest_primary evidence writer.
-- Proves, against live PostgreSQL:
--   * record_wallet_restriction and lift_wallet_restriction raise 42501 and
--     store nothing unless the integration exists, is enabled, matches the
--     environment, and its enabled evidence authority is this session's login
--     (so ops disabling the integration or its evidence authority stops
--     every write);
--   * each row records the integration that wrote it;
--   * an integration can never lift or complete another integration's
--     restriction, nor reuse its event ids: those are conflicts that change
--     nothing;
--   * wallet_restriction_state still blocks on every active restriction of
--     the wallet, whichever integration recorded it (fail closed).
-- The fixture hands authorities to this session's login by updating
-- inflow_authorities inside the rolled-back transaction.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/piggyvest_primary_wallet_restriction_authority.sql

BEGIN;

\ir piggyvest_primary_wallet_restrictions_fixture.inc.sql

-- Calls the writers with an explicit integration and environment.
CREATE FUNCTION pg_temp.rec_as(p_integration uuid, p_environment text, p_wallet text,
  p_event text, p_restriction text) RETURNS text LANGUAGE sql AS $$
  SELECT piggyvest_primary.record_wallet_restriction(p_integration, p_environment,
    p_wallet, p_event, p_restriction, 'Freeze', 0, 650733, 1650733, NULL)
$$;

CREATE FUNCTION pg_temp.lift_as(p_integration uuid, p_environment text, p_wallet text,
  p_event text, p_restriction text) RETURNS text LANGUAGE sql AS $$
  SELECT piggyvest_primary.lift_wallet_restriction(p_integration, p_environment,
    p_wallet, p_event, p_restriction, 'Freeze', '2026-10-01T12:00:00Z')
$$;

-- Both writers refuse p_integration/p_environment with 42501 and store nothing.
CREATE FUNCTION pg_temp.refused(p_integration text, p_environment text, p_case text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_rows bigint := (SELECT count(*) FROM piggyvest_primary.wallet_restrictions);
  v_events bigint := (SELECT count(*) FROM piggyvest_primary.wallet_restriction_events);
  v_args text := format('%L::uuid, %L', p_integration, p_environment);
BEGIN
  PERFORM pg_temp.unbound(
    format($sql$SELECT pg_temp.rec_as(%s, 'au-w', 'evt-au-new', 'rst-au-new')$sql$, v_args),
    'a creation ' || p_case);
  PERFORM pg_temp.unbound(
    format($sql$SELECT pg_temp.lift_as(%s, 'au-w', 'evt-au-lift', 'rst-au')$sql$, v_args),
    'a lift ' || p_case);
  PERFORM pg_temp.check(
    (SELECT count(*) FROM piggyvest_primary.wallet_restrictions) = v_rows
    AND (SELECT count(*) FROM piggyvest_primary.wallet_restriction_events) = v_events,
    'a refused call ' || p_case || ' stored something');
  PERFORM pg_temp.check(pg_temp.blocked('au-w'), 'a refused lift ' || p_case || ' unblocked the wallet');
END $$;

-- The bound caller records; the row names its integration.
DO $$ BEGIN
  PERFORM pg_temp.check(
    pg_temp.rec_as(pg_temp.integration_a(), 'staging', 'au-w', 'evt-au-create', 'rst-au') = 'recorded',
    'the bound integration cannot record');
  PERFORM pg_temp.check(
    (SELECT integration_id = pg_temp.integration_a() FROM piggyvest_primary.wallet_restrictions
     WHERE provider_event_id = 'evt-au-create'), 'the row does not name its integration');
  PERFORM pg_temp.check(pg_temp.blocked('au-w'), 'the recorded restriction does not block');
END $$;

-- Every unbound caller is refused before anything is stored.
DO $$ BEGIN
  PERFORM pg_temp.refused(pg_temp.integration_a()::text, 'production', 'for the wrong environment');
  PERFORM pg_temp.refused(pg_temp.integration_a()::text, NULL, 'without an environment');
  PERFORM pg_temp.refused('c7e50000-0000-4000-8000-0000000000ff', 'staging', 'for an unknown integration');
  PERFORM pg_temp.refused(NULL, 'staging', 'without an integration');
  -- Integration B's evidence authority belongs to another login.
  PERFORM pg_temp.refused(pg_temp.integration_b()::text, 'production', 'by another integration''s login');

  UPDATE piggyvest_primary.inflow_authorities SET enabled = false
    WHERE integration_id = pg_temp.integration_a();
  PERFORM pg_temp.refused(pg_temp.integration_a()::text, 'staging', 'with the evidence authority disabled');
  UPDATE piggyvest_primary.inflow_authorities SET enabled = true
    WHERE integration_id = pg_temp.integration_a();

  UPDATE piggyvest_primary.integrations SET enabled = false WHERE id = pg_temp.integration_a();
  PERFORM pg_temp.refused(pg_temp.integration_a()::text, 'staging', 'with the integration disabled');
  UPDATE piggyvest_primary.integrations SET enabled = true WHERE id = pg_temp.integration_a();

  UPDATE piggyvest_primary.inflow_authorities SET executor_login = 'wr_fixture_evidence_a'
    WHERE integration_id = pg_temp.integration_a();
  PERFORM pg_temp.refused(pg_temp.integration_a()::text, 'staging', 'by a login that is not the authority');
  UPDATE piggyvest_primary.inflow_authorities SET executor_login = session_user
    WHERE integration_id = pg_temp.integration_a();

  PERFORM pg_temp.check(
    pg_temp.lift_as(pg_temp.integration_a(), 'staging', 'au-w', 'evt-au-lift', 'rst-au') = 'lifted',
    'the rebound integration cannot lift its own restriction');
  PERFORM pg_temp.check(NOT pg_temp.blocked('au-w'), 'the bound lift did not lift');
END $$;

-- Integration B, now bound to this login, cannot touch A's restrictions or
-- reuse A's event ids; its own restrictions on the same wallet still block.
DO $$
DECLARE v_before text;
BEGIN
  PERFORM pg_temp.rec_as(pg_temp.integration_a(), 'staging', 'au-x', 'evt-ax-create', 'rst-ax');
  PERFORM pg_temp.lift_as(pg_temp.integration_a(), 'staging', 'au-y', 'evt-ay-lift', 'rst-ay');
  UPDATE piggyvest_primary.inflow_authorities SET executor_login = 'wr_fixture_evidence_a'
    WHERE integration_id = pg_temp.integration_a();
  UPDATE piggyvest_primary.inflow_authorities SET executor_login = session_user
    WHERE integration_id = pg_temp.integration_b();
  SELECT string_agg(concat_ws('|', id, integration_id, provider_event_id, lift_event_id,
      lifted_at, updated_at), ',' ORDER BY id)
    INTO v_before FROM piggyvest_primary.wallet_restrictions;

  PERFORM pg_temp.check(
    pg_temp.lift_as(pg_temp.integration_b(), 'production', 'au-x', 'evt-bx-lift', 'rst-ax') = 'conflict',
    'another integration lifted this integration''s restriction');
  PERFORM pg_temp.check(
    pg_temp.rec_as(pg_temp.integration_b(), 'production', 'au-y', 'evt-by-create', 'rst-ay') = 'conflict',
    'another integration completed this integration''s early lift');
  PERFORM pg_temp.check(
    pg_temp.rec_as(pg_temp.integration_b(), 'production', 'au-x', 'evt-ax-create', 'rst-ax') = 'conflict',
    'another integration replayed this integration''s creation');
  PERFORM pg_temp.check(
    pg_temp.lift_as(pg_temp.integration_b(), 'production', 'au-w', 'evt-au-lift', 'rst-au') = 'conflict',
    'another integration replayed this integration''s lift');
  PERFORM pg_temp.check(
    (SELECT string_agg(concat_ws('|', id, integration_id, provider_event_id, lift_event_id,
       lifted_at, updated_at), ',' ORDER BY id) FROM piggyvest_primary.wallet_restrictions) = v_before,
    'a cross-integration conflict changed a restriction');
  PERFORM pg_temp.check(pg_temp.blocked('au-x') AND NOT pg_temp.blocked('au-y'),
    'a cross-integration conflict changed whether a wallet is blocked');

  PERFORM pg_temp.check(
    pg_temp.rec_as(pg_temp.integration_b(), 'production', 'au-y', 'evt-by-own', 'rst-by') = 'recorded',
    'integration B cannot record its own restriction');
  PERFORM pg_temp.check(pg_temp.blocked('au-y') AND pg_temp.active('au-y') = 1,
    'a restriction recorded by another integration does not block the wallet');
END $$;

ROLLBACK;
