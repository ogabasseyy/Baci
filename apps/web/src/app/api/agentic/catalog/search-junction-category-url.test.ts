import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgenticScopedSupabaseClient } from '@/lib/agentic/scoped-supabase';
import { POST } from './search/route';

const mockReadAgenticQueryRequest = vi.hoisted(() => vi.fn());

vi.mock('@/lib/agentic/auth', () => ({
  verifyAgenticApiKey: vi.fn(() => true),
}));

vi.mock('@/lib/agentic/mutation-request', () => ({
  readAgenticQueryRequest: mockReadAgenticQueryRequest,
}));

vi.mock('@/lib/agentic/agent-request-controls', () => ({
  verifyAgenticRequestAccess: vi.fn(() => ({ ok: true })),
}));

vi.mock('@/lib/agentic/merchant-context', () => ({
  resolveAgenticMerchantContext: vi.fn(async () => ({
    agent_user_agent_allowlist: [],
    agent_user_agent_denylist: [],
    agentic_checkout_enabled: true,
    business_name: 'Ogabassey',
    custom_domain: undefined,
    id: 'merchant-1',
    pay_on_delivery_enabled: false,
    paystack_subaccount_code: null,
    slug: 'ogabassey',
  })),
}));

vi.mock('@/lib/agentic/scoped-supabase', () => ({
  createAgenticScopedSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({})),
}));

let query: {
  eq: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  lte: ReturnType<typeof vi.fn>;
  or: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
};

function mockJunctionOnlyProduct() {
  const rows = [
    {
      id: 'product-1',
      name: 'Laptop',
      price: 100,
      product_categories: [{ categories: { slug: 'laptops' } }],
      slug: 'thin-laptop',
      status: 'active',
    },
  ];
  query = {
    eq: vi.fn(() => query),
    gte: vi.fn(() => query),
    limit: vi.fn(async () => ({ data: rows, error: null })),
    lte: vi.fn(() => query),
    order: vi.fn(() => query),
    or: vi.fn(() => query),
    range: vi.fn(async (from: number, to: number) => ({
      data: rows.slice(from, to + 1),
      error: null,
    })),
  };
  vi.mocked(createAgenticScopedSupabaseClient).mockReturnValue({
    from: vi.fn(() => ({ select: vi.fn(() => query) })),
  } as never);
}

describe('POST /api/agentic/catalog/search junction categories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    mockJunctionOnlyProduct();
  });

  it('keeps the canonical category path for a junction-only product', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/agentic/catalog/search', {
        body: JSON.stringify({ filters: { category: 'laptops' } }),
        method: 'POST',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.products[0].url).toBe(
      'https://ogabassey.usebaci.com/laptops/thin-laptop'
    );
  });
});
