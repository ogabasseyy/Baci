import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sanitizeSearchQuery } from '@/lib/sanitize-core';
import { GET as autocompleteGET } from './autocomplete/route';
import { GET as searchGET } from './route';

const afterCallbacks = vi.hoisted(
  () => [] as Array<() => Promise<void> | void>
);

async function flushAfterCallbacks() {
  const callbacks = afterCallbacks.splice(0);
  await Promise.all(callbacks.map((callback) => callback()));
}

let mockProductsQueryData: unknown[] = [];
let mockProductsQueryError: { code?: string; message: string } | null = null;

type MockProductsQueryResult = {
  data: unknown[];
  error: { code?: string; message: string } | null;
};

type ProductsQueryResolve = (value: MockProductsQueryResult) => unknown;
type ProductsQueryReject = (reason?: unknown) => unknown;
type ChainableMockMethod = ReturnType<typeof vi.fn>;

interface SharedChainableMock {
  select: ChainableMockMethod;
  eq: ChainableMockMethod;
  in: ChainableMockMethod;
  ilike: ChainableMockMethod;
  or: ChainableMockMethod;
  single: ChainableMockMethod;
  maybeSingle: ChainableMockMethod;
  insert: ChainableMockMethod;
  update: ChainableMockMethod;
  delete: ChainableMockMethod;
  upsert: ChainableMockMethod;
  order: ChainableMockMethod;
  limit: ChainableMockMethod;
  range: ChainableMockMethod;
  then: (
    resolve: ProductsQueryResolve,
    reject?: ProductsQueryReject
  ) => Promise<unknown>;
}

// Mock env
vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://mock.supabase.co',
  getSupabaseAnonKey: () => 'mock-key',
  getSupabaseServiceRoleKey: () => 'mock-service-key',
  getRootDomain: () => 'localhost:3000',
}));

// Shared mock for chainable methods
const sharedChainableMock: SharedChainableMock = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  ilike: vi.fn().mockReturnThis(),
  or: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({
    data: {
      id: 'merchant-id',
      business_name: 'Test Merchant',
      country: 'NG',
    },
    error: null,
  }),
  maybeSingle: vi.fn().mockResolvedValue({ data: null }),
  insert: vi.fn().mockResolvedValue({ error: null }),
  update: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  upsert: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  range: vi.fn().mockReturnThis(),
  // biome-ignore lint/suspicious/noThenProperty: needed for thenable mock
  then: (resolve, reject) =>
    Promise.resolve({
      data: mockProductsQueryData,
      error: mockProductsQueryError,
    }).then(resolve, reject),
};

const mockSupabase = {
  auth: {
    getUser: vi.fn().mockResolvedValue({
      data: { user: { id: 'test-user-id' } },
      error: null,
    }),
  },
  from: vi.fn(() => sharedChainableMock),
  rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
};

const mockAnalyticsChainable = {
  insert: vi.fn().mockResolvedValue({ error: null }),
};

const mockAnalyticsSupabase = {
  from: vi.fn(() => mockAnalyticsChainable),
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: vi.fn(() => mockAnalyticsSupabase),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn(),
  }),
}));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    after: vi.fn((callback: () => Promise<void> | void) => {
      afterCallbacks.push(callback);
    }),
  };
});

describe('Search API Security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    afterCallbacks.length = 0;
    mockProductsQueryData = [];
    mockProductsQueryError = null;
    mockSupabase.rpc.mockReset();
    mockSupabase.rpc.mockResolvedValue({ data: [], error: null });
    mockAnalyticsSupabase.from.mockClear();
    mockAnalyticsChainable.insert.mockReset();
    mockAnalyticsChainable.insert.mockResolvedValue({ error: null });
  });

  describe('GET /api/search', () => {
    it('sanitizes direct search reads without recording a submission', async () => {
      const maliciousQuery = '<script>alert(1)</script>';
      const merchantId = '123e4567-e89b-12d3-a456-426614174000';
      const request = new NextRequest(
        `http://localhost:3000/api/search?q=${encodeURIComponent(maliciousQuery)}&merchant_id=${merchantId}&limit=10`
      );
      const response = await searchGET(request);
      expect(response.status).toBe(200);
      expect((await response.json()).query).toBe(
        sanitizeSearchQuery(maliciousQuery)
      );
      await flushAfterCallbacks();
      // Reads are silent: no render row and no explicit submission row.
      expect(mockAnalyticsChainable.insert).not.toHaveBeenCalled();
      expect(afterCallbacks).toHaveLength(0);
    });

    it('should validate merchant_id UUID', async () => {
      const invalidMerchantId = 'not-a-uuid';
      const request = new NextRequest(
        `http://localhost:3000/api/search?q=test&merchant_id=${invalidMerchantId}`
      );

      const response = await searchGET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toMatch(/Invalid merchant_id/);
    });

    it('degrades to no suggestion when the spelling suggestion lookup fails', async () => {
      mockSupabase.rpc
        .mockResolvedValueOnce({ data: [], error: null })
        .mockResolvedValueOnce({
          data: null,
          error: { message: 'suggestion failed' },
        });

      const request = new NextRequest(
        'http://localhost:3000/api/search?q=iphone&merchant_id=123e4567-e89b-12d3-a456-426614174000'
      );

      const response = await searchGET(request);

      // The "did you mean" lookup is additive — its failure must not turn a
      // valid zero-results search into a 500.
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.didYouMean).toBeNull();
      expect(data.productIds).toEqual([]);
    });
  });

  describe('GET /api/search/autocomplete', () => {
    it('should sanitize search query before passing it to ranked autocomplete search', async () => {
      const maliciousQuery = '<script>alert(1)</script>100%';
      const merchantId = '123e4567-e89b-12d3-a456-426614174000';
      const expectedQuery = sanitizeSearchQuery(maliciousQuery);
      mockSupabase.rpc.mockResolvedValueOnce({
        data: [{ product_id: 'product-id', total_count: 1 }],
        error: null,
      });

      const request = new NextRequest(
        `http://localhost:3000/api/search/autocomplete?q=${encodeURIComponent(
          maliciousQuery
        )}&merchant_id=${merchantId}`
      );

      const response = await autocompleteGET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'search_products_v2',
        expect.objectContaining({
          merchant_id_param: merchantId,
          search_query: expectedQuery,
        })
      );
      expect(sharedChainableMock.select).toHaveBeenCalledWith(
        'id, name, category, price, images, slug'
      );
      expect(sharedChainableMock.in).toHaveBeenCalledWith('id', ['product-id']);
      expect(sharedChainableMock.eq).toHaveBeenCalledWith(
        'merchant_id',
        merchantId
      );
      expect(sharedChainableMock.eq).toHaveBeenCalledWith('status', 'active');
      expect(sharedChainableMock.or).not.toHaveBeenCalled();
      expect(sharedChainableMock.ilike).not.toHaveBeenCalled();
      expect(data.popularSearches).toEqual([]);
    });

    it('handles comma and quote search text without raw PostgREST OR filters', async () => {
      const merchantId = '123e4567-e89b-12d3-a456-426614174000';
      const rawQuery = 'shirt, "blue"';

      const request = new NextRequest(
        `http://localhost:3000/api/search/autocomplete?q=${encodeURIComponent(
          rawQuery
        )}&merchant_id=${merchantId}`
      );

      const response = await autocompleteGET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.popularSearches).toEqual([]);
      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'search_products_v2',
        expect.objectContaining({
          merchant_id_param: merchantId,
          search_query: sanitizeSearchQuery(rawQuery),
        })
      );
      expect(sharedChainableMock.or).not.toHaveBeenCalled();
      expect(sharedChainableMock.ilike).not.toHaveBeenCalled();
    });

    it('returns bounded ranked product suggestions from the products table', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({
        data: [{ product_id: 'product-id', total_count: 1 }],
        error: null,
      });
      mockProductsQueryData = [
        {
          id: 'product-id',
          name: 'iPhone 15',
          category: 'Smartphones',
          price: 750000,
          images: ['https://example.com/iphone.jpg'],
          slug: 'iphone-15',
        },
      ];

      const request = new NextRequest(
        'http://localhost:3000/api/search/autocomplete?q=iphone&merchant_id=123e4567-e89b-12d3-a456-426614174000&limit=5'
      );

      const response = await autocompleteGET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'search_products_v2',
        expect.objectContaining({ result_limit: 5 })
      );
      expect(mockSupabase.from).toHaveBeenCalledWith('products');
      expect(sharedChainableMock.select).toHaveBeenCalledWith(
        'id, name, category, price, images, slug'
      );
      expect(sharedChainableMock.in).toHaveBeenCalledWith('id', ['product-id']);
      expect(data).toEqual({
        suggestions: [
          {
            id: 'product-id',
            name: 'iPhone 15',
            category: 'Smartphones',
            price: 750000,
            image_small: 'https://example.com/iphone.jpg',
            slug: 'iphone-15',
            relevance: 1,
          },
        ],
        popularSearches: [],
      });
    });

    it('does not issue legacy per-column ilike scans', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/search/autocomplete?q=iphone&merchant_id=123e4567-e89b-12d3-a456-426614174000&limit=1'
      );

      const response = await autocompleteGET(request);

      expect(response.status).toBe(200);
      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'search_products_v2',
        expect.objectContaining({ search_query: 'iphone', result_limit: 1 })
      );
      expect(sharedChainableMock.ilike).not.toHaveBeenCalled();
      expect(sharedChainableMock.order).not.toHaveBeenCalled();
      expect(sharedChainableMock.limit).not.toHaveBeenCalled();
    });

    it('returns a stable empty response for short autocomplete queries', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/search/autocomplete?q=i&merchant_id=123e4567-e89b-12d3-a456-426614174000&limit=10'
      );

      const response = await autocompleteGET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ suggestions: [], popularSearches: [] });
      expect(mockSupabase.rpc).not.toHaveBeenCalled();
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('rejects malformed autocomplete limits before querying Supabase', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/search/autocomplete?q=iphone&merchant_id=123e4567-e89b-12d3-a456-426614174000&limit=not-a-number'
      );

      const response = await autocompleteGET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid autocomplete parameters');
      expect(mockSupabase.rpc).not.toHaveBeenCalled();
      expect(mockSupabase.from).not.toHaveBeenCalled();
      expect(sharedChainableMock.limit).not.toHaveBeenCalled();
    });

    it('resolves object image urls and normalizes empty payloads to null image_small', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({
        data: [
          { product_id: 'product-null-image', total_count: 3 },
          { product_id: 'product-empty-image', total_count: 3 },
          { product_id: 'product-object-image', total_count: 3 },
        ],
        error: null,
      });
      mockProductsQueryData = [
        {
          id: 'product-null-image',
          name: 'Null Image Product',
          category: 'Smartphones',
          price: 100000,
          images: null,
          slug: 'null-image-product',
        },
        {
          id: 'product-empty-image',
          name: 'Empty Image Product',
          category: 'Smartphones',
          price: 110000,
          images: [],
          slug: 'empty-image-product',
        },
        {
          id: 'product-object-image',
          name: 'Object Image Product',
          category: 'Smartphones',
          price: 120000,
          images: [{ url: 'https://example.com/object-image.jpg' }],
          slug: 'object-image-product',
        },
      ];

      const request = new NextRequest(
        'http://localhost:3000/api/search/autocomplete?q=image&merchant_id=123e4567-e89b-12d3-a456-426614174000&limit=10'
      );

      const response = await autocompleteGET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(mockSupabase.from).toHaveBeenCalledWith('products');
      expect(sharedChainableMock.in).toHaveBeenCalledWith('id', [
        'product-null-image',
        'product-empty-image',
        'product-object-image',
      ]);
      expect(data.suggestions).toEqual([
        {
          id: 'product-null-image',
          name: 'Null Image Product',
          category: 'Smartphones',
          price: 100000,
          image_small: null,
          slug: 'null-image-product',
          relevance: 1,
        },
        {
          id: 'product-empty-image',
          name: 'Empty Image Product',
          category: 'Smartphones',
          price: 110000,
          image_small: null,
          slug: 'empty-image-product',
          relevance: 1,
        },
        {
          id: 'product-object-image',
          name: 'Object Image Product',
          category: 'Smartphones',
          price: 120000,
          image_small: 'https://example.com/object-image.jpg',
          slug: 'object-image-product',
          relevance: 1,
        },
      ]);
    });

    it('returns empty suggestions when autocomplete query times out', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({
        data: null,
        error: {
          code: '57014',
          message: 'canceling statement due to statement timeout',
        },
      });

      const request = new NextRequest(
        'http://localhost:3000/api/search/autocomplete?q=iphone&merchant_id=123e4567-e89b-12d3-a456-426614174000'
      );

      const response = await autocompleteGET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        suggestions: [],
        popularSearches: [],
      });
    });

    it('should validate merchant_id UUID', async () => {
      const invalidMerchantId = 'not-a-uuid';
      const request = new NextRequest(
        `http://localhost:3000/api/search/autocomplete?q=test&merchant_id=${invalidMerchantId}`
      );

      const response = await autocompleteGET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toMatch(/Invalid merchant_id/);
      expect(mockSupabase.rpc).not.toHaveBeenCalled();
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });
  });
});
