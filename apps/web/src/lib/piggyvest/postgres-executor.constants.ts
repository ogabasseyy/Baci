export const PIGGYVEST_POSTGRES_EXECUTOR = {
  deadlineMs: 5000,
  connectTimeoutMs: 1500,
  queryTimeoutMs: 2500,
  startupOptions:
    '-c search_path=pg_catalog -c statement_timeout=2000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=3000 -c synchronous_commit=on',
  verifySession:
    "SELECT current_database() AS database_name, current_user AS role_name, session_user AS login_role, role.rolsuper AS is_superuser, role.rolbypassrls AS bypasses_rls, role.rolcreaterole AS creates_role, role.rolcreatedb AS creates_database, role.rolreplication AS replicates, EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members AS membership WHERE membership.member = role.oid) AS has_memberships, current_setting('fsync') AS fsync_enabled, current_setting('synchronous_commit') AS synchronous_commit, pg_is_in_recovery() AS is_replica FROM pg_catalog.pg_roles AS role WHERE role.rolname = current_user",
} as const;
