import { NextRequest } from 'next/server';
import { vi } from 'vitest';
import {
  createMockSupabase,
  MERCHANT_ID,
  productRouteTestState,
} from './route-state.test-support';

vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
  getSupabaseAnonKey: () => 'test-anon-key',
  getSupabaseServiceRoleKey: () => 'test-service-role-key',
  getRootDomain: () => 'localhost',
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn(), set: vi.fn() }),
}));
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProductSlugs: vi.fn().mockReturnValue(true),
  revalidateProducts: vi.fn().mockReturnValue(true),
}));

const mockScheduleStorefrontProductPurge = vi.fn();
const mockGenerateProductSlug = vi.hoisted(() =>
  vi.fn((name: string) => name.toLowerCase().replace(/\s/g, '-'))
);
const mockScheduleProductImageTransformsPrewarm = vi.fn();

vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: (...args: unknown[]) =>
    mockScheduleStorefrontProductPurge(...args),
}));
vi.mock('@/lib/schedule-product-image-prewarm', () => ({
  scheduleProductImageTransformsPrewarm: (...args: unknown[]) =>
    mockScheduleProductImageTransformsPrewarm(...args),
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: vi.fn(() =>
    Promise.resolve(productRouteTestState.merchantContext.current)
  ),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn(() =>
    Promise.resolve({
      valid: productRouteTestState.csrfValid,
      response: productRouteTestState.csrfValid
        ? null
        : new Response(JSON.stringify({ error: 'CSRF validation failed' }), {
            status: 403,
          }),
    })
  ),
}));
vi.mock('@/lib/embeddings', () => ({
  getProductEmbeddingText: vi.fn().mockReturnValue('product text'),
}));
vi.mock('@/lib/sanitize', () => ({ sanitizeHtml: (str: string) => str }));
vi.mock('@/lib/sanitize-core', () => ({
  sanitizeLikePattern: (str: string) => str,
  sanitizeSchemaMarkup: (obj: Record<string, unknown>) => obj,
  sanitizeSearchQuery: (str: string) => str,
}));
vi.mock('@/lib/seo-utils', () => ({
  generateMetaDescription: (str: string) => `${str.substring(0, 50)}...`,
  generateProductSchema: () => ({ '@type': 'Product' }),
  generateProductSlug: (name: string) =>
    mockGenerateProductSlug(name) as string,
  generateSlug: (name: string) => name.toLowerCase().replace(/\s/g, '-'),
  getProductUrl: (product: { slug?: string; category?: string | null }) =>
    product.category
      ? `/${product.category.toLowerCase().replace(/\s+/g, '-')}/${product.slug}`
      : `/products/${product.slug}`,
}));
vi.mock('@/lib/countries', () => ({
  getCountryByCode: (code: string) => ({
    code,
    name: 'Test Country',
    currency: 'NGN',
  }),
}));
vi.mock('@/schemas/products', () => ({
  createProductSchema: {
    safeParse: (data: Record<string, unknown>) => {
      if (!data.name) {
        return {
          success: false,
          error: { issues: [{ path: ['name'], message: 'Required' }] },
        };
      }
      if (typeof data.price === 'number' && data.price < 0) {
        return {
          success: false,
          error: { issues: [{ path: ['price'], message: 'Must be positive' }] },
        };
      }
      return { success: true, data };
    },
  },
  formatZodErrors: (error: { issues: { path: string[]; message: string }[] }) =>
    error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    })),
}));
vi.mock('@/lib/product-variant-model', () => ({
  inferProductVariantModel: vi.fn(
    ({
      variantModel,
      hasVariants,
    }: {
      variantModel?: string;
      hasVariants?: boolean;
    }) =>
      variantModel === 'sku_matrix'
        ? 'sku_matrix'
        : hasVariants
          ? 'legacy'
          : 'simple'
  ),
  getSkuMatrixValidationError: vi.fn(
    ({
      variantModel,
      variants,
    }: {
      variantModel?: string;
      variants?: Array<{ price_override?: number }>;
    }) => {
      if (variantModel !== 'sku_matrix') return null;
      return (variants ?? []).some(
        (variant) =>
          typeof variant.price_override !== 'number' ||
          variant.price_override < 0
      )
        ? 'Every sku_matrix variant must include a non-negative price_override.'
        : null;
    }
  ),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createMockSupabase(),
}));

const { GET, POST } = await import('./route');

const validCreateBody = {
  name: 'Test Product',
  description: 'A great product',
  price: 5000,
  stock: 100,
  manage_stock: true,
  status: 'draft',
  category: 'Electronics',
  images: [{ url: 'https://example.com/image.png' }],
};

function makeGetRequest(params?: Record<string, string>) {
  const url = new URL('http://localhost:3000/api/products');
  for (const [key, value] of Object.entries(params ?? {}))
    url.searchParams.set(key, value);
  return new NextRequest(url.toString(), { method: 'GET' });
}

function makePostRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export {
  GET,
  MERCHANT_ID,
  makeGetRequest,
  makePostRequest,
  mockGenerateProductSlug,
  mockScheduleProductImageTransformsPrewarm,
  mockScheduleStorefrontProductPurge,
  POST,
  validCreateBody,
};
