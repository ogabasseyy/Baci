import { render, screen } from '@testing-library/react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import { OgabasseyHomePageContent } from './ogabassey-home-page-content';

const merchant = {
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
};

vi.mock('./ogabassey-home-launch-products', () => ({
  loadOgabasseyLaunchProducts: vi.fn(async () => []),
}));
vi.mock('@/lib/cached-data', () => ({
  getRequestScopedMerchant: vi.fn(async () => merchant),
}));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('next/server', () => ({ connection: vi.fn(async () => undefined) }));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('not-found');
  }),
}));
vi.mock('./ogabassey-home-dynamic-content', () => ({
  OgabasseyHomeDynamicContent: () => <div />,
}));
vi.mock('@/components/storefront/store-not-published', () => ({
  StoreNotPublished: ({ businessName }: { businessName: string }) => (
    <div data-testid="store-not-published">{businessName}</div>
  ),
}));
vi.mock('./ogabassey-home-recovery-hero', () => ({
  OgabasseyHomeRecoveryHero: ({
    omitMobileCarousel,
  }: {
    omitMobileCarousel?: boolean;
  }) => (
    <section
      aria-label="Recovered hero"
      data-omit-mobile-carousel={String(omitMobileCarousel)}
    />
  ),
}));

beforeEach(() => vi.clearAllMocks());

it('returns 404 when merchant lookup is null', async () => {
  vi.mocked(getRequestScopedMerchant).mockResolvedValueOnce(null);
  await expect(
    OgabasseyHomePageContent({
      pathPrefix: '/ogabassey',
      shellMerchantId: 'merchant-1',
      shellSlides: [],
    })
  ).rejects.toThrow('not-found');
  expect(notFound).toHaveBeenCalledOnce();
});

it('recovers after a shell timeout through the publication-checked content', async () => {
  render(
    await OgabasseyHomePageContent({
      pathPrefix: '',
      shellMerchantId: null,
      shellSlides: null,
    })
  );
  expect(
    screen.getByRole('region', { name: 'Recovered hero' })
  ).toBeInTheDocument();
});

it('forwards omitMobileCarousel to recovery when shell slides are unavailable', async () => {
  render(
    await OgabasseyHomePageContent({
      omitMobileCarousel: true,
      pathPrefix: '',
      shellMerchantId: null,
      shellSlides: null,
    })
  );
  expect(
    screen.getByRole('region', { name: 'Recovered hero' })
  ).toHaveAttribute('data-omit-mobile-carousel', 'true');
});

it('resolves the canonical custom-domain shell without awaiting connection() or headers()', async () => {
  render(
    await OgabasseyHomePageContent({
      canonicalDomain: true,
      omitDocumentHeading: true,
      pathPrefix: '',
      shellMerchantId: null,
      shellSlides: null,
    })
  );

  expect(getRequestScopedMerchant).toHaveBeenCalledWith('ogabassey.com');
  expect(connection).not.toHaveBeenCalled();
  expect(headers).not.toHaveBeenCalled();
});

it('still consults headers() when omitDocumentHeading and empty pathPrefix are passed without canonicalDomain', async () => {
  vi.mocked(headers).mockResolvedValueOnce(
    new Headers([['x-merchant-slug', 'other-merchant']])
  );

  render(
    await OgabasseyHomePageContent({
      omitDocumentHeading: true,
      pathPrefix: '',
      shellMerchantId: null,
      shellSlides: null,
    })
  );

  expect(connection).toHaveBeenCalledOnce();
  expect(headers).toHaveBeenCalledOnce();
  expect(getRequestScopedMerchant).toHaveBeenCalledWith('other-merchant');
});

it('enforces 404 and unpublished storefront guards on the canonicalDomain fast path', async () => {
  vi.mocked(getRequestScopedMerchant).mockResolvedValueOnce(null);
  await expect(
    OgabasseyHomePageContent({
      canonicalDomain: true,
      omitDocumentHeading: true,
      pathPrefix: '',
      shellMerchantId: 'merchant-1',
      shellSlides: [],
    })
  ).rejects.toThrow('not-found');
  expect(notFound).toHaveBeenCalledOnce();

  vi.mocked(getRequestScopedMerchant).mockResolvedValueOnce({
    ...merchant,
    is_published: false,
  });
  render(
    await OgabasseyHomePageContent({
      canonicalDomain: true,
      omitDocumentHeading: true,
      pathPrefix: '',
      shellMerchantId: 'merchant-1',
      shellSlides: [],
    })
  );
  expect(screen.getByTestId('store-not-published')).toHaveTextContent(
    'OgaBassey'
  );
});
