import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ orderId: 'order/with?reserved#characters' }),
}));
vi.mock('@/contexts/customer-auth-context', () => ({
  useCustomerAuth: () => ({
    customer: { id: 'customer' },
    isAuthenticated: true,
    isLoading: false,
  }),
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: () => ({
    merchant: { slug: 'shop' },
    loading: false,
    basePath: '/shop',
  }),
}));

import CustomerOrderDetailsClient from './customer-order-details-client';

afterEach(() => vi.unstubAllGlobals());
it('encodes the order ID as one path segment and uses storefront colors while loading', async () => {
  const fetcher = vi.fn(
    (_input: RequestInfo | URL) => new Promise<Response>(() => {})
  );
  vi.stubGlobal('fetch', fetcher);
  const { container } = render(<CustomerOrderDetailsClient />);
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  expect(fetcher.mock.calls[0][0]).toBe(
    '/api/storefront/account/orders/order%2Fwith%3Freserved%23characters?merchantSlug=shop'
  );
  expect(screen.getByLabelText('Loading order')).toBeInTheDocument();
  expect(container.firstElementChild).toHaveClass(
    'from-store-background',
    'to-store-secondary/20'
  );
});
