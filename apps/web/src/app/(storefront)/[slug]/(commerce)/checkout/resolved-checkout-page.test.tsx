import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  head: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  merchant: {
    id: 'merchant',
    slug: 'qa1',
    template_id: 'new-template',
  } as { id: string; slug: string; template_id: string } | null,
}));

vi.mock('next/navigation', () => ({ notFound: f.notFound }));

vi.mock('@/lib/cached-data', () => ({
  getCachedMerchant: vi.fn(async () => f.merchant),
  getCachedMerchantByDomain: vi.fn(async () => f.merchant),
}));
vi.mock('@/lib/experience/published-manifest', () => ({
  loadPublishedExperience: f.head,
}));
vi.mock('@/components/checkout-theme-provider', () => ({
  CheckoutThemeProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/storefront/new-template', () => ({
  NewTemplateCheckoutPage: () => <p>Legacy demo checkout</p>,
}));
vi.mock('@/components/storefront/ogabassey/pages/checkout-page', () => ({
  CheckoutPage: () => <p>Baci commerce checkout</p>,
}));
vi.mock(
  '@/components/storefront/ogabassey/pages/checkout/components/CheckoutCartCapacityGate',
  () => ({
    CheckoutCartCapacityGate: ({
      children,
      cartHref,
    }: {
      children: ReactNode;
      cartHref?: string;
    }) => (
      <div data-testid="cart-capacity-gate" data-cart-href={cartHref}>
        {children}
      </div>
    ),
  })
);

import { ResolvedCheckoutPage } from './resolved-checkout-page';

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

beforeEach(() => {
  f.merchant = { id: 'merchant', slug: 'qa1', template_id: 'new-template' };
  f.head.mockReset();
  f.head.mockResolvedValue(null);
});

it('preserves capacity recovery for the legacy demo checkout', async () => {
  render(await ResolvedCheckoutPage(params('qa1')));

  expect(screen.getByTestId('cart-capacity-gate')).toHaveAttribute(
    'data-cart-href',
    '/qa1/cart'
  );
  expect(screen.getByText('Legacy demo checkout')).toBeVisible();
});

it('uses the root cart route for a domain storefront', async () => {
  render(await ResolvedCheckoutPage(params('shop.example.com')));

  expect(screen.getByTestId('cart-capacity-gate')).toHaveAttribute(
    'data-cart-href',
    '/cart'
  );
});

it('keeps the existing Baci checkout and its native resume behavior for an experience', async () => {
  f.head.mockResolvedValue({ buildDigest: 'verified' });

  render(await ResolvedCheckoutPage(params('qa1')));

  expect(screen.getByText('Baci commerce checkout')).toBeVisible();
  expect(screen.queryByTestId('cart-capacity-gate')).toBeNull();
});

it('falls back to Baci checkout for Ogabassey without a published experience', async () => {
  f.merchant = { id: 'merchant', slug: 'qa1', template_id: 'ogabassey' };

  render(await ResolvedCheckoutPage(params('qa1')));

  expect(f.head).toHaveBeenCalledOnce();
  expect(screen.getByText('Baci commerce checkout')).toBeVisible();
  expect(screen.queryByTestId('cart-capacity-gate')).toBeNull();
});

it('calls notFound when the merchant lookup has no match', async () => {
  f.merchant = null;

  await expect(ResolvedCheckoutPage(params('missing'))).rejects.toThrow(
    'NEXT_NOT_FOUND'
  );
  expect(f.notFound).toHaveBeenCalledOnce();
  expect(f.head).not.toHaveBeenCalled();
});

it.each([
  'new-template',
  'ogabassey',
])('keeps the native %s checkout when the published head is corrupt or mismatched', async (template) => {
  f.merchant = { id: 'merchant', slug: 'qa1', template_id: template };
  f.head.mockRejectedValue(Error('MERCHANT_MISMATCH'));
  render(await ResolvedCheckoutPage(params('qa1')));
  expect(
    screen.getByText(
      template === 'new-template'
        ? 'Legacy demo checkout'
        : 'Baci commerce checkout'
    )
  ).toBeVisible();
});
