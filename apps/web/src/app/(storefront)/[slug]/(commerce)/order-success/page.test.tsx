import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
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

let mockUser: { id: string } | null = null;

vi.mock('@/contexts/auth-context', () => ({
  useAuthSafe: () => ({
    user: mockUser,
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
    mockUser = null;
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

  it('hands payforme requesters copyable instructions with no Bearer [REDACTED]', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-123',
        type: 'payforme',
        payerName: 'Alice',
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
        currency: 'NGN',
        items: [],
        subtotal: 3500,
        shipping_cost: 0,
        total: 3500,
        virtual_account: {
          account_name: 'Baci Checkout ORD-123',
          account_number: '9876543210',
          bank_name: 'Baci Bank',
        },
      }),
    });

    render(<OrderSuccessPage />);

    // Handoff contract: instructions (never a link) — the route must
    // never claim a delivery happened.
    expect(
      await screen.findByRole('heading', { name: /share the payment details/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/send the payment details below to alice/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/we've sent a payment link/i)).toBeNull();

    const handoff = (await screen.findByText(
      /payment details for alice/i
    )) as HTMLElement;
    const handoffRoot = handoff.closest('div') as HTMLElement;
    const handoffQueries = within(handoffRoot);
    expect(handoffQueries.getByText(/amount due/i)).toBeInTheDocument();
    expect(handoffQueries.getByText(/₦|NGN/)).toBeInTheDocument();
    expect(handoffQueries.getByText('Baci Bank')).toBeInTheDocument();
    expect(handoffQueries.getByText('9876543210')).toBeInTheDocument();
    // The tracking token is a full-PII bearer: it must appear nowhere
    // in the handoff — no link, no input, no copied text.
    expect(handoffQueries.queryByRole('link')).toBeNull();
    expect(handoffRoot.textContent).not.toContain('track-token-123');
    expect(handoffRoot.textContent).not.toContain('buyer@example.com');

    fireEvent.click(
      handoffQueries.getByRole('button', { name: /copy payment details/i })
    );
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = String(writeText.mock.calls[0][0]);
    expect(copied).toContain('ORD-123');
    expect(copied).toContain('9876543210');
    expect(copied).not.toContain('track-token-123');
    expect(copied).not.toContain('buyer@example.com');
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('withholds the naira account from foreign-currency payer details', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-123',
        type: 'payforme',
        payerName: 'Alice',
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
        currency: 'USD',
        items: [],
        subtotal: 3500,
        shipping_cost: 0,
        total: 3500,
        virtual_account: {
          account_name: 'Baci Checkout ORD-123',
          account_number: '9876543210',
          bank_name: 'Baci Bank',
        },
      }),
    });

    render(<OrderSuccessPage />);

    // Same NGN-only rule as the order email: a dollar-denominated
    // balance must not print the naira account beside it.
    expect(
      await screen.findByText(/payment details for alice/i)
    ).toBeInTheDocument();
    expect(screen.queryByText('9876543210')).toBeNull();
    expect(screen.queryByText('Baci Bank')).toBeNull();
    expect(
      screen.getByText(/your order email has the full transfer details/i)
    ).toBeInTheDocument();
  });

  it('asks the payer for the residual when wallet credit partially covers the order', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-123',
        type: 'payforme',
        payerName: 'Alice',
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
        currency: 'NGN',
        payment_status: 'unpaid',
        items: [],
        subtotal: 3500,
        shipping_cost: 0,
        total: 3500,
        amount_paid: 1500,
        virtual_account: {
          account_name: 'Baci Checkout ORD-123',
          account_number: '9876543210',
          bank_name: 'Baci Bank',
        },
      }),
    });

    render(<OrderSuccessPage />);

    // The server provisioned the DVA and email for the residual — the
    // handoff must ask for ₦2,000, never the full ₦3,500 again. (The
    // order summary still shows the full total; scope to the handoff.)
    const handoffLabel = await screen.findByText(/payment details for alice/i);
    const handoffRoot = handoffLabel.closest('div') as HTMLElement;
    const handoffQueries = within(handoffRoot);
    expect(handoffQueries.getByText(/₦2,000\.00/)).toBeInTheDocument();
    expect(handoffQueries.queryByText(/₦3,500\.00/)).toBeNull();

    fireEvent.click(
      screen.getByRole('button', { name: /copy payment details/i })
    );
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(String(writeText.mock.calls[0][0])).toContain('2,000');
  });

  it('suppresses the payer handoff once a payforme order is paid', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-123',
        type: 'payforme',
        payerName: 'Alice',
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
        currency: 'NGN',
        payment_status: 'paid',
        items: [],
        subtotal: 3500,
        shipping_cost: 0,
        total: 3500,
        amount_paid: 3500,
      }),
    });

    render(<OrderSuccessPage />);

    // A paid revisit renders the standard confirmation — no handoff, so
    // the details can never request the amount again after settlement.
    expect(
      await screen.findByRole('heading', { name: /order confirmed!/i })
    ).toBeInTheDocument();
    expect(screen.queryByText(/payment details for alice/i)).toBeNull();
    expect(
      screen.queryByRole('button', { name: /copy payment details/i })
    ).toBeNull();
  });

  it('shows guests the emailed invoice action instead of the archive link', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-123',
        type: 'invoice',
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
        payment_method: 'invoice',
        payment_status: 'unpaid',
      }),
    });

    render(<OrderSuccessPage />);

    // Anonymous: the /receipts archive would only bounce to login.
    // The email also renders in the order summary, so assert the full
    // action sentence to pin the address to the emailed action.
    expect(
      await screen.findByText(
        /proforma invoice pdf was sent to buyer@example\.com/i
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /download proforma invoice pdf/i })
    ).toBeNull();
  });

  it('keeps the archive download link for authenticated invoice orders', async () => {
    mockUser = { id: 'user-1' };
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-123',
        type: 'invoice',
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
        payment_method: 'invoice',
        payment_status: 'unpaid',
      }),
    });

    render(<OrderSuccessPage />);

    expect(
      await screen.findByRole('link', {
        name: /download proforma invoice pdf/i,
      })
    ).toHaveAttribute('href', '/test-store/receipts');
    expect(screen.queryByText(/was sent to/i)).toBeNull();
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

  it('observes a BNPL settlement that lands after the fast polling budget', async () => {
    vi.useFakeTimers();
    try {
      mockSearchParams.mockReturnValue(
        new URLSearchParams({
          orderId: 'order-123',
          reference: 'klump-ref-1',
          type: 'klump',
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
        payment_method: 'klump',
        payment_status: 'pending',
      };
      const paidOrder = { ...pendingOrder, payment_status: 'paid' };
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => pendingOrder })
        .mockResolvedValue({ ok: true, json: async () => pendingOrder });

      render(<OrderSuccessPage />);
      await flushMicrotasks();

      // Exhaust the 20 fast polls with the provider still pending: no
      // conversion, but polling must continue into the slow lane.
      for (let i = 0; i < 20; i += 1) {
        await advanceTimers(3000);
        await flushMicrotasks();
      }
      expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledTimes(21);

      // The webhook marks the order paid minutes later: the next slow
      // poll observes it and captures the deferred conversion.
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => paidOrder,
      });
      await advanceTimers(15000);
      await flushMicrotasks();

      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_completed',
        'order-123',
        expect.objectContaining({
          payment_method: 'klump',
          payment_status: 'paid',
          reference: 'klump-ref-1',
          total: 49875,
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('recovers the settlement lane after a hung lookup aborts', async () => {
    vi.useFakeTimers();
    try {
      mockSearchParams.mockReturnValue(
        new URLSearchParams({
          orderId: 'order-123',
          reference: 'klump-ref-1',
          type: 'klump',
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
        payment_method: 'klump',
        payment_status: 'pending',
      };
      const paidOrder = { ...pendingOrder, payment_status: 'paid' };
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => pendingOrder })
        .mockImplementationOnce(
          (_url: unknown, init?: { signal?: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => {
                reject(new DOMException('Aborted', 'AbortError'));
              });
            })
        )
        .mockResolvedValue({ ok: true, json: async () => paidOrder });

      render(<OrderSuccessPage />);
      await flushMicrotasks();

      // The first poll hangs; the 10s lookup timeout aborts it and the
      // lane schedules the next poll instead of stalling forever.
      await advanceTimers(3000);
      await flushMicrotasks();
      expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalled();
      await advanceTimers(10000);
      await flushMicrotasks();
      await advanceTimers(3000);
      await flushMicrotasks();

      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_completed',
        'order-123',
        expect.objectContaining({
          payment_method: 'klump',
          payment_status: 'paid',
          reference: 'klump-ref-1',
          total: 49875,
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('labels the deferred BNPL completion with the stamped order currency', async () => {
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
      // Order stamped USD while the merchant prices in NGN.
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
            currency: 'USD',
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
            currency: 'USD',
            payment_method: 'credpal',
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
        'order-123',
        expect.objectContaining({
          currency: 'USD',
          payment_method: 'credpal',
          payment_status: 'paid',
        })
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
    // Guests cannot reach the account archive (it redirects to login),
    // so the paid invoice order keeps an accurate email-only action: the
    // order confirmation email, not a claimed commercial-invoice PDF —
    // none is emailed on later gateway settlement.
    expect(
      screen.queryByRole('link', { name: /download commercial invoice pdf/i })
    ).toBeNull();
    expect(
      screen.getByText(
        /your order confirmation was sent to buyer@example\.com/i
      )
    ).toBeInTheDocument();
  });
});
