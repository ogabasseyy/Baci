import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { TermsPageClient } from './terms-page-client';

const { useMerchantSafe } = vi.hoisted(() => ({ useMerchantSafe: vi.fn() }));
vi.mock('@/hooks/use-merchant-client', () => ({ useMerchantSafe }));
vi.mock('@/components/storefront/header', () => ({
  StorefrontHeader: () => null,
}));
vi.mock('@/components/storefront/footer', () => ({
  StorefrontFooter: () => null,
}));
vi.mock('../content-page-providers', () => ({
  ContentPageProviders: ({ children }: { children: React.ReactNode }) =>
    children,
}));

it.each([
  '/ogabassey',
  '',
])('resolves policy links for storefront base %j', (basePath) => {
  useMerchantSafe.mockReturnValue({ basePath });
  render(
    <TermsPageClient
      merchant={{ id: 'store', slug: 'ogabassey', business_name: 'Ogabassey' }}
    />
  );
  expect(screen.getByRole('link', { name: 'return policy' })).toHaveAttribute(
    'href',
    `${basePath}/returns`
  );
  expect(screen.getByRole('link', { name: 'warranty page' })).toHaveAttribute(
    'href',
    `${basePath}/warranty`
  );
});
