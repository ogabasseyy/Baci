import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./components/AdUnit', () => ({
  AdUnit: ({ placementKey }: { placementKey: string }) => (
    <aside aria-label="Footer ad unit">{placementKey}</aside>
  ),
}));

vi.mock('./components/deferred-cart-sidebar', () => ({
  DeferredCartSidebar: () => (
    <div aria-label="Deferred cart sidebar" role="dialog" />
  ),
}));

vi.mock('./components/chat/DeferredChatWidget', () => ({
  DeferredChatWidget: () => <aside aria-label="Deferred chat widget" />,
}));

vi.mock('./components/Footer', () => ({
  Footer: ({ storeSlug }: { storeSlug: string }) => (
    <footer aria-label="Full storefront footer">
      <a href={`${storeSlug}/about`}>About Us</a>
    </footer>
  ),
}));

import { StorefrontDeferredFooterChrome } from './storefront-deferred-footer-chrome';

describe('StorefrontDeferredFooterChrome', () => {
  it('mounts the full footer and footer commerce widgets behind the deferred chrome boundary', async () => {
    render(<StorefrontDeferredFooterChrome basePath="/ogabassey" />);

    expect(
      await screen.findByRole('contentinfo', {
        name: /full storefront footer/i,
      })
    ).toContainElement(screen.getByRole('link', { name: /about us/i }));

    expect(
      await screen.findByRole('complementary', { name: /footer ad unit/i })
    ).toHaveTextContent('FOOTER_BANNER');
    expect(
      await screen.findByRole('dialog', { name: /deferred cart sidebar/i })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('complementary', {
        name: /deferred chat widget/i,
      })
    ).toBeInTheDocument();

    // Footer banner sits above `<Footer />` for Active View viewability.
    const adUnit = screen.getByRole('complementary', { name: /footer ad unit/i });
    const footer = screen.getByRole('contentinfo', {
      name: /full storefront footer/i,
    });
    expect(
      adUnit.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('reserves the complete footer ad wrapper per breakpoint so content-visibility does not shift', async () => {
    render(<StorefrontDeferredFooterChrome basePath="/ogabassey" />);

    const adUnitWrapper = (
      await screen.findByRole('complementary', { name: /footer ad unit/i })
    ).parentElement;

    // Includes the creative, Sponsored label, AdSlotShell margins, and wrapper
    // padding at each breakpoint.
    expect(adUnitWrapper).toHaveClass('min-h-[200px]');
    expect(adUnitWrapper).toHaveClass('[contain-intrinsic-size:1400px_200px]');
    expect(adUnitWrapper).toHaveClass('md:min-h-[350px]');
    expect(adUnitWrapper).toHaveClass(
      'md:[contain-intrinsic-size:1400px_350px]'
    );
    expect(adUnitWrapper).toHaveClass('content-auto');
  });
});
