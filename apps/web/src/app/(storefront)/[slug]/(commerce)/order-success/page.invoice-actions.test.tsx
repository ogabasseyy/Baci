import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderSuccessContent as OrderSuccessPage } from './order-success-content';

const mockSearchParams = vi.fn();
const mockFetch = vi.fn();
let mockMerchant: { slug: string; country: string; payout_currency?: string } =
  { slug: 'test-store', country: 'NG' };
const mockGoogleCustomerReviews = vi.hoisted(() => vi.fn());
const mockCaptureCheckoutFunnelEventOnce = vi.hoisted(() => vi.fn());
// 04b: BNPL capture requires the paid verify verdict, not the paid row
// alone. Defaults to verified so the capture tests prove the
// verify-then-capture path; denial tests override per case.
const mockVerifyBnplSettlementProof = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => true)
);

const mockRouterPush = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush }),
  usePathname: () => '/order-success',
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

let mockCustomerSessionStatus: 'loading' | 'authenticated' | 'guest' = 'guest';

vi.mock(
  '@/components/storefront/ogabassey/pages/checkout/hooks/use-storefront-customer-session',
  () => ({
    useStorefrontCustomerSession: () => ({
      status: mockCustomerSessionStatus,
      isAuthenticated: mockCustomerSessionStatus === 'authenticated',
      waitForResolvedAuthenticated: async () =>
        mockCustomerSessionStatus === 'authenticated',
    }),
  })
);

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

vi.mock('./verify-bnpl-settlement-proof', () => ({
  verifyBnplSettlementProof: (...args: unknown[]) =>
    mockVerifyBnplSettlementProof(...args),
}));

describe('storefront order success page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCustomerSessionStatus = 'guest';
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
    // Delivery runs in after(), after this lookup: until the server
    // delivery flag lands, the action must promise preparation — never
    // a sent PDF that may not exist yet.
    expect(
      await screen.findByText(
        /proforma invoice pdf is being prepared — we'll email it to buyer@example\.com/i
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /download proforma invoice pdf/i })
    ).toBeNull();
  });

  it('suppresses invoice actions for cancelled orders', async () => {
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
        payment_status: 'cancelled',
      }),
    });

    render(<OrderSuccessPage />);

    // Terminal and non-payable: neither the proforma email action nor the
    // commercial download may render.
    expect(
      await screen.findByRole('heading', { name: /order confirmed!/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /download .* invoice pdf/i })
    ).toBeNull();
    expect(screen.queryByText(/was sent to/i)).toBeNull();
    expect(screen.queryByText(/being prepared/i)).toBeNull();
  });

  it('shows guests the sent invoice action once delivery lands', async () => {
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
        notification_delivered: true,
      }),
    });

    render(<OrderSuccessPage />);

    expect(
      await screen.findByText(
        /proforma invoice pdf was sent to buyer@example\.com/i
      )
    ).toBeInTheDocument();
  });

  it('renders no invoice action while the customer session resolves', async () => {
    mockCustomerSessionStatus = 'loading';
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

    // Neither the download link nor the guest email notice may flash for
    // the wrong audience while auth is unresolved.
    await screen.findByText(/fetching your order summary/i);
    expect(
      screen.queryByRole('link', { name: /download proforma invoice pdf/i })
    ).toBeNull();
    expect(screen.queryByText(/was sent to/i)).toBeNull();
  });

  it('keeps the archive download link for authenticated invoice orders', async () => {
    mockCustomerSessionStatus = 'authenticated';
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
});
