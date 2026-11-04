import { getExpoClient } from '@/lib/expo-client';
import type { PushDelivery } from '@/lib/expo-push-types';
import type { GiglNotificationRpcClient } from '@/lib/gigl-notification-worker-client';

type TokenRows = { token: string; platform: string }[];

/**
 * Push store backed by the lease-bound notification wrappers. Tenant, user
 * and app type are derived from the leased outbox row inside the database,
 * so none of the ids passed in by the delivery core are trusted for scope.
 */
export function createGiglNotificationPushStore(
  client: GiglNotificationRpcClient,
  lease: { notificationId: string; workerId: string }
): PushDelivery {
  const base = { p_id: lease.notificationId, p_worker_id: lease.workerId };
  const fetchTokens = async (extra: Record<string, unknown>) => {
    const { data, error } = await client.rpc(
      'gigl_worker_notification_push_tokens',
      { ...base, ...extra }
    );
    if (error) return { data: null, error: { message: error.message } };
    return { data: (data ?? []) as TokenRows, error: null };
  };
  // The wrappers answer false/0 when the lease is gone; surface that as an
  // error so the attempt retry loop and ticket logging see the lost write.
  const write = async (
    name: Parameters<GiglNotificationRpcClient['rpc']>[0],
    args: Record<string, unknown>
  ) => {
    const { data, error } = await client.rpc(name, { ...base, ...args });
    if (error) return { error: { message: error.message } };
    if (data === false) {
      return { error: { message: 'Notification lease is no longer active' } };
    }
    return { error: null };
  };
  return {
    getExpo: getExpoClient,
    fetchMerchantTokens: ({ recipientUserIds, requiredCapability }) =>
      fetchTokens({
        p_recipient_user_ids: recipientUserIds ?? null,
        p_required_capability: requiredCapability ?? null,
      }),
    fetchCustomerTokens: ({ requiredCapability }) =>
      fetchTokens({ p_required_capability: requiredCapability ?? null }),
    deactivateTokens: (reason, tokens) =>
      write('gigl_worker_deactivate_notification_push_tokens', {
        p_reason: reason,
        p_tokens: tokens,
      }),
    insertTickets: (rows) =>
      write('gigl_worker_store_notification_push_tickets', {
        p_tickets: rows.map((row) => ({
          channel: row.channel,
          notification_type: row.notification_type,
          push_token: row.push_token,
          ticket_id: row.ticket_id,
        })),
      }),
    insertAttempt: (row) =>
      write('gigl_worker_record_notification_push_attempt', {
        p_attempt: row,
      }),
  };
}
