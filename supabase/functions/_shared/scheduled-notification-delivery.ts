import type { ScheduledNotification } from './scheduled-notification.ts';
import { sendPushTokens } from './scheduled-notification-push-dispatch.ts';
import { requiresPushOutcomeReview } from './scheduled-notification-push-outcome-review.ts';
import {
  NotificationClaimLostError,
  parseRecipientPageIds,
  renewScheduledNotificationClaim,
  rpcOk,
  type ScheduledNotificationWorkerClient,
} from './scheduled-notification-rpc.ts';
import { scheduledNotificationWorker } from './scheduled-notification-worker.ts';
import type { ScheduledNotificationResultStatus } from './scheduled-notification-worker-outcome.ts';

const {
  isExpired,
  nextRecipientPageCursor,
  parseClaimedNotification,
  parseMalformedClaimIdentity,
} = scheduledNotificationWorker;
const RECIPIENT_PAGE_SIZE = 500;

type Outcome = Exclude<ScheduledNotificationResultStatus, 'failed'>;
type FailureCode =
  | 'expired_finalization_failed'
  | 'malformed_claim_retry_finalization_failed'
  | 'retry_finalization_failed';
type ClaimResult = {
  failure?: FailureCode;
  id: string;
  recipients?: number;
  status: ScheduledNotificationResultStatus;
};

class NotificationExpiredError extends Error {
  constructor() {
    super('Notification expired during delivery');
    this.name = 'NotificationExpiredError';
  }
}

function throwIfExpired(notification: ScheduledNotification) {
  if (isExpired(notification)) throw new NotificationExpiredError();
}

export {
  isWithinQuietHours,
  parseExpoTicketResults,
} from './scheduled-notification-push-utils.ts';

async function deliverPages(
  client: ScheduledNotificationWorkerClient,
  notification: ScheduledNotification
) {
  throwIfExpired(notification);
  await rpcOk(client, 'snapshot_claimed_notification_audience_v1', {
    p_claim_token: notification.delivery_claim_token,
    p_notification_id: notification.id,
  });
  let after: string | null = null;
  let recipients = 0;
  let hasDeferredPushes = false;
  for (;;) {
    throwIfExpired(notification);
    await renewScheduledNotificationClaim(client, notification);
    const data = await rpcOk(
      client,
      'get_scheduled_notification_recipient_page_v1',
      {
        p_after_merchant_id: after,
        p_claim_token: notification.delivery_claim_token,
        p_limit: RECIPIENT_PAGE_SIZE,
        p_notification_id: notification.id,
      }
    );
    const ids = parseRecipientPageIds(data);
    if (!ids) throw new Error('Invalid audience page');
    if (ids.length === 0) return { hasDeferredPushes, recipients };
    throwIfExpired(notification);
    await rpcOk(client, 'create_claimed_admin_notification_recipients_v1', {
      p_claim_token: notification.delivery_claim_token,
      p_merchant_ids: ids,
      p_notification_id: notification.id,
    });
    const pageDeferredPushes = await sendPushTokens(
      client,
      notification,
      ids,
      throwIfExpired
    );
    hasDeferredPushes = hasDeferredPushes || pageDeferredPushes;
    recipients += ids.length;
    after = nextRecipientPageCursor(ids, RECIPIENT_PAGE_SIZE);
    if (!after) return { hasDeferredPushes, recipients };
  }
}

async function finalize(
  client: ScheduledNotificationWorkerClient,
  notification: Pick<ScheduledNotification, 'id' | 'delivery_claim_token'>,
  outcome: Outcome,
  error?: string
) {
  const data = await rpcOk(client, 'finalize_scheduled_admin_notification_v1', {
    p_claim_token: notification.delivery_claim_token,
    p_error: error,
    p_notification_id: notification.id,
    p_outcome: outcome,
  });
  if (data !== true) throw new NotificationClaimLostError();
}

/**
 * Finalizes inside a claim's error path without letting a finalization
 * failure abort the rest of the batch. A lost claim is fenced (no result, no
 * second finalization); any other failure becomes an explicit failed result.
 */
async function finalizeOrReportFailure(
  client: ScheduledNotificationWorkerClient,
  notification: Pick<ScheduledNotification, 'id' | 'delivery_claim_token'>,
  outcome: 'expired' | 'retry',
  failure: FailureCode,
  error?: string
): Promise<ClaimResult | null> {
  try {
    await finalize(client, notification, outcome, error);
    return { id: notification.id, status: outcome };
  } catch (finalizeError) {
    if (finalizeError instanceof NotificationClaimLostError) return null;
    return reportFinalizationFailure(notification.id, outcome, failure);
  }
}

/** Logs only fixed fields: raw RPC or provider error text never reaches logs. */
function reportFinalizationFailure(
  notificationId: string,
  outcome: 'expired' | 'retry',
  failure: FailureCode
): ClaimResult {
  console.error('Scheduled notification finalization failed', {
    failure,
    notificationId,
    outcome,
  });
  return { failure, id: notificationId, status: 'failed' };
}

export async function processScheduledNotificationClaims(
  client: ScheduledNotificationWorkerClient,
  claimed: unknown[]
) {
  const results: ClaimResult[] = [];
  for (const value of claimed) {
    let notification: ScheduledNotification;
    try {
      notification = parseClaimedNotification(value);
    } catch (parseError) {
      const identity = parseMalformedClaimIdentity(value);
      if (!identity) throw parseError;
      const malformedResult = await finalizeOrReportFailure(
        client,
        identity,
        'retry',
        'malformed_claim_retry_finalization_failed',
        parseError instanceof Error
          ? parseError.message
          : 'Claim RPC returned a malformed scheduled notification'
      );
      if (malformedResult) results.push(malformedResult);
      continue;
    }
    try {
      // Pre-delivery expiry shares the single expired-finalization path below.
      throwIfExpired(notification);
      const { hasDeferredPushes, recipients } = await deliverPages(
        client,
        notification
      );
      if (hasDeferredPushes) {
        const summary = await rpcOk(
          client,
          'get_notification_push_outbox_summary_v1',
          {
            p_claim_token: notification.delivery_claim_token,
            p_notification_id: notification.id,
          }
        );
        if (requiresPushOutcomeReview(summary))
          throw new Error('Push outcome requires review');
        await finalize(client, notification, 'deferred');
        results.push({ id: notification.id, recipients, status: 'deferred' });
        continue;
      }
      const summary = await rpcOk(
        client,
        'get_notification_push_outbox_summary_v1',
        {
          p_claim_token: notification.delivery_claim_token,
          p_notification_id: notification.id,
        }
      );
      if (requiresPushOutcomeReview(summary))
        throw new Error('Push outcome requires review');
      await finalize(client, notification, 'sent');
      results.push({ id: notification.id, recipients, status: 'sent' });
    } catch (error) {
      if (error instanceof NotificationClaimLostError) continue;
      const failureResult =
        error instanceof NotificationExpiredError
          ? await finalizeOrReportFailure(
              client,
              notification,
              'expired',
              'expired_finalization_failed'
            )
          : await finalizeOrReportFailure(
              client,
              notification,
              'retry',
              'retry_finalization_failed',
              error instanceof Error
                ? error.message
                : 'Notification delivery failed'
            );
      if (failureResult) results.push(failureResult);
    }
  }
  return results;
}
