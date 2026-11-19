import type { Pool } from 'pg';

export const authDatabaseDeadlines = {
  statement_timeout: 2000,
  lock_timeout: 1000,
  query_timeout: 3000,
} as const;

/** Verify both the dedicated login and the role actually executing broker SQL. */
export async function verifyProductionAuthDatabaseRole(pool: Pool) {
  const identity = await pool.query<{
    login: string;
    role: string;
    unsafe: boolean;
    authenticated_member: boolean;
    storage_member: boolean;
    storage_unsafe: boolean;
    storage_memberships: boolean;
    extra_memberships: boolean;
    statement_timeout_ms: number;
    lock_timeout_ms: number;
  }>(`SELECT session_user AS login, current_user AS role,
    COALESCE((SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication OR rolinherit OR NOT rolcanlogin FROM pg_catalog.pg_roles WHERE rolname=session_user), true) AS unsafe,
    COALESCE((SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication OR rolinherit OR rolcanlogin FROM pg_catalog.pg_roles WHERE rolname=current_user), true) AS storage_unsafe,
    EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)) AS storage_memberships,
    pg_has_role(session_user,'authenticated','MEMBER') AS authenticated_member,
    pg_has_role(session_user,'baci_builder_auth_storage','MEMBER') AS storage_member,
    EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user) AND r.rolname<>'baci_builder_auth_storage') AS extra_memberships,
    (SELECT setting::integer FROM pg_catalog.pg_settings WHERE name='statement_timeout' AND unit='ms') AS statement_timeout_ms,
    (SELECT setting::integer FROM pg_catalog.pg_settings WHERE name='lock_timeout' AND unit='ms') AS lock_timeout_ms`);
  const principal = identity.rows[0];
  if (
    principal?.login !== 'baci_builder_auth_login' ||
    principal.role !== 'baci_builder_auth_storage' ||
    principal.unsafe !== false ||
    principal.authenticated_member !== false ||
    principal.storage_member !== true ||
    principal.storage_unsafe !== false ||
    principal.storage_memberships !== false ||
    principal.extra_memberships !== false
  )
    throw Error('UNSAFE_AUTH_DATABASE_SESSION');
  if (
    principal.statement_timeout_ms !==
      authDatabaseDeadlines.statement_timeout ||
    principal.lock_timeout_ms !== authDatabaseDeadlines.lock_timeout
  )
    throw Error('UNBOUNDED_AUTH_DATABASE_SESSION');
}
