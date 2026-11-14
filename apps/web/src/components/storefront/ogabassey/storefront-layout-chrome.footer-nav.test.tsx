import { render, screen } from '@testing-library/react';
import type { MerchantData } from '@/hooks/merchant/types';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/dynamic', () => ({
  default: () => {
    return function DynamicSlot() {
      return <section aria-label="dynamic slot" />;
    };
  },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/ogabassey',
}));

vi.mock('./layout/navbar', () => ({
  OgabasseyNavbar: ({ storeSlug }: { storeSlug: string }) => (
    <nav aria-label="OgaBassey storefront">{storeSlug}</nav>
  ),
}));

vi.mock('./components/AdUnit', () => ({
  AdUnit: ({ placementKey }: { placementKey: string }) => (
    <aside aria-label={placementKey}>{placementKey}</aside>
  ),
}));

vi.mock('./components/deferred-shell-feature', () => ({
  DeferredShellFeature: ({
    children,
    fallback = null,
  }: {
    children: ReactNode;
    fallback?: ReactNode;
  }) => (
    <section aria-label="deferred shell">{fallback}</section>
  ),
}));

vi.mock('./components/GoogleAdManager', () => ({
  GoogleAdManager: () => (
    <aside aria-label="Google Ad Manager" />
  ),
}));

vi.mock('./components/Footer', () => {
  throw new Error('Full Footer must stay out of storefront-layout-chrome');
});

vi.mock('./components/chat/DeferredChatWidget', () => ({
  DeferredChatWidget: () => <aside aria-label="chat widget" />,
}));

vi.mock('./storefront-deferred-footer-chrome', () => ({
  StorefrontDeferredFooterChrome: ({
    basePath,
  }: {
    basePath: string;
  }) => (
    <section aria-label="deferred footer commerce">
      <footer aria-label="Full storefront footer">
        <a href={`${basePath}/about`}>About Us</a>
      </footer>
    </section>
  ),
}));

vi.mock('./storefront-deferred-overlay-chrome', () => ({
  StorefrontDeferredOverlayChrome: () => (
    <section aria-label="deferred overlay chrome" />
  ),
}));

import { OgabasseyLayoutChrome } from './storefront-layout-chrome';

const merchantWithPublishablePolicies = {
  id: 'merchant-1',
  user_id: 'user-1',
  business_name: 'Ogabassey',
  business_type: 'electronics',
  template_id: 'ogabassey',
  trust_profile: {
    return_policy: { summary: 'Returns accepted within 7 days.' },
    shipping_policy: { summary: 'Ships nationwide.' },
    warranty_policy: { summary: 'Warranty applies to eligible devices.' },
  },
} as unknown as MerchantData;

describe('OgabasseyLayoutChrome - Footer and Mobile Nav Removal', () => {
  it('renders lightweight semantic footer links immediately without a fixed mobile bottom nav while deferring full footer commerce widgets', () => {
    render(
      <OgabasseyLayoutChrome
        basePath="/ogabassey"
        merchant={merchantWithPublishablePolicies}
        section="footer"
      />
    );

    expect(
      screen.queryByRole('navigation', { name: /mobile footer/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('contentinfo', {
        name: /semantic storefront footer/i,
      })
    ).toContainElement(screen.getByRole('link', { name: /about us/i }));
    expect(screen.getByRole('link', { name: /all products/i })).toHaveAttribute(
      'href',
      '/ogabassey/products'
    );
    expect(
      screen.getByRole('link', { name: /swap \/ trade-in/i })
    ).toHaveAttribute('href', '/ogabassey/swap');
    expect(screen.getByRole('link', { name: /imei checker/i })).toHaveAttribute(
      'href',
      '/ogabassey/imei-check'
    );
    expect(screen.getByRole('link', { name: /repairs/i })).toHaveAttribute(
      'href',
      '/ogabassey/repairs'
    );
    expect(screen.getByRole('link', { name: /returns/i })).toHaveAttribute(
      'href',
      '/ogabassey/returns'
    );
    expect(screen.getByRole('link', { name: /shipping/i })).toHaveAttribute(
      'href',
      '/ogabassey/shipping'
    );
    expect(screen.getByRole('link', { name: /warranty/i })).toHaveAttribute(
      'href',
      '/ogabassey/warranty'
    );
    expect(
      screen.queryByRole('contentinfo', { name: /full storefront footer/i })
    ).not.toBeInTheDocument();
  });
});
