import { vi } from 'vitest';
import type * as CachedData from '@/lib/cached-data';

type CategoryPageProps = {
  params: Promise<{ category: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const getCachedCategories = vi.hoisted(() => vi.fn());
const getCachedCategoryPageData = vi.hoisted(() => vi.fn());
const getRequestScopedMerchant = vi.hoisted(() => vi.fn());
const mockGenerateCategoryMetadata = vi.hoisted(() =>
  vi.fn(async (_props: CategoryPageProps) => ({
    title: 'Compare category metadata',
  }))
);

export {
  getCachedCategories,
  getCachedCategoryPageData,
  getRequestScopedMerchant,
  mockGenerateCategoryMetadata,
};
export const mockNotFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('next/navigation', () => ({
  notFound: () => mockNotFound(),
}));

vi.mock('next/server', () => ({
  connection: vi.fn(),
}));

vi.mock('@/lib/cached-data', () => ({
  getCachedCategories,
  getStorefrontCategories: async (...args: unknown[]) => {
    try {
      return {
        categories: await getCachedCategories(...args),
        queryFailed: false,
      };
    } catch {
      return { categories: [], queryFailed: true };
    }
  },
  getCachedCategoryPageData,
  getRequestScopedMerchant,
}));

vi.mock('@/lib/store-url', () => ({
  buildStoreUrl: (merchant: { custom_domain?: string | null; slug: string }) =>
    merchant.custom_domain
      ? `https://${merchant.custom_domain}`
      : `https://${merchant.slug}.usebaci.com`,
}));

vi.mock('../[category]/page', () => ({
  default: vi.fn(),
  generateMetadata: (props: CategoryPageProps) =>
    mockGenerateCategoryMetadata(props),
}));

vi.mock('./compare-page-content', () => ({
  ComparePageContent: vi.fn(),
}));

type RequestScopedMerchant = NonNullable<
  Awaited<ReturnType<typeof CachedData.getRequestScopedMerchant>>
>;
type CachedCategories = Awaited<
  ReturnType<typeof CachedData.getCachedCategories>
>;
type CategoryPageData = Awaited<
  ReturnType<typeof CachedData.getCachedCategoryPageData>
>;

export const merchant = {
  id: 'merchant-1',
  business_name: 'Ogabassey',
  site_title: 'Ogabassey',
  site_tagline: 'Devices and repairs',
  site_description: 'Shop devices and repairs.',
  business_type: 'electronics',
  logo_url: '',
  phone: '',
  email: 'support@ogabassey.com',
  slug: 'ogabassey',
  custom_domain: 'ogabassey.com',
  business_address: '',
  payout_currency: 'NGN',
  is_published: true,
  template_id: 'ogabassey',
  plan_tier: 'free',
  premium_features: {},
  country: 'NG',
} satisfies RequestScopedMerchant;

export const categories = [
  {
    id: 'category-1',
    name: 'Laptops',
    slug: 'laptops',
    description: null,
    image_url: null,
    is_active: true,
    parent_id: null,
  },
] satisfies CachedCategories;

export const categoryPageData = {
  isCollection: false,
  category: null,
  fallbackDescription: 'Shop laptops.',
  fallbackName: 'Laptops',
  isInactiveCategory: false,
  products: [
    {
      id: 'macbook-air-15',
      name: '15" MacBook Air M4 (2025)',
      slug: 'macbook-air-15-inch-m4-2025',
      price: 2_000_000,
      category: 'Laptops',
      brand: 'Apple',
      product_key_specs: { chipset: 'Apple M4', ram_gb: 16, storage_gb: 512 },
    },
    {
      id: 'dell-xps-13',
      name: 'Dell XPS 13 9350',
      slug: 'dell-xps-13-9350',
      price: 900_000,
      category: 'Laptops',
      brand: 'Dell',
      product_key_specs: {
        chipset: 'Intel Core Ultra 7',
        ram_gb: 32,
        storage_gb: 1024,
      },
    },
  ],
} satisfies CategoryPageData;

export const { generateMetadata } = await import('./page');

export function resetCompareMetadataMocks() {
  getRequestScopedMerchant.mockReset();
  getCachedCategories.mockReset();
  getCachedCategoryPageData.mockReset();
  getRequestScopedMerchant.mockResolvedValue(merchant);
  getCachedCategories.mockResolvedValue(categories);
  getCachedCategoryPageData.mockResolvedValue(categoryPageData);
  mockGenerateCategoryMetadata.mockReset();
  mockGenerateCategoryMetadata.mockResolvedValue({
    title: 'Compare category metadata',
  });
  mockNotFound.mockClear();
}
