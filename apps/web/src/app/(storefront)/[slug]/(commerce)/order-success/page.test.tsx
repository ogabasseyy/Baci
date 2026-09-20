import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OrderSuccessPage from '@/app/(storefront)/[slug]/(commerce)/order-success/page';

const mockSearchParams = vi.fn();
const mockFetch = vi.fn();
let mockMerchant = { slug: 'test-store', country: 'NG' };
const mockGoogleCustomerReviews = vi.hoisted(() => vi.fn());
const mockCaptureCheckoutFunnelEventOnce = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
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

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => ({
    basePath: '/test-store',
    merchant: mockMerchant,
  }),
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuthSafe: () => ({
    user: null,
  }),
}));

vi.mock('@/components/analytics/google-customer-reviews', () => ({
  GoogleCustomerReviews: (props: unknown) => {
    mockGoogleCustomerReviews(props);
    return null;
  },
}));

vi.mock('@/lib/posthog/capture-checkout-funnel-event', () => ({
  captureCheckoutFunnelEventOnce: (...args: unknown[]) =>
    mockCaptureCheckoutFunnelEventOnce(...args),
}));

describe('storefront order success page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-123',
        trackingToken: 'track-token-123',
      })
    );
    mockMerchant = { slug: 'test-store', country: 'NG' };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'order-123',
        order_number: 'ORD-123',
        tracking_token: 'track-token-123',
        customer_email: 'buyer@example.com',
        items: [{ id: 'item-1', gtin: ' 0123456789012 ', quantity: 1 }],
        subtotal: 3500,
        shipping_cost: 0,
        total: 3500,
      }),
    });
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it('shows a neutral shell while order details are still loading', () => {
    mockFetch.mockReturnValue(new Promise(() => undefined));

    render(<OrderSuccessPage />);

    expect(
      screen.getByRole('heading', { name: /finalizing your order/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /order confirmed!/i })
    ).toBeNull();
    expect(
      screen.getByText(/fetching your order summary/i)
    ).toBeInTheDocument();
  });

  it('shows a recovery state when the order id is missing', () => {
    mockSearchParams.mockReturnValue(new URLSearchParams());

    render(<OrderSuccessPage />);

    expect(
      screen.getByRole('heading', {
        name: /we could not confirm this order yet/i,
      })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /order confirmed!/i })
    ).toBeNull();
    expect(
      screen.getByRole('link', { name: /return to checkout/i })
    ).toHaveAttribute('href', '/test-store/checkout');
  });

  it('uses trackingToken to fetch guest order details', async () => {
    render(<OrderSuccessPage />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/storefront/orders/order-123?merchant_slug=test-store&token=track-token-123'
      );
    });

    expect(
      await screen.findByRole('link', { name: /track my order/i })
    ).toHaveAttribute('href', '/test-store/track-order?token=track-token-123');
    expect(mockGoogleCustomerReviews).toHaveBeenCalledWith(
      expect.objectContaining({
        country: 'NG',
        products: [{ gtin: '0123456789012' }],
      })
    );
  });

  it('keeps supporting legacy token query params', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-123',
        token: 'legacy-token-123',
      })
    );

    render(<OrderSuccessPage />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/storefront/orders/order-123?merchant_slug=test-store&token=legacy-token-123'
      );
    });
  });

  it('falls back to the email param when no tracking token is present', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-123',
        email: 'buyer@example.com',
      })
    );

    render(<OrderSuccessPage />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/storefront/orders/order-123?merchant_slug=test-store&email=buyer%40example.com'
      );
    });
  });

  it('formats the order total with the merchant country currency', async () => {
    mockMerchant = { slug: 'test-store', country: 'IN' };

    render(<OrderSuccessPage />);

    expect(await screen.findByText(/₹|INR/)).toBeInTheDocument();
    expect(screen.queryByText(/₦/)).not.toBeInTheDocument();
    expect(mockGoogleCustomerReviews).toHaveBeenCalledWith(
      expect.objectContaining({ country: 'IN' })
    );
  });

  it('renders invoice specific heading and description when type is invoice', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-123',
        type: 'invoice',
      })
    );

    render(<OrderSuccessPage />);

    expect(
      await screen.findByRole('heading', { name: /proforma invoice ready!/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /we have prepared your proforma invoice and sent it to your email/i
      )
    ).toBeInTheDocument();
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

  it('captures the pending-to-paid CredPal transition', async () => {
    vi.useFakeTimers();
    try {
      mockSearchParams.mockReturnValue(
        new URLSearchParams({
          orderId: 'order-123',
          reference: 'credpal-ref-1',
          type: 'credpal',
          credpalStatus: 'pending',
          trackingToken: 'track-token-123',
        })
      );
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'order-123',
            order_number: 'ORD-123',
            tracking_token: 'track-token-123',
            customer_email: 'buyer@example.com',
            items: [],
            subtotal: 45000,
            shipping_cost: 1500,
            total: 49875,
            payment_method: 'credpal',
            payment_status: 'pending',
          }),
        })
        .mockResolvedValue({
          ok: true,
          json: async () => ({
            id: 'order-123',
            order_number: 'ORD-123',
            tracking_token: 'track-token-123',
            customer_email: 'buyer@example.com',
            items: [],
            subtotal: 45000,
            shipping_cost: 1500,
            total: 49875,
            payment_method: 'credpal',
            payment_status: 'paid',
          }),
        });

      render(<OrderSuccessPage />);
      await flushMicrotasks();

      // Still pending after the first read: no conversion yet.
      expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalled();

      // The settlement poll observes the webhook-paid order.
      await advanceTimers(3000);
      await flushMicrotasks();

      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_completed',
        'order-123',
        expect.objectContaining({
          payment_method: 'credpal',
          payment_status: 'paid',
          reference: 'credpal-ref-1',
          total: 49875,
        })
      );
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/storefront/orders/order-123?merchant_slug=test-store&token=track-token-123'
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('captures the pending-to-paid Klump transition', async () => {
    vi.useFakeTimers();
    try {
      mockSearchParams.mockReturnValue(
        new URLSearchParams({
          orderId: 'order-1',
          reference: 'BAC-ABCD12345678',
          type: 'klump',
          trackingToken: 'tok-123',
        })
      );
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'order-1',
            order_number: 'ORD-1',
            tracking_token: 'tok-123',
            customer_email: 'buyer@example.com',
            items: [],
            subtotal: 20000,
            shipping_cost: 0,
            total: 20000,
            payment_method: 'klump',
            payment_status: 'pending',
          }),
        })
        .mockResolvedValue({
          ok: true,
          json: async () => ({
            id: 'order-1',
            order_number: 'ORD-1',
            tracking_token: 'tok-123',
            customer_email: 'buyer@example.com',
            items: [],
            subtotal: 20000,
            shipping_cost: 0,
            total: 20000,
            payment_method: 'klump',
            payment_status: 'paid',
          }),
        });

      render(<OrderSuccessPage />);
      await flushMicrotasks();

      expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalled();

      await advanceTimers(3000);
      await flushMicrotasks();

      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_completed',
        'order-1',
        expect.objectContaining({
          payment_method: 'klump',
          payment_status: 'paid',
          reference: 'BAC-ABCD12345678',
          total: 20000,
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('serializes settlement polls and never applies stale pending over paid', async () => {
    vi.useFakeTimers();
    try {
      mockSearchParams.mockReturnValue(
        new URLSearchParams({
          orderId: 'order-123',
          reference: 'credpal-ref-1',
          type: 'credpal',
          credpalStatus: 'pending',
          trackingToken: 'track-token-123',
        })
      );
      const pendingOrder = {
        id: 'order-123',
        order_number: 'ORD-123',
        tracking_token: 'track-token-123',
        customer_email: 'buyer@example.com',
        items: [],
        subtotal: 45000,
        shipping_cost: 1500,
        total: 49875,
        payment_method: 'credpal',
        payment_status: 'pending',
      };
      const paidOrder = { ...pendingOrder, payment_status: 'paid' };
      let releaseFirstPoll!: (value: unknown) => void;
      const firstPollGate = new Promise((resolve) => {
        releaseFirstPoll = resolve as (value: unknown) => void;
      });
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => pendingOrder,
        })
        .mockImplementationOnce(() =>
          firstPollGate.then(() => ({
            ok: true,
            json: async () => pendingOrder,
          }))
        )
        .mockResolvedValue({
          ok: true,
          json: async () => paidOrder,
        });

      render(<OrderSuccessPage />);
      await flushMicrotasks();
      expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalled();

      // First poll starts on schedule…
      await advanceTimers(3000);
      await flushMicrotasks();
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // …but while it is still in flight, later intervals must not
      // start concurrent polls (each would resolve pending and could
      // overwrite the paid order observed next).
      await advanceTimers(6000);
      await flushMicrotasks();
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // The slow poll settles pending; only then does the next poll
      // start and observe the paid order.
      releaseFirstPoll(undefined);
      await flushMicrotasks();
      await advanceTimers(3000);
      await flushMicrotasks();

      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_completed',
        'order-123',
        expect.objectContaining({
          payment_method: 'credpal',
          payment_status: 'paid',
          total: 49875,
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not capture a stale paid order under a navigated order id', async () => {
    vi.useFakeTimers();
    try {
      const paidOrderA = {
        id: 'order-A',
        order_number: 'ORD-A',
        tracking_token: 'track-A',
        customer_email: 'buyer@example.com',
        items: [],
        subtotal: 1000,
        shipping_cost: 0,
        total: 1000,
        payment_method: 'credpal',
        payment_status: 'paid',
      };
      const paidOrderB = {
        ...paidOrderA,
        id: 'order-B',
        order_number: 'ORD-B',
        tracking_token: 'track-B',
        total: 2000,
      };
      let releaseB!: (value: unknown) => void;
      const gateB = new Promise((resolve) => {
        releaseB = resolve as (value: unknown) => void;
      });
      mockSearchParams.mockReturnValue(
        new URLSearchParams({
          orderId: 'order-A',
          reference: 'ref-A',
          type: 'credpal',
          trackingToken: 'track-A',
        })
      );
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => paidOrderA,
        })
        .mockImplementationOnce(() =>
          gateB.then(() => ({
            ok: true,
            json: async () => paidOrderB,
          }))
        )
        .mockResolvedValue({
          ok: true,
          json: async () => paidOrderB,
        });

      const { rerender } = render(<OrderSuccessPage />);
      await flushMicrotasks();
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_completed',
        'order-A',
        expect.objectContaining({ order_number: 'ORD-A' })
      );

      // Same-route navigation to B while B's lookup is still in flight:
      // `order` still holds paid A, which must not be captured under B
      // (misattribution, and the once-guard would then suppress B's own
      // correct capture).
      mockSearchParams.mockReturnValue(
        new URLSearchParams({
          orderId: 'order-B',
          reference: 'ref-B',
          type: 'credpal',
          trackingToken: 'track-B',
        })
      );
      rerender(<OrderSuccessPage />);
      await flushMicrotasks();
      expect(
        mockCaptureCheckoutFunnelEventOnce.mock.calls.filter(
          (call) => call[1] === 'order-B'
        )
      ).toHaveLength(0);

      // Once B's own lookup resolves paid, exactly one correct capture
      // fires with B's details.
      releaseB(undefined);
      await flushMicrotasks();
      const callsForB = mockCaptureCheckoutFunnelEventOnce.mock.calls.filter(
        (call) => call[1] === 'order-B'
      );
      expect(callsForB).toHaveLength(1);
      expect(callsForB[0][2]).toEqual(
        expect.objectContaining({ order_number: 'ORD-B', total: 2000 })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('captures the CredPal reference from the credpalRef query key', async () => {
    vi.useFakeTimers();
    try {
      // The standard CredPal pending redirect carries the provider
      // transaction as credpalRef, not reference.
      mockSearchParams.mockReturnValue(
        new URLSearchParams({
          orderId: 'order-123',
          type: 'credpal',
          credpalRef: 'CP-99',
          credpalStatus: 'pending',
          trackingToken: 'track-token-123',
        })
      );
      const pendingOrder = {
        id: 'order-123',
        order_number: 'ORD-123',
        tracking_token: 'track-token-123',
        customer_email: 'buyer@example.com',
        items: [],
        subtotal: 45000,
        shipping_cost: 1500,
        total: 49875,
        payment_method: 'credpal',
        payment_status: 'pending',
      };
      const paidOrder = { ...pendingOrder, payment_status: 'paid' };
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => pendingOrder,
        })
        .mockResolvedValue({
          ok: true,
          json: async () => paidOrder,
        });

      render(<OrderSuccessPage />);
      await flushMicrotasks();
      await advanceTimers(3000);
      await flushMicrotasks();
      await advanceTimers(3000);
      await flushMicrotasks();

      // The deferred conversion must reconcile to the provider
      // transaction, not emit without a reference.
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_completed',
        'order-123',
        expect.objectContaining({
          payment_method: 'credpal',
          payment_status: 'paid',
          reference: 'CP-99',
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not capture while a BNPL approval is still pending', async () => {
    vi.useFakeTimers();
    try {
      mockSearchParams.mockReturnValue(
        new URLSearchParams({
          orderId: 'order-123',
          reference: 'credpal-ref-1',
          type: 'credpal',
          credpalStatus: 'pending',
          trackingToken: 'track-token-123',
        })
      );
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'order-123',
          order_number: 'ORD-123',
          tracking_token: 'track-token-123',
          customer_email: 'buyer@example.com',
          items: [],
          subtotal: 45000,
          shipping_cost: 1500,
          total: 49875,
          payment_method: 'credpal',
          payment_status: 'pending',
        }),
      });

      render(<OrderSuccessPage />);
      await flushMicrotasks();
      await advanceTimers(3000);
      await flushMicrotasks();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders commercial copy for a paid invoice-method order', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-123',
        type: 'invoice',
      })
    );
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'order-123',
        order_number: 'ORD-123',
        tracking_token: 'track-token-123',
        customer_email: 'buyer@example.com',
        items: [],
        subtotal: 3500,
        shipping_cost: 0,
        total: 3500,
        payment_method: 'invoice',
        payment_status: 'paid',
      }),
    });

    render(<OrderSuccessPage />);

    expect(
      await screen.findByRole('heading', { name: /order confirmed!/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /download proforma invoice pdf/i })
    ).toBeNull();
    // The paid invoice order keeps a document action, now rendered as
    // the commercial (380) invoice rather than disappearing entirely.
    expect(
      screen.getByRole('link', { name: /download commercial invoice pdf/i })
    ).toBeInTheDocument();
  });
});
