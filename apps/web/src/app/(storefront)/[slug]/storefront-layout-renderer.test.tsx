import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { MerchantData } from '@/hooks/merchant/types';
import { StorefrontLayoutRenderer } from './storefront-layout-renderer';

const mockOgabasseyLayout = vi.hoisted(() =>
  vi.fn(({ children }: { children: ReactNode }) => (
    <div data-testid="ogabassey-layout">{children}</div>
  ))
);

vi.mock('@/components/storefront/ogabassey/storefront-layout', () => ({
  OgabasseyStorefrontLayout: mockOgabasseyLayout,
}));

const ogabasseyMerchant = {
  id: 'merchant-1',
  slug: 'ogabassey',
  template_id: 'ogabassey',
} as MerchantData;

const genericMerchant = {
  id: 'merchant-2',
  slug: 'another-shop',
  template_id: 'modern',
} as MerchantData;

describe('StorefrontLayoutRenderer', () => {
  it('wraps OgaBassey tenants in the persistent storefront layout', () => {
    render(
      <StorefrontLayoutRenderer
        merchant={ogabasseyMerchant}
        preloadHeroLcpImages={false}
        routingMode="domain"
      >
        <main>Home</main>
      </StorefrontLayoutRenderer>
    );

    expect(screen.getByTestId('ogabassey-layout')).toHaveTextContent('Home');
    expect(mockOgabasseyLayout.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        preloadHeroLcpImages: false,
        routingMode: 'domain',
      })
    );
  });

  it('skips the OgaBassey chrome for other templates', () => {
    mockOgabasseyLayout.mockClear();

    render(
      <StorefrontLayoutRenderer
        merchant={genericMerchant}
        preloadHeroLcpImages={false}
        routingMode="path"
      >
        <main>Generic home</main>
      </StorefrontLayoutRenderer>
    );

    expect(screen.getByRole('main')).toHaveTextContent('Generic home');
    expect(screen.queryByTestId('ogabassey-layout')).not.toBeInTheDocument();
    expect(mockOgabasseyLayout).not.toHaveBeenCalled();
  });
});
