import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStorefrontReadDeadline } from './create-storefront-read-deadline';

describe('createStorefrontReadDeadline', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts and rejects with TimeoutError at the deadline', async () => {
    vi.useFakeTimers();
    const deadline = createStorefrontReadDeadline(3_000);
    const assertion = expect(deadline.promise).rejects.toMatchObject({
      name: 'TimeoutError',
    });

    await vi.advanceTimersByTimeAsync(3_000);

    await assertion;
    expect(deadline.signal.aborted).toBe(true);
  });

  it('can be cleaned up without aborting a completed read', async () => {
    vi.useFakeTimers();
    const deadline = createStorefrontReadDeadline(3_000);

    deadline.cleanup();
    await vi.advanceTimersByTimeAsync(3_001);

    expect(deadline.signal.aborted).toBe(false);
  });
});
