import 'server-only';
import { Client, type ClientConfig } from 'pg';
import {
  PIGGYVEST_CAPTURE_DRAIN_LOGIN,
  PIGGYVEST_CAPTURE_WORKER_ROLE,
  type PiggyvestCaptureDrainRuntime,
  piggyvestCaptureDrainSessionRowSchema,
} from '@/schemas/piggyvest/webhook-capture-drain-runtime';
import { primaryDbLink } from './primary-db-link';

/**
 * Database executor of the PiggyVest webhook capture drain (R5), for the
 * worker host. It holds no service-role key: it connects as the dedicated
 * drain login, proves on every connection that the session is exactly that
 * login (SESSION_USER and CURRENT_USER), that the login is a member of the
 * worker role and of nothing else, that neither carries an elevated
 * attribute, that it can actually use the worker role's grants (inheritance),
 * that nothing, PUBLIC included, gives it the capture table or the capture
 * functions, that it reaches nothing beyond what anon already can, and that
 * the connection is TLS. Only then does it run one of
 * three fixed statements. Any doubt fails closed with a generic error that
 * names no host, login detail or password.
 *
 * A connection is opened per statement and always closed, matching the
 * other PiggyVest worker stores; constructing the executor opens nothing.
 */

export type CaptureDrainStatement = 'claim' | 'resolve' | 'status';

// Resolve goes through the claim-bound entry point: the worker can settle
// only rows it leased, never through the tokenless branch the web receiver
// uses for inline completion.
export const CAPTURE_DRAIN_STATEMENTS: Readonly<
  Record<CaptureDrainStatement, string>
> = {
  claim:
    'SELECT capture_id, claim_token, raw_hex, signature, key_version, key_families, attempts, event_type, provider_transaction_id FROM public.claim_piggyvest_webhook_captures($1::integer, $2::integer, $3::integer)',
  resolve:
    'SELECT public.resolve_claimed_piggyvest_webhook_capture($1::uuid, $2::uuid, $3::text, $4::text) AS resolved',
  status: 'SELECT public.piggyvest_webhook_capture_status() AS status',
};

// One row about the session: who is connected, what the login may do, how
// many roles it belongs to, whether its single membership is the worker
// role (itself non-login, non-elevated and a member of nothing), TLS, and
// what the login can actually reach:
// - grants_usable: the login really holds the schema USAGE and the three
//   entry points (has_function_privilege follows rolinherit and the
//   membership's inherit option, so a login that cannot inherit the worker
//   role's grants fails here instead of with a permission error later);
// - capture_surface_denied: no privilege, from any source including PUBLIC,
//   on the capture table, the capture door, the shared resolve function or
//   the evidence trigger function;
// - unexpected_privileges: privileges the login holds by name rather than
//   through PUBLIC, on anything but the three entry points and USAGE on
//   public. It counts pg_shdepend, which records an ACL (or ownership)
//   dependency of every object on each role named in its ACL, for the login
//   and every role whose privileges it inherits, so it is an indexed lookup
//   that does not scan the catalogs. Zero bounds the login to the worker
//   role's grants plus what PUBLIC grants every role, which is exactly what
//   the anonymous anon role already holds; the capture surface is denied even
//   from PUBLIC (capture_surface_denied).
// $1 is the worker role and $2 the drain login, whose row is the one
// checked; SESSION_USER must also be that login (checked in sessionFailures).
// The text runs verbatim in supabase/tests/piggyvest_webhook_capture_drain_session_check.sql.
export const CAPTURE_DRAIN_VERIFY_SESSION_SQL = `SELECT pg_catalog.current_database() AS database_name,
  SESSION_USER AS login_name, CURRENT_USER AS role_name,
  (login.rolcanlogin AND NOT login.rolsuper AND NOT login.rolbypassrls
    AND NOT login.rolcreaterole AND NOT login.rolcreatedb AND NOT login.rolreplication) AS login_safe,
  (SELECT count(*) FROM pg_catalog.pg_auth_members m WHERE m.member = login.oid)::integer AS membership_count,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles worker ON worker.oid = m.roleid
    WHERE m.member = login.oid AND worker.rolname = $1::text AND NOT m.admin_option
      AND NOT worker.rolcanlogin AND NOT worker.rolsuper AND NOT worker.rolbypassrls
      AND NOT worker.rolcreaterole AND NOT worker.rolcreatedb AND NOT worker.rolreplication
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members parent WHERE parent.member = worker.oid)
  ) AS worker_membership,
  (
    pg_catalog.has_schema_privilege(login.oid, 'public', 'USAGE')
    AND COALESCE(pg_catalog.has_function_privilege(login.oid, pg_catalog.to_regprocedure('public.claim_piggyvest_webhook_captures(integer,integer,integer)'), 'EXECUTE'), false)
    AND COALESCE(pg_catalog.has_function_privilege(login.oid, pg_catalog.to_regprocedure('public.resolve_claimed_piggyvest_webhook_capture(uuid,uuid,text,text)'), 'EXECUTE'), false)
    AND COALESCE(pg_catalog.has_function_privilege(login.oid, pg_catalog.to_regprocedure('public.piggyvest_webhook_capture_status()'), 'EXECUTE'), false)
  ) AS grants_usable,
  NOT (
    COALESCE(pg_catalog.has_function_privilege(login.oid, pg_catalog.to_regprocedure('public.capture_piggyvest_webhook_delivery(jsonb)'), 'EXECUTE'), false)
    OR COALESCE(pg_catalog.has_function_privilege(login.oid, pg_catalog.to_regprocedure('public.resolve_piggyvest_webhook_capture(uuid,uuid,text,text)'), 'EXECUTE'), false)
    OR COALESCE(pg_catalog.has_function_privilege(login.oid, pg_catalog.to_regprocedure('public.piggyvest_webhook_captures_immutable_evidence()'), 'EXECUTE'), false)
    OR COALESCE(pg_catalog.has_table_privilege(login.oid, pg_catalog.to_regclass('public.piggyvest_webhook_captures'), 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'), false)
    OR COALESCE(pg_catalog.has_any_column_privilege(login.oid, pg_catalog.to_regclass('public.piggyvest_webhook_captures'), 'SELECT, INSERT, UPDATE, REFERENCES'), false)
  ) AS capture_surface_denied,
  (
    SELECT count(*)::integer FROM pg_catalog.pg_shdepend d
    WHERE d.refclassid = 'pg_catalog.pg_authid'::pg_catalog.regclass AND d.deptype IN ('a', 'o')
      AND d.dbid IN (0, (SELECT db.oid FROM pg_catalog.pg_database db WHERE db.datname = pg_catalog.current_database()))
      AND d.refobjid IN (SELECT r.oid FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(login.oid, r.oid, 'USAGE'))
      AND NOT (d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass AND d.objsubid = 0 AND d.objid = ANY (ARRAY[
        COALESCE(pg_catalog.to_regprocedure('public.claim_piggyvest_webhook_captures(integer,integer,integer)')::oid, 0),
        COALESCE(pg_catalog.to_regprocedure('public.resolve_claimed_piggyvest_webhook_capture(uuid,uuid,text,text)')::oid, 0),
        COALESCE(pg_catalog.to_regprocedure('public.piggyvest_webhook_capture_status()')::oid, 0)]))
      AND NOT (d.classid = 'pg_catalog.pg_namespace'::pg_catalog.regclass AND d.objid = 'public'::pg_catalog.regnamespace)
  ) + (
    SELECT count(*)::integer FROM pg_catalog.pg_namespace n
    CROSS JOIN LATERAL pg_catalog.aclexplode(n.nspacl) acl
    WHERE n.nspname = 'public' AND acl.privilege_type <> 'USAGE'
      AND acl.grantee IN (SELECT r.oid FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(login.oid, r.oid, 'USAGE'))
  ) AS unexpected_privileges,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_stat_ssl s WHERE s.pid = pg_catalog.pg_backend_pid() AND s.ssl
  ) AS tls
FROM pg_catalog.pg_roles login WHERE login.rolname = $2::text`;

export type CaptureDrainSessionCheck =
  | 'database'
  | 'session_user'
  | 'current_user'
  | 'login_privileges'
  | 'membership'
  | 'grants'
  | 'capture_surface'
  | 'extra_privileges'
  | 'tls';

export type CaptureDrainSessionVerdict =
  | { ok: true }
  | { ok: false; reason: 'unreachable' }
  | { ok: false; reason: 'unsafe'; failedChecks: CaptureDrainSessionCheck[] };

export interface CaptureDrainExecutor {
  /** Runs one fixed statement on a verified session and returns its rows. */
  query(
    statement: CaptureDrainStatement,
    parameters: readonly unknown[]
  ): Promise<unknown[]>;
  /** Opens and verifies a session only (readiness); runs no statement. */
  verifySession(): Promise<CaptureDrainSessionVerdict>;
}

export interface CaptureDrainPgClient {
  connect(): Promise<unknown>;
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<unknown>;
}

/**
 * The executor's only failure. The message never varies; `sqlState` is the
 * five-character PostgreSQL error class when the database answered one
 * (for example 42883 when a function is missing), which is safe to report.
 */
export class CaptureDrainDatabaseError extends Error {
  constructor(readonly sqlState: string | null) {
    super('PiggyVest capture drain database unavailable');
  }
}

function sqlStateOf(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : null;
}

class UnsafeSession extends Error {
  constructor(readonly failedChecks: CaptureDrainSessionCheck[]) {
    super('Unsafe capture drain session');
  }
}

function sessionFailures(
  rows: unknown[],
  databaseName: string
): CaptureDrainSessionCheck[] {
  const parsed =
    rows.length === 1
      ? piggyvestCaptureDrainSessionRowSchema.safeParse(rows[0])
      : null;
  if (!parsed?.success) {
    return ['session_user', 'membership', 'tls'];
  }
  const session = parsed.data;
  const checks: [CaptureDrainSessionCheck, boolean][] = [
    ['database', session.database_name === databaseName],
    ['session_user', session.login_name === PIGGYVEST_CAPTURE_DRAIN_LOGIN],
    ['current_user', session.role_name === PIGGYVEST_CAPTURE_DRAIN_LOGIN],
    ['login_privileges', session.login_safe],
    ['membership', session.membership_count === 1 && session.worker_membership],
    ['grants', session.grants_usable],
    ['capture_surface', session.capture_surface_denied],
    ['extra_privileges', session.unexpected_privileges === 0],
    ['tls', session.tls],
  ];
  return checks.flatMap(([check, passed]) => (passed ? [] : [check]));
}

function clientConfig(
  database: PiggyvestCaptureDrainRuntime['database'],
  link: ReturnType<typeof primaryDbLink>
): ClientConfig {
  return {
    host: database.host,
    port: database.port,
    database: database.name,
    user: link.user,
    password: database.password,
    ssl: {
      rejectUnauthorized: true,
      ca: database.certificateAuthority,
      ...link.tls,
    },
    connectionTimeoutMillis: 4000,
    query_timeout: 4000,
    ...link.startup,
    application_name: 'baci-piggyvest-capture-drain',
  };
}

export function createCaptureDrainPgExecutor(
  runtime: PiggyvestCaptureDrainRuntime,
  options: {
    createClient?: (config: ClientConfig) => CaptureDrainPgClient;
  } = {}
): CaptureDrainExecutor {
  const createClient =
    options.createClient ?? ((config: ClientConfig) => new Client(config));

  async function withVerifiedSession<T>(
    work: (client: CaptureDrainPgClient) => Promise<T>
  ): Promise<T> {
    const link = primaryDbLink(runtime.database.login, runtime.database.port);
    const client = createClient(clientConfig(runtime.database, link));
    try {
      await client.connect();
      await link.afterConnect(client);
      const verified = await client.query(CAPTURE_DRAIN_VERIFY_SESSION_SQL, [
        PIGGYVEST_CAPTURE_WORKER_ROLE,
        PIGGYVEST_CAPTURE_DRAIN_LOGIN,
      ]);
      const failed = sessionFailures(verified.rows, runtime.database.name);
      if (failed.length > 0) throw new UnsafeSession(failed);
      return await work(client);
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  return {
    async query(statement, parameters) {
      const text = CAPTURE_DRAIN_STATEMENTS[statement];
      try {
        const result = await withVerifiedSession((client) =>
          client.query(text, [...parameters])
        );
        return result.rows;
      } catch (error) {
        throw new CaptureDrainDatabaseError(sqlStateOf(error));
      }
    },
    async verifySession() {
      try {
        await withVerifiedSession(async () => undefined);
        return { ok: true };
      } catch (error) {
        return error instanceof UnsafeSession
          ? { ok: false, reason: 'unsafe', failedChecks: error.failedChecks }
          : { ok: false, reason: 'unreachable' };
      }
    },
  };
}
