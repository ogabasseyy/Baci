-- Part of piggyvest_primary_ops_approvals.sql (\ir): removes everything the
-- runtime part commits. Runs at the start (after an aborted earlier run) and
-- at the end. Idempotent.
--
-- The ops tables are append-only by trigger. The suite runs as their owner,
-- so it lifts the guards for its own subject rows only, in one transaction.

DO $$
DECLARE
  v_name text;
BEGIN
  FOREACH v_name IN ARRAY COALESCE(dblink_get_connections(), ARRAY[]::text[]) LOOP
    IF v_name LIKE 'pvops\_%' THEN
      PERFORM dblink_disconnect(v_name);
    END IF;
  END LOOP;
END
$$;

BEGIN;
ALTER TABLE piggyvest_primary.ops_approvals DISABLE TRIGGER USER;
ALTER TABLE piggyvest_primary.ops_approval_requests DISABLE TRIGGER USER;
DELETE FROM piggyvest_primary.ops_approvals a
USING piggyvest_primary.ops_approval_requests r
WHERE a.request_id = r.id AND r.subject_table = 'pvops_test.subjects';
DELETE FROM piggyvest_primary.ops_approval_requests
WHERE subject_table = 'pvops_test.subjects';
ALTER TABLE piggyvest_primary.ops_approval_requests ENABLE TRIGGER USER;
ALTER TABLE piggyvest_primary.ops_approvals ENABLE TRIGGER USER;
COMMIT;

DROP SCHEMA IF EXISTS pvops_test CASCADE;

DO $$
DECLARE
  v_login text;
BEGIN
  FOR v_login IN
    SELECT rolname FROM pg_catalog.pg_roles
    WHERE rolname IN ('pvops_test_approver_a', 'pvops_test_approver_b',
                      'pvops_test_approver_c', 'pvops_test_engine_e')
  LOOP
    EXECUTE pg_catalog.format('DROP ROLE %I', v_login);
  END LOOP;
END
$$;
