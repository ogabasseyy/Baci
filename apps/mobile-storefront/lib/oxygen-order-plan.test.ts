import { expect, it, jest } from '@jest/globals';
import {
  mockFetchWithTimeout,
  mockGetSession,
} from '@/lib/wallet-top-up.test-utils';
import { readOxygenOrderPlan } from './oxygen-order-plan';

const getPlan = (signal = new AbortController().signal, user = 'user-1') =>
  readOxygenOrderPlan('order+one', user, signal);

it('reads the encoded order using the matching signed-in customer', async () => {
  mockFetchWithTimeout.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ plan: null }),
  });
  await expect(getPlan()).resolves.toBeNull();
  expect(mockFetchWithTimeout).toHaveBeenCalledWith(
    'https://usebaci.com/api/payments/oxygen/order-plan?orderId=order%2Bone',
    expect.objectContaining({
      headers: { Authorization: 'Bearer token-123' },
      method: 'GET',
      timeout: 10000,
    })
  );
});

it('rejects a session mismatch before fetching', async () => {
  await expect(getPlan(undefined, 'user-2')).rejects.toThrow('account changed');
  expect(mockGetSession).toHaveBeenCalled();
  expect(mockFetchWithTimeout).not.toHaveBeenCalled();
});

it('rejects a malformed repayment schedule response', async () => {
  mockFetchWithTimeout.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ plan: { schedule: [] } }),
  });
  await expect(getPlan()).rejects.toThrow();
});

it('cancels a stalled response body after ten seconds', async () => {
  jest.useFakeTimers();
  try {
    mockFetchWithTimeout.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => new Promise(() => undefined),
    });
    const result = expect(getPlan()).rejects.toThrow('timed out after 10000');
    await jest.advanceTimersByTimeAsync(10000);
    await result;
    const init = mockFetchWithTimeout.mock.calls[0][1] as RequestInit;
    expect(init.signal?.aborted).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

it('cancels the read when the screen aborts it', async () => {
  const started = new Promise<void>((resolve) => {
    mockFetchWithTimeout.mockImplementationOnce(
      (_url, init) =>
        new Promise((_, reject) => {
          const signal = (init as RequestInit).signal;
          signal?.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
          resolve();
        })
    );
  });
  const controller = new AbortController();
  const result = expect(getPlan(controller.signal)).rejects.toThrow();
  await started;
  controller.abort();
  await result;
  const init = mockFetchWithTimeout.mock.calls[0][1] as RequestInit;
  expect(init.signal?.aborted).toBe(true);
});
