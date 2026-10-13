import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECKOUT_PENDING_ORDER_STORAGE_KEY } from '@/components/storefront/ogabassey/pages/checkout/pending-checkout-order';
import CheckoutSuccessPage from './page';

const mocks = vi.hoisted(() => ({
  clearCart: vi.fn(),
  router: { push: vi.fn() },
  fetch: vi.fn(),
  verify: vi.fn(),
  params: new URLSearchParams(),
  merchant: { basePath: '/ogabassey', merchant: { slug: 'ogabassey' } },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.params,
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
  motion: { div: 'div', h1: 'h1', p: 'p' },
}));

vi.mock('@/hooks/cart', () => ({
  useCart: () => ({ clearCart: mocks.clearCart }),
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => mocks.merchant,
}));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.verify }));
vi.mock('@/components/storefront/ogabassey/components/AdUnit', () => ({
  AdUnit: () => null,
}));

describe('actual REDVAULT checkout callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
    sessionStorage.clear();
    sessionStorage.setItem(
      CHECKOUT_PENDING_ORDER_STORAGE_KEY,
      'retained-order'
    );
  });

  it('retains the cart and pending order on a reference callback with a 202 held capture', async () => {
    mocks.params = new URLSearchParams({ reference: 'redvault-reference' });
    mocks.verify.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            code: 'REDVAULT_CAPTURE_HELD',
            status: 'pending',
            orderNumber: 'RV-HELD',
          }),
          { status: 202 }
        )
    );

    const { rerender } = render(
      <React.StrictMode>
        <CheckoutSuccessPage />
      </React.StrictMode>
    );

    expect(await screen.findByText('#RV-HELD')).toBeInTheDocument();
    expect(mocks.verify).toHaveBeenCalledTimes(2);
    const heldOrder = screen.getByText('#RV-HELD');
    rerender(
      <React.StrictMode>
        <CheckoutSuccessPage />
      </React.StrictMode>
    );
    expect(heldOrder).toBeInTheDocument();
    expect(mocks.verify).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole('heading', { name: /order being processed/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /order received/i })
    ).toBeNull();
    expect(mocks.clearCart).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(CHECKOUT_PENDING_ORDER_STORAGE_KEY)).toBe(
      'retained-order'
    );
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(mocks.verify).toHaveBeenCalledWith(
      '/api/payments/verify',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reference: 'redvault-reference' }),
      })
    );
  });

  it.each([
    'unpaid',
    'pending',
    'failed',
    undefined,
  ])('does not confirm an orderId-only REDVAULT order with payment status %s', async (paymentStatus) => {
    mocks.params = new URLSearchParams({ orderId: 'redvault-order' });
    mocks.fetch.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            order_number: 'RV-UNPAID',
            payment_method: 'uba_redvault',
            payment_status: paymentStatus,
          })
        )
    );

    render(<CheckoutSuccessPage />);

    expect(await screen.findByText('#RV-UNPAID')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /order being processed/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /order received/i })
    ).toBeNull();
    expect(mocks.clearCart).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(CHECKOUT_PENDING_ORDER_STORAGE_KEY)).toBe(
      'retained-order'
    );
    expect(mocks.router.push).not.toHaveBeenCalled();
  });
});
