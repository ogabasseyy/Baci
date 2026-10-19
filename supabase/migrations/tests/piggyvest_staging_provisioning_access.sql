\set ON_ERROR_STOP on
DO $$
DECLARE
  role_name text;
  function_entry record;
  table_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'provisioning_test_reader'] LOOP
    PERFORM provisioning_test.assert_true(NOT has_schema_privilege(role_name, 'piggyvest_staging', 'USAGE'), 'private schema');
    FOREACH table_name IN ARRAY ARRAY['provisioning_integrations', 'provisioning_intents'] LOOP
      PERFORM provisioning_test.assert_true(NOT has_table_privilege(role_name, 'piggyvest_staging.' || table_name,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), 'no application table privileges');
    END LOOP;
    FOR function_entry IN SELECT routine.oid FROM pg_proc AS routine
      JOIN pg_namespace AS namespace ON namespace.oid = routine.pronamespace
      WHERE namespace.nspname = 'piggyvest_staging' AND routine.proname LIKE '%provisioning%'
    LOOP
      PERFORM provisioning_test.assert_true(NOT has_function_privilege(role_name, function_entry.oid, 'EXECUTE'),
        'no application execute privilege');
    END LOOP;
  END LOOP;
  PERFORM provisioning_test.assert_true(NOT EXISTS (SELECT 1 FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'piggyvest_staging' AND relation.relname IN ('provisioning_integrations', 'provisioning_intents')
      AND NOT relation.relrowsecurity), 'RLS enabled');
END $$;

BEGIN;
GRANT USAGE ON SCHEMA piggyvest_staging, provisioning_test TO provisioning_test_reader;
GRANT SELECT, INSERT, UPDATE, DELETE ON piggyvest_staging.provisioning_intents,
  piggyvest_staging.provisioning_integrations TO provisioning_test_reader;
CREATE POLICY provisioning_test_permissive ON piggyvest_staging.provisioning_intents
  FOR ALL TO provisioning_test_reader USING (true) WITH CHECK (true);
CREATE POLICY provisioning_test_permissive ON piggyvest_staging.provisioning_integrations
  FOR ALL TO provisioning_test_reader USING (true) WITH CHECK (true);
SET LOCAL ROLE provisioning_test_reader;
SELECT provisioning_test.assert_true((SELECT count(*) = 0 FROM piggyvest_staging.provisioning_intents), 'restrictive policy hides all tenants');
SELECT provisioning_test.assert_true((SELECT count(*) = 0 FROM piggyvest_staging.provisioning_integrations), 'restrictive policy hides registry');
SELECT provisioning_test.expect_error($command$
  INSERT INTO piggyvest_staging.provisioning_integrations (integration_id, merchant_id)
    VALUES ('40000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001')
$command$, '42501');
WITH changed AS (UPDATE piggyvest_staging.provisioning_intents SET status = 'unknown' RETURNING id)
SELECT provisioning_test.assert_true((SELECT count(*) = 0 FROM changed), 'RLS cannot mutate intents');
SELECT provisioning_test.expect_error($command$
  SELECT piggyvest_staging.prepare_provisioning_intent(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001', NULL, 'create_customer', decode(repeat('aa', 32), 'hex'))
$command$, '42501');
ROLLBACK;
