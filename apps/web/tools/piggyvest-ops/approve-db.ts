import { Client } from 'pg';
import {
  type OpsApproveArgs,
  type OpsOpenRequest,
  opsDecisionResultSchema,
  opsOpenRequestRowSchema,
} from '@/schemas/piggyvest/ops-approvals';

export interface ApproverConnectionConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: false | { rejectUnauthorized: true; ca?: string };
  application_name: string;
  options: string;
  client_encoding: string;
  connectionTimeoutMillis: number;
  query_timeout: number;
  statement_timeout: number;
}

type OpsDecisionResult = ReturnType<typeof opsDecisionResultSchema.parse>;

export interface PgClientLike {
  connect: () => Promise<unknown>;
  query: (
    text: string,
    values?: unknown[]
  ) => Promise<{ rows: readonly unknown[] }>;
  end: () => Promise<unknown>;
}

export interface DecisionInput {
  requestId: string;
  decision: 'approve' | 'reject';
  amountKobo: number;
  digest: string;
}

export interface ApproverSession {
  listOpen: () => Promise<OpsOpenRequest[]>;
  decide: (input: DecisionInput) => Promise<OpsDecisionResult>;
  close: () => Promise<void>;
}

/** A refusal raised by the approval functions (e.g. ops_approval_expired). */
export class OpsRefusal extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'OpsRefusal';
  }
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

/**
 * Every field is explicit, so pg never falls back to environment variables
 * or a password file. The password is only ever the one typed at the prompt.
 * Remote connections always verify the server certificate.
 */
export function buildConnectionConfig(
  args: OpsApproveArgs,
  password: string,
  certificateAuthority?: string
): ApproverConnectionConfig {
  return {
    host: args.host,
    port: args.port,
    database: args.database,
    user: args.user,
    password,
    ssl: isLoopbackHost(args.host)
      ? false
      : {
          rejectUnauthorized: true,
          ...(certificateAuthority ? { ca: certificateAuthority } : {}),
        },
    application_name: 'baci-piggyvest-approve',
    options: '-c search_path=pg_catalog',
    client_encoding: 'UTF8',
    connectionTimeoutMillis: 10_000,
    query_timeout: 15_000,
    statement_timeout: 10_000,
  };
}

const LIST_SQL = `SELECT request_id, action, label, subject, amount_kobo, amount_naira,
  destination, reason, requested_by, opened_at, expires_at, approvals,
  decided_by_you, digest
FROM piggyvest_approvals.list_open_ops_requests()`;

const DECIDE_SQL =
  'SELECT piggyvest_approvals.approve_ops_request($1::uuid, $2::text, $3::bigint, $4::text) AS result';

function rethrow(error: unknown): never {
  const message = error instanceof Error ? error.message : '';
  if (/^ops_approval_[a-z_]{1,60}$/.test(message))
    throw new OpsRefusal(message);
  throw new Error('The database could not complete the request.');
}

/** The login part of "login" or a pooler user "login.<project ref>". */
function loginOf(user: string): string {
  return user.split('.')[0];
}

/**
 * The real client, built from the whole config: pg reads an environment
 * variable only for a field that is missing, and none is.
 */
export function createPgClient(config: ApproverConnectionConfig): PgClientLike {
  return new Client(config);
}

export async function openApproverSession(
  config: ApproverConnectionConfig,
  createClient: (
    config: ApproverConnectionConfig
  ) => PgClientLike = createPgClient
): Promise<ApproverSession> {
  const client = createClient(config);
  try {
    await client.connect();
    const { rows } = await client.query('SELECT session_user::text AS login');
    const signedIn = (rows[0] as { login?: unknown } | undefined)?.login;
    if (signedIn !== loginOf(config.user)) {
      throw new Error('Signed in as a different login');
    }
  } catch (error) {
    await client.end().catch(() => undefined);
    throw error instanceof Error &&
      error.message === 'Signed in as a different login'
      ? error
      : new Error('Could not sign in to the database.');
  }

  return {
    listOpen: async () => {
      try {
        const { rows } = await client.query(LIST_SQL);
        return rows.map((row) => opsOpenRequestRowSchema.parse(row));
      } catch (error) {
        return rethrow(error);
      }
    },
    decide: async (input) => {
      try {
        const { rows } = await client.query(DECIDE_SQL, [
          input.requestId,
          input.decision,
          input.amountKobo.toString(),
          input.digest,
        ]);
        const result = (rows[0] as { result?: unknown } | undefined)?.result;
        return opsDecisionResultSchema.parse(result);
      } catch (error) {
        return rethrow(error);
      }
    },
    close: async () => {
      await client.end().catch(() => undefined);
    },
  };
}
