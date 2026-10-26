import { describe, expect, it, vi } from 'vitest';
import { requestDeadline } from './request-deadline';

describe('requestDeadline', () => {
  it('returns a completed request result', async () => {
    await expect(
      requestDeadline.run(async () => 'done', {
        timeoutMs: 100,
        timeoutMessage: 'request expired',
      })
    ).resolves.toBe('done');
  });

  it('aborts and rejects when the request exceeds its deadline', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const request = requestDeadline.run(
      (requestSignal) => {
        signal = requestSignal;
        return new Promise(() => undefined);
      },
      { timeoutMs: 100, timeoutMessage: 'request expired' }
    );
    const rejected = expect(request).rejects.toMatchObject({
      name: 'TimeoutError',
      message: 'request expired',
    });

    try {
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not invoke the request for an already-aborted parent signal', async () => {
    const parent = new AbortController();
    parent.abort();
    const request = vi.fn(async () => 'should not run');

    await expect(
      requestDeadline.run(request, {
        timeoutMs: 100,
        timeoutMessage: 'request expired',
        parentSignal: parent.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(request).not.toHaveBeenCalled();
  });
});
