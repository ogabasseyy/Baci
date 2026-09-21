import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  juicywayAttemptKey,
  useJuicywayPayment,
  type UseJuicywayPaymentOptions,
} from './use-juicyway-payment';
import type { CryptoChain } from '../types';

const mockCaptureCheckoutFunnelEventOnce = vi.fn();
vi.mock('@/lib/posthog/capture-checkout-funnel-event', () => ({
  captureCheckoutFunnelEventOnce: (...args: unknown[]) =>
    mockCaptureCheckoutFunnelEventOnce(...args),
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

const pendingOrder = {
  orderId: 'order-1',
  trackingToken: 'track-1',
  amount: 5750,
  total: 5750,
  orderCurrency: 'NGN',
  customerEmail: 'ada@example.com',
  customerName: 'Ada Buyer',
  customerPhone: '+2348123456789',
  billingAddress: {
    line1: '2 Olaide Tomori Street',
    city: 'Ikeja',
    state: 'Lagos',
    country: 'NG',
  },
  items: [{ name: 'Test Product', type: 'physical' as const }],
};

function createOptions(chain: CryptoChain): UseJuicywayPaymentOptions {
  return {
    merchantId: 'merchant-1',
    pendingCryptoOrder: pendingOrder,
    selectedCryptoChain: chain,
    selectedCryptoCurrency: 'USDT',
    setShowCryptoSelector: vi.fn(),
    clearCheckoutSession: vi.fn(),
    clearPendingCheckoutOrder: vi.fn(),
    clearCart: vi.fn(),
    routerPush: vi.fn(),
    getHref: (path: string) => `/ogabassey${path}`,
  };
}

function initResponse(reference: string, paymentId: string, chain = 'TRX') {
  return Response.json({
    success: true,
    reference,
    session_id: `sess-${reference}`,
    crypto_payment: {
      address:
        chain === 'TRX'
          ? 'T7WHdR7vj4i3L4575w8V5hV8tKf9w2Q3xY'
          : '0x1234567890abcdef1234567890abcdef12345678',
      chain,
      currency: 'USDT',
      amount: 575000,
      crypto_amount: '5.0',
      payment_id: paymentId,
      confirmation_time: '10 minutes',
    },
  });
}

describe('useJuicywayPayment', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('keys the lifecycle per attempt so a retry re-emits after a failed attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(initResponse('ref-1', 'pay-1'))
      .mockResolvedValueOnce(Response.json({ is_failed: true }))
      .mockResolvedValueOnce(initResponse('ref-2', 'pay-2', 'ETH'))
      .mockResolvedValueOnce(Response.json({ is_failed: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = renderHook(
      ({ chain }: { chain: CryptoChain }) =>
        useJuicywayPayment(createOptions(chain)),
      { initialProps: { chain: 'TRX' as CryptoChain } }
    );

    // Attempt 1 opens (new reference) then fails verification.
    await act(async () => {
      await result.current.initializeCryptoPayment();
    });
    expect(result.current.cryptoPaymentData?.reference).toBe('ref-1');
    await act(async () => {
      await result.current.verifyCryptoPayment();
    });
    expect(result.current.cryptoVerificationStatus).toBe('failed');

    // Retry on another network mints a new reference; its lifecycle
    // must not be suppressed by the first attempt's claims.
    act(() => {
      result.current.dismissCryptoModal();
    });
    rerender({ chain: 'ETH' });
    await act(async () => {
      await result.current.initializeCryptoPayment();
    });
    expect(result.current.cryptoPaymentData?.reference).toBe('ref-2');
    await act(async () => {
      await result.current.verifyCryptoPayment();
    });

    const startedKeys = mockCaptureCheckoutFunnelEventOnce.mock.calls
      .filter(([event]) => event === 'payment_started')
      .map(([, key]) => key);
    const failedKeys = mockCaptureCheckoutFunnelEventOnce.mock.calls
      .filter(([event]) => event === 'payment_failed')
      .map(([, key]) => key);
    expect(startedKeys).toEqual(['order-1:ref-1', 'order-1:ref-2']);
    expect(failedKeys).toEqual(['order-1:ref-1', 'order-1:ref-2']);
  });

  it('re-initializes a replacement session when retrying the same network after failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(initResponse('ref-1', 'pay-1'))
      .mockResolvedValueOnce(Response.json({ is_failed: true }))
      .mockResolvedValueOnce(initResponse('ref-2', 'pay-2'))
      .mockResolvedValueOnce(Response.json({ is_failed: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { result, unmount } = renderHook(() =>
      useJuicywayPayment(createOptions('TRX'))
    );

    // Attempt 1 opens then fails verification.
    await act(async () => {
      await result.current.initializeCryptoPayment();
    });
    expect(result.current.cryptoPaymentData?.reference).toBe('ref-1');
    await act(async () => {
      await result.current.verifyCryptoPayment();
    });
    expect(result.current.cryptoVerificationStatus).toBe('failed');

    // Retry on the SAME network: the terminal failure must have evicted
    // the cached session, so this mints a new reference instead of
    // reusing the failed session's dead payment id.
    act(() => {
      result.current.dismissCryptoModal();
    });
    await act(async () => {
      await result.current.initializeCryptoPayment();
    });
    expect(result.current.cryptoPaymentData?.reference).toBe('ref-2');
    expect(
      fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')
    ).toHaveLength(2);
    await act(async () => {
      await result.current.verifyCryptoPayment();
    });
    expect(result.current.cryptoVerificationStatus).toBe('failed');

    const startedKeys = mockCaptureCheckoutFunnelEventOnce.mock.calls
      .filter(([event]) => event === 'payment_started')
      .map(([, key]) => key);
    const failedKeys = mockCaptureCheckoutFunnelEventOnce.mock.calls
      .filter(([event]) => event === 'payment_failed')
      .map(([, key]) => key);
    expect(startedKeys).toEqual(['order-1:ref-1', 'order-1:ref-2']);
    expect(failedKeys).toEqual(['order-1:ref-1', 'order-1:ref-2']);
    unmount();
  });

  it('does not let a dismissed poll settle a retried attempt', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(initResponse('ref-1', 'pay-1'))
        .mockResolvedValueOnce(Response.json({}))
        .mockResolvedValueOnce(initResponse('ref-2', 'pay-2', 'ETH'))
        .mockResolvedValueOnce(Response.json({}))
        .mockResolvedValueOnce(Response.json({ is_confirmed: true }));
      vi.stubGlobal('fetch', fetchMock);
      const { result, rerender, unmount } = renderHook(
        ({ chain }: { chain: CryptoChain }) =>
          useJuicywayPayment(createOptions(chain)),
        { initialProps: { chain: 'TRX' as CryptoChain } }
      );

      await act(async () => {
        await result.current.initializeCryptoPayment();
      });
      await act(async () => {
        await result.current.verifyCryptoPayment();
      });
      expect(result.current.cryptoVerificationStatus).toBe('pending');

      // Dismiss mid-poll (modal header close), then retry on another
      // network and leave it pending too.
      act(() => {
        result.current.dismissCryptoModal();
      });
      rerender({ chain: 'ETH' });
      await act(async () => {
        await result.current.initializeCryptoPayment();
      });
      expect(result.current.cryptoPaymentData?.reference).toBe('ref-2');
      await act(async () => {
        await result.current.verifyCryptoPayment();
      });
      expect(result.current.cryptoVerificationStatus).toBe('pending');

      // The first poll tick belongs to attempt 2 only: the dismissed
      // poll must neither fire again nor settle attempt 1.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      expect(result.current.cryptoVerificationStatus).toBe('confirmed');
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_completed',
        'order-1',
        expect.objectContaining({ reference: 'ref-2' })
      );
      const failedKeys = mockCaptureCheckoutFunnelEventOnce.mock.calls
        .filter(([event]) => event === 'payment_failed')
        .map(([, key]) => key);
      expect(failedKeys).toEqual([]);
      const statusUrls = fetchMock.mock.calls
        .map(([url]) => String(url))
        .filter((url) => url.includes('/api/payments/status'));
      expect(statusUrls.filter((url) => url.includes('pay-1'))).toHaveLength(
        1
      );
      expect(statusUrls.filter((url) => url.includes('pay-2'))).toHaveLength(
        2
      );
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops polling when the modal is dismissed mid-verification', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(initResponse('ref-1', 'pay-1'))
        .mockResolvedValueOnce(Response.json({}))
        .mockResolvedValueOnce(Response.json({ is_confirmed: true }));
      vi.stubGlobal('fetch', fetchMock);
      const { result, unmount } = renderHook(() =>
        useJuicywayPayment(createOptions('TRX'))
      );

      await act(async () => {
        await result.current.initializeCryptoPayment();
      });
      await act(async () => {
        await result.current.verifyCryptoPayment();
      });
      expect(result.current.cryptoVerificationStatus).toBe('pending');

      // Dismiss with no retry: later ticks must not settle the attempt.
      act(() => {
        result.current.dismissCryptoModal();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });

      expect(result.current.cryptoVerificationStatus).toBe('idle');
      expect(result.current.isVerifyingCrypto).toBe(false);
      expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalledWith(
        'payment_completed',
        expect.anything(),
        expect.anything()
      );
      const statusUrls = fetchMock.mock.calls
        .map(([url]) => String(url))
        .filter((url) => url.includes('/api/payments/status'));
      expect(statusUrls).toHaveLength(1);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores an in-flight verification check after dismiss', async () => {
    let resolveStatus!: (response: Response) => void;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(initResponse('ref-1', 'pay-1'))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveStatus = resolve;
          })
      );
    vi.stubGlobal('fetch', fetchMock);
    const { result, unmount } = renderHook(() =>
      useJuicywayPayment(createOptions('TRX'))
    );

    await act(async () => {
      await result.current.initializeCryptoPayment();
    });
    let verifyPromise!: Promise<void>;
    act(() => {
      verifyPromise = result.current.verifyCryptoPayment();
    });
    // Dismiss while the initial status check is in flight.
    act(() => {
      result.current.dismissCryptoModal();
    });
    await act(async () => {
      resolveStatus(Response.json({ is_confirmed: true }));
      await verifyPromise;
    });

    expect(result.current.cryptoVerificationStatus).toBe('idle');
    expect(result.current.isVerifyingCrypto).toBe(false);
    expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalledWith(
      'payment_completed',
      expect.anything(),
      expect.anything()
    );
    unmount();
  });

  it('serializes poll ticks while a status check is in flight', async () => {
    vi.useFakeTimers();
    try {
      let resolveSlowCheck!: (response: Response) => void;
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(initResponse('ref-1', 'pay-1'))
        .mockResolvedValueOnce(Response.json({}))
        .mockImplementationOnce(
          () =>
            new Promise<Response>((resolve) => {
              resolveSlowCheck = resolve;
            })
        )
        // A second overlapping request (only reachable pre-fix): never
        // resolves, so any duplicate settle would hang the test open.
        .mockImplementationOnce(() => new Promise<Response>(() => {}));
      vi.stubGlobal('fetch', fetchMock);
      const options = createOptions('TRX');
      const { result, unmount } = renderHook(() =>
        useJuicywayPayment(options)
      );

      await act(async () => {
        await result.current.initializeCryptoPayment();
      });
      await act(async () => {
        await result.current.verifyCryptoPayment();
      });
      expect(result.current.cryptoVerificationStatus).toBe('pending');

      // First tick starts a slow check; the second tick must skip rather
      // than stack a second request for the same attempt.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      const statusUrls = fetchMock.mock.calls
        .map(([url]) => String(url))
        .filter((url) => url.includes('/api/payments/status'));
      expect(statusUrls).toHaveLength(2);

      await act(async () => {
        resolveSlowCheck(Response.json({ is_confirmed: true }));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.cryptoVerificationStatus).toBe('confirmed');
      expect(options.routerPush).toHaveBeenCalledTimes(1);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores verification responses after unmount', async () => {
    let resolveStatus!: (response: Response) => void;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(initResponse('ref-1', 'pay-1'))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveStatus = resolve;
          })
      );
    vi.stubGlobal('fetch', fetchMock);
    const options = createOptions('TRX');
    const { result, unmount } = renderHook(() =>
      useJuicywayPayment(options)
    );

    await act(async () => {
      await result.current.initializeCryptoPayment();
    });
    let verifyPromise!: Promise<void>;
    act(() => {
      verifyPromise = result.current.verifyCryptoPayment();
    });
    // Navigate away while the initial status check is in flight.
    act(() => {
      unmount();
    });
    await act(async () => {
      resolveStatus(Response.json({ is_confirmed: true }));
      await verifyPromise;
    });

    // The stale confirmation must not clear the cart or redirect back to
    // order success from another page.
    expect(options.routerPush).not.toHaveBeenCalled();
    expect(options.clearCart).not.toHaveBeenCalled();
    expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalledWith(
      'payment_completed',
      expect.anything(),
      expect.anything()
    );
  });

  it('keeps the completion order-keyed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(initResponse('ref-1', 'pay-1'))
      .mockResolvedValueOnce(Response.json({ is_confirmed: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() =>
      useJuicywayPayment(createOptions('TRX'))
    );

    await act(async () => {
      await result.current.initializeCryptoPayment();
    });
    await act(async () => {
      await result.current.verifyCryptoPayment();
    });

    expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
      'payment_completed',
      'order-1',
      expect.objectContaining({
        payment_method: 'juicyway',
        payment_status: 'paid',
        reference: 'ref-1',
      })
    );
  });

  it('falls back to the payment id when the reference is empty', () => {
    expect(juicywayAttemptKey('order-1', '', 'pay-1')).toBe('order-1:pay-1');
    expect(juicywayAttemptKey('order-1', 'ref-1', 'pay-1')).toBe(
      'order-1:ref-1'
    );
  });
});
