import { describe, expect, it, jest } from '@jest/globals';
import { fetchWithTimeout } from './fetch-with-timeout';

describe('fetchWithTimeout cancellation', () => {
  it('preserves caller aborts instead of reporting a request timeout', async () => {
    const controller = new AbortController();
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation((_input, init) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              const error = new Error('Cancelled by caller');
              error.name = 'AbortError';
              reject(error);
            },
            { once: true }
          );
        });
      });

    try {
      const request = fetchWithTimeout('https://usebaci.com/api/test', {
        signal: controller.signal,
      });
      controller.abort();

      await expect(request).rejects.toMatchObject({
        message: 'Cancelled by caller',
        name: 'AbortError',
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('bounds the request by the deadlineMs remainder', async () => {
    // Codex R70 6ryArL: an explicit deadline overrides timeout —
    // headers + body share one per-request budget.
    jest.useFakeTimers();
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation((_input, init) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            },
            { once: true }
          );
        });
      });

    try {
      const request = fetchWithTimeout('https://usebaci.com/api/test', {
        deadlineMs: Date.now() + 100,
        timeout: 10_000,
      });
      const assertion = expect(request).rejects.toThrow(
        'Request timed out after 100ms'
      );

      await jest.advanceTimersByTimeAsync(100);
      await assertion;
    } finally {
      fetchSpy.mockRestore();
      jest.useRealTimers();
    }
  });
});
