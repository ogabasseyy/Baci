import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MerchantData } from '@/hooks/merchant/types';

vi.mock('next/dynamic', () => ({
  default: () => {
    return function DynamicSlot() {
      return <section aria-label="dynamic slot" />;
    };
  },
}));

const mockUsePathname = vi.fn(() => '/ogabassey');
vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}));

vi.mock('./layout/navbar', () => ({
  OgabasseyNavbar: ({ storeSlug }: { storeSlug: string }) => (
    <nav aria-label="OgaBassey storefront">{storeSlug}</nav>
  ),
}));

vi.mock('./components/GoogleAdManager', () => ({
  GoogleAdManager: () => <aside aria-label="Google Ad Manager" />,
}));

vi.mock('./components/deferred-shell-feature', () => ({
  DeferredShellFeature: ({ fallback = null }: { fallback?: ReactNode }) => (
    <section aria-label="deferred shell">{fallback}</section>
  ),
}));

import { OgabasseyLayoutChrome } from './storefront-layout-chrome';

const merchantWithoutPublishableWarranty = {
  id: 'merchant-1',
  user_id: 'user-1',
  business_name: 'Ogabassey',
  business_type: 'electronics',
  template_id: 'ogabassey',
  trust_profile: {
    return_policy: { summary: 'Returns accepted within 7 days.' },
    shipping_policy: { summary: 'Ships nationwide.' },
    warranty_policy: {},
  },
} as MerchantData;

describe('OgabasseyLayoutChrome footer fallback reservation', () => {
  beforeEach(() => {
    mockUsePathname.mockReset();
    mockUsePathname.mockReturnValue('/ogabassey');
  });

  it('reserves the pre-footer ad slot before the semantic footer fallback so activation does not shift', () => {
    render(<OgabasseyLayoutChrome basePath="/ogabassey" section="footer" />);

    const adReserve = screen.getByTestId('footer-ad-fallback-reserve');
    const fallbackFooter = screen.getByRole('contentinfo', {
      name: /semantic storefront footer/i,
    });

    expect(adReserve).toHaveClass('min-h-[200px]', 'md:min-h-[350px]');
    expect(
      adReserve.compareDocumentPosition(fallbackFooter) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    // Matches the real `<Footer />` stacked height below the 200/350px ad box
    // (total = 1100px mobile / 910px md / 770px lg).
    expect(fallbackFooter).toHaveClass('min-h-[900px]');
    expect(fallbackFooter).toHaveClass('md:min-h-[560px]');
    expect(fallbackFooter).toHaveClass('lg:min-h-[420px]');
  });

  it('keeps immediate footer links root-relative for domain-routed storefronts', () => {
    render(<OgabasseyLayoutChrome basePath="" section="footer" />);

    expect(screen.getByRole('link', { name: /about us/i })).toHaveAttribute(
      'href',
      '/about'
    );
  });

  it('omits non-publishable warranty links from the immediate fallback footer', () => {
    render(
      <OgabasseyLayoutChrome
        basePath="/ogabassey"
        merchant={merchantWithoutPublishableWarranty}
        section="footer"
      />
    );

    expect(screen.getByRole('link', { name: /returns/i })).toHaveAttribute(
      'href',
      '/ogabassey/returns'
    );
    expect(screen.getByRole('link', { name: /shipping/i })).toHaveAttribute(
      'href',
      '/ogabassey/shipping'
    );
    expect(
      screen.queryByRole('link', { name: /warranty/i })
    ).not.toBeInTheDocument();
  });
});
