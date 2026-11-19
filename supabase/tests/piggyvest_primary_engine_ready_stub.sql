-- Contract test: who may read piggyvest_primary.engine_ready, the PiggyVest
-- engine readiness check (first shipped as a fail-closed stub, now replaced
-- by the enforcing check, whose verdicts are proven in
-- piggyvest_primary_engine_ready_enforcing.sql).
-- Proves, against live PostgreSQL:
--   * an unknown surface and NULL are never ready;
--   * only the dedicated readiness reader holds EXECUTE; it is granted to
--     exactly the evidence, bank-inbox worker and authorizer roles; anon,
--     authenticated, service_role, PUBLIC and the other PiggyVest roles
--     cannot execute it;
--   * the bank inbox session safety check still refuses every unsafe worker
--     or intake setup, while the reader membership and engine_ready are the
--     only new things a worker session may hold;
--   * the test fixture overrides readiness inside the transaction only.
-- Denials are asserted through the catalog (a denied EXECUTE cannot be
-- trapped on the replay image, so no denial is probed by calling).
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/piggyvest_primary_engine_ready_stub.sql

BEGIN;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', p_message; END IF;
END $$;

-- The stub verdict is replaced by the enforcing check
-- (20261104130900); its verdicts are proven in
-- piggyvest_primary_engine_ready_enforcing.sql. Here: whatever the
-- installed body, an unknown surface and NULL are never ready.
DO $$
BEGIN
  PERFORM pg_temp.check(piggyvest_primary.engine_ready('not_a_surface')
      = '{"ready": false, "missing": ["unknown_surface"]}'::jsonb,
    'an unknown surface must not be ready');
  PERFORM pg_temp.check(piggyvest_primary.engine_ready(NULL)
      = '{"ready": false, "missing": ["unknown_surface"]}'::jsonb,
    'engine_ready(NULL) must not be ready');
END $$;

\ir piggyvest_primary_engine_ready_stub_grants.inc.sql
\ir piggyvest_primary_engine_ready_stub_bank_role.inc.sql
\ir piggyvest_primary_engine_ready_stub_fixture.inc.sql

ROLLBACK;
