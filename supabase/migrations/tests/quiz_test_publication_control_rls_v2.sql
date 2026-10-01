BEGIN;

DO $$
DECLARE
  v_rls_enabled boolean;
  v_policy_count bigint;
BEGIN
  SELECT relation.relrowsecurity
  INTO v_rls_enabled
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'private'
    AND relation.relname = 'quiz_test_publication_control_v2';

  IF v_rls_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'private.quiz_test_publication_control_v2 must have RLS enabled';
  END IF;

  SELECT count(*)
  INTO v_policy_count
  FROM pg_catalog.pg_policy AS policy
  JOIN pg_catalog.pg_class AS relation
    ON relation.oid = policy.polrelid
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'private'
    AND relation.relname = 'quiz_test_publication_control_v2';

  IF v_policy_count <> 0 THEN
    RAISE EXCEPTION
      'private.quiz_test_publication_control_v2 must remain deny-by-default';
  END IF;

  IF pg_catalog.has_table_privilege(
    'authenticated',
    'private.quiz_test_publication_control_v2',
    'SELECT'
  ) OR pg_catalog.has_table_privilege(
    'anon',
    'private.quiz_test_publication_control_v2',
    'SELECT'
  ) OR pg_catalog.has_table_privilege(
    'service_role',
    'private.quiz_test_publication_control_v2',
    'SELECT'
  ) THEN
    RAISE EXCEPTION
      'test-publication control must not grant client or service-role reads';
  END IF;
END;
$$;

ROLLBACK;
