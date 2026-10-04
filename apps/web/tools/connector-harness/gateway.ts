import postgres from 'postgres';
import type { HarnessGrantContext, HarnessSql } from './gateway-types';

export { pgErrorToHttp, pgRaiseToHttp } from './gateway-errors';
export {
  readAnalyticsSummary,
  readInventoryLevels,
  readOrderGet,
  readOrdersList,
} from './gateway-reads';
export type {
  HarnessAnalyticsSummary,
  HarnessGrantContext,
  HarnessHttpError,
  HarnessInventoryLevel,
  HarnessOrderRow,
  HarnessSql,
} from './gateway-types';

export function createHarnessSql(databaseUrl: string): HarnessSql {
  return postgres(databaseUrl, { max: 5, idle_timeout: 20 });
}

interface ResolveRow {
  grant_id: string;
  user_id: string;
  merchant_id: string;
  branch_ids: string[];
  merchant_wide: boolean;
  scopes: string[];
  grant_version: number;
}

/**
 * Validate the token and return the grant context. Callers must invoke this
 * inside the request transaction (before `establishUserContext`) so a
 * revocation racing the read cannot slip between two transactions.
 */
export async function resolveGrant(
  sql: HarnessSql | postgres.TransactionSql,
  input: {
    tokenHash: string;
    scope: string;
    resource: string;
    action: string;
    branchIds: string[] | null;
  }
): Promise<HarnessGrantContext> {
  const rows = (await sql`
    SELECT * FROM public.resolve_connector_grant_context(
      ${input.tokenHash},
      ${input.scope},
      ${input.resource},
      ${input.action},
      ${input.branchIds}::uuid[]
    )
  `) as unknown as ResolveRow[];
  const row = rows[0];
  if (!row) {
    throw new Error('connector_grant_denied');
  }
  return {
    grantId: row.grant_id,
    userId: row.user_id,
    merchantId: row.merchant_id,
    branchIds: row.branch_ids ?? [],
    merchantWide: row.merchant_wide,
    scopes: row.scopes ?? [],
    grantVersion: row.grant_version,
  };
}

/** Establish the linked user's RLS context for the current transaction. */
export async function establishUserContext(
  txn: postgres.TransactionSql,
  userId: string
): Promise<void> {
  await txn`SET LOCAL ROLE authenticated`;
  await txn`SELECT set_config('request.jwt.claim.sub', ${userId}, true)`;
  await txn`SELECT set_config(
    'request.jwt.claims',
    json_build_object('sub', ${userId}::text)::text,
    true
  )`;
}

export function issueTestGrant(
  sql: HarnessSql,
  ownerUserId: string,
  input: {
    merchantId: string;
    connectionId: string;
    branchIds: string[];
    scopes: string[];
    merchantWide: boolean;
    expiresAt: string | null;
    tokenHash: string;
    refreshTokenHash: string | null;
  }
): Promise<string> {
  return sql.begin(async (txn): Promise<string> => {
    await establishUserContext(txn, ownerUserId);
    const rows = (await txn`
      SELECT public.create_connector_grant(
        ${input.merchantId}::uuid,
        ${input.connectionId},
        ${input.branchIds}::uuid[],
        ${input.scopes}::text[],
        ${input.merchantWide},
        ${input.expiresAt}::timestamptz,
        ${input.tokenHash},
        ${input.refreshTokenHash}
      ) AS id
    `) as unknown as Array<{ id: string }>;
    const id = rows[0]?.id;
    if (!id) {
      throw new Error('connector_grant_denied');
    }
    return id;
  });
}

export async function rotateTestGrant(
  sql: HarnessSql,
  input: {
    refreshTokenHash: string;
    newTokenHash: string;
    newRefreshTokenHash: string | null;
  }
): Promise<boolean> {
  const rows = (await sql`
    SELECT public.rotate_connector_grant_tokens(
      ${input.refreshTokenHash},
      ${input.newTokenHash},
      ${input.newRefreshTokenHash}
    ) AS rotated
  `) as unknown as Array<{ rotated: boolean }>;
  return rows[0]?.rotated === true;
}

export function revokeTestGrant(
  sql: HarnessSql,
  ownerUserId: string,
  grantId: string,
  reason: string | null
): Promise<boolean> {
  return sql.begin(async (txn): Promise<boolean> => {
    await establishUserContext(txn, ownerUserId);
    const rows = (await txn`
      SELECT public.revoke_connector_grant(${grantId}::uuid, ${reason}) AS revoked
    `) as unknown as Array<{ revoked: boolean }>;
    return rows[0]?.revoked === true;
  });
}
