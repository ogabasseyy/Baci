import type { ScheduledNotification } from './scheduled-notification.ts';

export type RpcResult = { data: unknown; error: { message: string } | null };

export interface ScheduledNotificationWorkerClient {
  rpc(name: string, args?: Record<string, unknown>): Promise<RpcResult>;
}

export class NotificationClaimLostError extends Error {
  constructor() {
    super('Notification claim was lost');
    this.name = 'NotificationClaimLostError';
  }
}

export function parseRecipientPageIds(data: unknown): string[] | null {
  if (!Array.isArray(data)) return null;
  const ids = data.flatMap((row) => {
    const value = row !== null && typeof row === 'object' ? row : null;
    const merchantId =
      value && 'merchant_id' in value ? value.merchant_id : null;
    return typeof merchantId === 'string' ? [merchantId] : [];
  });
  return ids.length === data.length ? ids : null;
}

export async function rpcOk(
  client: ScheduledNotificationWorkerClient,
  name: string,
  args: Record<string, unknown>
) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name} failed`);
  return data;
}

export async function renewScheduledNotificationClaim(
  client: ScheduledNotificationWorkerClient,
  notification: ScheduledNotification
) {
  const data = await rpcOk(client, 'renew_scheduled_notification_claim_v1', {
    p_claim_token: notification.delivery_claim_token,
    p_notification_id: notification.id,
  });
  if (data !== true) throw new NotificationClaimLostError();
}
