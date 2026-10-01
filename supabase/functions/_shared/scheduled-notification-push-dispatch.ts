import type { ScheduledNotification } from './scheduled-notification.ts';
import {
  isWithinQuietHours,
  parseExpoTicketResults,
} from './scheduled-notification-push-utils.ts';
import {
  renewScheduledNotificationClaim,
  rpcOk,
  type ScheduledNotificationWorkerClient,
} from './scheduled-notification-rpc.ts';
import { scheduledNotificationWorker } from './scheduled-notification-worker.ts';

const { asRecord, chunks, isExpoPushToken } = scheduledNotificationWorker;
const TOKEN_BATCH_SIZE = 100;
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type PushTokenRecord = {
  push_token: string;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  quiet_hours_time_zone: string;
};

export async function sendPushTokens(
  client: ScheduledNotificationWorkerClient,
  notification: ScheduledNotification,
  merchantIds: string[],
  throwIfExpired: (notification: ScheduledNotification) => void
) {
  if (!notification.channels.includes('push')) return false;
  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  let hasDeferredPushes = false;
  for (const merchants of chunks(merchantIds, TOKEN_BATCH_SIZE)) {
    throwIfExpired(notification);
    const data = await rpcOk(
      client,
      'get_claimed_notification_push_tokens_v1',
      {
        p_claim_token: notification.delivery_claim_token,
        p_merchant_ids: merchants,
        p_notification_id: notification.id,
      }
    );
    if (!Array.isArray(data)) throw new Error('Push tokens unavailable');
    const records = data.flatMap((row): PushTokenRecord[] => {
      const value = asRecord(row);
      const token = value?.push_token;
      return typeof token === 'string' && isExpoPushToken(token)
        ? [
            {
              push_token: token,
              quiet_hours_start:
                typeof value?.quiet_hours_start === 'string'
                  ? value.quiet_hours_start
                  : null,
              quiet_hours_end:
                typeof value?.quiet_hours_end === 'string'
                  ? value.quiet_hours_end
                  : null,
              quiet_hours_time_zone:
                typeof value?.quiet_hours_time_zone === 'string'
                  ? value.quiet_hours_time_zone
                  : 'Africa/Lagos',
            },
          ]
        : [];
    });
    const uniqueRecords = [
      ...new Map(records.map((record) => [record.push_token, record])).values(),
    ];
    const quietTokens = uniqueRecords.filter((record) =>
      isWithinQuietHours(
        new Date(),
        record.quiet_hours_start,
        record.quiet_hours_end,
        record.quiet_hours_time_zone
      )
    );
    if (quietTokens.length > 0) {
      const deferredCount = await rpcOk(
        client,
        'defer_notification_push_tokens_v1',
        {
          p_claim_token: notification.delivery_claim_token,
          p_notification_id: notification.id,
          p_tokens: quietTokens.map((record) => record.push_token),
        }
      );
      if (typeof deferredCount === 'number' && deferredCount > 0) {
        hasDeferredPushes = true;
      }
    }
    const tokens = uniqueRecords
      .filter((record) => !quietTokens.includes(record))
      .map((record) => record.push_token);
    for (const requested of chunks(tokens, TOKEN_BATCH_SIZE)) {
      throwIfExpired(notification);
      await renewScheduledNotificationClaim(client, notification);
      const reserved = await rpcOk(
        client,
        'reserve_notification_push_batch_v1',
        {
          p_claim_token: notification.delivery_claim_token,
          p_notification_id: notification.id,
          p_tokens: requested,
        }
      );
      const dispatchTokens = Array.isArray(reserved)
        ? reserved.flatMap((row) => {
            const token = asRecord(row)?.push_token;
            return typeof token === 'string' ? [token] : [];
          })
        : [];
      if (dispatchTokens.length === 0) continue;
      try {
        throwIfExpired(notification);
        const response = await fetch(EXPO_PUSH_URL, {
          signal: AbortSignal.timeout(12_000),
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify(
            dispatchTokens.map((to) => ({
              to,
              title: notification.title,
              body: notification.message,
              data: {
                type: 'admin_broadcast',
                notification_id: notification.id,
                action_url: notification.action_url,
              },
              sound: 'default',
              channelId: 'admin',
              priority: 'default',
            }))
          ),
        });
        const results = response.ok
          ? parseExpoTicketResults(await response.json(), dispatchTokens.length)
          : null;
        if (!results) throw new Error('Provider outcome unresolved');
        await rpcOk(client, 'record_notification_push_ticket_results_v1', {
          p_claim_token: notification.delivery_claim_token,
          p_error_codes: results.errorCodes,
          p_notification_id: notification.id,
          p_statuses: results.statuses,
          p_ticket_ids: results.ticketIds,
          p_tokens: dispatchTokens,
        });
      } catch {
        await rpcOk(client, 'mark_notification_push_unknown_v1', {
          p_claim_token: notification.delivery_claim_token,
          p_error_code: 'provider_outcome_unknown',
          p_notification_id: notification.id,
          p_tokens: dispatchTokens,
        });
        throw new Error('Push provider outcome unresolved');
      }
    }
  }
  return hasDeferredPushes;
}
