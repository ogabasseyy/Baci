import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureKlumpCallbackSettlementIfPaid } from './klump-callback-settlement';

const mockCaptureBnplPaymentCompleted = vi.hoisted(() => vi.fn());

vi.mock('./capture-bnpl-payment-completed', () => ({
  captureBnplPaymentCompleted: (...args: unknown[]) =>
    mockCaptureBnplPaymentCompleted(...args),
}));

describe('captureKlumpCallbackSettlementIfPaid', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('resolves unattributed when the settlement lookup hangs past its deadline', async () => {
    const fetchMock = vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted'))
          );
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const pending = captureKlumpCallbackSettlementIfPaid({
      orderId: 'order-1',
      klumpReference: 'BAC-ABCD12345678',
      trackingToken: 'tok-123',
      merchantSlug: 'test-store',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/storefront/orders/order-1'),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );

    // The hung lookup hits its deadline and resolves quietly — no
    // attribution, no throw — instead of holding the callback.
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pending).resolves.toBeUndefined();
    expect(mockCaptureBnplPaymentCompleted).not.toHaveBeenCalled();
  });
});
