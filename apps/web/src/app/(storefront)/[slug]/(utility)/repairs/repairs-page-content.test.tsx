import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CachedMerchant } from '@/lib/cached-data';
import {
  RepairsPageContent,
  shouldRenderRepairsPage,
} from './repairs-page-content';

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({
    get: () => null,
  })),
}));

vi.mock('@/components/seo/json-ld', () => ({
  JsonLd: () => null,
}));

vi.mock('@/components/storefront/ogabassey/pages/repairs', () => ({
  OgabasseyV2Repairs: ({ omitHero }: { omitHero?: boolean }) => (
    <div
      data-testid="ogabassey-repairs"
      data-omit-hero={String(Boolean(omitHero))}
    />
  ),
}));

vi.mock('@/lib/store-url', () => ({
  buildStoreUrl: () => 'https://ogabassey.com',
}));

const merchant = {
  id: 'merchant-1',
  business_name: 'OgaBassey',
  slug: 'ogabassey',
  template_id: 'ogabassey',
} as CachedMerchant;

describe('RepairsPageContent', () => {
  it('omits the branded lab hero for the monitored tenant after the committed shell paints', async () => {
    render(
      await RepairsPageContent({
        merchant,
        omitHero: true,
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(screen.getByTestId('ogabassey-repairs')).toHaveAttribute(
      'data-omit-hero',
      'true'
    );
  });

  it('keeps the branded lab hero for other OgaBassey-template stores', async () => {
    render(
      await RepairsPageContent({
        merchant: { ...merchant, slug: 'other-store' },
        omitHero: false,
        params: Promise.resolve({ slug: 'other-store' }),
      })
    );

    expect(screen.getByTestId('ogabassey-repairs')).toHaveAttribute(
      'data-omit-hero',
      'false'
    );
  });
});

describe('shouldRenderRepairsPage', () => {
  it('renders the Ogabassey repair lab even when the catalogue flag is off', () => {
    expect(
      shouldRenderRepairsPage({
        template_id: 'ogabassey',
        business_type: 'fashion',
        feature_settings: { repairs_catalog_enabled: false },
      } as Parameters<typeof shouldRenderRepairsPage>[0])
    ).toBe(true);
  });

  it('hides generic stores that have not opted into the repairs catalogue', () => {
    expect(
      shouldRenderRepairsPage({
        template_id: 'modern',
        business_type: 'fashion',
        feature_settings: { repairs_catalog_enabled: false },
      } as Parameters<typeof shouldRenderRepairsPage>[0])
    ).toBe(false);
  });
});
