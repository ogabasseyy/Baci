import 'server-only';
import { Client } from 'pg';
import { piggyvestWebhookIntakeRuntimeSchema } from '@/schemas/piggyvest-webhook-intake-runtime';
import { primaryDbLink } from './primary-db-link';

/**
 * Database executor of the PiggyVest webhook receiver.
 *
 * The receiver connects as the restricted login
 * `baci_piggyvest_webhook_intake` (member of the NOLOGIN group role
 * `piggyvest_webhook_intake`) over verified TLS, and can run only the
 * SECURITY DEFINER functions of the `piggyvest_webhook_intake` schema. It has
 * no table privilege and never holds the Supabase service-role key.
 *
 * Every call is one fixed statement `SELECT piggyvest_webhook_intake.<fn>($1)`
 * built from the allowlist below (the function name is never caller text),
 * run after the session proves it is the restricted login, over TLS, with no
 * elevated attribute. Database detail never leaves this module: a failure
 * keeps only the 5-character SQLSTATE of the statement.
 */

export const PIGGYVEST_WEBHOOK_INTAKE_FUNCTIONS = [
  'capture_delivery',
  'resolve_capture',
  'claim_event',
  'resolve_event',
  'allocate_plan_transfer',
  'apply_staging_restriction',
  'resolve_staging_owner',
  'inbox_insert',
  'inbox_read',
  'quarantine_insert',
  'inflow_credit_insert',
  'inflow_credit_read',
  'interest_payout_insert',
  'interest_payout_read',
  'plan_wallet_read',
  'plan_wallet_set_status',
  'outbox_apply_terminal',
] as const;

export type PiggyvestWebhookIntakeFunction =
  (typeof PIGGYVEST_WEBHOOK_INTAKE_FUNCTIONS)[number];

export type PiggyvestWebhookIntakeExecute = (
  fn: PiggyvestWebhookIntakeFunction,
  payload: unknown
) => Promise<unknown>;

/** A database failure; `code` is the statement's SQLSTATE when it had one. */
export class PiggyvestIntakeDbError extends Error {
  readonly code: string | undefined;

  constructor(code?: string) {
    super('PiggyVest intake database unavailable');
    this.name = 'PiggyvestIntakeDbError';
    this.code = code;
  }
}

// A 64 KiB body is 128 KiB of hex inside the capture command; leave headroom.
const MAX_PAYLOAD_BYTES = 512 * 1024;
const allowed = new Set<string>(PIGGYVEST_WEBHOOK_INTAKE_FUNCTIONS);
const SQLSTATE = /^[0-9A-Z]{5}$/;

const verifySession = `SELECT current_database() AS database_name, SESSION_USER AS login_name, CURRENT_USER AS role_name,
  (NOT role.rolsuper AND NOT role.rolbypassrls AND NOT role.rolcreaterole AND NOT role.rolcreatedb AND NOT role.rolreplication
    AND pg_has_role(SESSION_USER,'piggyvest_webhook_intake','MEMBER')
    AND NOT EXISTS(SELECT 1 FROM pg_auth_members membership JOIN pg_roles parent ON parent.oid=membership.roleid
      WHERE membership.member=role.oid AND parent.rolname<>'piggyvest_webhook_intake')) AS safe,
  EXISTS(SELECT 1 FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) AS tls
  FROM pg_roles role WHERE role.rolname=SESSION_USER`;

/**
 * An executor bound to ONE database connection. The connection opens lazily
 * on the first operation, is verified once, and is reused by every later
 * operation of the same delivery. The caller must `close()` it (route
 * `finally`). A failed setup is remembered, so a delivery never retries on a
 * fresh connection (fail closed), and a closed executor refuses new work.
 */
export type PiggyvestWebhookIntakeSession = PiggyvestWebhookIntakeExecute & {
  close: () => Promise<void>;
};

export function createPiggyvestWebhookIntakeExecutor(
  configuration: unknown
): PiggyvestWebhookIntakeSession {
  const { database } = piggyvestWebhookIntakeRuntimeSchema.parse(configuration);
  let connection: Promise<Client> | undefined;
  let rawClient: Client | undefined;
  let closed = false;

  const open = async (): Promise<Client> => {
    const link = primaryDbLink(database.login, database.port);
    const client = new Client({
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
      application_name: 'baci-piggyvest-webhook-intake',
    });
    rawClient = client;
    // A dropped idle connection must not become an unhandled 'error' event;
    // the next statement on it fails and maps to a code-less error.
    client.on('error', () => undefined);
    await client.connect();
    await link.afterConnect(client);
    const verified = await client.query(verifySession);
    const session = verified.rows[0];
    if (
      verified.rows.length !== 1 ||
      session?.database_name !== database.name ||
      session.login_name !== database.login ||
      session.role_name !== database.login ||
      session.safe !== true ||
      session.tls !== true
    )
      throw new PiggyvestIntakeDbError();
    return client;
  };

  const execute: PiggyvestWebhookIntakeExecute = async (fn, payload) => {
    if (
      closed ||
      !allowed.has(fn) ||
      typeof payload !== 'object' ||
      payload === null ||
      Array.isArray(payload)
    )
      throw new PiggyvestIntakeDbError();
    const serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_PAYLOAD_BYTES)
      throw new PiggyvestIntakeDbError();
    const statement = `SELECT piggyvest_webhook_intake.${fn}($1::jsonb) AS result`;
    let client: Client;
    try {
      connection ??= open();
      client = await connection;
    } catch (error) {
      await closeRaw();
      throw error instanceof PiggyvestIntakeDbError
        ? error
        : new PiggyvestIntakeDbError();
    }
    try {
      const response: { rows: Array<{ result?: unknown }> } =
        await client.query(statement, [serialized]);
      return response.rows[0]?.result ?? null;
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      throw new PiggyvestIntakeDbError(
        typeof code === 'string' && SQLSTATE.test(code) ? code : undefined
      );
    }
  };

  const closeRaw = async (): Promise<void> => {
    const client = rawClient;
    rawClient = undefined;
    if (client) await client.end().catch(() => undefined);
  };

  return Object.assign(execute, {
    close: async (): Promise<void> => {
      closed = true;
      await connection?.catch(() => undefined);
      await closeRaw();
    },
  });
}
