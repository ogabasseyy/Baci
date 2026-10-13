import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout } from './fetch-with-timeout';

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
