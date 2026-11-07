import 'server-only';
import type { PiggyvestCaptureStatus } from '@/schemas/piggyvest/webhook-capture';
import {
  logPiggyvestWebhookAlert,
  sendPiggyvestWebhookAlertDelivered,
} from './webhook-alerts';

/** The parked rows themselves are durable alert evidence. Every enabled pass
 * checks them, including after a lost settlement response or a process crash.
 * No delivery acknowledgement is stored, so a failed send is retried next pass. */
export async function monitorCaptureReviews(
  status: () => Promise<PiggyvestCaptureStatus>
): Promise<void> {
  const snapshot = await status();
  if (snapshot.needsReview === 0) return;
  const detail = {
    reason: `${snapshot.needsReview} captured deliveries remain in needs_review`,
  };
  logPiggyvestWebhookAlert('PIGGYVEST_WEBHOOK_NEEDS_REVIEW', detail);
  await sendPiggyvestWebhookAlertDelivered(
    'PIGGYVEST_WEBHOOK_NEEDS_REVIEW',
    detail
  );
}
