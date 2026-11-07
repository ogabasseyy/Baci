import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const alerts = vi.hoisted(() => ({ log: vi.fn(), send: vi.fn() }));
vi.mock('./webhook-alerts', () => ({
  logPiggyvestWebhookAlert: alerts.log,
  sendPiggyvestWebhookAlertDelivered: alerts.send,
}));

import { monitorCaptureReviews } from './webhook-capture-review-monitor';
import type { CaptureReviewState } from './webhook-capture-review-state';

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

function memoryState(initialCount = 0): CaptureReviewState {
  let count = initialCount;
  return {
    readLastPagedCount: () => count,
    writeLastPagedCount: (nextCount) => {
      count = nextCount;
    },
  };
}

it('retries a parked review notification after a crash or failed send', async () => {
  const status = vi.fn(async () => snapshot(1));
  const state = memoryState();
  await monitorCaptureReviews(status, state);
  alerts.send.mockResolvedValue(true);
  await monitorCaptureReviews(status, state);
  await monitorCaptureReviews(status, state);
  expect(alerts.send).toHaveBeenCalledTimes(2);
  expect(alerts.send).toHaveBeenLastCalledWith(
    'PIGGYVEST_WEBHOOK_NEEDS_REVIEW',
    { reason: '1 captured deliveries remain in needs_review' }
  );
});

it('stops alerting once the durable review state has been resolved', async () => {
  const state = memoryState(1);
  await monitorCaptureReviews(async () => snapshot(0), state);
  await monitorCaptureReviews(async () => snapshot(0), state);
  expect(alerts.send).not.toHaveBeenCalled();
});

it('pages only when the review count increases and resets after resolution', async () => {
  alerts.send.mockResolvedValue(true);
  const state = memoryState();
  for (const count of [1, 1, 2, 0, 1])
    await monitorCaptureReviews(async () => snapshot(count), state);
  expect(alerts.send).toHaveBeenCalledTimes(3);
});
