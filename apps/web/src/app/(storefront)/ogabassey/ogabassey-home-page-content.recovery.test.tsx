import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
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
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/server', () => ({ connection: async () => undefined }));
vi.mock('next/navigation', () => ({ notFound: vi.fn() }));
vi.mock('./ogabassey-home-dynamic-content', () => ({
  OgabasseyHomeDynamicContent: () => <div />,
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
