import { afterEach, describe, expect, it, vi } from 'vitest';
import { withTimeout } from './with-timeout';

describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the promise when it settles first', async () => {
    vi.useFakeTimers();
    await expect(withTimeout(Promise.resolve('fast'), 1000)).resolves.toBe(
      'fast'
    );
  });

  it('rejects with the promise rejection when it settles first', async () => {
    vi.useFakeTimers();
    await expect(
      withTimeout(Promise.reject(new Error('boom')), 1000, 'timed out')
    ).rejects.toThrow('boom');
  });

  it('rejects with the message when the timer wins', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise(() => {}), 1000, 'slow body');
    const assertion = expect(pending).rejects.toThrow('slow body');
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });
});
