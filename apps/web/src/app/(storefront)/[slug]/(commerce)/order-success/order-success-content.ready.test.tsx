import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderSuccessContent } from './order-success-content';

const mocks = vi.hoisted(() => ({
  state: { searchParams: new URLSearchParams(), isReady: true },
  fetch: vi.fn(),
}));

vi.mock('@/hooks/use-private-search-params', () => ({
  usePrivateSearchParamsState: () => mocks.state,
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/order-success' }));
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => ({
    basePath: '/test-store',
    merchant: { slug: 'test-store', country: 'NG' },
  }),
}));
vi.mock(
  '@/components/storefront/ogabassey/pages/checkout/hooks/use-storefront-customer-session',
  () => ({
    useStorefrontCustomerSession: () => ({
      status: 'guest',
      isAuthenticated: false,
      waitForResolvedAuthenticated: async () => false,
    }),
  })
);
vi.mock('@/components/analytics/google-customer-reviews', () => ({
  GoogleCustomerReviews: () => null,
}));
vi.mock('@/lib/posthog/capture-checkout-funnel-event', () => ({
  captureCheckoutFunnelEventOnce: vi.fn(),
}));

describe('bugfix: reloaded order link showed "order not found" before the stash was readable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetch.mockReturnValue(new Promise(() => undefined));
    global.fetch = mocks.fetch as unknown as typeof fetch;
  });

  it('shows the loading shell and sends no request while not ready, then looks the order up once', async () => {
    mocks.state = { searchParams: new URLSearchParams(), isReady: false };
    const { rerender } = render(<OrderSuccessContent />);

    expect(
      screen.getByRole('heading', { name: /finalizing your order/i })
    ).toBeInTheDocument();
    expect(mocks.fetch).not.toHaveBeenCalled();

    mocks.state = {
      searchParams: new URLSearchParams({
        orderId: 'order-1',
        trackingToken: 'tok',
      }),
      isReady: true,
    };
    rerender(<OrderSuccessContent />);

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    expect(String(mocks.fetch.mock.calls[0]?.[0])).toContain('order-1');
  });
});
