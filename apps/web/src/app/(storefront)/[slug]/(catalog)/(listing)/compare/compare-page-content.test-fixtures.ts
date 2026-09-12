import type {
  getCachedCategories,
  getCachedCategoryPageData,
  getRequestScopedMerchant,
} from '@/lib/cached-data';

type CachedCategories = Awaited<ReturnType<typeof getCachedCategories>>;
type CategoryPageData = Awaited<ReturnType<typeof getCachedCategoryPageData>>;

const laptopProducts = [
  {
    id: 'macbook-air-15',
    name: '15" MacBook Air M4 (2025)',
    slug: 'macbook-air-15-inch-m4-2025',
    price: 2_000_000,
    category: 'Laptops',
    brand: 'Apple',
    condition: 'new',
    product_key_specs: {
      chipset: 'Apple M4',
      ram_gb: 16,
      screen_size_inches: 15,
      storage_gb: 512,
    },
  },
  {
    id: 'dell-xps-13',
    name: 'Dell XPS 13 9350',
    slug: 'dell-xps-13-9350',
    price: 900_000,
    category: 'Laptops',
    brand: 'Dell',
    condition: 'new',
    product_key_specs: {
      chipset: 'Intel Core Ultra 7',
      ram_gb: 16,
      screen_size_inches: 13,
      storage_gb: 1024,
    },
  },
];
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
  products: laptopProducts,
} satisfies CategoryPageData;

type RequestScopedMerchant = NonNullable<
  Awaited<ReturnType<typeof getRequestScopedMerchant>>
>;

export function makeMerchant(
  overrides: Partial<RequestScopedMerchant> = {}
): RequestScopedMerchant {
  return {
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
    business_address: '',
    payout_currency: 'NGN',
    is_published: true,
    template_id: 'ogabassey',
    plan_tier: 'free',
    premium_features: {},
    country: 'NG',
    ...overrides,
  };
}
