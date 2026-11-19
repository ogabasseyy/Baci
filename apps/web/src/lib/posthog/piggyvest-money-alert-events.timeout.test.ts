import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPiggyvestMoneyAlertSender,
  PIGGYVEST_MONEY_ALERT_TIMEOUT_MS,
  type PiggyvestMoneyAlertDeps,
} from './piggyvest-money-alert-events';

/**
 * The PostHog page is best effort and must never affect a money path. A send
 * can resolve, reject or throw before the timeout, or outlive the timeout and
 * fail afterwards (a connection reset). Every path resolves an outcome, clears
 * its timer, and never surfaces an unhandled rejection.
 */

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: vi.fn(() => Promise.resolve(true)),
}));

const CAPTURE_ID = '4204dc18-efb3-44d0-b9a2-1362448d4f21';
const LATE_BY_MS = 1_000;
const EVENT = 'unhandledRejection';

type Capture = PiggyvestMoneyAlertDeps['capture'];

// Plain functions, never vi.fn: a spy attaches handlers to every promise it
// returns (to record settled results), which would hide a leaked rejection.
function counted(impl: () => Promise<boolean>): {
  capture: Capture;
  calls: () => number;
} {
  let calls = 0;
  return {
    capture: () => {
      calls += 1;
      return impl();
    },
    calls: () => calls,
  };
}

// Only this file's listener sees rejections while a test runs, so a leak
// fails an assertion here instead of being reported elsewhere.
let saved: NodeJS.UnhandledRejectionListener[] = [];
const unhandled = vi.fn<NodeJS.UnhandledRejectionListener>();

function realMacrotask(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function flushRejections(): Promise<void> {
  await realMacrotask();
  await realMacrotask();
}

function sender(capture: Capture) {
  return createPiggyvestMoneyAlertSender({
    capture,
    keepAlive: vi.fn(),
    now: () => 0,
    env: { VERCEL_ENV: 'production' },
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  saved = process.listeners(EVENT);
  process.removeAllListeners(EVENT);
  unhandled.mockReset();
  process.on(EVENT, unhandled);
});

afterEach(() => {
  process.off(EVENT, unhandled);
  for (const listener of saved) process.on(EVENT, listener);
  vi.useRealTimers();
});

describe('PostHog money alert delivery bounds', () => {
  it('resolves failed at the timeout and swallows a rejection that arrives later', async () => {
    const { capture, calls } = counted(
      () =>
        new Promise<boolean>((_resolve, reject) => {
          setTimeout(
            () => reject(new Error('connection reset')),
            PIGGYVEST_MONEY_ALERT_TIMEOUT_MS + LATE_BY_MS
          );
        })
    );

    const pending = sender(capture)('PIGGYVEST_FEE_UNATTRIBUTED', {
      captureId: CAPTURE_ID,
    });
    await vi.advanceTimersByTimeAsync(PIGGYVEST_MONEY_ALERT_TIMEOUT_MS);
    await expect(pending).resolves.toBe('failed');

    await vi.advanceTimersByTimeAsync(LATE_BY_MS);
    await flushRejections();

    expect(calls()).toBe(1);
    expect(unhandled).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each<[string, () => Promise<boolean>, string]>([
    ['resolves', () => Promise.resolve(true), 'sent'],
    ['rejects', () => Promise.reject(new Error('posthog down')), 'failed'],
    [
      'throws synchronously',
      () => {
        throw new Error('posthog misconfigured');
      },
      'failed',
    ],
  ])('clears the timeout timer when PostHog %s before it fires', async (_label, impl, outcome) => {
    const { capture, calls } = counted(impl);

    await expect(
      sender(capture)('PIGGYVEST_FEE_UNATTRIBUTED', { captureId: CAPTURE_ID })
    ).resolves.toBe(outcome);
    await flushRejections();

    expect(calls()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('detects a rejection nobody handles (guards the checks above)', async () => {
    void Promise.reject(new Error('unobserved'));
    await flushRejections();

    expect(unhandled).toHaveBeenCalledTimes(1);
  });
});
