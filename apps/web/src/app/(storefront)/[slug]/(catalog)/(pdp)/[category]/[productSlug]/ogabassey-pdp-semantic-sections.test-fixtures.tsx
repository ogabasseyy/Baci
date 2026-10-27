import { vi } from 'vitest';
import type { Product } from '@/lib/products';

export type SemanticModel = {
  contextParagraphs?: string[];
  trustBullets: string[];
  supportLinks: unknown[];
  guideLinks: unknown[];
  alternatives: null;
  sameBrand: null;
  samePrice: null;
};

export const mockGetCachedProductSeoLinkData = vi.fn();
export const mockLoadPdpBrandHubEligibilityInventorySafely = vi.fn();
export const mockBuildProductSemanticModel =
  vi.fn<(input: unknown) => SemanticModel>();
export const mockProductSemanticSections = vi.fn(
  ({
    model,
    merchantName,
    productComparePathPrefix,
  }: {
    merchantName?: string;
    model: SemanticModel;
    productCompareLinks?: unknown[];
    productComparePathPrefix?: string;
    productName?: string;
  }) => (
    <section aria-label="semantic sections">
      {merchantName}
      {productComparePathPrefix}
      {model.trustBullets.join(' | ')}
      {model.contextParagraphs?.join(' | ')}
    </section>
  )
);

vi.mock('@/lib/storefront-product/get-cached-product-seo-link-data', () => ({
  getCachedProductSeoLinkData: (...args: unknown[]) =>
    mockGetCachedProductSeoLinkData(...args),
}));

vi.mock(
  '@/lib/storefront-product/load-pdp-brand-hub-eligibility-inventory-safely',
  () => ({
    loadPdpBrandHubEligibilityInventorySafely: (...args: unknown[]) =>
      mockLoadPdpBrandHubEligibilityInventorySafely(...args),
  })
);

vi.mock('@/lib/storefront-product/build-product-semantic-model', () => ({
  buildProductSemanticModel: (input: unknown) =>
    mockBuildProductSemanticModel(input),
}));

vi.mock(
  '@/components/storefront/ogabassey/seo/product-semantic-sections',
  () => ({
    ProductSemanticSections: (props: { model: SemanticModel }) =>
      mockProductSemanticSections(props),
  })
);

export const product = {
  id: 'prod-1',
  slug: 'lenovo-legion',
  name: 'Lenovo Legion',
  brand: 'Lenovo',
  condition: 'new',
  price: 3500000,
  stock: 4,
  category_slug: 'laptops',
  product_key_specs: {
    chipset: 'AMD Ryzen 9',
    ram_gb: 32,
    storage_gb: 1024,
  },
} as Product;
