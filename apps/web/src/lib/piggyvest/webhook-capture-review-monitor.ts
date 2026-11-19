import 'server-only';
import type { PiggyvestCaptureStatus } from '@/schemas/piggyvest/webhook-capture';
import {
  logPiggyvestWebhookAlert,
  sendPiggyvestWebhookAlertDelivered,
} from './webhook-alerts';
import {
  type CaptureReviewState,
  createCaptureReviewState,
} from './webhook-capture-review-state';

/** The parked rows are durable alert evidence. Every enabled pass checks them,
 * while a durable count marker suppresses duplicate pages. A failed send does
 * not advance that marker, so the next pass retries the notification. */
export async function monitorCaptureReviews(
  status: () => Promise<PiggyvestCaptureStatus>,
  state: CaptureReviewState = createCaptureReviewState()
): Promise<void> {
  const snapshot = await status();
  console.info('[PiggyVest Webhook] Capture review status', {
    needsReview: snapshot.needsReview,
  });
  const previousCount = state.readLastPagedCount();
  if (snapshot.needsReview < previousCount) {
    try {
      state.writeLastPagedCount(snapshot.needsReview);
    } catch {
      console.warn(
        '[PiggyVest Webhook] Failed to persist capture review state'
      );
    }
    return;
  }
  if (snapshot.needsReview <= previousCount) return;
  const detail = {
    reason: `${snapshot.needsReview} captured deliveries remain in needs_review`,
  };
  logPiggyvestWebhookAlert('PIGGYVEST_WEBHOOK_NEEDS_REVIEW', detail);
  const delivered = await sendPiggyvestWebhookAlertDelivered(
    'PIGGYVEST_WEBHOOK_NEEDS_REVIEW',
    detail
  );
  if (!delivered) return;
  try {
    state.writeLastPagedCount(snapshot.needsReview);
  } catch {
    console.warn('[PiggyVest Webhook] Failed to persist capture review state');
  }
}
