import type { PriceBandDefinition } from './compare-types';

export const CURATED_PRICE_BANDS = {
  smartphones: [
    {
      slug: 'under-500k',
      label: 'Best Smartphones Under ₦500,000',
      ceiling: 500_000,
    },
    {
      slug: 'under-1m',
      label: 'Best Smartphones Under ₦1,000,000',
      ceiling: 1_000_000,
    },
  ],
  laptops: [
    {
      slug: 'under-1m',
      label: 'Best Laptops Under ₦1,000,000',
      ceiling: 1_000_000,
    },
  ],
  'smart-tvs': [
    {
      slug: 'under-2m',
      label: 'Best Smart TVs Under ₦2,000,000',
      ceiling: 2_000_000,
    },
  ],
  'gaming-laptops': [
    {
      slug: 'under-1-5m',
      label: 'Best Gaming Laptops Under ₦1,500,000',
      ceiling: 1_500_000,
    },
    {
      slug: 'under-2-5m',
      label: 'Best Gaming Laptops Under ₦2,500,000',
      ceiling: 2_500_000,
    },
    {
      slug: 'under-4m',
      label: 'Best Gaming Laptops Under ₦4,000,000',
      ceiling: 4_000_000,
    },
  ],
  tablets: [
    {
      slug: 'under-200k',
      label: 'Best Tablets Under ₦200,000',
      ceiling: 200_000,
    },
    {
      slug: 'under-500k',
      label: 'Best Tablets Under ₦500,000',
      ceiling: 500_000,
    },
    {
      slug: 'under-1m',
      label: 'Best Tablets Under ₦1,000,000',
      ceiling: 1_000_000,
    },
  ],
  audio: [
    {
      slug: 'under-50k',
      label: 'Best Audio & Speakers Under ₦50,000',
      ceiling: 50_000,
    },
    {
      slug: 'under-150k',
      label: 'Best Audio & Speakers Under ₦150,000',
      ceiling: 150_000,
    },
    {
      slug: 'under-500k',
      label: 'Best Audio & Speakers Under ₦500,000',
      ceiling: 500_000,
    },
  ],
  smartwatches: [
    {
      slug: 'under-100k',
      label: 'Best Smartwatches Under ₦100,000',
      ceiling: 100_000,
    },
    {
      slug: 'under-300k',
      label: 'Best Smartwatches Under ₦300,000',
      ceiling: 300_000,
    },
    {
      slug: 'under-600k',
      label: 'Best Smartwatches Under ₦600,000',
      ceiling: 600_000,
    },
  ],
  'playstation-5': [
    {
      slug: 'under-50k',
      label: 'Best PlayStation 5 Picks Under ₦50,000',
      ceiling: 50_000,
    },
    {
      slug: 'under-100k',
      label: 'Best PlayStation 5 Picks Under ₦100,000',
      ceiling: 100_000,
    },
    {
      slug: 'under-1m',
      label: 'Best PlayStation 5 Picks Under ₦1,000,000',
      ceiling: 1_000_000,
    },
  ],
} satisfies Record<string, PriceBandDefinition[]>;

export type CuratedPriceBandCategorySlug = keyof typeof CURATED_PRICE_BANDS;

export function getConfiguredPriceBands(
  categorySlug: string
): PriceBandDefinition[] {
  if (!Object.hasOwn(CURATED_PRICE_BANDS, categorySlug)) {
    return [];
  }
  return (
    CURATED_PRICE_BANDS[categorySlug as CuratedPriceBandCategorySlug] ?? []
  );
}
