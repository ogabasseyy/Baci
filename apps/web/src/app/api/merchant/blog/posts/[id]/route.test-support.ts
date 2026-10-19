import { NextRequest } from 'next/server';
import { vi } from 'vitest';
import { DEFAULT_BLOG_MEDIA_CDN_ORIGIN } from '@/config/cdn';

type ServerModule = typeof import('next/server');
type IndexnowModule = typeof import('@/lib/indexnow');

// ---- Mocks ----

vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
  getSupabaseAnonKey: () => 'test-anon-key',
  getRootDomain: () => 'localhost',
}));

vi.mock('next/server', async () => {
  const actual = await vi.importActual<ServerModule>('next/server');

  return {
    ...actual,
    after: (callback: () => void | Promise<void>) => callback(),
  };
});

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn(),
    set: vi.fn(),
  }),
}));

// Mock API auth
const mockAuthenticateApiRequest = vi.fn();
const mockGetUserAccess = vi.fn();
const mockHasPermission = vi.fn();
const mockGetMerchantForApiRequest = vi.fn();
const mockToUserAccess = vi.fn();

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mockAuthenticateApiRequest(...args),
  getUserAccess: (...args: unknown[]) => mockGetUserAccess(...args),
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) =>
    mockGetMerchantForApiRequest(...args),
  toUserAccess: (...args: unknown[]) => mockToUserAccess(...args),
}));

// Mock cache revalidation
const mockRevalidateBlogPosts = vi.fn();
const mockGetMerchantBlogCacheIdentifiers = vi.fn();
const mockDispatchZohoBlogCampaign = vi.fn();
const mockInvokeEmbedding = vi
  .fn()
  .mockResolvedValue({ data: null, error: null });
const mockSubmitIndexNowUrls = vi.fn();

vi.mock('@/lib/cache-revalidation', () => ({
  revalidateBlogPosts: (...args: unknown[]) => mockRevalidateBlogPosts(...args),
}));

vi.mock('@/lib/get-merchant-blog-cache-identifiers', () => ({
  getMerchantBlogRevalidationContext: (...args: unknown[]) =>
    mockGetMerchantBlogCacheIdentifiers(...args),
}));

vi.mock('@/lib/zoho-blog-campaign-server', () => ({
  dispatchConfiguredZohoBlogCampaign: (...args: unknown[]) =>
    mockDispatchZohoBlogCampaign(...args),
}));

vi.mock('@/lib/indexnow', async (importOriginal) => {
  const actual = await importOriginal<IndexnowModule>();

  return {
    ...actual,
  };
});
vi.mock('@/lib/indexnow-server', () => ({
  submitConfiguredIndexNowUrls: (...args: unknown[]) =>
    mockSubmitIndexNowUrls(...args),
}));

// Mock blog image prewarm scheduling
const mockSchedulePrewarmBlogImageTransforms = vi.fn();

vi.mock('@/lib/ogabassey-blog-image-prewarm', () => ({
  schedulePrewarmBlogImageTransforms: (...args: unknown[]) =>
    mockSchedulePrewarmBlogImageTransforms(...args),
}));

// Mock embeddings
const mockGetBlogEmbeddingText = vi.fn();

vi.mock('@/lib/embeddings', () => ({
  getBlogEmbeddingText: (...args: unknown[]) =>
    mockGetBlogEmbeddingText(...args),
}));

// Mock next/cache
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

// Supabase mock - create a chainable mock
const createChainableMock = () => {
  const mock = {
    from: vi.fn(),
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    eq: vi.fn(),
    neq: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    in: vi.fn(),
    rpc: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
    functions: { invoke: mockInvokeEmbedding },
  };

  // Make all methods return the mock for chaining
  mock.from.mockReturnValue(mock);
  mock.select.mockReturnValue(mock);
  mock.insert.mockReturnValue(mock);
  mock.update.mockReturnValue(mock);
  mock.delete.mockReturnValue(mock);
  mock.eq.mockReturnValue(mock);
  mock.neq.mockReturnValue(mock);
  mock.or.mockReturnValue(mock);
  mock.order.mockReturnValue(mock);
  mock.range.mockReturnValue(mock);
  mock.in.mockReturnValue(mock);
  mock.rpc.mockReturnValue(mock);

  return mock;
};

const mockSupabase = createChainableMock();

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockSupabase,
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn(() =>
    Promise.resolve({ valid: true, response: null })
  ),
}));

// Mock global fetch for embedding generation
global.fetch = vi.fn();

// ---- Import handler AFTER mocks ----
const { DELETE, GET, PATCH } = await import('./route');

// ---- Constants ----

const MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const USER_ID = 'user-123';
const POST_ID = 'post-abc-123';
const managedFeaturedImageUrl = `${DEFAULT_BLOG_MEDIA_CDN_ORIGIN}/storage/v1/object/public/media/${MERCHANT_ID}/blog/cover.png`;
const replacementManagedFeaturedImageUrl = `${DEFAULT_BLOG_MEDIA_CDN_ORIGIN}/storage/v1/object/public/media/${MERCHANT_ID}/blog/replacement.png`;
const managedLandscapeVariantUrl = `${DEFAULT_BLOG_MEDIA_CDN_ORIGIN}/storage/v1/object/public/media/${MERCHANT_ID}/blog/upload-1/landscape_16x9.webp`;

// ---- Helpers ----

function makeRequest(
  url: string,
  method: 'GET' | 'PATCH' | 'DELETE',
  body?: Record<string, unknown>
) {
  const requestUrl = new URL(`http://localhost:3000${url}`);
  requestUrl.searchParams.set('merchantId', MERCHANT_ID);
  return new NextRequest(requestUrl, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body && { body: JSON.stringify(body) }),
  });
}

function makeParams(id: string) {
  return {
    params: Promise.resolve({ id }),
  };
}

function setupAuth(hasAuth = true, hasAccess = true) {
  if (hasAuth) {
    mockAuthenticateApiRequest.mockResolvedValue({
      user: { id: USER_ID },
      supabase: mockSupabase,
    });
  } else {
    mockAuthenticateApiRequest.mockResolvedValue({
      error: 'Unauthorized',
      user: null,
      supabase: null,
    });
  }

  if (hasAccess) {
    const access = {
      merchantId: MERCHANT_ID,
      role: 'owner',
    };
    mockGetUserAccess.mockResolvedValue(access);
    mockGetMerchantForApiRequest.mockResolvedValue({
      merchantId: MERCHANT_ID,
      staffAccess: { isOwner: true, isStaff: false, permissions: {} },
    });
    mockToUserAccess.mockReturnValue(access);
  } else {
    mockGetUserAccess.mockResolvedValue(null);
    mockGetMerchantForApiRequest.mockResolvedValue(null);
  }
}

// ---- Tests ----

export {
  createChainableMock,
  DELETE,
  GET,
  MERCHANT_ID,
  makeParams,
  makeRequest,
  managedFeaturedImageUrl,
  managedLandscapeVariantUrl,
  mockAuthenticateApiRequest,
  mockDispatchZohoBlogCampaign,
  mockGetBlogEmbeddingText,
  mockGetMerchantBlogCacheIdentifiers,
  mockGetMerchantForApiRequest,
  mockGetUserAccess,
  mockHasPermission,
  mockInvokeEmbedding,
  mockRevalidateBlogPosts,
  mockSchedulePrewarmBlogImageTransforms,
  mockSubmitIndexNowUrls,
  mockSupabase,
  mockToUserAccess,
  PATCH,
  POST_ID,
  replacementManagedFeaturedImageUrl,
  setupAuth,
  USER_ID,
};
