import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTimeoutComposedFetch } from '@/lib/supabase/compose-fetch-signal';

describe('createTimeoutComposedFetch', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockFetch.mockReset();
  });

  it('applies a timeout signal when the caller passes none', async () => {
    const composedFetch = createTimeoutComposedFetch(5000);

    await composedFetch('https://example.com/rest');

    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal?.aborted).toBe(false);
  });

  it('keeps the caller abort live instead of discarding it (regression: caller signals were overwritten)', async () => {
    const composedFetch = createTimeoutComposedFetch(5000);
    const callerController = new AbortController();

    await composedFetch('https://example.com/rest', {
      signal: callerController.signal,
    });

    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect(init.signal?.aborted).toBe(false);

    callerController.abort(new Error('caller aborted'));

    expect(init.signal?.aborted).toBe(true);
    expect((init.signal?.reason as Error).message).toBe('caller aborted');
  });

  it('aborts via the timeout even when a caller signal is present', async () => {
    // AbortSignal.timeout uses Node-internal timers that can starve under CI
    // load. Drive the timeout signal through a controllable AbortController so
    // the AbortSignal.any composition is asserted deterministically.
    const timeoutController = new AbortController();
    const timeoutSpy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(timeoutController.signal);

    const composedFetch = createTimeoutComposedFetch(5_000);
    const callerController = new AbortController();

    await composedFetch('https://example.com/rest', {
      signal: callerController.signal,
    });

    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect(init.signal?.aborted).toBe(false);

    timeoutController.abort(
      new DOMException('The operation was aborted.', 'TimeoutError')
    );

    expect(init.signal?.aborted).toBe(true);
    expect((init.signal?.reason as DOMException).name).toBe('TimeoutError');
    expect(timeoutSpy).toHaveBeenCalledWith(5_000);
    timeoutSpy.mockRestore();
  });

  it('forwards the request input and remaining init options untouched', async () => {
    const composedFetch = createTimeoutComposedFetch(5000);

    await composedFetch('https://example.com/rest', {
      method: 'POST',
      headers: { 'X-Test': '1' },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/rest',
      expect.objectContaining({
        method: 'POST',
        headers: { 'X-Test': '1' },
      })
    );
  });
});
