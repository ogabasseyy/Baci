import 'server-only';
import type { Pool } from 'pg';
import { verifyCompiledCandidate } from '@/lib/experience/compiled-candidate';
import type { PrerenderBinding } from '../experience-runner/prerender-artifacts';

export const rendererDatabaseDeadlines = {
  connectionTimeoutMillis: 2000,
  statement_timeout: 2000,
  lock_timeout: 1000,
  query_timeout: 2500,
} as const;

/** This principal can execute only the published-pointer projection. */
export async function createPublishedRendererReader(pool: Pool) {
  const { rows } = await pool.query<{ safe: boolean }>(`
    SELECT (
      session_user = 'baci_experience_renderer_reader_login'
      AND current_user = 'baci_experience_renderer_reader'
      AND NOT EXISTS (
        SELECT FROM pg_catalog.pg_roles
        WHERE rolname IN (session_user, current_user)
          AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb
            OR rolreplication OR rolinherit OR rolcanlogin <> (rolname = session_user))
      )
      AND NOT EXISTS (
        SELECT FROM pg_catalog.pg_auth_members AS m
        JOIN pg_catalog.pg_roles AS member ON member.oid = m.member
        JOIN pg_catalog.pg_roles AS parent ON parent.oid = m.roleid
        WHERE member.rolname = current_user OR
          (member.rolname = session_user AND parent.rolname <> current_user)
      )
      AND NOT pg_catalog.has_table_privilege(
        current_user, 'experience_authorization.verified_renderers',
        'SELECT, INSERT, UPDATE, DELETE'
      )
      AND NOT pg_catalog.has_function_privilege(
        current_user, 'experience_authorization.exact_verified_renderer(uuid,uuid,text,text)', 'EXECUTE'
      )
      AND pg_catalog.has_function_privilege(
        current_user, 'experience_authorization.read_published_verified_renderer(text,uuid,uuid,text,text)', 'EXECUTE'
      )
    ) AS safe
  `);
  if (rows[0]?.safe !== true) throw Error('UNSAFE_RENDERER_DATABASE_SESSION');
  return async (
    slug: string,
    binding: PrerenderBinding,
    signal: AbortSignal
  ) => {
    signal.throwIfAborted();
    const client = await pool.connect();
    let discarded = false;
    const cancel = () => {
      discarded = true;
      client.release(true);
    };
    try {
      signal.throwIfAborted();
      signal.addEventListener('abort', cancel, { once: true });
      const result = await client.query<{ renderer: unknown }>(
        'SELECT experience_authorization.read_published_verified_renderer($1,$2,$3,$4,$5) AS renderer',
        [
          slug,
          binding.merchantId,
          binding.buildId,
          binding.buildDigest,
          binding.sourceDigest,
        ]
      );
      signal.throwIfAborted();
      if (result.rows.length !== 1) throw Error('RENDERER_UNAVAILABLE');
      const { renderer } = result.rows[0];
      return renderer === null ? null : verifyCompiledCandidate(renderer);
    } finally {
      signal.removeEventListener('abort', cancel);
      if (!discarded) client.release();
    }
  };
}
