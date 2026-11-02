import { render, screen } from '@testing-library/react';
import type { MerchantData } from '@/hooks/merchant/types';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/dynamic', () => ({
  default: () => {
    return function DynamicSlot() {
      return <section aria-label="dynamic slot" />;
    };
  },
}));

const mockUsePathname = vi.fn(() => '/ogabassey');
let deferredShellActive = false;
vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
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
    deferInteractionActivationUntilNextPaint,
    timeoutMs,
  }: {
    children: ReactNode;
    fallback?: ReactNode;
    deferInteractionActivationUntilNextPaint?: boolean;
    timeoutMs?: number;
  }) => (
    <section
      data-defer-interaction-until-next-paint={String(
        Boolean(deferInteractionActivationUntilNextPaint)
      )}
      data-timeout-ms={String(timeoutMs ?? '')}
      aria-label="deferred shell"
    >
      {deferredShellActive ? children : fallback}
    </section>
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
      <aside aria-label="FOOTER_BANNER">FOOTER_BANNER</aside>
      <section aria-label="dynamic slot" />
      <aside aria-label="cart sidebar" />
      <aside aria-label="chat widget" />
      <span>{basePath}</span>
    </section>
  ),
}));

vi.mock('./storefront-deferred-overlay-chrome', () => ({
  StorefrontDeferredOverlayChrome: () => (
    <section aria-label="deferred overlay chrome">
      <section aria-label="dynamic slot" />
      <section aria-label="dynamic slot" />
    </section>
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
} as MerchantData;

const merchantWithoutPublishableWarranty = {
  ...merchantWithPublishablePolicies,
  trust_profile: {
    return_policy: { summary: 'Returns accepted within 7 days.' },
    shipping_policy: { summary: 'Ships nationwide.' },
    warranty_policy: {},
  },
} as MerchantData;

describe('OgabasseyLayoutChrome', () => {
  beforeEach(() => {
    mockUsePathname.mockReset();
    mockUsePathname.mockReturnValue('/ogabassey');
    deferredShellActive = false;
  });

  it('renders only header chrome for the header section', () => {
    render(<OgabasseyLayoutChrome basePath="/ogabassey" section="header" />);

    expect(
      screen.getByRole('complementary', { name: /google ad manager/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: /ogabassey storefront/i })
    ).toHaveTextContent('/ogabassey');
    expect(
      screen.queryByRole('complementary', { name: 'FOOTER_BANNER' })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('complementary', { name: /chat widget/i })
    ).not.toBeInTheDocument();
  });

  it('reserves the full footer and ad subtree on the deferred fallback so activation does not shift', () => {
    render(<OgabasseyLayoutChrome basePath="/ogabassey" section="footer" />);

    const fallbackFooter = screen.getByRole('contentinfo', {
      name: /semantic storefront footer/i,
    });

    // Footer estimates plus the complete footer-ad wrapper reservation.
    expect(fallbackFooter).toHaveClass('min-h-[1100px]');
    expect(fallbackFooter).toHaveClass('md:min-h-[910px]');
    expect(fallbackFooter).toHaveClass('lg:min-h-[770px]');
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

  it('mounts deferred footer commerce chrome after activation', async () => {
    deferredShellActive = true;

    render(<OgabasseyLayoutChrome basePath="/ogabassey" section="footer" />);

    expect(
      await screen.findByRole('region', {
        name: /deferred footer commerce/i,
      })
    ).toHaveTextContent('/ogabassey');
    expect(
      screen.getByRole('contentinfo', { name: /full storefront footer/i })
    ).toContainElement(screen.getByRole('link', { name: /about us/i }));
    expect(
      screen.queryByRole('contentinfo', {
        name: /semantic storefront footer/i,
      })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('complementary', { name: 'FOOTER_BANNER' })
    ).toHaveTextContent('FOOTER_BANNER');
    expect(
      screen.getByRole('complementary', { name: /cart sidebar/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('complementary', { name: /chat widget/i })
    ).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: /dynamic slot/i })).toHaveLength(
      1
    );
  });

  it('hides navigation-dependent chrome when hideNavigation is true', () => {
    const { container } = render(
      <OgabasseyLayoutChrome
        basePath="/ogabassey"
        hideNavigation
        section="footer"
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders overlay chrome independently from header and footer sections', async () => {
    deferredShellActive = true;

    render(
      <OgabasseyLayoutChrome
        basePath="/ogabassey"
        hideNavigation
        section="overlay"
      />
    );

    expect(
      await screen.findByRole('region', { name: /deferred overlay chrome/i })
    ).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: /dynamic slot/i })).toHaveLength(
      2
    );
    expect(
      screen.queryByRole('navigation', { name: /ogabassey storefront/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('complementary', { name: 'FOOTER_BANNER' })
    ).not.toBeInTheDocument();
  });

  it('defers overlay chrome until activation', () => {
    render(
      <OgabasseyLayoutChrome
        basePath="/ogabassey"
        hideNavigation
        section="overlay"
      />
    );

    expect(
      screen.queryByRole('region', { name: /deferred overlay chrome/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: /dynamic slot/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: /deferred shell/i })
    ).toHaveAttribute('data-defer-interaction-until-next-paint', 'true');
  });

  // Reactive hide-on-pathname coverage — this is the P1 regression fix.
  // The shell is persistent across client-side routing, so hide state must
  // derive from `usePathname()` and update without remounting the chrome.
  it('auto-hides the navbar when the current pathname is a checkout route', () => {
    mockUsePathname.mockReturnValue('/ogabassey/checkout');
    render(<OgabasseyLayoutChrome basePath="/ogabassey" section="header" />);

    expect(
      screen.queryByRole('navigation', { name: /ogabassey storefront/i })
    ).not.toBeInTheDocument();
    // GoogleAdManager is outside the hide gate — it still renders.
    expect(
      screen.getByRole('complementary', { name: /google ad manager/i })
    ).toBeInTheDocument();
  });

  it('auto-hides the footer chrome on nav-less routes', () => {
    mockUsePathname.mockReturnValue('/ogabassey/account/login');
    const { container } = render(
      <OgabasseyLayoutChrome basePath="/ogabassey" section="footer" />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('keeps the navbar visible on a normal storefront route', () => {
    mockUsePathname.mockReturnValue('/ogabassey/products/some-item');
    render(<OgabasseyLayoutChrome basePath="/ogabassey" section="header" />);

    expect(
      screen.getByRole('navigation', { name: /ogabassey storefront/i })
    ).toBeInTheDocument();
  });

  it('keeps the header visible on the cart route', () => {
    mockUsePathname.mockReturnValue('/ogabassey/cart');
    render(<OgabasseyLayoutChrome basePath="/ogabassey" section="header" />);

    expect(
      screen.getByRole('navigation', { name: /ogabassey storefront/i })
    ).toBeInTheDocument();
  });

  it('hides the mobile footer on the cart route without dropping deferred footer chrome', async () => {
    deferredShellActive = true;
    mockUsePathname.mockReturnValue('/ogabassey/cart');

    render(<OgabasseyLayoutChrome basePath="/ogabassey" section="footer" />);

    expect(
      screen.queryByRole('navigation', { name: /mobile footer/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('contentinfo', { name: /full storefront footer/i })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('region', {
        name: /deferred footer commerce/i,
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('complementary', { name: /cart sidebar/i })
    ).toBeInTheDocument();
  });

  it('still honours an explicit hideNavigation override on any route', () => {
    mockUsePathname.mockReturnValue('/ogabassey/products/some-item');
    render(
      <OgabasseyLayoutChrome
        basePath="/ogabassey"
        hideNavigation
        section="header"
      />
    );

    expect(
      screen.queryByRole('navigation', { name: /ogabassey storefront/i })
    ).not.toBeInTheDocument();
  });
});
