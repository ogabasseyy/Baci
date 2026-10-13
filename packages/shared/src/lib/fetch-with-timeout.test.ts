import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchJsonWithDeadline, fetchWithTimeout } from './fetch-with-timeout';

describe('fetchWithTimeout', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('passes through successful responses with a timeout signal', async () => {
    const response = new Response('ok');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

    await expect(fetchWithTimeout('/api/test')).resolves.toBe(response);

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/test',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('uses the configured timeout message when the timeout aborts the request', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });

    const request = fetchWithTimeout('/api/test', {
      timeoutMessage: 'Evidence upload took too long. Please try again.',
      timeoutMs: 100,
    });
    const expectation = expect(request).rejects.toThrow(
      'Evidence upload took too long. Please try again.'
    );

    await vi.advanceTimersByTimeAsync(100);
    await expectation;
  });

  it('bounds headers by the deadlineMs remainder instead of timeoutMs', async () => {
    // Codex R70 6ryArL: headers + body share one per-request
    // deadline — the explicit deadline wins over timeoutMs.
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });

    const request = fetchWithTimeout('/api/test', {
      deadlineMs: Date.now() + 100,
      timeoutMs: 10_000,
    });
    const expectation = expect(request).rejects.toThrow(
      'Request timed out. Please try again.'
    );

    await vi.advanceTimersByTimeAsync(100);
    await expectation;
  });

  it('preserves caller abort errors', async () => {
    const controller = new AbortController();
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('cancelled by caller');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });

    const request = fetchWithTimeout('/api/test', {
      signal: controller.signal,
      timeoutMs: 10_000,
    });
    controller.abort();

    await expect(request).rejects.toThrow('cancelled by caller');
  });
});

describe('fetchJsonWithDeadline', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('resolves parsed data with the response on success', async () => {
    vi.useFakeTimers();
    const json = vi.fn(async () => ({ pin: 'PIN-1' }));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json,
    } as unknown as Response);

    const result = await fetchJsonWithDeadline('/api/test', {
      deadlineMs: Date.now() + 1000,
    });

    expect(json).toHaveBeenCalledTimes(1);
    expect(result.data).toEqual({ pin: 'PIN-1' });
    expect(result.response.ok).toBe(true);
  });

  it('aborts the fetch when headers outlive the deadline', async () => {
    vi.useFakeTimers();
    let captured: AbortSignal | null | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      captured = init?.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });

    const read = fetchJsonWithDeadline('/api/test', {
      deadlineMs: Date.now() + 100,
    });
    const expectation = expect(read).rejects.toThrow(
      'Request timed out. Please try again.'
    );
    await vi.advanceTimersByTimeAsync(100);
    await expectation;
    expect(captured?.aborted).toBe(true);
  });

  it('aborts the fetch when the body outlives the deadline', async () => {
    // Codex R72 6rzq3y: response.json() locks the stream, so only a
    // fetch-level abort releases a stalled body pre-retry.
    vi.useFakeTimers();
    let captured: AbortSignal | null | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      captured = init?.signal ?? undefined;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => new Promise(() => {}),
      } as unknown as Response);
    });

    const read = fetchJsonWithDeadline('/api/test', {
      deadlineMs: Date.now() + 100,
    });
    const expectation = expect(read).rejects.toThrow(
      'Request timed out. Please try again.'
    );
    await vi.advanceTimersByTimeAsync(100);
    await expectation;
    expect(captured?.aborted).toBe(true);
  });

  it('skips the body read when shouldReadBody declines', async () => {
    vi.useFakeTimers();
    const json = vi.fn(async () => ({ pin: 'PIN-1' }));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      json,
    } as unknown as Response);

    const result = await fetchJsonWithDeadline('/api/test', {
      deadlineMs: Date.now() + 1000,
      shouldReadBody: (res) => res.ok,
    });

    expect(json).not.toHaveBeenCalled();
    expect(result.data).toBeNull();
    expect(result.response.status).toBe(503);
  });

  it('aborts a skipped body instead of leaving it downloading', async () => {
    // Codex R73 6r0cZh: a stalled non-OK body must not linger across
    // retries just because the caller skips the read.
    vi.useFakeTimers();
    let captured: AbortSignal | null | undefined;
    const json = vi.fn(() => new Promise(() => {}));
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      captured = init?.signal ?? undefined;
      return Promise.resolve({
        ok: false,
        status: 503,
        json,
      } as unknown as Response);
    });

    const result = await fetchJsonWithDeadline('/api/test', {
      deadlineMs: Date.now() + 1000,
      shouldReadBody: (res) => res.ok,
    });

    expect(result.data).toBeNull();
    expect(json).not.toHaveBeenCalled();
    expect(captured?.aborted).toBe(true);
  });

  it('preserves caller aborts during the body read', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      const abortError = () => {
        const error = new Error('cancelled by caller');
        error.name = 'AbortError';
        return error;
      };
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            // Already aborted before the read started (like a real
            // fetch with a pre-aborted signal).
            if (init?.signal?.aborted) {
              reject(abortError());
              return;
            }
            init?.signal?.addEventListener('abort', () => {
              reject(abortError());
            });
          }),
      } as unknown as Response);
    });

    const read = fetchJsonWithDeadline('/api/test', {
      signal: controller.signal,
      deadlineMs: Date.now() + 1000,
    });
    const expectation = expect(read).rejects.toThrow('cancelled by caller');
    controller.abort();
    await expectation;
  });

  it('propagates body parse errors unchanged', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('bad json');
      },
    } as unknown as Response);

    await expect(
      fetchJsonWithDeadline('/api/test', { deadlineMs: Date.now() + 1000 })
    ).rejects.toThrow('bad json');
  });

  it('times out immediately past the deadline', async () => {
    vi.useFakeTimers();
    let captured: AbortSignal | null | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      captured = init?.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });

    const read = fetchJsonWithDeadline('/api/test', {
      deadlineMs: Date.now() - 1,
    });
    const expectation = expect(read).rejects.toThrow(
      'Request timed out. Please try again.'
    );
    await vi.advanceTimersByTimeAsync(1);
    await expectation;
    expect(captured?.aborted).toBe(true);
  });
});
