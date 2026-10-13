import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout, readJsonWithDeadline } from './fetch-with-timeout';

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

describe('readJsonWithDeadline', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('cancels the stalled stream when the deadline wins', async () => {
    // Codex R71 6rzIQ3: rejecting the wrapper alone leaves the body
    // downloading — retries would pile up connections behind stalls.
    vi.useFakeTimers();
    const cancel = vi.fn(async () => {});
    const response = {
      body: { cancel },
      json: () => new Promise(() => {}),
    } as unknown as Response;

    const read = readJsonWithDeadline(response, Date.now() + 100);
    const expectation = expect(read).rejects.toThrow('Operation timed out');
    await vi.advanceTimersByTimeAsync(100);
    await expectation;
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('returns the parsed body without cancelling on success', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(async () => {});
    const response = {
      body: { cancel },
      json: async () => ({ ok: true }),
    } as unknown as Response;

    await expect(
      readJsonWithDeadline(response, Date.now() + 100)
    ).resolves.toEqual({ ok: true });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('propagates body errors and tolerates an unusable body', async () => {
    vi.useFakeTimers();
    const broken = {
      body: null,
      json: async () => {
        throw new Error('bad json');
      },
    } as unknown as Response;
    await expect(
      readJsonWithDeadline(broken, Date.now() + 100)
    ).rejects.toThrow('bad json');

    const unusable = {
      body: {
        cancel: async () => {
          throw new Error('nope');
        },
      },
      json: () => new Promise(() => {}),
    } as unknown as Response;
    const read = readJsonWithDeadline(unusable, Date.now() + 100);
    const expectation = expect(read).rejects.toThrow('Operation timed out');
    await vi.advanceTimersByTimeAsync(100);
    await expectation;
  });
});
