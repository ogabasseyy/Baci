import 'server-only';
import { Client, type ClientConfig } from 'pg';
import {
  PIGGYVEST_CAPTURE_DRAIN_LOGIN,
  PIGGYVEST_CAPTURE_WORKER_ROLE,
  type PiggyvestCaptureDrainRuntime,
  piggyvestCaptureDrainSessionRowSchema,
} from '@/schemas/piggyvest/webhook-capture-drain-runtime';

/**
 * Database executor of the PiggyVest webhook capture drain (R5), for the
 * worker host. It holds no service-role key: it connects as the dedicated
 * drain login, proves on every connection that the session is exactly that
 * login (SESSION_USER and CURRENT_USER), that the login is a member of the
 * worker role and of nothing else, that neither carries an elevated
 * attribute, and that the connection is TLS. Only then does it run one of
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
// role (itself non-login, non-elevated and a member of nothing), and TLS.
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
    ['tls', session.tls],
  ];
  return checks.flatMap(([check, passed]) => (passed ? [] : [check]));
}

function clientConfig(
  database: PiggyvestCaptureDrainRuntime['database']
): ClientConfig {
  return {
    host: database.host,
    port: database.port,
    database: database.name,
    user: database.login,
    password: database.password,
    ssl: { rejectUnauthorized: true, ca: database.certificateAuthority },
    connectionTimeoutMillis: 4000,
    query_timeout: 4000,
    statement_timeout: 2500,
    lock_timeout: 1500,
    options: '-c search_path=pg_catalog',
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
    const client = createClient(clientConfig(runtime.database));
    try {
      await client.connect();
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
