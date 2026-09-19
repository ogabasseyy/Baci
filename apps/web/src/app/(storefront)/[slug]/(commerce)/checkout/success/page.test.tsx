import { act, render, screen, waitFor } from '@testing-library/react';
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

    await waitFor(() => expect(mockClearCart).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText(/ORD-2001/i)).toBeInTheDocument()
    );
    expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalled();
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
        expect.objectContaining({ total: 21500 })
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
        expect.objectContaining({ total: 470000 })
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
        order_number: 'ORD-1001',
        payment_method: 'invoice',
      }),
    });

    render(<CheckoutSuccessPage />);

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/storefront/orders/order-123?merchant_slug=test-store&tracking_token=track-token-123'
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
      expect(mockFetch).toHaveBeenCalledWith('/api/storefront/orders/order-123')
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

    expect(
      await screen.findByRole('heading', { name: /order received/i })
    ).toBeInTheDocument();
    expect(mockClearCart).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText('#ABCDEFGH')).toBeInTheDocument()
    );
  });
});
