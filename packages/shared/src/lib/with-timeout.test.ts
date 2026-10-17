import { afterEach, describe, expect, it, vi } from 'vitest';
import { withDeadline, withTimeout } from './with-timeout';

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

describe('withDeadline', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives the body only the budget remaining at call time', async () => {
    // Codex R70 6ryArL: slow headers must not restart the clock — a
    // body read starting 900ms into a 1s deadline gets 100ms.
    vi.useFakeTimers();
    const deadlineMs = Date.now() + 1000;
    await vi.advanceTimersByTimeAsync(900);
    const pending = withDeadline(new Promise(() => {}), deadlineMs, 'stalled');
    const assertion = expect(pending).rejects.toThrow('stalled');
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it('still resolves a ready value past the deadline', async () => {
    vi.useFakeTimers();
    await expect(
      withDeadline(Promise.resolve('late-but-ready'), Date.now() - 1)
    ).resolves.toBe('late-but-ready');
  });
});
