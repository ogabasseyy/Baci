import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockDynamicContentShouldSuspend,
  mockHeaders,
  mockHeroRender,
  mockPublishedMerchant,
} = vi.hoisted(() => ({
  mockHeaders: vi.fn(() => Promise.resolve(new Headers())),
  mockDynamicContentShouldSuspend: vi.fn(() => false),
  mockHeroRender: vi.fn(),
  mockPublishedMerchant: {
    id: 'merchant-1',
    business_name: 'OgaBassey',
    business_type: 'electronics',
    email: 'hello@ogabassey.com',
    phone: '+2341234567',
    logo_url: '',
    brand_colors: undefined,
    country: 'NG',
    pages: undefined,
    slug: 'ogabassey',
    custom_domain: 'ogabassey.com',
    favicon_svg_url: undefined,
    favicon_png_32_url: undefined,
    favicon_apple_touch_url: undefined,
    social_media: undefined,
    business_address: '',
    is_published: true,
    feature_settings: undefined,
    template_id: 'ogabassey',
    vat_registration_status: undefined,
    vat_rate: undefined,
    hero_slides: undefined,
    mobile_hero_slides: undefined,
    site_title: '',
    site_tagline: '',
    site_description: '',
    payout_currency: 'NGN',
    plan_tier: 'free',
    premium_features: undefined,
  },
}));

vi.mock('@/lib/cached-data', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getRequestScopedMerchant: vi.fn(() =>
      Promise.resolve(mockPublishedMerchant)
    ),
  };
});

vi.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('not-found');
  }),
}));

vi.mock('next/server', () => ({
  connection: vi.fn(() => Promise.resolve()),
}));

vi.mock('./ogabassey-home-dynamic-content', () => ({
  OgabasseyHomeDynamicContent: ({ pathPrefix }: { pathPrefix: string }) => {
    if (mockDynamicContentShouldSuspend()) {
      throw new Promise(() => undefined);
    }
    return <section aria-label="Dynamic home content">{pathPrefix}</section>;
  },
}));

vi.mock('@/components/storefront/store-not-published', () => ({
  StoreNotPublished: ({ businessName }: { businessName: string }) => (
    <div data-testid="store-not-published">{businessName}</div>
  ),
}));

vi.mock('@/components/storefront/ogabassey/components/Hero', () => ({
  Hero: ({
    omitDocumentHeading,
    omitMobileCarousel,
    slides,
  }: {
    omitDocumentHeading?: boolean;
    omitMobileCarousel?: boolean;
    slides: unknown[];
  }) => {
    mockHeroRender({ omitDocumentHeading, omitMobileCarousel, slides });
    return (
      <section
        aria-label="Product hero"
        data-omit-document-heading={omitDocumentHeading ? 'true' : 'false'}
        data-omit-mobile-carousel={omitMobileCarousel ? 'true' : 'false'}
        data-slide-count={slides.length}
      />
    );
  },
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch: _prefetch,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    prefetch?: boolean;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { getRequestScopedMerchant } from '@/lib/cached-data';
import { OgabasseyHomePageContent } from './ogabassey-home-page-content';

const SHELL_SLIDE = {
  kind: 'product' as const,
  id: 'p1',
  name: 'Tecno Spark 40 Pro',
  priceLabel: '₦250,000',
  href: 'https://ogabassey.com/smartphones/tecno-spark-40-pro',
  imageUrl: 'https://cdn.ogabassey.com/products/tecno.avif',
  imageAlt: 'Tecno Spark 40 Pro',
  ctaLabel: 'Shop now',
};

describe('OgabasseyHomePageContent committed hero', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHeaders.mockResolvedValue(new Headers());
    mockDynamicContentShouldSuspend.mockReturnValue(false);
    vi.mocked(getRequestScopedMerchant).mockResolvedValue(
      mockPublishedMerchant
    );
  });

  it('threads omitMobileCarousel into the publication-gated Hero', async () => {
    const result = await OgabasseyHomePageContent({
      omitMobileCarousel: true,
      pathPrefix: '/ogabassey',
      shellMerchantId: 'merchant-1',
      shellSlides: [SHELL_SLIDE],
    });

    render(result as ReactElement);

    expect(
      screen.getByRole('region', { name: /product hero/i })
    ).toHaveAttribute('data-omit-mobile-carousel', 'true');
    expect(mockHeroRender).toHaveBeenCalledWith(
      expect.objectContaining({
        omitMobileCarousel: true,
        slides: [SHELL_SLIDE],
      })
    );
  });

  it('threads omitDocumentHeading into the publication-gated Hero', async () => {
    const result = await OgabasseyHomePageContent({
      omitDocumentHeading: true,
      pathPrefix: '/ogabassey',
      shellMerchantId: 'merchant-1',
      shellSlides: [SHELL_SLIDE],
    });

    render(result as ReactElement);

    expect(
      screen.getByRole('region', { name: /product hero/i })
    ).toHaveAttribute('data-omit-document-heading', 'true');
    expect(mockHeroRender).toHaveBeenCalledWith(
      expect.objectContaining({
        omitDocumentHeading: true,
        slides: [SHELL_SLIDE],
      })
    );
  });

  it('does not restore the H1 when the parent already committed the document heading', async () => {
    const result = await OgabasseyHomePageContent({
      omitDocumentHeading: true,
      pathPrefix: '/ogabassey',
      shellMerchantId: null,
      shellSlides: null,
    });

    render(result as ReactElement);

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(mockHeroRender).not.toHaveBeenCalled();
  });

  it('renders one Hero with request-bound content after the publication guard', async () => {
    const result = await OgabasseyHomePageContent({
      pathPrefix: '/ogabassey',
      shellMerchantId: 'merchant-1',
      shellSlides: [SHELL_SLIDE],
    });

    render(result as ReactElement);

    expect(
      screen.getByRole('region', { name: /product hero/i })
    ).toHaveAttribute('data-slide-count', '1');
    expect(
      screen.getByRole('region', { name: /product hero/i })
    ).toHaveAttribute('data-omit-mobile-carousel', 'false');
    expect(
      screen.getByRole('region', { name: /dynamic home content/i })
    ).toHaveTextContent('/ogabassey');
    expect(getRequestScopedMerchant).toHaveBeenCalledWith('ogabassey');
  });

  it('restores the H1 after the publication guard when the cached Hero degraded', async () => {
    const result = await OgabasseyHomePageContent({
      pathPrefix: '/ogabassey',
      shellMerchantId: null,
      shellSlides: null,
    });

    render(result as ReactElement);

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'OgaBassey - Official Online Store',
      })
    ).toBeInTheDocument();
  });

  it('keeps the publication-gated Hero when below-fold content suspends', async () => {
    mockDynamicContentShouldSuspend.mockReturnValue(true);

    const result = await OgabasseyHomePageContent({
      pathPrefix: '/ogabassey',
      shellMerchantId: 'merchant-1',
      shellSlides: [SHELL_SLIDE],
    });

    render(result as ReactElement);

    expect(
      screen.getByRole('region', { name: /product hero/i })
    ).toHaveAttribute('data-slide-count', '1');
    expect(
      screen.queryByRole('region', { name: /dynamic home content/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });
});
