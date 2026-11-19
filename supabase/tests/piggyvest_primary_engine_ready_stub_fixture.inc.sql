-- Part of piggyvest_primary_engine_ready_stub.sql (\ir): the readiness
-- override fixture that later suites use. Runs inside the entry file's
-- transaction; not a standalone suite.

\ir helpers/piggyvest_engine_ready_fixture.inc.sql

SELECT pg_temp.piggyvest_engine_ready_override(ARRAY['inflow', 'bank_inbox']);

-- Listed surfaces answer ready, others stay refused, and the override keeps
-- the function's shape and grants.
DO $$
BEGIN
  PERFORM pg_temp.check(piggyvest_primary.engine_ready('inflow')
      = '{"ready": true, "missing": []}'::jsonb,
    'an overridden surface must answer ready');
  PERFORM pg_temp.check(piggyvest_primary.engine_ready('bank_inbox')
      = '{"ready": true, "missing": []}'::jsonb,
    'every listed surface must answer ready');
  PERFORM pg_temp.check(piggyvest_primary.engine_ready('settlement_full')
      = '{"ready": false, "missing": ["engine_readiness_test_override"]}'::jsonb,
    'an unlisted surface must stay not ready under the override');
  PERFORM pg_temp.check(piggyvest_primary.engine_ready(NULL)
      = '{"ready": false, "missing": ["engine_readiness_test_override"]}'::jsonb,
    'NULL must stay not ready under the override');
  PERFORM pg_temp.check((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=pg_catalog']
      AND pg_get_userbyid(p.proowner) = current_user
      FROM pg_proc p WHERE p.oid = 'piggyvest_primary.engine_ready(text)'::regprocedure),
    'the override must keep SECURITY DEFINER, the pinned search_path and the owner');
  PERFORM pg_temp.check(
    has_function_privilege('piggyvest_primary_readiness_reader',
      'piggyvest_primary.engine_ready(text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'piggyvest_primary.engine_ready(text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'piggyvest_primary.engine_ready(text)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'piggyvest_primary.engine_ready(text)', 'EXECUTE'),
    'the override must keep the grants');
END $$;

SELECT pg_temp.piggyvest_engine_ready_override(NULL);
SELECT pg_temp.check(piggyvest_primary.engine_ready('inflow')
    = '{"ready": false, "missing": ["engine_readiness_test_override"]}'::jsonb,
  'an empty override must refuse every surface');

-- Restoring brings back the installed check: the override marker is gone,
-- and an unknown surface is refused by the real rules.
SELECT pg_temp.piggyvest_engine_ready_restore();
SELECT pg_temp.check(piggyvest_primary.engine_ready('inflow')->'missing'
    <> '["engine_readiness_test_override"]'::jsonb,
  'restore must bring back the installed check');
SELECT pg_temp.check(piggyvest_primary.engine_ready('not_a_surface')
    = '{"ready": false, "missing": ["unknown_surface"]}'::jsonb,
  'restore must bring back the enforcing rules');
