import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPiggyvestMoneyAlertSender,
  PIGGYVEST_MONEY_ALERT_TIMEOUT_MS,
  type PiggyvestMoneyAlertDeps,
} from './piggyvest-money-alert-events';

/**
 * A PostHog send can outlive its timeout and fail afterwards (for example a
 * connection reset). The alert has already resolved as failed by then; the
 * late rejection must stay inside the sender and never surface as an
 * unhandled rejection, which would crash the invocation.
 */

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: vi.fn(() => Promise.resolve(true)),
}));

const CAPTURE_ID = '4204dc18-efb3-44d0-b9a2-1362448d4f21';
const LATE_BY_MS = 1_000;

function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('a PostHog send that fails after the timeout', () => {
  const unhandled = vi.fn();

  beforeEach(() => {
    unhandled.mockClear();
    process.on('unhandledRejection', unhandled);
  });

  afterEach(() => {
    process.off('unhandledRejection', unhandled);
    vi.useRealTimers();
  });

  it('resolves failed at the timeout and never leaks the late rejection', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const capture = vi.fn<PiggyvestMoneyAlertDeps['capture']>(
      () =>
        new Promise<boolean>((_resolve, reject) => {
          setTimeout(
            () => reject(new Error('connection reset')),
            PIGGYVEST_MONEY_ALERT_TIMEOUT_MS + LATE_BY_MS
          );
        })
    );
    const send = createPiggyvestMoneyAlertSender({
      capture,
      keepAlive: vi.fn(),
      now: () => 0,
      env: { VERCEL_ENV: 'production' },
    });

    const pending = send('PIGGYVEST_FEE_UNATTRIBUTED', {
      captureId: CAPTURE_ID,
    });
    await vi.advanceTimersByTimeAsync(PIGGYVEST_MONEY_ALERT_TIMEOUT_MS);
    await expect(pending).resolves.toBe('failed');

    await vi.advanceTimersByTimeAsync(LATE_BY_MS);
    await nextMacrotask();
    await nextMacrotask();

    expect(capture).toHaveBeenCalledTimes(1);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
