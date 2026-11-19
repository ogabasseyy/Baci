import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The PostHog page is best effort. Even if the sender ever rejected or threw,
 * the alert call must return at once, keep its single console line, and
 * leave no unhandled rejection behind on the money path.
 */

// A plain function, never vi.fn: a spy attaches handlers to every promise it
// returns (to record settled results), which would hide a leaked rejection.
const sender = vi.hoisted(() => ({
  calls: 0,
  impl: (): Promise<unknown> => Promise.resolve('sent'),
}));

vi.mock('@/lib/posthog/piggyvest-money-alert-events', () => ({
  sendPiggyvestMoneyAlert: () => {
    sender.calls += 1;
    return sender.impl();
  },
}));

import { emitPiggyvestWebhookAlert } from './webhook-alerts';

const CAPTURE_ID = '4204dc18-efb3-44d0-b9a2-1362448d4f21';
const EVENT = 'unhandledRejection';

// Only this file's listener sees rejections while a test runs, so a leak
// fails an assertion here instead of being reported elsewhere.
let saved: NodeJS.UnhandledRejectionListener[] = [];
const unhandled = vi.fn<NodeJS.UnhandledRejectionListener>();
let error: ReturnType<typeof vi.spyOn>;

async function flushRejections(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  saved = process.listeners(EVENT);
  process.removeAllListeners(EVENT);
  unhandled.mockReset();
  process.on(EVENT, unhandled);
  sender.calls = 0;
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.off(EVENT, unhandled);
  for (const listener of saved) process.on(EVENT, listener);
  vi.restoreAllMocks();
});

describe('emitPiggyvestWebhookAlert when the PostHog page fails', () => {
  it.each<[string, () => Promise<unknown>]>([
    ['rejects', () => Promise.reject(new Error('posthog down'))],
    [
      'throws synchronously',
      () => {
        throw new Error('posthog misconfigured');
      },
    ],
  ])('keeps the console line and leaks nothing when the sender %s', async (_label, failure) => {
    sender.impl = failure;

    expect(
      emitPiggyvestWebhookAlert('PIGGYVEST_RESTRICTION_BLOCKED', {
        captureId: CAPTURE_ID,
      })
    ).toBeUndefined();
    await flushRejections();

    expect(sender.calls).toBe(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      `[PiggyVest Webhook][ALERT] PIGGYVEST_RESTRICTION_BLOCKED {"captureId":"${CAPTURE_ID}"}`
    );
    expect(unhandled).not.toHaveBeenCalled();
  });
});
