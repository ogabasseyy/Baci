import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  head: vi.fn(),
  merchant: {
    id: 'merchant',
    slug: 'qa1',
    template_id: 'ogabassey',
  },
}));

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

import CheckoutPage, * as pageModule from './page';
import { ResolvedCheckoutPage } from './resolved-checkout-page';

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

beforeEach(() => {
  f.merchant = { id: 'merchant', slug: 'qa1', template_id: 'ogabassey' };
  f.head.mockReset();
  f.head.mockResolvedValue(null);
});

it('uses the existing checkout for merchants with a published experience', async () => {
  f.merchant.template_id = 'new-template';
  f.head.mockResolvedValue({ buildDigest: 'verified' });

  render(await ResolvedCheckoutPage(params('qa1')));

  expect(screen.getByText('Baci commerce checkout')).toBeVisible();
  expect(screen.queryByText('Legacy demo checkout')).toBeNull();
});

it('streams checkout selection inside the secure loading boundary', () => {
  const element = CheckoutPage(params('qa1'));

  expect(element.props.fallback.props.role).toBe('status');
  expect(element.props.children.type).toBe(ResolvedCheckoutPage);
});

it('exports only framework-recognized App Router page fields', () => {
  expect(Object.keys(pageModule).sort()).toEqual(['default', 'metadata']);
});
