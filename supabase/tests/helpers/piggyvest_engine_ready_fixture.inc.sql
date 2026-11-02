-- Test helper: report the PiggyVest engine ready, for chosen surfaces, inside
-- one SQL suite's transaction. Include it with \ir from a suite that has
-- already run BEGIN and ends with ROLLBACK; it is not a standalone suite.
--
--   \ir helpers/piggyvest_engine_ready_fixture.inc.sql
--   SELECT pg_temp.piggyvest_engine_ready_override(ARRAY['bank_inbox']);
--   ... exercise the code that asks engine_ready ...
--   SELECT pg_temp.piggyvest_engine_ready_restore();   -- optional
--
-- The override replaces piggyvest_primary.engine_ready in place (CREATE OR
-- REPLACE keeps its owner, grants and SECURITY DEFINER), and the suite's
-- ROLLBACK brings the installed definition back, so no other session and no
-- later suite ever sees it. Listed surfaces answer ready; every other
-- surface answers not ready with the marker engine_readiness_test_override.
-- Both helpers refuse to run outside a transaction block: an autocommit
-- override would be permanent.

DO $$
BEGIN
  IF pg_catalog.transaction_timestamp() = pg_catalog.statement_timestamp() THEN
    RAISE EXCEPTION 'piggyvest_engine_ready_fixture must run inside the suite transaction';
  END IF;
END $$;

-- The installed definition, captured before any override.
CREATE TEMP TABLE piggyvest_engine_ready_installed ON COMMIT DROP AS
SELECT pg_catalog.pg_get_functiondef(
  'piggyvest_primary.engine_ready(text)'::pg_catalog.regprocedure) AS definition;

CREATE FUNCTION pg_temp.piggyvest_engine_ready_override(p_ready_surfaces text[])
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF pg_catalog.transaction_timestamp() = pg_catalog.statement_timestamp() THEN
    RAISE EXCEPTION 'the engine readiness override must run inside the suite transaction';
  END IF;
  EXECUTE pg_catalog.format($ddl$
    CREATE OR REPLACE FUNCTION piggyvest_primary.engine_ready(p_surface text)
    RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
    AS $body$
      SELECT CASE WHEN p_surface = ANY (%L::text[])
        THEN jsonb_build_object('ready', true, 'missing', jsonb_build_array())
        ELSE jsonb_build_object('ready', false,
          'missing', jsonb_build_array('engine_readiness_test_override'))
      END
    $body$
  $ddl$, coalesce(p_ready_surfaces, ARRAY[]::text[]));
END $$;

CREATE FUNCTION pg_temp.piggyvest_engine_ready_restore()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_definition text;
BEGIN
  SELECT installed.definition INTO STRICT v_definition
  FROM pg_temp.piggyvest_engine_ready_installed installed;
  EXECUTE v_definition;
END $$;
