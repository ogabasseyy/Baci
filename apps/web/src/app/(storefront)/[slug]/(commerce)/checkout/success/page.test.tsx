import { act, render, screen, waitFor } from '@testing-library/react';
import * as nextNavigation from 'next/navigation';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CheckoutSuccessPage from '@/app/(storefront)/[slug]/(commerce)/checkout/success/page';

const mockPush = vi.fn();
const mockSearchParams = vi.fn();
const mockClearCart = vi.fn();
const mockFetch = vi.fn();
const mockFetchWithCsrf = vi.fn();
const mockUseMerchantSafe = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        (_target, tag: string) =>
        ({
          children,
          ...props
        }: React.HTMLAttributes<HTMLElement> & { children: React.ReactNode }) =>
          React.createElement(tag, props, children),
    }
  ),
}));

vi.mock('@/hooks/cart', () => ({
  useCart: () => ({
    clearCart: mockClearCart,
  }),
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => mockUseMerchantSafe(),
}));

const mockCaptureCheckoutFunnelEventOnce = vi.fn();

vi.mock('@/lib/posthog/capture-checkout-funnel-event', () => ({
  captureCheckoutFunnelEventOnce: (...args: unknown[]) =>
    mockCaptureCheckoutFunnelEventOnce(...args),
}));

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (...args: unknown[]) => mockFetchWithCsrf(...args),
}));

vi.mock(
  '@/components/storefront/ogabassey/pages/checkout/pending-checkout-order',
  () => ({
    CHECKOUT_PENDING_ORDER_STORAGE_KEY: 'pending-order',
  })
);

vi.mock('@/components/storefront/ogabassey/components/AdUnit', () => ({
  AdUnit: () => <div data-testid="ad-unit" />,
}));

describe('checkout success page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        reference: 'txn-ref-123',
      })
    );
    mockUseMerchantSafe.mockReturnValue({
      basePath: '/test-store',
      merchant: { business_name: 'Test Store', slug: 'test-store' },
    });
    mockFetch.mockReturnValue(new Promise(() => undefined));
    mockFetchWithCsrf.mockReturnValue(new Promise(() => undefined));
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it('does not let the standalone verifying screen own the first paint', () => {
    render(<CheckoutSuccessPage />);

    expect(
      screen.getByRole('heading', { name: /order being processed/i })
    ).toBeInTheDocument();
    expect(screen.queryByText(/verifying your payment/i)).toBeNull();
  });

  it('links support users to the canonical contact route', () => {
    render(<CheckoutSuccessPage />);

    expect(
      screen.getByRole('link', { name: /contact our support team/i })
    ).toHaveAttribute('href', '/test-store/contact');
  });

  it('verifies payment references with a JSON POST instead of a side-effecting GET', async () => {
    mockFetchWithCsrf.mockResolvedValue({
      ok: true,
      json: async () => ({
        finalizationOutcome: 'completed',
        orderId: 'order-1',
        orderNumber: 'ORD-2001',
        status: 'success',
        success: true,
      }),
    });

    render(<CheckoutSuccessPage />);

    await waitFor(() =>
      expect(mockFetchWithCsrf).toHaveBeenCalledWith('/api/payments/verify', {
        body: JSON.stringify({ reference: 'txn-ref-123' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: expect.any(AbortSignal),
      })
    );
    expect(mockClearCart).toHaveBeenCalled();
    await waitFor(() =>
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_completed',
        expect.anything(),
        expect.objectContaining({ payment_status: 'paid' })
      )
    );
  });

  it.each([
    { status: 'failed', reason: 'payment_failed' },
    { status: 'cancelled', reason: 'payment_cancelled' },
  ])('captures a failed conversion for a $status verification ($reason)', async ({
    status,
    reason,
  }) => {
    mockFetchWithCsrf.mockResolvedValue({
      ok: true,
      json: async () => ({
        finalizationOutcome: 'completed',
        orderId: 'order-1',
        orderNumber: 'ORD-2001',
        status,
        success: false,
      }),
    });

    render(<CheckoutSuccessPage />);

    await waitFor(() =>
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_failed',
        'txn-ref-123',
        expect.objectContaining({ reason })
      )
    );
    expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalledWith(
      'payment_completed',
      expect.anything(),
      expect.anything()
    );
  });

  it.each([
    { outcome: 'order_cancelled' },
    { outcome: 'order_skipped' },
  ])('shows reconciliation instead of success for a captured $outcome payment', async ({
    outcome,
  }) => {
    mockFetchWithCsrf.mockResolvedValue({
      ok: true,
      json: async () => ({
        finalizationOutcome: outcome,
        orderId: 'order-1',
        orderNumber: 'ORD-2001',
        status: 'success',
        success: true,
      }),
    });

    render(<CheckoutSuccessPage />);

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /order under review/i })
      ).toBeInTheDocument()
    );
    expect(screen.getByText('#ORD-2001')).toBeInTheDocument();
    expect(screen.queryByText(/order received/i)).toBeNull();
    expect(mockClearCart).not.toHaveBeenCalled();
    expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalledWith(
      'payment_completed',
      expect.anything(),
      expect.anything()
    );
  });

  it('claims verification failures per attempt when one order retries with a new reference', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams({ reference: 'ref-1', orderId: 'order-1' })
    );
    mockFetchWithCsrf.mockResolvedValue({
      ok: true,
      json: async () => ({
        finalizationOutcome: 'completed',
        orderId: 'order-1',
        orderNumber: 'ORD-2001',
        status: 'failed',
        success: false,
      }),
    });

    const { unmount } = render(<CheckoutSuccessPage />);
    await waitFor(() =>
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_failed',
        'order-1:ref-1',
        expect.objectContaining({ reason: 'payment_failed' })
      )
    );

    // Same order, new gateway reference: the retry lands as a fresh page
    // load and its failed attempt claims a distinct failure instead of
    // being suppressed by the first attempt's claim.
    unmount();
    mockSearchParams.mockReturnValue(
      new URLSearchParams({ reference: 'ref-2', orderId: 'order-1' })
    );
    render(<CheckoutSuccessPage />);
    await waitFor(() =>
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_failed',
        'order-1:ref-2',
        expect.objectContaining({ reason: 'payment_failed' })
      )
    );
  });

  it('does not count cancelled finalizations as paid conversions', async () => {
    mockFetchWithCsrf.mockResolvedValue({
      ok: true,
      json: async () => ({
        finalizationOutcome: 'order_cancelled',
        orderNumber: 'ORD-2001',
        status: 'success',
        success: true,
      }),
    });

    render(<CheckoutSuccessPage />);

    // Captured-but-cancelled is terminal reconciliation: the cart stays
    // intact, no success experience renders, and no funnel event fires.
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /order under review/i })
      ).toBeInTheDocument()
    );
    expect(mockClearCart).not.toHaveBeenCalled();
    expect(screen.queryByText(/order received/i)).toBeNull();
    expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalled();
  });

  it('re-verifies a pending gateway response until it settles paid', async () => {
    // Pin a stable router identity so the verify effect runs once per
    // mount (as in production): the shared mock returns a fresh object
    // per render, which would re-trigger verification immediately and
    // mask the single-shot gap this test regresses.
    const useRouterSpy = vi
      .spyOn(nextNavigation, 'useRouter')
      .mockReturnValue({ push: mockPush } as never);
    mockFetchWithCsrf
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          orderNumber: 'ORD-2001',
          status: 'pending',
          success: false,
        }),
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          finalizationOutcome: 'completed',
          orderId: 'order-1',
          orderNumber: 'ORD-2001',
          orderTotal: 5750,
          paymentMethod: 'paystack',
          status: 'success',
          success: true,
        }),
      });

    render(<CheckoutSuccessPage />);

    try {
      // Still processing after the first read: no conversion yet.
      await waitFor(() => expect(mockFetchWithCsrf).toHaveBeenCalled());
      expect(
        screen.getByRole('heading', { name: /order being processed/i })
      ).toBeInTheDocument();
      expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalledWith(
        'payment_completed',
        expect.anything(),
        expect.anything()
      );

      // The bounded re-verification observes the settled payment without
      // a manual refresh.
      await waitFor(
        () => {
          expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
            'payment_completed',
            'order-1',
            expect.objectContaining({ payment_status: 'paid' })
          );
        },
        { timeout: 8000 }
      );
      expect(mockFetchWithCsrf.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      useRouterSpy.mockRestore();
    }
  });

  it('keeps polling through a captured-payment finalization error', async () => {
    const useRouterSpy = vi
      .spyOn(nextNavigation, 'useRouter')
      .mockReturnValue({ push: mockPush } as never);
    mockFetchWithCsrf
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: 'Failed to finalize order',
          finalizationOutcome: 'completion_failed',
        }),
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          finalizationOutcome: 'completed',
          orderId: 'order-1',
          orderNumber: 'ORD-2001',
          orderTotal: 5750,
          paymentMethod: 'paystack',
          status: 'success',
          success: true,
        }),
      });

    render(<CheckoutSuccessPage />);

    try {
      // The provider captured the money but finalization failed: the
      // page stays pending without recording a payment failure, and the
      // next pass observes the reconciled completion.
      await waitFor(() => expect(mockFetchWithCsrf).toHaveBeenCalled());
      expect(
        screen.getByRole('heading', { name: /order being processed/i })
      ).toBeInTheDocument();
      expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalledWith(
        'payment_failed',
        expect.anything(),
        expect.anything()
      );

      await waitFor(
        () => {
          expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
            'payment_completed',
            'order-1',
            expect.objectContaining({ payment_status: 'paid' })
          );
        },
        { timeout: 8000 }
      );
      expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalledWith(
        'payment_failed',
        expect.anything(),
        expect.anything()
      );
    } finally {
      useRouterSpy.mockRestore();
    }
  });

  it('keeps polling through an order-fetch finalization failure', async () => {
    const useRouterSpy = vi
      .spyOn(nextNavigation, 'useRouter')
      .mockReturnValue({ push: mockPush } as never);
    mockFetchWithCsrf
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: 'Failed to finalize order',
          finalizationOutcome: 'order_fetch_failed',
        }),
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          finalizationOutcome: 'completed',
          orderId: 'order-1',
          orderNumber: 'ORD-2001',
          orderTotal: 5750,
          paymentMethod: 'paystack',
          status: 'success',
          success: true,
        }),
      });

    render(<CheckoutSuccessPage />);

    try {
      // Atomic completion already made the order paid; only the rich-order
      // fetch failed. The page stays pending without recording a payment
      // failure, and the next pass observes the reconciled completion.
      await waitFor(() => expect(mockFetchWithCsrf).toHaveBeenCalled());
      expect(
        screen.getByRole('heading', { name: /order being processed/i })
      ).toBeInTheDocument();
      expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalledWith(
        'payment_failed',
        expect.anything(),
        expect.anything()
      );

      await waitFor(
        () => {
          expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
            'payment_completed',
            'order-1',
            expect.objectContaining({ payment_status: 'paid' })
          );
        },
        { timeout: 8000 }
      );
      expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalledWith(
        'payment_failed',
        expect.anything(),
        expect.anything()
      );
    } finally {
      useRouterSpy.mockRestore();
    }
  });

  it('does not start a second verification while one is in flight', async () => {
    // Same stable-router pin as above: production runs the effect once
    // per mount.
    const useRouterSpy = vi
      .spyOn(nextNavigation, 'useRouter')
      .mockReturnValue({ push: mockPush } as never);
    let releaseFirst!: (value: unknown) => void;
    const firstGate = new Promise((resolve) => {
      releaseFirst = resolve as (value: unknown) => void;
    });
    mockFetchWithCsrf
      .mockImplementationOnce(() =>
        firstGate.then(() => ({
          ok: true,
          json: async () => ({
            orderNumber: 'ORD-2001',
            status: 'pending',
            success: false,
          }),
        }))
      )
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          finalizationOutcome: 'completed',
          orderId: 'order-1',
          orderNumber: 'ORD-2001',
          orderTotal: 5750,
          paymentMethod: 'paystack',
          status: 'success',
          success: true,
        }),
      });

    try {
      render(<CheckoutSuccessPage />);
      await waitFor(() => expect(mockFetchWithCsrf).toHaveBeenCalled());

      // Wait past the re-verify interval while the first request is
      // still in flight: no concurrent second request may start.
      await new Promise((resolve) => setTimeout(resolve, 4100));
      expect(mockFetchWithCsrf).toHaveBeenCalledTimes(1);

      // The slow first response settles pending; only then does the
      // next attempt start and observe the paid order.
      releaseFirst(undefined);
      await waitFor(
        () => {
          expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
            'payment_completed',
            'order-1',
            expect.objectContaining({ payment_status: 'paid' })
          );
        },
        { timeout: 8000 }
      );
      expect(
        screen.queryByRole('heading', { name: /order being processed/i })
      ).not.toBeInTheDocument();
    } finally {
      useRouterSpy.mockRestore();
    }
  });

  it('does not verify again after success even when a timer was armed', async () => {
    // Same stable-router pin as above: production runs the effect once
    // per mount.
    const useRouterSpy = vi
      .spyOn(nextNavigation, 'useRouter')
      .mockReturnValue({ push: mockPush } as never);
    mockFetchWithCsrf.mockResolvedValue({
      ok: true,
      json: async () => ({
        finalizationOutcome: 'completed',
        orderId: 'order-1',
        orderNumber: 'ORD-2001',
        orderTotal: 5750,
        paymentMethod: 'paystack',
        status: 'success',
        success: true,
      }),
    });

    try {
      render(<CheckoutSuccessPage />);
      await waitFor(() => {
        expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
          'payment_completed',
          'order-1',
          expect.objectContaining({ payment_status: 'paid' })
        );
      });
      expect(mockFetchWithCsrf).toHaveBeenCalledTimes(1);

      // setStatus('success') only schedules the React update, so the
      // settling pass can arm one more timer against a stale ref. Past
      // the re-verify interval that timer must find the terminal status
      // and stop — never a second verification (a transient failure
      // there would flip the paid order to failed).
      await new Promise((resolve) => setTimeout(resolve, 4100));
      expect(mockFetchWithCsrf).toHaveBeenCalledTimes(1);
      expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalledWith(
        'payment_failed',
        expect.anything(),
        expect.anything()
      );
    } finally {
      useRouterSpy.mockRestore();
    }
  });

  it('keeps the cart intact when payment verification does not succeed', async () => {
    mockFetchWithCsrf.mockResolvedValue({
      ok: true,
      json: async () => ({
        orderNumber: 'ORD-2001',
        status: 'pending',
        success: false,
      }),
    });

    render(<CheckoutSuccessPage />);

    await waitFor(() =>
      expect(mockFetchWithCsrf).toHaveBeenCalledWith('/api/payments/verify', {
        body: JSON.stringify({ reference: 'txn-ref-123' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: expect.any(AbortSignal),
      })
    );
    expect(mockClearCart).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('heading', { name: /order received/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /payment unsuccessful/i })
    ).not.toBeInTheDocument();
  });

  it('keeps the cart intact when payment verification fetch rejects', async () => {
    mockFetchWithCsrf.mockRejectedValue(new Error('network failed'));

    render(<CheckoutSuccessPage />);

    await waitFor(() => expect(mockFetchWithCsrf).toHaveBeenCalled());
    expect(mockClearCart).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('heading', { name: /order received/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /payment unsuccessful/i })
    ).not.toBeInTheDocument();
  });

  it('keeps the cart intact and redirects after failed payment verification', async () => {
    const redirectTimerSpy = vi.spyOn(globalThis, 'setTimeout');
    mockFetchWithCsrf.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'failed',
        success: false,
      }),
    });

    try {
      render(<CheckoutSuccessPage />);

      expect(
        await screen.findByRole('heading', { name: /payment unsuccessful/i })
      ).toBeInTheDocument();
      expect(mockClearCart).not.toHaveBeenCalled();

      const redirectCallback = redirectTimerSpy.mock.calls.find(
        ([, delay]) => delay === 4000
      )?.[0];

      expect(redirectCallback).toEqual(expect.any(Function));
      if (typeof redirectCallback === 'function') {
        act(() => redirectCallback());
      }
      expect(mockPush).toHaveBeenCalledWith('/test-store/checkout');
    } finally {
      redirectTimerSpy.mockRestore();
    }
  });

  it('keeps non-2xx pending verification responses pending', async () => {
    mockFetchWithCsrf.mockResolvedValue({
      ok: false,
      json: async () => ({
        orderNumber: 'ORD-PENDING',
        status: 'pending',
        success: false,
      }),
    });

    render(<CheckoutSuccessPage />);

    await waitFor(() => expect(mockFetchWithCsrf).toHaveBeenCalled());
    expect(mockClearCart).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('heading', { name: /payment unsuccessful/i })
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: /order being processed/i })
    ).toBeInTheDocument();
    expect(await screen.findByText('#ORD-PENDING')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('treats non-2xx non-pending verification responses as failed', async () => {
    const redirectTimerSpy = vi.spyOn(globalThis, 'setTimeout');
    mockFetchWithCsrf.mockResolvedValue({
      ok: false,
      json: async () => ({
        error: 'Invalid CSRF token',
      }),
    });

    try {
      render(<CheckoutSuccessPage />);

      expect(
        await screen.findByRole('heading', { name: /payment unsuccessful/i })
      ).toBeInTheDocument();
      expect(mockClearCart).not.toHaveBeenCalled();

      const redirectCallback = redirectTimerSpy.mock.calls.find(
        ([, delay]) => delay === 4000
      )?.[0];

      expect(redirectCallback).toEqual(expect.any(Function));
    } finally {
      redirectTimerSpy.mockRestore();
    }
  });

  it('carries the canonical total into verified completion events', async () => {
    mockFetchWithCsrf.mockResolvedValue({
      ok: true,
      json: async () => ({
        currency: 'USD',
        finalizationOutcome: 'completed',
        orderId: 'order-1',
        orderNumber: 'ORD-2001',
        orderTotal: 21500,
        status: 'success',
        success: true,
      }),
    });

    render(<CheckoutSuccessPage />);

    await waitFor(() =>
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_completed',
        'order-1',
        expect.objectContaining({ currency: 'USD', total: 21500 })
      )
    );
  });

  it('carries the looked-up total into paid-order completion events', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-123',
        trackingToken: 'track-token-123',
      })
    );
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        // Token lookups must carry the order identity: the lookup
        // requires data.id === orderId before treating it as success.
        id: 'order-123',
        currency: 'GHS',
        order_number: 'ORD-1001',
        payment_method: 'paystack',
        payment_status: 'paid',
        total: 470000,
      }),
    });

    render(<CheckoutSuccessPage />);

    await waitFor(() =>
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_completed',
        'order-123',
        expect.objectContaining({ currency: 'GHS', total: 470000 })
      )
    );
  });

  it('fetches invoice order details with merchant slug and tracking token', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-123',
        trackingToken: 'track-token-123',
        type: 'invoice',
      })
    );
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'order-123',
        order_number: 'ORD-1001',
        payment_method: 'invoice',
      }),
    });

    render(<CheckoutSuccessPage />);

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/storefront/orders/order-123?merchant_slug=test-store&tracking_token=track-token-123',
        { signal: expect.any(AbortSignal) }
      )
    );
    expect(mockClearCart).toHaveBeenCalled();
    expect(
      await screen.findByRole('heading', { name: /proforma invoice ready/i })
    ).toBeInTheDocument();
  });

  it('does not send a literal undefined slug when merchant context has no slug', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-123',
      })
    );
    mockUseMerchantSafe.mockReturnValue({
      basePath: '/test-store',
      merchant: { business_name: 'Test Store' },
    });
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({}),
    });

    render(<CheckoutSuccessPage />);

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/storefront/orders/order-123',
        {
          signal: expect.any(AbortSignal),
        }
      )
    );
    expect(mockFetch.mock.calls[0]?.[0]).not.toContain('undefined');
  });

  it('falls back to a derived order number when order lookup rejects', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'abcdefgh-1234',
      })
    );
    mockFetch.mockRejectedValue(new Error('network failed'));

    render(<CheckoutSuccessPage />);

    // Rejected lookups prove nothing: the page stays in its pending
    // state with the derived number and keeps the cart for retry.
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /order being processed/i })
      ).toBeInTheDocument()
    );
    expect(mockClearCart).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText('#ABCDEFGH')).toBeInTheDocument()
    );
  });

  // Timer advances and promise drains must run inside act() so React
  // applies the fetch/settle state updates under fake timers.
  const flushMicrotasks = async () => {
    await act(async () => {
      for (let i = 0; i < 6; i += 1) {
        await Promise.resolve();
      }
    });
  };
  const advanceTimers = async (ms: number) => {
    await act(async () => {
      vi.advanceTimersByTime(ms);
      await Promise.resolve();
    });
  };

  it('re-verifies when navigation swaps to a new reference without remounting', async () => {
    // Stable-router pin: production's useRouter is referentially stable,
    // so only the query change re-runs verification — not the render.
    const useRouterSpy = vi
      .spyOn(nextNavigation, 'useRouter')
      .mockReturnValue({ push: mockPush } as never);
    mockSearchParams.mockReturnValue(
      new URLSearchParams({ orderId: 'order-1', reference: 'ref-1' })
    );
    mockFetchWithCsrf
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          finalizationOutcome: 'completed',
          orderId: 'order-1',
          orderNumber: 'ORD-2001',
          status: 'success',
          success: true,
        }),
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          finalizationOutcome: 'completed',
          orderId: 'order-2',
          orderNumber: 'ORD-2002',
          status: 'success',
          success: true,
        }),
      });

    try {
      const { rerender } = render(<CheckoutSuccessPage />);
      expect(await screen.findByText('#ORD-2001')).toBeInTheDocument();

      // App Router query change without a remount: the completed
      // checkout's terminal state must reset so the new reference is
      // verified instead of showing the prior order number forever.
      mockSearchParams.mockReturnValue(
        new URLSearchParams({ orderId: 'order-2', reference: 'ref-2' })
      );
      rerender(<CheckoutSuccessPage />);

      await waitFor(() =>
        expect(mockFetchWithCsrf).toHaveBeenCalledWith('/api/payments/verify', {
          body: JSON.stringify({ reference: 'ref-2' }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
          signal: expect.any(AbortSignal),
        })
      );
      expect(await screen.findByText('#ORD-2002')).toBeInTheDocument();
      expect(screen.queryByText('#ORD-2001')).toBeNull();
    } finally {
      useRouterSpy.mockRestore();
    }
  });

  it('releases a hung verification request and retries the pass', async () => {
    vi.useFakeTimers();
    // Stable-router pin: production's useRouter is referentially stable,
    // so each render must not restart verification with a fresh pass.
    const useRouterSpy = vi
      .spyOn(nextNavigation, 'useRouter')
      .mockReturnValue({ push: mockPush } as never);
    try {
      // The first request stalls but honors the pass bound; the retry
      // observes the captured payment completing.
      mockFetchWithCsrf.mockImplementationOnce(
        (_url: unknown, options: unknown) =>
          new Promise((_resolve, reject) => {
            const signal = (options as { signal?: AbortSignal } | undefined)
              ?.signal;
            signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          })
      );
      mockFetchWithCsrf.mockResolvedValue({
        ok: true,
        json: async () => ({
          finalizationOutcome: 'completed',
          orderId: 'order-1',
          orderNumber: 'ORD-2001',
          status: 'success',
          success: true,
        }),
      });

      render(<CheckoutSuccessPage />);
      await flushMicrotasks();
      expect(mockFetchWithCsrf).toHaveBeenCalledTimes(1);

      // The 10s pass bound aborts the hung request; the loop stays
      // pending and the 3s retry observes success.
      await advanceTimers(10000);
      await flushMicrotasks();
      await advanceTimers(3000);
      await flushMicrotasks();

      expect(mockFetchWithCsrf).toHaveBeenCalledTimes(2);
      expect(screen.getByText('#ORD-2001')).toBeInTheDocument();
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_completed',
        'order-1',
        expect.objectContaining({ payment_status: 'paid' })
      );
    } finally {
      useRouterSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('keeps observing late settlement on the slow lane after the fast budget', async () => {
    vi.useFakeTimers();
    // Stable-router pin: production's useRouter is referentially stable,
    // so each render must not restart verification with a fresh pass.
    const useRouterSpy = vi
      .spyOn(nextNavigation, 'useRouter')
      .mockReturnValue({ push: mockPush } as never);
    try {
      mockFetchWithCsrf.mockResolvedValue({
        ok: true,
        json: async () => ({
          orderNumber: 'ORD-2001',
          status: 'pending',
          success: true,
        }),
      });

      render(<CheckoutSuccessPage />);
      await flushMicrotasks();

      // Exhaust the 20 fast passes with finalization still pending: no
      // conversion, but polling must continue instead of stranding the
      // page on "processing" after one minute. The 20th pass already arms
      // the slow timer, so only 19 fast advances fire.
      for (let i = 0; i < 19; i += 1) {
        await advanceTimers(3000);
        await flushMicrotasks();
      }
      expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalled();
      expect(mockFetchWithCsrf).toHaveBeenCalledTimes(20);

      // Past the fast budget the lane slows to 15s: a 3s wait schedules
      // nothing, the full backoff runs the next pass.
      await advanceTimers(3000);
      await flushMicrotasks();
      expect(mockFetchWithCsrf).toHaveBeenCalledTimes(20);
      await advanceTimers(12000);
      await flushMicrotasks();
      expect(mockFetchWithCsrf).toHaveBeenCalledTimes(21);

      // Late reconciliation marks the order paid: the slow lane observes
      // it and completes without a manual refresh.
      mockFetchWithCsrf.mockResolvedValue({
        ok: true,
        json: async () => ({
          finalizationOutcome: 'completed',
          orderId: 'order-1',
          orderNumber: 'ORD-2001',
          status: 'success',
          success: true,
        }),
      });
      await advanceTimers(15000);
      await flushMicrotasks();

      expect(screen.getByText('#ORD-2001')).toBeInTheDocument();
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_completed',
        'order-1',
        expect.objectContaining({ payment_status: 'paid' })
      );
    } finally {
      useRouterSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('revalidates immediately when the shopper returns during a slow wait', async () => {
    vi.useFakeTimers();
    // Stable-router pin: production's useRouter is referentially stable,
    // so each render must not restart verification with a fresh pass.
    const useRouterSpy = vi
      .spyOn(nextNavigation, 'useRouter')
      .mockReturnValue({ push: mockPush } as never);
    try {
      mockFetchWithCsrf.mockResolvedValue({
        ok: true,
        json: async () => ({
          orderNumber: 'ORD-2001',
          status: 'pending',
          success: true,
        }),
      });

      render(<CheckoutSuccessPage />);
      await flushMicrotasks();
      // Reach the slow lane: the 20th pass arms the 15s timer, so 19 fast
      // advances get there.
      for (let i = 0; i < 19; i += 1) {
        await advanceTimers(3000);
        await flushMicrotasks();
      }
      const callsBeforeFocus = mockFetchWithCsrf.mock.calls.length;

      await act(async () => {
        window.dispatchEvent(new Event('focus'));
        await Promise.resolve();
      });
      await flushMicrotasks();

      // No timers advanced: the focus return ran the waiting pass now.
      expect(mockFetchWithCsrf.mock.calls.length).toBe(callsBeforeFocus + 1);
    } finally {
      useRouterSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
