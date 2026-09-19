import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OrderSuccessPage from '@/app/(storefront)/[slug]/(commerce)/order-success/page';

const mockSearchParams = vi.fn();
const mockFetch = vi.fn();
let mockMerchant = { slug: 'test-store', country: 'NG' };
const mockGoogleCustomerReviews = vi.hoisted(() => vi.fn());

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
  });
});
