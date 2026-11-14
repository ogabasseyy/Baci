import type { Pool } from 'pg';

export async function verifyVerifierDatabaseRole(pool: Pool) {
  const check = await pool.query<{
    login: string;
    role: string;
    unsafe: boolean;
    target_unsafe: boolean;
    target_memberships: boolean;
    authenticated_member: boolean;
    verifier_member: boolean;
    extra_memberships: boolean;
  }>(`SELECT session_user AS login, current_user AS role,
    COALESCE((SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication OR rolinherit OR NOT rolcanlogin FROM pg_catalog.pg_roles WHERE rolname=session_user), true) AS unsafe,
    COALESCE((SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication OR rolinherit OR rolcanlogin FROM pg_catalog.pg_roles WHERE rolname=current_user), true) AS target_unsafe,
    EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)) AS target_memberships,
    pg_has_role(session_user,'authenticated','MEMBER') AS authenticated_member,
    pg_has_role(session_user,'baci_experience_verifier','MEMBER') AS verifier_member,
    EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user) AND r.rolname<>'baci_experience_verifier') AS extra_memberships`);
  const principal = check.rows[0];
  if (
    principal?.login !== 'baci_experience_verifier_login' ||
    principal.role !== 'baci_experience_verifier' ||
    principal.unsafe !== false ||
    principal.target_unsafe !== false ||
    principal.target_memberships !== false ||
    principal.authenticated_member !== false ||
    principal.verifier_member !== true ||
    principal.extra_memberships !== false
  )
    throw Error('UNSAFE_VERIFIER_DATABASE_SESSION');
}
