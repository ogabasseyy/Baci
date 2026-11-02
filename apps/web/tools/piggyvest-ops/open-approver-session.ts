import {
  type OpsDecisionResult,
  opsDecisionResultSchema,
} from '@/schemas/piggyvest/ops-decision-result';
import {
  type OpsOpenRequest,
  opsOpenRequestRowSchema,
} from '@/schemas/piggyvest/ops-open-request-row';
import type { ApproverConnectionConfig } from './build-connection-config';
import { createPgClient, type PgClientLike } from './create-pg-client';
import { OpsRefusal } from './ops-refusal';

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
