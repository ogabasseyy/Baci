import 'server-only';

import {
  claimedGiglTrackingNotificationsSchema,
  processClaimedGiglTrackingNotifications,
} from '@/app/api/cron/gigl-tracking/gigl-tracking-notification-worker';
import type { GiglNotificationRpcClient } from '@/lib/gigl-notification-worker-client';

type ProcessNotifications = typeof processClaimedGiglTrackingNotifications;

export async function runGiglTrackingNotificationBatch({
  batchSize,
  client,
  processNotifications = processClaimedGiglTrackingNotifications,
  workerId,
}: {
  batchSize: number;
  client: GiglNotificationRpcClient;
  processNotifications?: ProcessNotifications;
  workerId: string;
}) {
  const { data, error } = await client.rpc('gigl_worker_claim_notifications', {
    p_limit: batchSize,
    p_worker_id: workerId,
  });
  if (error) return { ok: false as const, reason: 'claim_failed' as const };

  const notifications = claimedGiglTrackingNotificationsSchema.safeParse(
    data ?? []
  );
  if (!notifications.success) {
    return { ok: false as const, reason: 'invalid_claim_payload' as const };
  }

  try {
    return {
      ok: true as const,
      summary: await processNotifications(client, notifications.data, workerId),
    };
  } catch {
    return { ok: false as const, reason: 'worker_failed' as const };
  }
}
