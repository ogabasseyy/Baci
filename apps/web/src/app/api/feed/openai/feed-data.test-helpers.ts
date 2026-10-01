import { vi } from 'vitest';
export interface ProductFixture {
  id: string;
  name: string;
  description: string;
  slug: string;
  price: number;
  stock: number;
  stock_quantity: number;
  manage_stock: boolean;
  condition?: string | null;
  has_condition_offers?: boolean | null;
  average_rating?: number | null;
  review_count?: number | null;
  canonical_url?: string | null;
  category?: string | null;
  category_slug?: string | null;
  categories?: { name?: string | null; slug?: string | null } | null;
  product_categories?: Array<{
    categories?: { name?: string | null; slug?: string | null } | null;
  }> | null;
  created_at?: string | null;
  variants: Array<{
    id: string;
    attributes: Record<string, string>;
    stock_quantity: number;
    sku: string;
    primary_image: string;
  }>;
}

export interface ReviewFixture {
  product_id: string | null;
  rating: number | string | null;
}

export interface OfferFixture {
  id: string;
  product_id: string;
  condition: string;
  price: number;
  images?: unknown;
}

export interface ManifestFixture {
  product_id: string;
  variant_id?: string | null;
  verified_url: string | null;
  verified_format: string | null;
  status: string;
  is_primary: boolean;
  position: number;
}

export interface FeedDataHarnessState {
  productsResult: { data: ProductFixture[] | null; error: unknown };
  nullCreatedAtProductsResult: {
    data: ProductFixture[] | null;
    error: unknown;
  };
  manifestResult: { data: ManifestFixture[] | null; error: unknown };
  offersResult: { data: OfferFixture[] | null; error: unknown };
  reviewsResult: {
    count?: number | null;
    data: ReviewFixture[] | null;
    error: unknown;
  };
  reviewPageResults: Array<{
    count?: number | null;
    data: ReviewFixture[] | null;
    error: unknown;
  }>;
  productQueryMode: 'non_null' | 'null';
}

/** Shared mutable fixture state (per test file via module registry). */
export const harness = {
  productsResult: null,
  nullCreatedAtProductsResult: null,
  manifestResult: null,
  offersResult: null,
  reviewsResult: null,
  reviewPageResults: null,
  productQueryMode: null,
} as unknown as FeedDataHarnessState;

export const mockProductSelect = vi.fn();
export const mockProductsGt = vi.fn();
export const mockProductsIs = vi.fn();
export const mockProductsOr = vi.fn();
export const mockProductsNot = vi.fn();
export const mockProductsOrder = vi.fn();
export const mockProductsLimit = vi.fn();
export const mockManifestEq = vi.fn();
export const mockManifestIn = vi.fn();
export const mockManifestOrder = vi.fn();
export const mockManifestRange = vi.fn();
export const mockReviewSelect = vi.fn();
export const mockReviewsIn = vi.fn();
export const mockReviewsOrder = vi.fn();
export const mockReviewsRange = vi.fn();

export function createMockSupabase() {
  return {
    from: (table: string) => {
      if (table === 'products') {
        return {
          select: mockProductSelect.mockImplementation(() => {
            const query = {
              eq: () => query,
              not: (column: string, operator: string, value: unknown) => {
                harness.productQueryMode = 'non_null';
                mockProductsNot(column, operator, value);
                return query;
              },
              is: (column: string, value: unknown) => {
                if (column === 'created_at' && value === null) {
                  harness.productQueryMode = 'null';
                }
                mockProductsIs(column, value);
                return query;
              },
              gt: (column: string, value: string) => {
                mockProductsGt(column, value);
                return query;
              },
              or: (filter: string) => {
                mockProductsOr(filter);
                return query;
              },
              order: (
                column: string,
                options?: {
                  ascending: boolean;
                }
              ) => {
                mockProductsOrder(column, options);
                return query;
              },
              limit: (value: number) => mockProductsLimit(value),
            };
            return query;
          }),
        };
      }
      if (table === 'product_reviews') {
        return {
          select: mockReviewSelect.mockImplementation(() => {
            const query = {
              eq: () => query,
              in: (column: string, values: string[]) => {
                mockReviewsIn(column, values);
                return query;
              },
              order: (
                column: string,
                options?: {
                  ascending: boolean;
                }
              ) => {
                mockReviewsOrder(column, options);
                return query;
              },
              range: (from: number, to: number) => mockReviewsRange(from, to),
            };
            return query;
          }),
        };
      }
      if (table === 'product_offers') {
        return {
          select: () => ({
            in: () => ({
              eq: () => ({
                order: () => ({
                  order: () => Promise.resolve(harness.offersResult),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'product_feed_images') {
        return {
          select: () => {
            const query = {
              eq: (column: string, value: unknown) => {
                mockManifestEq(column, value);
                return query;
              },
              in: (column: string, values: string[]) => {
                mockManifestIn(column, values);
                return query;
              },
              order: (
                column: string,
                options?: {
                  ascending: boolean;
                }
              ) => {
                mockManifestOrder(column, options);
                return query;
              },
              range: (from: number, to: number) => mockManifestRange(from, to),
            };
            return query;
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

export function resetFeedDataHarness() {
  vi.clearAllMocks();
  mockProductSelect.mockReset();
  mockProductsOr.mockReset();
  mockProductsNot.mockReset();
  mockProductsIs.mockReset();
  mockProductsGt.mockReset();
  mockProductsOrder.mockReset();
  mockProductsLimit.mockReset();
  mockManifestEq.mockReset();
  mockManifestIn.mockReset();
  mockManifestOrder.mockReset();
  mockManifestRange.mockReset();
  mockReviewSelect.mockReset();
  mockReviewsIn.mockReset();
  mockReviewsOrder.mockReset();
  mockReviewsRange.mockReset();
  harness.productQueryMode = 'non_null';
  mockProductsLimit.mockImplementation(() =>
    Promise.resolve(
      harness.productQueryMode === 'null'
        ? harness.nullCreatedAtProductsResult
        : harness.productsResult
    )
  );
  harness.productsResult = {
    data: [
      {
        id: 'prod-1',
        name: 'Test Phone',
        created_at: '2026-01-01T00:00:00.000Z',
        description: 'A phone',
        slug: 'test-phone',
        price: 50000,
        stock: 5,
        stock_quantity: 5,
        manage_stock: true,
        variants: [
          {
            id: 'var-1',
            attributes: { color: 'Red' },
            stock_quantity: 3,
            sku: 'SKU-RED',
            primary_image: 'https://cdn.example.com/red.jpg',
          },
        ],
      },
    ],
    error: null,
  };
  harness.nullCreatedAtProductsResult = { data: [], error: null };
  harness.manifestResult = {
    data: [
      {
        product_id: 'prod-1',
        verified_url: 'https://cdn.example.com/manifest-front.jpg',
        verified_format: 'jpeg',
        status: 'verified',
        is_primary: true,
        position: 0,
      },
      {
        product_id: 'prod-1',
        variant_id: 'var-1',
        verified_url: 'https://cdn.example.com/manifest-red.jpg',
        verified_format: 'jpeg',
        status: 'verified',
        is_primary: true,
        position: 1,
      },
    ],
    error: null,
  };
  harness.reviewsResult = { data: [], error: null };
  harness.offersResult = { data: [], error: null };
  harness.reviewPageResults = [];
  mockManifestRange.mockImplementation(() =>
    Promise.resolve(harness.manifestResult)
  );
  mockReviewsRange.mockImplementation(() =>
    Promise.resolve(harness.reviewPageResults.shift() ?? harness.reviewsResult)
  );
}
