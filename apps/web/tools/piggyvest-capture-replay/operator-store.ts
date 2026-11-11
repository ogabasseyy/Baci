import type { ClientConfig } from 'pg';
import { Client } from 'pg';
import {
  PIGGYVEST_CAPTURE_OPERATOR_FORBIDDEN_LOGINS,
  PIGGYVEST_CAPTURE_OPERATOR_ROLE,
  PIGGYVEST_CAPTURE_PIPELINE_ROLES,
  type PiggyvestCaptureOperatorSession,
  type PiggyvestCaptureRequeueResult,
  type PiggyvestReviewCapture,
  piggyvestCaptureOperatorSessionSchema,
  piggyvestCaptureRequeueResultSchema,
  piggyvestReviewCapturesSchema,
} from '@/schemas/piggyvest/webhook-capture-operator-replay';

/**
 * Database access of the PiggyVest capture replay operator tool.
 *
 * It connects as the operator's own login (never service_role), proves the
 * session first (a member of the operator role, no elevated attribute, not a
 * shared platform login, encrypted or loopback transport, grants usable),
 * then runs exactly one fixed statement and closes. The database records the
 * session login as the actor of every requeue, so who acted cannot be typed in.
 */

export const OPERATOR_STATEMENTS = {
  list: 'SELECT piggyvest_capture_operator.list_review_captures($1::integer) AS captures',
  requeue:
    'SELECT piggyvest_capture_operator.requeue_review_capture($1::uuid, $2::text) AS result',
} as const;

// One row about the session. secure_transport accepts TLS, or a unix socket
// or loopback connection (local disposable databases only).
export const OPERATOR_VERIFY_SESSION_SQL = `SELECT SESSION_USER::text AS login_name,
  (login.rolcanlogin AND NOT login.rolsuper AND NOT login.rolbypassrls
    AND NOT login.rolcreaterole AND NOT login.rolcreatedb AND NOT login.rolreplication) AS login_safe,
  pg_catalog.pg_has_role(SESSION_USER, $1::text, 'MEMBER') AS operator_member,
  EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
    WHERE r.rolname = ANY ($2::text[])
      AND pg_catalog.pg_has_role(SESSION_USER, r.oid, 'MEMBER')) AS pipeline_member,
  (pg_catalog.has_schema_privilege(SESSION_USER, 'piggyvest_capture_operator', 'USAGE')
    AND pg_catalog.has_function_privilege(SESSION_USER,
      'piggyvest_capture_operator.list_review_captures(integer)', 'EXECUTE')
    AND pg_catalog.has_function_privilege(SESSION_USER,
      'piggyvest_capture_operator.requeue_review_capture(uuid,text)', 'EXECUTE')) AS grants_usable,
  (COALESCE((SELECT s.ssl FROM pg_catalog.pg_stat_ssl s WHERE s.pid = pg_catalog.pg_backend_pid()), false)
    OR pg_catalog.inet_client_addr() IS NULL
    OR pg_catalog.inet_client_addr() <<= '127.0.0.0/8'::inet
    OR pg_catalog.inet_client_addr() = '::1'::inet) AS secure_transport
FROM pg_catalog.pg_roles login WHERE login.rolname = SESSION_USER`;

export class OperatorRefusal extends Error {
  override name = 'OperatorRefusal';
}

export interface OperatorQueryClient {
  connect(): Promise<unknown>;
  query(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<unknown>;
}

export interface OperatorStoreOptions {
  connectionString: string;
  createClient?: (config: ClientConfig) => OperatorQueryClient;
}

export interface OperatorStore {
  list(limit: number): Promise<PiggyvestReviewCapture[]>;
  requeue(
    captureId: string,
    reason: string
  ): Promise<PiggyvestCaptureRequeueResult>;
}

export function sessionFailures(
  session: PiggyvestCaptureOperatorSession
): string[] {
  const failures: string[] = [];
  if (PIGGYVEST_CAPTURE_OPERATOR_FORBIDDEN_LOGINS.includes(session.login_name))
    failures.push(
      'use your personal operator login, not a shared platform login'
    );
  if (!session.login_safe) failures.push('login carries an elevated attribute');
  if (!session.operator_member)
    failures.push(
      `login is not a member of ${PIGGYVEST_CAPTURE_OPERATOR_ROLE}`
    );
  if (session.pipeline_member)
    failures.push(
      'login is also a capture pipeline (worker or intake) login; use a separate operator login'
    );
  if (!session.grants_usable) failures.push('operator grants are not usable');
  if (!session.secure_transport) failures.push('connection is not encrypted');
  return failures;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * node-postgres lets connection-string parameters override the explicit
 * config, so a URL could silently weaken certificate checks
 * (`sslmode=no-verify`) or redirect the host (`?host=`). Both are refused
 * before any connection, so the password is never sent over such a link.
 * Only a loopback database (local disposable testing) may skip TLS.
 */
export function readOperatorConnection(connectionString: string): {
  loopback: boolean;
} {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new OperatorRefusal('the connection string is not a valid URL');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:')
    throw new OperatorRefusal('the connection string must be a postgres URL');
  const names = [...url.searchParams.keys()];
  const repeated = names.find((name, i) => names.indexOf(name) !== i);
  // node-postgres keeps the LAST value of a repeated parameter, so
  // ?sslmode=verify-full&sslmode=disable would slip past a first-value check.
  if (repeated !== undefined)
    throw new OperatorRefusal(
      `the connection string repeats ${repeated}; give each parameter once`
    );
  if (url.hostname === '' || url.searchParams.has('host'))
    throw new OperatorRefusal(
      'the connection string must name its host directly'
    );
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  const sslmode = url.searchParams.get('sslmode');
  if (!loopback && sslmode !== null && sslmode !== 'verify-full')
    throw new OperatorRefusal('sslmode must be verify-full (or left out)');
  for (const name of ['sslrootcert', 'sslcert', 'sslkey', 'ssl'])
    if (!loopback && url.searchParams.has(name))
      throw new OperatorRefusal(`remove ${name} from the connection string`);
  return { loopback };
}

export function createOperatorStore(
  options: OperatorStoreOptions
): OperatorStore {
  const createClient =
    options.createClient ??
    ((config: ClientConfig): OperatorQueryClient => new Client(config));
  const { loopback } = readOperatorConnection(options.connectionString);
  const config: ClientConfig = {
    connectionString: options.connectionString,
    application_name: 'baci-piggyvest-capture-operator',
    statement_timeout: 15_000,
    lock_timeout: 5_000,
    connectionTimeoutMillis: 10_000,
    ...(loopback ? {} : { ssl: { rejectUnauthorized: true } }),
  };

  async function run<T>(
    statement: string,
    values: unknown[],
    read: (row: Record<string, unknown>) => T
  ): Promise<T> {
    const client = createClient(config);
    try {
      await client.connect();
      const verified = await client.query(OPERATOR_VERIFY_SESSION_SQL, [
        PIGGYVEST_CAPTURE_OPERATOR_ROLE,
        PIGGYVEST_CAPTURE_PIPELINE_ROLES,
      ]);
      const session = piggyvestCaptureOperatorSessionSchema.safeParse(
        verified.rows[0]
      );
      if (!session.success)
        throw new OperatorRefusal('session could not be verified');
      const failures = sessionFailures(session.data);
      if (failures.length > 0)
        throw new OperatorRefusal(`session refused: ${failures.join('; ')}`);
      const result = await client.query(statement, values);
      const row = result.rows[0];
      if (!row) throw new OperatorRefusal('the database returned no row');
      return read(row);
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  return {
    list: (limit) =>
      run(OPERATOR_STATEMENTS.list, [limit], (row) =>
        piggyvestReviewCapturesSchema.parse(row.captures)
      ),
    requeue: (captureId, reason) =>
      run(OPERATOR_STATEMENTS.requeue, [captureId, reason], (row) =>
        piggyvestCaptureRequeueResultSchema.parse(row.result)
      ),
  };
}
