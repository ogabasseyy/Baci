DO $acl$ DECLARE entry record; BEGIN
  FOR entry IN SELECT rolname FROM pg_roles WHERE rolname<>'postgres' LOOP
    EXECUTE format('REVOKE ALL ON TABLE pg_temp.reviewed_approval FROM %I',entry.rolname);
    EXECUTE format('REVOKE ALL ON FUNCTION pg_temp.reviewed_promote_collection(jsonb,jsonb,jsonb),
      pg_temp.reviewed_approval_guard(jsonb,jsonb,jsonb),pg_temp.reviewed_preflight(),
      pg_temp.reviewed_state(),pg_temp.reviewed_metadata() FROM %I',entry.rolname);
  END LOOP;
END $acl$;
REVOKE ALL ON TABLE pg_temp.reviewed_approval FROM PUBLIC;
REVOKE ALL ON FUNCTION pg_temp.reviewed_promote_collection(jsonb,jsonb,jsonb),
  pg_temp.reviewed_approval_guard(jsonb,jsonb,jsonb),pg_temp.reviewed_preflight(),
  pg_temp.reviewed_state(),pg_temp.reviewed_metadata() FROM PUBLIC;
