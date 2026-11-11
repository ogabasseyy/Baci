import type { Pool } from 'pg';

/** Verify both the dedicated login and the role actually executing broker SQL. */
export async function verifyProductionAuthDatabaseRole(pool: Pool) {
  const identity = await pool.query<{
    login: string;
    role: string;
    unsafe: boolean;
    authenticated_member: boolean;
    storage_member: boolean;
    extra_memberships: boolean;
  }>(`SELECT session_user AS login, current_user AS role,
    COALESCE((SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication OR rolinherit OR NOT rolcanlogin FROM pg_catalog.pg_roles WHERE rolname=session_user), true) AS unsafe,
    pg_has_role(session_user,'authenticated','MEMBER') AS authenticated_member,
    pg_has_role(session_user,'baci_builder_auth_storage','MEMBER') AS storage_member,
    EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user) AND r.rolname<>'baci_builder_auth_storage') AS extra_memberships`);
  const principal = identity.rows[0];
  if (
    principal?.login !== 'baci_builder_auth_login' ||
    principal.role !== 'baci_builder_auth_storage' ||
    principal.unsafe !== false ||
    principal.authenticated_member !== false ||
    principal.storage_member !== true ||
    principal.extra_memberships !== false
  )
    throw Error('UNSAFE_AUTH_DATABASE_SESSION');
}
