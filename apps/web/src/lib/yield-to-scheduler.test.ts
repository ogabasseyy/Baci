// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { yieldToScheduler } from './yield-to-scheduler';

type TestScheduler = { yield?: () => Promise<void> } | undefined;

function setWindowScheduler(scheduler: TestScheduler) {
  // TS 6+ lib.dom declares a required `Window.scheduler: Scheduler`, so an
  // intersection with `Window` would reject `undefined`; widen through a
  // narrow shape instead to exercise the scheduler-less browser path.
  (window as unknown as { scheduler?: TestScheduler }).scheduler = scheduler;
}

afterEach(() => {
  setWindowScheduler(undefined);
});

describe('yieldToScheduler', () => {
  it('awaits scheduler.yield when the API is available', async () => {
    const yieldSpy = vi.fn(() => Promise.resolve());
    setWindowScheduler({ yield: yieldSpy });

    await yieldToScheduler();

    expect(yieldSpy).toHaveBeenCalledTimes(1);
  });

  it('resolves as a no-op when scheduler.yield is missing', async () => {
    setWindowScheduler(undefined);

    await expect(yieldToScheduler()).resolves.toBeUndefined();
  });

  it('resolves as a no-op when scheduler exists without yield', async () => {
    setWindowScheduler({});

    await expect(yieldToScheduler()).resolves.toBeUndefined();
  });

  it('swallows a rejected scheduler.yield instead of breaking the handler', async () => {
    setWindowScheduler({
      yield: () => Promise.reject(new Error('aborted')),
    });

    await expect(yieldToScheduler()).resolves.toBeUndefined();
  });
});
