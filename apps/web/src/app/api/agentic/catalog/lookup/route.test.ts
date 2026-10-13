import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgenticScopedSupabaseClient } from '@/lib/agentic/scoped-supabase';
import { POST } from './route';

const mockVerifyAgenticApiKey = vi.hoisted(() => vi.fn(() => true));
const mockReadAgenticQueryRequest = vi.hoisted(() => vi.fn());
const mockResolveAgenticMerchantContext = vi.hoisted(() =>
  vi.fn(async () => ({
    agent_user_agent_allowlist: [],
    agent_user_agent_denylist: [],
    agentic_checkout_enabled: true,
    business_name: 'Ogabassey',
    custom_domain: undefined,
    id: 'merchant-1',
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

type ProductRow = {
  categories?: { slug?: string | null } | null;
  id: string;
  name: string;
  price?: number | string | null;
  product_categories?: Array<{ categories?: { slug?: string | null } | null }>;
  slug?: string;
  status?: string;
};

let query: {
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
};

function mockProductRows(rows: ProductRow[]) {
  query = {
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    limit: vi.fn(async () => ({ data: rows, error: null })),
    order: vi.fn(() => query),
  };
  vi.mocked(createAgenticScopedSupabaseClient).mockReturnValue({
    from: vi.fn(() => ({ select: vi.fn(() => query) })),
  } as never);
}

describe('POST /api/agentic/catalog/lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyAgenticApiKey.mockReturnValue(true);
    mockReadAgenticQueryRequest.mockImplementation(
      async ({ request }: { request: NextRequest }) => ({
        agentId: null,
        apiVersion: '2026-04-30',
        body: await request.json(),
        idempotencyKey: '',
        method: request.method,
        ok: true,
        pathname: request.nextUrl.pathname,
        rawBody: '',
        requestId: 'catalog-request-1',
      })
    );
    mockProductRows([]);
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
      new NextRequest('http://localhost/api/agentic/catalog/lookup', {
        body: JSON.stringify({ ids: ['product-1'] }),
        method: 'POST',
      })
    );

    expect(response.status).toBe(401);
    expect(createAgenticScopedSupabaseClient).not.toHaveBeenCalled();
  });

  it('returns lookup products in requested ID order', async () => {
    mockProductRows([
      {
        id: 'product-2',
        name: 'MacBook',
        price: 2_500_000,
        slug: 'macbook',
        status: 'active',
      },
      {
        id: 'product-1',
        name: 'iPhone',
        price: 1_200_000,
        slug: 'iphone',
        status: 'active',
      },
    ]);

    const response = await POST(
      new NextRequest('http://localhost/api/agentic/catalog/lookup', {
        body: JSON.stringify({ ids: ['product-1', 'product-2'] }),
        method: 'POST',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.products.map((product: { id: string }) => product.id)).toEqual([
      'product-1',
      'product-2',
    ]);
    expect(body.products[0].variants).toEqual([
      expect.objectContaining({
        inputs: [expect.objectContaining({ id: 'product-1' })],
      }),
    ]);
    expect(query.in).toHaveBeenCalledWith('id', ['product-1', 'product-2']);
  });

  it('rejects empty lookup IDs', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/agentic/catalog/lookup', {
        body: JSON.stringify({ ids: [] }),
        method: 'POST',
      })
    );

    expect(response.status).toBe(400);
    expect(query.in).not.toHaveBeenCalled();
  });

  it('omits active products with malformed prices', async () => {
    mockProductRows([
      { id: 'bad-price', name: 'Bad', price: '123abc', status: 'active' },
      { id: 'free-product', name: 'Free', price: 0, status: 'active' },
    ]);

    const { POST } = await import('./route');
    const response = await POST(
      new NextRequest('http://localhost/api/agentic/catalog/lookup', {
        body: JSON.stringify({ ids: ['bad-price', 'free-product'] }),
        method: 'POST',
      })
    );
    const body = await response.json();

    expect(body.products.map((product: { id: string }) => product.id)).toEqual([
      'free-product',
    ]);
  });

  it('selects junction categories for legacy category-only products', async () => {
    const select = vi.fn(() => query);
    vi.mocked(createAgenticScopedSupabaseClient).mockReturnValue({
      from: vi.fn(() => ({ select })),
    } as never);

    await POST(
      new NextRequest('http://localhost/api/agentic/catalog/lookup', {
        body: JSON.stringify({ ids: ['product-1'] }),
        method: 'POST',
      })
    );

    expect(select).toHaveBeenCalledWith(
      expect.stringContaining(
        'product_categories:product_categories(category_id, categories(slug, is_active))'
      )
    );
  });

  it('keeps the canonical category path for a junction-only product', async () => {
    mockProductRows([
      {
        id: 'product-1',
        name: 'Laptop',
        price: 0,
        product_categories: [{ categories: { slug: 'laptops' } }],
        slug: 'thin-laptop',
        status: 'active',
      },
    ]);

    const response = await POST(
      new NextRequest('http://localhost/api/agentic/catalog/lookup', {
        body: JSON.stringify({ ids: ['product-1'] }),
        method: 'POST',
      })
    );
    const body = await response.json();

    expect(body.products[0].url).toBe(
      'https://ogabassey.usebaci.com/laptops/thin-laptop'
    );
  });
});
