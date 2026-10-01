import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgenticScopedSupabaseClient } from '@/lib/agentic/scoped-supabase';

const VALID_AGENTIC_MERCHANT_ID = '00000000-0000-4000-8000-000000000001';
const mockVerifyAgenticApiKey = vi.hoisted(() => vi.fn(() => true));
const mockReadAgenticQueryRequest = vi.hoisted(() => vi.fn());
const mockResolveAgenticMerchantContext = vi.hoisted(() =>
  vi.fn(async () => ({
    agent_user_agent_allowlist: [],
    agent_user_agent_denylist: [],
    agentic_checkout_enabled: true,
    business_name: 'Ogabassey',
    custom_domain: undefined,
    id: '00000000-0000-4000-8000-000000000001',
    pay_on_delivery_enabled: false,
    paystack_subaccount_code: null,
    slug: 'ogabassey',
  }))
);

vi.mock('@/lib/agentic/auth', () => ({
  verifyAgenticApiKey: mockVerifyAgenticApiKey,
}));

vi.mock('@/lib/agentic/mutation-request', () => ({
  readAgenticQueryRequest: mockReadAgenticQueryRequest,
}));

vi.mock('@/lib/agentic/agent-request-controls', () => ({
  verifyAgenticRequestAccess: vi.fn(() => ({ ok: true })),
}));

vi.mock('@/lib/agentic/merchant-context', () => ({
  resolveAgenticMerchantContext: mockResolveAgenticMerchantContext,
}));

vi.mock('@/lib/agentic/scoped-supabase', () => ({
  createAgenticScopedSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({})),
}));

import { POST } from './route';

type ProductRow = {
  categories?: { slug?: string | null } | null;
  category?: string;
  id: string;
  name: string;
  price?: number | string | null;
  product_categories?: Array<{ categories?: { slug?: string | null } | null }>;
  slug?: string;
  status?: string;
};

let mockSelect: ReturnType<typeof vi.fn>;
let mockRpc: ReturnType<typeof vi.fn>;
let query: {
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  or: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
};

function mockProductRows(rows: ProductRow[]) {
  mockRpc = vi.fn().mockResolvedValue({
    data: rows
      .filter((row) => row.status !== 'draft')
      .map((row) => ({ product_id: row.id, total_count: rows.length })),
    error: null,
  });
  let categoryFilter: string | undefined;
  query = {
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    limit: vi.fn(async () => ({ data: rows, error: null })),
    or: vi.fn((expression: string) => {
      categoryFilter = expression.match(/^category\.eq\.([^,]+)/)?.[1];
      return query;
    }),
    order: vi.fn(() => query),
    range: vi.fn(async (from: number, to: number) => ({
      data: rows
        .filter(
          (row) =>
            !categoryFilter ||
            row.category === categoryFilter ||
            row.categories?.slug === categoryFilter
        )
        .slice(from, to + 1),
      error: null,
    })),
  };
  mockSelect = vi.fn(() => query);
  vi.mocked(createAgenticScopedSupabaseClient).mockReturnValue({
    rpc: mockRpc,
    from: vi.fn(() => ({ select: mockSelect })),
  } as never);
}

describe('POST /api/agentic/catalog/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyAgenticApiKey.mockReturnValue(true);
    mockReadAgenticQueryRequest.mockImplementation(
      async ({ request }: { request: NextRequest }) => {
        try {
          return {
            agentId: null,
            apiVersion: '2026-04-30',
            body: await request.json(),
            idempotencyKey: '',
            method: request.method,
            ok: true,
            pathname: request.nextUrl.pathname,
            rawBody: '',
            requestId: 'catalog-request-1',
          };
        } catch {
          return {
            ok: false,
            response: NextResponse.json(
              { error: 'Invalid JSON body' },
              { status: 400 }
            ),
          };
        }
      }
    );
    mockProductRows([]);
  });

  it('returns 401 when the agent key is missing', async () => {
    mockVerifyAgenticApiKey.mockReturnValueOnce(false);

    const response = await POST(
      new NextRequest('http://localhost/api/agentic/catalog/search', {
        body: JSON.stringify({ query: 'iphone' }),
        method: 'POST',
      })
    );

    expect(response.status).toBe(401);
    expect(createAgenticScopedSupabaseClient).not.toHaveBeenCalled();
  });

  it('propagates a catalog request-signing rejection before reading products', async () => {
    mockReadAgenticQueryRequest.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      ),
    });

    const response = await POST(
      new NextRequest('http://localhost/api/agentic/catalog/search', {
        body: JSON.stringify({ query: 'iphone' }),
        method: 'POST',
      })
    );

    expect(response.status).toBe(401);
    expect(createAgenticScopedSupabaseClient).not.toHaveBeenCalled();
  });

  it('returns matching active products for a text query', async () => {
    mockProductRows([
      {
        id: 'product-1',
        name: 'iPhone 15',
        price: 1_200_000,
        slug: 'iphone-15',
        status: 'active',
      },
    ]);

    const response = await POST(
      new NextRequest('http://localhost/api/agentic/catalog/search', {
        body: JSON.stringify({ query: 'iphone', pagination: { limit: 10 } }),
        method: 'POST',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.products).toEqual([
      expect.objectContaining({ id: 'product-1', title: 'iPhone 15' }),
    ]);
    expect(query.order).toHaveBeenCalledWith('category_id', {
      ascending: true,
      referencedTable: 'product_categories',
    });
    expect(query.eq).toHaveBeenCalledWith(
      'merchant_id',
      VALID_AGENTIC_MERCHANT_ID
    );
    expect(query.eq).toHaveBeenCalledWith('status', 'active');
    expect(mockRpc).toHaveBeenCalledWith(
      'search_products_v2',
      expect.objectContaining({ search_query: 'iphone' })
    );
    expect(query.in).toHaveBeenCalledWith('id', ['product-1']);
    expect(query.or).not.toHaveBeenCalled();
  });

  it('omits unpublished products returned by the database', async () => {
    mockProductRows([
      { id: 'draft-product', name: 'Draft', status: 'draft' },
      { id: 'product-1', name: 'Live', price: 0, status: 'active' },
    ]);

    const response = await POST(
      new NextRequest('http://localhost/api/agentic/catalog/search', {
        body: JSON.stringify({ query: 'phone' }),
        method: 'POST',
      })
    );
    const body = await response.json();

    expect(body.products).toEqual([
      expect.objectContaining({ id: 'product-1' }),
    ]);
  });

  it('omits active products with malformed prices', async () => {
    mockProductRows([
      { id: 'bad-price', name: 'Bad', price: '123abc', status: 'active' },
      { id: 'free-product', name: 'Free', price: 0, status: 'active' },
    ]);

    const response = await POST(
      new NextRequest('http://localhost/api/agentic/catalog/search', {
        body: JSON.stringify({ query: 'phone' }),
        method: 'POST',
      })
    );
    const body = await response.json();

    expect(body.products.map((product: { id: string }) => product.id)).toEqual([
      'free-product',
    ]);
  });

  it('backfills filter-only results after refusing invalid candidates', async () => {
    mockProductRows([
      {
        id: 'bad-price-1',
        name: 'Bad 1',
        price: -1,
        status: 'active',
        category: 'phones',
      },
      {
        id: 'bad-price-2',
        name: 'Bad 2',
        price: Number.NaN,
        status: 'active',
        category: 'phones',
      },
      {
        id: 'valid-product',
        name: 'Valid',
        price: 100,
        status: 'active',
        category: 'phones',
      },
    ]);

    const response = await POST(
      new NextRequest('http://localhost/api/agentic/catalog/search', {
        body: JSON.stringify({
          filters: { category: 'phones' },
          pagination: { limit: 1 },
        }),
        method: 'POST',
      })
    );
    const body = await response.json();

    expect(query.order).toHaveBeenCalledWith('id', { ascending: true });
    expect(query.range).toHaveBeenNthCalledWith(1, 0, 99);
    expect(body.products.map((product: { id: string }) => product.id)).toEqual([
      'valid-product',
    ]);
  });

  it('bounds filter-only results when a valid batch exceeds the page size', async () => {
    mockProductRows([
      {
        id: 'product-1',
        name: 'First',
        price: 100,
        status: 'active',
        category: 'laptops',
      },
      {
        id: 'product-2',
        name: 'Second',
        price: 200,
        status: 'active',
        category: 'phones',
      },
    ]);

    const response = await POST(
      new NextRequest('http://localhost/api/agentic/catalog/search', {
        body: JSON.stringify({
          filters: { category: 'phones' },
          pagination: { limit: 1 },
        }),
        method: 'POST',
      })
    );
    const body = await response.json();

    expect(body.products).toHaveLength(1);
    expect(body.products[0]).toEqual(
      expect.objectContaining({ id: 'product-2' })
    );
  });

  it('does not use select star in Supabase queries', async () => {
    await POST(
      new NextRequest('http://localhost/api/agentic/catalog/search', {
        body: JSON.stringify({ query: 'phone' }),
        method: 'POST',
      })
    );

    expect(mockSelect).not.toHaveBeenCalledWith('*');
  });

  it('selects junction categories for legacy category-only products', async () => {
    mockProductRows([
      {
        id: 'legacy-product',
        name: 'Legacy product',
        price: 100,
        product_categories: [{ categories: { slug: 'laptops' } }],
        status: 'active',
      },
    ]);

    await POST(
      new NextRequest('http://localhost/api/agentic/catalog/search', {
        body: JSON.stringify({ query: 'phone' }),
        method: 'POST',
      })
    );

    expect(mockSelect).toHaveBeenCalledWith(
      expect.stringContaining(
        'product_categories:product_categories(category_id, categories(slug, is_active))'
      )
    );
  });
});
