import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ merchant: vi.fn(), domain: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found');
  },
}));
vi.mock('@/lib/cached-data', () => ({
  getCachedMerchant: mocks.merchant,
  getCachedMerchantByDomain: mocks.domain,
}));
vi.mock('@/components/checkout-theme-provider', () => ({
  CheckoutThemeProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock('@/components/payments/oxygen/OxygenOrderConfirmationRedirect', () => ({
  OxygenOrderConfirmationRedirect: ({
    children,
    orderId,
  }: {
    children: ReactNode;
    orderId: string;
  }) => <section aria-label={`confirmation ${orderId}`}>{children}</section>,
}));
vi.mock('@/components/payments/oxygen/OxygenStorefrontCheckout', () => ({
  OxygenStorefrontCheckout: ({ merchantId }: { merchantId: string }) => (
    <p>Oxygen checkout for {merchantId}</p>
  ),
}));
vi.mock('@/components/storefront/new-template', () => ({
  NewTemplateCheckoutPage: () => <p>New checkout</p>,
}));
vi.mock(
  '@/components/storefront/ogabassey/pages/checkout/components/CheckoutCartCapacityGate',
  () => ({
    CheckoutCartCapacityGate: ({
      children,
      cartHref,
    }: {
      children: ReactNode;
      cartHref: string;
    }) => <section aria-label={`cart ${cartHref}`}>{children}</section>,
  })
);
vi.mock('@/components/storefront/ogabassey/pages/checkout-page', () => ({
  CheckoutPage: () => <p>Default checkout</p>,
}));

import { CheckoutContent } from './checkout-content';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.merchant.mockResolvedValue({ id: 'merchant-1', slug: 'shop' });
  mocks.domain.mockResolvedValue({
    id: 'merchant-2',
    slug: 'shop',
    template_id: 'new-template',
  });
});
it('renders the owned Oxygen checkout only for a valid order identifier', async () => {
  const id = '60000000-0000-4000-8000-000000000001';
  render(
    await CheckoutContent({
      params: Promise.resolve({ slug: 'shop' }),
      searchParams: Promise.resolve({ oxygenOrderId: id }),
    })
  );
  expect(
    screen.getByRole('region', { name: `confirmation ${id}` })
  ).toHaveTextContent('Oxygen checkout for merchant-1');
  await expect(
    CheckoutContent({
      params: Promise.resolve({ slug: 'shop' }),
      searchParams: Promise.resolve({ oxygenOrderId: 'invalid' }),
    })
  ).rejects.toThrow('not found');
});
it('uses the custom-domain merchant and domain-relative cart for the new template', async () => {
  render(
    await CheckoutContent({
      params: Promise.resolve({ slug: 'shop.example.com' }),
    })
  );
  expect(mocks.domain).toHaveBeenCalledWith('shop.example.com');
  expect(screen.getByRole('region', { name: 'cart /cart' })).toHaveTextContent(
    'New checkout'
  );
});
it('rejects unknown merchants and otherwise renders the default checkout', async () => {
  render(await CheckoutContent({ params: Promise.resolve({ slug: 'shop' }) }));
  expect(screen.getByText('Default checkout')).toBeInTheDocument();
  mocks.merchant.mockResolvedValue(null);
  await expect(
    CheckoutContent({ params: Promise.resolve({ slug: 'missing' }) })
  ).rejects.toThrow('not found');
});
