import { describe, expect, it } from 'vitest';
import { runExclusive } from './guest-cart-mutex';

describe('runExclusive', () => {
  it('serializes operations for the same key in submission order', async () => {
    const order: string[] = [];
    const first = runExclusive('token', async () => {
      order.push('first:start');
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push('first:end');
    });
    const second = runExclusive('token', async () => {
      order.push('second');
    });
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });

  it('runs different keys concurrently and releases after failure', async () => {
    await expect(
      runExclusive('a', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    await expect(runExclusive('a', async () => 'ok')).resolves.toBe('ok');
    await expect(runExclusive('b', async () => 'other')).resolves.toBe(
      'other'
    );
  });
});
