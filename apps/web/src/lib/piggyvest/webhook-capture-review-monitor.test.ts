import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const alerts = vi.hoisted(() => ({ log: vi.fn(), send: vi.fn() }));
vi.mock('./webhook-alerts', () => ({
  logPiggyvestWebhookAlert: alerts.log,
  sendPiggyvestWebhookAlertDelivered: alerts.send,
}));

import { monitorCaptureReviews } from './webhook-capture-review-monitor';

beforeEach(() => {
  vi.clearAllMocks();
  alerts.send.mockResolvedValue(false);
});
const snapshot = (needsReview: number) => ({
  needsReview,
  pending: 0,
  claimed: 0,
  oldestUnprocessedAt: null,
  lastCapturedAt: null,
  lastProcessedAt: null,
});

it('retries a parked review notification after a crash or failed send', async () => {
  const status = vi.fn(async () => snapshot(1));
  await monitorCaptureReviews(status);
  alerts.send.mockResolvedValue(true);
  await monitorCaptureReviews(status);
  expect(alerts.send).toHaveBeenCalledTimes(2);
  expect(alerts.send).toHaveBeenLastCalledWith(
    'PIGGYVEST_WEBHOOK_NEEDS_REVIEW',
    { reason: '1 captured deliveries remain in needs_review' }
  );
});

it('stops alerting once the durable review state has been resolved', async () => {
  await monitorCaptureReviews(async () => snapshot(0));
  expect(alerts.send).not.toHaveBeenCalled();
});
