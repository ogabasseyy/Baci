import type { getCachedStorefrontHomeProducts } from '@/lib/cached-data';
import { OgabasseyHomeDiscoverySection } from './ogabassey-home-discovery-section';
import { loadOgabasseyLaunchProducts } from './ogabassey-home-launch-products';

export type StorefrontHomeProduct = Awaited<
  ReturnType<typeof getCachedStorefrontHomeProducts>
>[number];

export const mockSectionMerchant = {
  id: 'merchant-1',
  business_name: 'Oga & Bassey',
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
  feature_settings: {
    google_analytics_id: 'G-OGABASSEY',
    // Real settings field (blog hub gating); default off so tests that omit
    // it keep asserting the no-blog baseline.
    blog_enabled: false,
  },
  template_id: 'ogabassey',
  vat_registration_status: undefined,
  vat_rate: undefined,
  hero_slides: undefined,
  mobile_hero_slides: undefined,
  site_title: '',
  site_tagline: '',
  site_description: '',
  payout_currency: 'NGN',
  plan_expires_at: null,
  plan_tier: 'pro',
  premium_features: [],
};

export function createSectionProduct(
  overrides: Partial<StorefrontHomeProduct> = {}
): StorefrontHomeProduct {
  return {
    id: 'product-1',
    name: 'iPhone 17 Pro Max',
    slug: 'iphone-17-pro-max',
    description: 'Apple flagship phone.',
    price: 2500000,
    compare_at_price: null,
    images: [
      'https://cdn.ogabassey.com/core-assets/products/iphone-17-pro-max.avif',
    ],
    category: 'Smartphones',
    brand: 'Apple',
    condition: 'new',
    stock: 4,
    stock_quantity: null,
    manage_stock: false,
    low_stock_threshold: null,
    product_categories: [],
    ...overrides,
  };
}

export function createSectionCategories() {
  return [{ name: 'Smartphones', slug: 'smartphones' }];
}

export function resolveSectionDiscovery({
  merchant = mockSectionMerchant,
  pathPrefix = '/ogabassey',
  products = [] as StorefrontHomeProduct[],
  categories = createSectionCategories(),
  launchProductsPromise = loadOgabasseyLaunchProducts('merchant-1'),
}: {
  merchant?: typeof mockSectionMerchant;
  pathPrefix?: string;
  products?: StorefrontHomeProduct[];
  categories?: { name: string; slug: string }[];
  launchProductsPromise?: ReturnType<typeof loadOgabasseyLaunchProducts>;
}) {
  return OgabasseyHomeDiscoverySection({
    categoriesPromise: Promise.resolve(categories),
    launchProductsPromise,
    merchant,
    pathPrefix,
    productsPromise: Promise.resolve(products),
  });
}
