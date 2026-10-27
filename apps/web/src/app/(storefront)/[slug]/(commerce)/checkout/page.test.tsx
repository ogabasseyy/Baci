import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { getCachedMerchant } from '@/lib/cached-data';
import CheckoutPage from './page';

const pending = new Promise<never>(() => {});
const state = vi.hoisted(() => ({ suspend: false }));
vi.mock('@/lib/cached-data', () => ({
  getCachedMerchant: vi.fn(),
  getCachedMerchantByDomain: vi.fn(),
}));
vi.mock('@/components/checkout-theme-provider', () => ({
  CheckoutThemeProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/storefront/new-template', () => ({
  NewTemplateCheckoutPage: () => <p>New checkout</p>,
}));
vi.mock('@/components/storefront/ogabassey/pages/checkout-page', () => ({
  CheckoutPage: () => {
    if (state.suspend) throw pending;
    return <p>Guest checkout</p>;
  },
}));
vi.mock(
  '@/components/storefront/ogabassey/pages/checkout/components/CheckoutCartCapacityGate',
  () => ({
    CheckoutCartCapacityGate: ({ children }: { children: ReactNode }) =>
      children,
  })
);
beforeEach(() => {
  state.suspend = false;
  vi.mocked(getCachedMerchant).mockResolvedValue({
    id: 'merchant',
    template_id: 'ogabassey',
  } as Awaited<ReturnType<typeof getCachedMerchant>>);
});
it('renders the guest checkout for the resolved merchant', async () => {
  render(await CheckoutPage({ params: Promise.resolve({ slug: 'shop' }) }));
  expect(screen.getByText('Guest checkout')).toBeVisible();
});
it('keeps query-driven checkout suspension inside an explicit loading boundary', async () => {
  state.suspend = true;
  render(await CheckoutPage({ params: Promise.resolve({ slug: 'shop' }) }));
  expect(screen.getByRole('status')).toHaveTextContent('Loading checkout');
});
