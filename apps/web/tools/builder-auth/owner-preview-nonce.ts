import type { Pool } from 'pg';

/** Restricted DB role only. A unique insert is the replay decision across replicas. */
export async function createOwnerPreviewNonceStore(
  pool: Pool,
  now: () => number = Date.now
) {
  const check = await pool.query<{
    login: string;
    role: string;
    unsafe: boolean;
    target_unsafe: boolean;
    target_memberships: boolean;
    authenticated_member: boolean;
    nonce_member: boolean;
    extra_memberships: boolean;
  }>(`SELECT session_user AS login, current_user AS role,
    COALESCE((SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication OR rolinherit OR NOT rolcanlogin FROM pg_catalog.pg_roles WHERE rolname=session_user), true) AS unsafe,
    COALESCE((SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication OR rolinherit OR rolcanlogin FROM pg_catalog.pg_roles WHERE rolname=current_user), true) AS target_unsafe,
    EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)) AS target_memberships,
    pg_has_role(session_user,'authenticated','MEMBER') AS authenticated_member,
    pg_has_role(session_user,'baci_owner_preview_nonce','MEMBER') AS nonce_member,
    EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user) AND r.rolname<>'baci_owner_preview_nonce') AS extra_memberships`);
  const identity = check.rows[0];
  if (
    identity?.login !== 'baci_owner_preview_login' ||
    identity.role !== 'baci_owner_preview_nonce' ||
    identity.unsafe !== false ||
    identity.target_unsafe !== false ||
    identity.target_memberships !== false ||
    identity.authenticated_member !== false ||
    identity.nonce_member !== true ||
    identity.extra_memberships !== false
  )
    throw Error('UNSAFE_OWNER_PREVIEW_DATABASE_SESSION');
  return async (nonce: string, expiresAt: number): Promise<boolean> => {
    const time = now();
    if (
      !/^[a-f0-9]{64}$/.test(nonce) ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= time ||
      expiresAt > time + 60000
    )
      throw Error('INVALID_OWNER_PREVIEW_NONCE');
    await pool.query(
      'DELETE FROM builder_authorization.owner_preview_nonces WHERE expires_at <= statement_timestamp()'
    );
    const result = await pool.query(
      'INSERT INTO builder_authorization.owner_preview_nonces(nonce,expires_at) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [Buffer.from(nonce, 'hex'), new Date(expiresAt)]
    );
    return result.rowCount === 1;
  };
}
