import { Pool } from 'pg';
import { logger } from '@/lib/logger';
import {
  claimedSavingsNotificationsSchema,
  savingsNotificationWorkerConfigSchema,
  savingsNotificationWorkerLimitSchema,
} from '@/schemas/savings-notification-worker';
import { deliverSavingsExpoPush } from './expo-delivery';
import {
  processSavingsNotificationPushClaims,
  SAVINGS_NOTIFICATION_PUSH_CONCURRENCY,
  type SavingsPushOutcome,
} from './push-worker';
import { reconcileSavingsNotificationReceipts } from './receipt-reconciliation';

const SAVINGS_WORKER_ROLE = 'baci_savings_notifications_worker';
const DATABASE_STATEMENT_TIMEOUT_MS = 2_000;
const DATABASE_QUERY_TIMEOUT_MS = 2_500;
// Receipts are one batched Expo call plus indexed single-row writes, so the
// per-run receipt budget matches the maximum dispatch volume (and the SQL
// ceiling): anything smaller accumulates backlog until the 24-hour
// receipt_unknown conversion, and dead tokens are never deactivated.
const RECEIPT_BATCH_LIMIT = 100;
const WORKER_DEADLINE_MS = 50_000;
const PUSH_CYCLE_BUDGET_MS =
  DATABASE_QUERY_TIMEOUT_MS * (SAVINGS_NOTIFICATION_PUSH_CONCURRENCY + 1) +
  8_000;

type RuntimeResult = {
  enabled: boolean;
  enqueued: number;
  claimed: number;
  accepted: number;
  rejected: number;
  unregistered: number;
  unknown: number;
  retried: number;
  finishFailed: number;
  receiptChecked: number;
  receiptProviderConfirmed: number;
  receiptFailed: number;
  receiptPending: number;
  receiptRecordFailed: number;
};

const emptyResult = (enabled: boolean): RuntimeResult => ({
  enabled,
  enqueued: 0,
  claimed: 0,
  accepted: 0,
  rejected: 0,
  unregistered: 0,
  unknown: 0,
  retried: 0,
  finishFailed: 0,
  receiptChecked: 0,
  receiptProviderConfirmed: 0,
  receiptFailed: 0,
  receiptPending: 0,
  receiptRecordFailed: 0,
});
const disabledResult = (): RuntimeResult => emptyResult(false);

export async function runSavingsNotificationPushWorker(
  options: { limit?: unknown; checkOnly?: boolean } = {}
): Promise<RuntimeResult> {
  if (process.env.SAVINGS_NOTIFICATIONS_ENABLED !== 'true') {
    return disabledResult();
  }
  const deadlineAt = Date.now() + WORKER_DEADLINE_MS;
  const config = savingsNotificationWorkerConfigSchema.parse(process.env);
  const limit = savingsNotificationWorkerLimitSchema.parse(options.limit);
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 1,
    connectionTimeoutMillis: DATABASE_QUERY_TIMEOUT_MS,
    idleTimeoutMillis: 5_000,
    statement_timeout: DATABASE_STATEMENT_TIMEOUT_MS,
    query_timeout: DATABASE_QUERY_TIMEOUT_MS,
    lock_timeout: 750,
    idle_in_transaction_session_timeout: DATABASE_QUERY_TIMEOUT_MS,
  });

  try {
    const client = await pool.connect();
    try {
      const identity = await client.query<{
        session_user: string;
        current_user: string;
        current_database: string;
        rolinherit: boolean;
        rolsuper: boolean;
        rolcreaterole: boolean;
        rolcreatedb: boolean;
        rolreplication: boolean;
        rolbypassrls: boolean;
      }>(
        'SELECT session_user, current_user, current_database(), role.rolinherit, role.rolsuper, role.rolcreaterole, role.rolcreatedb, role.rolreplication, role.rolbypassrls FROM pg_catalog.pg_roles AS role WHERE role.rolname = session_user'
      );
      const row = identity.rows[0];
      if (
        row?.session_user !== SAVINGS_WORKER_ROLE ||
        row.current_user !== SAVINGS_WORKER_ROLE ||
        row.current_database !== config.databaseName ||
        row.rolinherit !== false ||
        row.rolsuper !== false ||
        row.rolcreaterole !== false ||
        row.rolcreatedb !== false ||
        row.rolreplication !== false ||
        row.rolbypassrls !== false
      ) {
        throw new Error(
          'Savings notification worker database identity check failed'
        );
      }

      if (options.checkOnly === true) return emptyResult(true);

      const enqueue = await client.query<{ enqueued: number }>(
        'SELECT savings_notifications.enqueue_due() AS enqueued'
      );
      const enqueued = Number(enqueue.rows[0]?.enqueued);
      if (!Number.isSafeInteger(enqueued) || enqueued < 0) {
        throw new Error(
          'Savings notification enqueue returned an invalid count'
        );
      }
      const receiptCounts = await reconcileSavingsNotificationReceipts(
        {
          pendingReceipts: async (receiptLimit) => {
            const receipts = await client.query(
              'SELECT ticket_id, notification_id, push_token FROM savings_notifications.pending_receipts($1)',
              [receiptLimit]
            );
            return receipts.rows;
          },
          recordReceipt: async (ticketId, status, error) => {
            const recorded = await client.query<{ recorded: boolean }>(
              'SELECT savings_notifications.record_receipt($1, $2, $3) AS recorded',
              [ticketId, status, error]
            );
            return recorded.rows[0]?.recorded === true;
          },
          requeueReceipt: async (ticketId) => {
            const requeued = await client.query<{ requeued: boolean }>(
              'SELECT savings_notifications.requeue_delivery($1) AS requeued',
              [ticketId]
            );
            return requeued.rows[0]?.requeued === true;
          },
        },
        {
          limit: Math.min(limit, RECEIPT_BATCH_LIMIT),
          accessToken: config.expoAccessToken,
        }
      );
      const counts = {
        accepted: 0,
        rejected: 0,
        unregistered: 0,
        unknown: 0,
        retried: 0,
        finishFailed: 0,
      };
      let claimed = 0;
      while (
        claimed < limit &&
        Date.now() + PUSH_CYCLE_BUDGET_MS <= deadlineAt
      ) {
        const claimLimit = Math.min(
          SAVINGS_NOTIFICATION_PUSH_CONCURRENCY,
          limit - claimed
        );
        const claimResult = await client.query(
          'SELECT notification_id, claim_id, push_token, title, body, data FROM savings_notifications.claim_push($1)',
          [claimLimit]
        );
        const parsedClaims = claimedSavingsNotificationsSchema.safeParse(
          claimResult.rows
        );
        if (!parsedClaims.success || parsedClaims.data.length > claimLimit) {
          throw new Error(
            'Savings notification worker received invalid claims'
          );
        }
        if (parsedClaims.data.length === 0) break;

        claimed += parsedClaims.data.length;
        const cycleCounts = await processSavingsNotificationPushClaims(
          parsedClaims.data,
          {
            accessToken: config.expoAccessToken,
            send: deliverSavingsExpoPush,
            finishPush: async (input) => {
              const finish = await client.query<{ finished: boolean }>(
                'SELECT savings_notifications.finish_push($1, $2, $3, $4, $5) AS finished',
                [
                  input.notificationId,
                  input.pushToken,
                  input.claimId,
                  input.outcome satisfies SavingsPushOutcome,
                  input.ticketId,
                ]
              );
              return finish.rows[0]?.finished === true;
            },
          },
          { concurrency: SAVINGS_NOTIFICATION_PUSH_CONCURRENCY }
        );
        counts.accepted += cycleCounts.accepted;
        counts.rejected += cycleCounts.rejected;
        counts.unregistered += cycleCounts.unregistered;
        counts.unknown += cycleCounts.unknown;
        counts.retried += cycleCounts.retried;
        counts.finishFailed += cycleCounts.finishFailed;
      }
      const result = {
        enabled: true,
        enqueued,
        claimed,
        ...counts,
        receiptChecked: receiptCounts.checked,
        receiptProviderConfirmed: receiptCounts.providerConfirmed,
        receiptFailed: receiptCounts.receiptFailed,
        receiptPending: receiptCounts.pending,
        receiptRecordFailed: receiptCounts.recordFailed,
      };
      logger.info({
        message: 'Savings notification push worker completed',
        ...result,
      });
      return result;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}
