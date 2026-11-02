-- Contract test: piggyvest_primary.engine_ready, the fail-closed readiness
-- stub for the PiggyVest ledger and transfer engine, and who may read it.
--
-- Until the enforcing readiness check replaces it, engine_ready answers
-- not-ready for every surface, so the inflow executor and the bank-inbox
-- worker (which ask it before any credit or claim) never credit a wallet.
-- Proves, against live PostgreSQL:
--   * the stub verdict is exactly {ready:false, missing:[the stub marker]}
--     for every surface, an unknown surface and NULL;
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

-- The stub verdict, identical for every input.
DO $$
DECLARE
  v_surface text;
  v_stub constant jsonb :=
    '{"ready": false, "missing": ["engine_readiness_not_installed"]}';
BEGIN
  FOREACH v_surface IN ARRAY ARRAY['inflow', 'bank_inbox', 'settlement_drain',
    'settlement_full', 'spend', 'goal_inflow', 'treasury_sweep', 'approvals',
    'not_a_surface', '']
  LOOP
    PERFORM pg_temp.check(
      piggyvest_primary.engine_ready(v_surface) = v_stub,
      format('engine_ready(%L) must return the stub verdict', v_surface));
  END LOOP;
  PERFORM pg_temp.check(piggyvest_primary.engine_ready(NULL) = v_stub,
    'engine_ready(NULL) must return the stub verdict');
END $$;

\ir piggyvest_primary_engine_ready_stub_grants.inc.sql
\ir piggyvest_primary_engine_ready_stub_bank_role.inc.sql
\ir piggyvest_primary_engine_ready_stub_fixture.inc.sql

ROLLBACK;
