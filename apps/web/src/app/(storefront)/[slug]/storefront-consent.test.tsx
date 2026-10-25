import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FacebookPixel } from '@/components/analytics/facebook-pixel';
import { TikTokPixel } from '@/components/analytics/tiktok-pixel';
import type { StorefrontShellSnapshot } from '@/hooks/merchant/types';
import { getStoredConsent } from '@/lib/consent-mode';
import { AboutPageClient } from './(content)/pages/about/about-page-client';
import { ContactPageClient } from './(content)/pages/contact/contact-page-client';
import { FAQPageClient } from './(content)/pages/faq/faq-page-client';
import { PrivacyPageClient } from './(content)/pages/privacy/privacy-page-client';
import { TermsPageClient } from './(content)/pages/terms/terms-page-client';
import { StorefrontShellFrame } from './storefront-shell-frame';

// Keep consent UI, storage, event subscriptions and all three pixel gates real.
// Script output is inert so tests never contact the advertising providers.
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/script', () => ({
  default: ({ id, children }: { id: string; children: ReactNode }) => (
    <pre hidden data-testid={id}>
      {children}
    </pre>
  ),
}));
vi.mock('next/dynamic', async () => {
  const { CookieConsent } = await import(
    '@/components/storefront/cookie-consent'
  );
  return {
    default: (loader: () => unknown) =>
      loader.toString().includes('cookie-consent') ? CookieConsent : () => null,
  };
});
vi.mock('next/navigation', () => ({
  usePathname: () => '/store/product',
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => ({ basePath: '' }),
}));
vi.mock('@/hooks/merchant/storefront-merchant-provider', () => ({
  StorefrontMerchantProvider: ({ children }: { children: ReactNode }) =>
    children,
}));
vi.mock('@/hooks/cart/storefront-cart-provider', () => ({
  StorefrontCartProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/hooks/merchant/merchant-provider', () => ({
  MerchantProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/contexts/storefront-context', () => ({
  StorefrontProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/storefront/header', () => ({
  StorefrontHeader: () => null,
}));
vi.mock('@/components/storefront/footer', () => ({
  StorefrontFooter: () => null,
}));
vi.mock('@/components/storefront/webmcp-storefront-tools', () => ({
  WebMcpStorefrontTools: () => null,
}));
vi.mock('@/components/storefront/deferred-page-view-tracker', () => ({
  DeferredPageViewTracker: () => null,
}));
vi.mock('./storefront-layout-renderer', () => ({
  StorefrontLayoutRenderer: ({ children }: { children: ReactNode }) => (
    <>
      <FacebookPixel pixelId="configured-meta-pixel" />
      <TikTokPixel pixelId="configured-tiktok-pixel" />
      {children}
    </>
  ),
}));

const merchant = {
  id: 'merchant-1',
  user_id: 'user-1',
  business_type: 'electronics',
  slug: 'store',
  business_name: 'Test Store',
};
const shellSnapshot = {
  merchant,
  routingMode: 'domain',
  basePath: '',
  navigationCategories: [],
  chatgptPixelId: 'configured-chatgpt-pixel',
} satisfies StorefrontShellSnapshot;
function shell(children: ReactNode) {
  return (
    <StorefrontShellFrame
      preloadHeroLcpImages={false}
      shellSnapshot={shellSnapshot}
    >
      {children}
    </StorefrontShellFrame>
  );
}
function revealPrompt() {
  act(() => vi.advanceTimersByTime(1000));
}
function expectNoPixels() {
  expect(screen.queryByTestId('facebook-pixel')).not.toBeInTheDocument();
  expect(screen.queryByTestId('tiktok-pixel')).not.toBeInTheDocument();
  expect(
    screen.queryByTestId('chatgpt-measurement-sdk')
  ).not.toBeInTheDocument();
}

describe('storefront consent wiring', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'gtag');
    Reflect.deleteProperty(window, 'oaiq');
    vi.useRealTimers();
  });

  it('offers fresh visitors one consent prompt while both configured pixels remain denied', () => {
    render(shell(<main>Home</main>));
    expectNoPixels();
    revealPrompt();
    expect(
      screen.getAllByRole('dialog', { name: 'Cookie consent' })
    ).toHaveLength(1);
    expectNoPixels();
    expect(getStoredConsent()).toBeNull();
  });

  it('releases configured pixels after Accept All and preserves the choice through checkout navigation and remount', () => {
    const view = render(shell(<main>Product</main>));
    revealPrompt();
    fireEvent.click(screen.getByRole('button', { name: 'Accept All' }));
    expect(screen.getByTestId('facebook-pixel')).toHaveTextContent(
      'configured-meta-pixel'
    );
    expect(screen.getByTestId('tiktok-pixel')).toHaveTextContent(
      'configured-tiktok-pixel'
    );
    expect(screen.getByTestId('chatgpt-measurement-sdk')).toBeInTheDocument();
    expect(getStoredConsent()).toMatchObject({
      analytics: true,
      marketing: true,
    });
    act(() => vi.advanceTimersByTime(200));
    view.rerender(shell(<main>Checkout</main>));
    expect(screen.getByText('Checkout')).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: 'Cookie consent' })
    ).not.toBeInTheDocument();
    view.unmount();
    render(shell(<main>Checkout revisited</main>));
    revealPrompt();
    expect(
      screen.queryByRole('dialog', { name: 'Cookie consent' })
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('facebook-pixel')).toBeInTheDocument();
    expect(screen.getByTestId('tiktok-pixel')).toBeInTheDocument();
    expect(screen.getByTestId('chatgpt-measurement-sdk')).toBeInTheDocument();
  });

  it('keeps advertising denied after Necessary Only and a page reload', () => {
    const view = render(shell(<main>Checkout</main>));
    revealPrompt();
    fireEvent.click(screen.getByRole('button', { name: 'Necessary Only' }));
    expect(getStoredConsent()).toMatchObject({
      analytics: false,
      marketing: false,
    });
    expectNoPixels();
    view.unmount();
    render(shell(<main>Home revisited</main>));
    revealPrompt();
    expect(
      screen.queryByRole('dialog', { name: 'Cookie consent' })
    ).not.toBeInTheDocument();
    expectNoPixels();
  });

  it('keeps the storefront usable and pixels denied when reading consent storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage denied', 'SecurityError');
    });
    expect(() => render(shell(<main>Browse products</main>))).not.toThrow();
    revealPrompt();
    expect(screen.getByText('Browse products')).toBeInTheDocument();
    expect(
      screen.getByRole('dialog', { name: 'Cookie consent' })
    ).toBeInTheDocument();
    expectNoPixels();
  });

  it('keeps tracking denied and offers retry when saving consent throws', () => {
    const consentEvents = vi.fn();
    const gtag = vi.fn();
    window.gtag = gtag;
    window.addEventListener('cookie-consent-updated', consentEvents);
    const writeConsent = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('Storage full', 'QuotaExceededError');
      });
    try {
      render(shell(<main>Continue shopping</main>));
      revealPrompt();
      fireEvent.click(screen.getByRole('button', { name: 'Accept All' }));
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Unable to save your cookie preferences'
      );
      act(() => vi.advanceTimersByTime(200));
      expect(
        screen.getByRole('dialog', { name: 'Cookie consent' })
      ).toBeInTheDocument();
      expect(screen.getByText('Continue shopping')).toBeInTheDocument();
      expect(getStoredConsent()).toBeNull();
      expectNoPixels();
      expect(gtag).not.toHaveBeenCalled();
      expect(consentEvents).not.toHaveBeenCalled();
      writeConsent.mockRestore();
      fireEvent.click(screen.getByRole('button', { name: 'Accept All' }));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(getStoredConsent()).toMatchObject({
        analytics: true,
        marketing: true,
      });
      expect(screen.getByTestId('facebook-pixel')).toBeInTheDocument();
      expect(screen.getByTestId('tiktok-pixel')).toBeInTheDocument();
    } finally {
      window.removeEventListener('cookie-consent-updated', consentEvents);
    }
  });

  it.each([
    [
      'privacy',
      <PrivacyPageClient key="privacy" merchant={merchant as never} />,
    ],
    ['terms', <TermsPageClient key="terms" merchant={merchant} />],
    [
      'about',
      <AboutPageClient key="about" merchant={merchant} aboutPage={{}} />,
    ],
    ['contact', <ContactPageClient key="contact" merchant={merchant} />],
    ['faq', <FAQPageClient key="faq" merchant={merchant} faqItems={[]} />],
  ])('keeps one prompt when navigating from home to generic %s content', (_page, content) => {
    const view = render(shell(<main>Home</main>));
    revealPrompt();
    view.rerender(shell(content));
    revealPrompt();
    expect(
      screen.getAllByRole('dialog', { name: 'Cookie consent' })
    ).toHaveLength(1);
    expectNoPixels();
  });
});
