import { describe, expect, it, jest } from '@jest/globals';
import { serializeAfterOrderCreated } from './serialize-after-order-created';

describe('serializeAfterOrderCreated', () => {
  it('runs a later emission for the same order after the earlier one', async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const first = serializeAfterOrderCreated('order-1', async () => {
      events.push('first-start');
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      events.push('first-end');
      return 'first';
    });
    const second = serializeAfterOrderCreated('order-1', async () => {
      events.push('second');
      return 'second';
    });

    // The follower waits even though the leader has started.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events).toEqual(['first-start']);

    releaseFirst();
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(events).toEqual(['first-start', 'first-end', 'second']);
  });

  it('does not serialize emissions for different orders', async () => {
    let releaseFirst!: () => void;
    const first = serializeAfterOrderCreated(
      'order-1',
      () =>
        new Promise<string>((resolve) => {
          releaseFirst = () => resolve('first');
        })
    );
    const second = serializeAfterOrderCreated('order-2', async () => 'second');

    await expect(second).resolves.toBe('second');
    releaseFirst();
    await expect(first).resolves.toBe('first');
  });

  it('lets a follower through when the leader stalls past the timeout', async () => {
    jest.useFakeTimers();
    try {
      serializeAfterOrderCreated(
        'order-9',
        () => new Promise<string>(() => undefined)
      );
      const follower = serializeAfterOrderCreated(
        'order-9',
        async () => 'follower'
      );
      const assertion = expect(follower).resolves.toBe('follower');

      await jest.advanceTimersByTimeAsync(5000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });
});
