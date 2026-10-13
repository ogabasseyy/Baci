import { NextRequest } from 'next/server';
import { vi } from 'vitest';

const productImageRouteMocks = vi.hoisted(() => ({
  checkCsrfProtection: vi.fn(),
  checkRateLimit: vi.fn(),
  cookies: vi.fn(),
  from: vi.fn(),
  generateText: vi.fn(),
  getMerchantForApiRequest: vi.fn(),
  getPublicUrl: vi.fn(),
  getUser: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  revalidateProductSlugs: vi.fn(),
  revalidateProducts: vi.fn(),
  rpc: vi.fn(),
  storageFrom: vi.fn(),
  upload: vi.fn(),
}));

export function getProductImageRouteMocks() {
  return productImageRouteMocks;
}

vi.mock('next/headers', () => ({ cookies: productImageRouteMocks.cookies }));
vi.mock('ai', () => ({ generateText: productImageRouteMocks.generateText }));
vi.mock('@/ai/provider', () => ({ activeImageModel: 'mock-image-model' }));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: productImageRouteMocks.checkCsrfProtection,
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: productImageRouteMocks.getMerchantForApiRequest,
}));
vi.mock('@/lib/logger', () => ({
  logger: {
    error: productImageRouteMocks.loggerError,
    warn: productImageRouteMocks.loggerWarn,
  },
}));
vi.mock('@/lib/rate-limiter', () => ({
  checkRateLimit: productImageRouteMocks.checkRateLimit,
}));
vi.mock('@/lib/product-cache-revalidation', () => ({
  productCacheRevalidation: {
    revalidateProducts: (...args: unknown[]) =>
      productImageRouteMocks.revalidateProducts(...args),
    revalidateProductSlugs: (...args: unknown[]) =>
      productImageRouteMocks.revalidateProductSlugs(...args),
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: productImageRouteMocks.getUser },
    from: productImageRouteMocks.from,
    rpc: productImageRouteMocks.rpc,
    storage: { from: productImageRouteMocks.storageFrom },
  })),
}));

export const merchantId = 'merchant-1';
export const parentProductId = '11111111-1111-4111-8111-111111111111';
const userId = 'user-1';

export function productImageRequest(
  url = 'https://usebaci.com/api/admin/generate-product-images'
) {
  return new NextRequest(url, { method: 'POST' });
}

function productsQuery(result: unknown) {
  return {
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
  };
}

export function mockProductImageTables({
  products = [],
  productsError = null,
  updateError = null,
}: {
  products?: Record<string, unknown>[];
  productsError?: unknown;
  updateError?: unknown;
} = {}) {
  const query = productsQuery({ data: products, error: productsError });
  const updateEq = vi.fn();
  const updateChain = { eq: updateEq };
  updateEq.mockReturnValueOnce(updateChain).mockResolvedValueOnce({
    error: updateError,
  });
  const productsTable = {
    select: vi.fn(() => query),
    update: vi.fn(() => updateChain),
  };
  productImageRouteMocks.from.mockImplementation((table: string) => {
    if (table === 'products') return productsTable;
    throw new Error(`Unexpected table: ${table}`);
  });
  return { productsQuery: query, productsTable };
}

export function resetProductImageRouteMocks() {
  vi.clearAllMocks();
  productImageRouteMocks.checkCsrfProtection.mockResolvedValue({
    valid: true,
    response: null,
  });
  productImageRouteMocks.cookies.mockResolvedValue({});
  productImageRouteMocks.getUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  });
  productImageRouteMocks.getMerchantForApiRequest.mockResolvedValue({
    merchantId,
    merchantSlug: 'test-store',
    staffAccess: { isStaff: false },
  });
  productImageRouteMocks.rpc.mockResolvedValue({ data: true, error: null });
  productImageRouteMocks.checkRateLimit.mockResolvedValue(true);
  productImageRouteMocks.storageFrom.mockReturnValue({
    getPublicUrl: productImageRouteMocks.getPublicUrl,
    upload: productImageRouteMocks.upload,
  });
  productImageRouteMocks.upload.mockResolvedValue({
    data: { path: 'product-1/gen.png' },
    error: null,
  });
  productImageRouteMocks.getPublicUrl.mockReturnValue({
    data: { publicUrl: 'https://cdn.usebaci.com/product-1/gen.png' },
  });
  productImageRouteMocks.generateText.mockResolvedValue({
    response: {
      body: {
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    data: Buffer.from('fake-image').toString('base64'),
                    mimeType: 'image/png',
                  },
                },
              ],
            },
          },
        ],
      },
    },
  });
}
