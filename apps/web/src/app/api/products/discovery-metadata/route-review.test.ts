import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  merchant: vi.fn(),
  permission: vi.fn(),
  rpc: vi.fn(),
  result: { data: [] as unknown[], error: null as unknown },
}));
vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: mocks.user }, rpc: mocks.rpc }),
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: mocks.merchant,
  toUserAccess: (v: unknown) => v,
}));
vi.mock('@/lib/api-permissions', () => ({ hasPermission: mocks.permission }));

import { GET } from './route';

const request = (suffix = '') =>
  new NextRequest(
    `https://ogabassey.com/api/products/discovery-metadata${suffix}`
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.result = { data: [], error: null };
  mocks.user.mockResolvedValue({ data: { user: { id: 'user' } }, error: null });
  mocks.merchant.mockResolvedValue({ merchantId: 'merchant' });
  mocks.permission.mockReturnValue(true);
  mocks.rpc.mockReturnValue({ select: async () => mocks.result });
});
it('authenticates and authorizes product editing before source reads', async () => {
  mocks.user.mockResolvedValueOnce({ data: { user: null }, error: null });
  expect((await GET(request())).status).toBe(401);
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.permission.mockReturnValueOnce(false);
  expect((await GET(request())).status).toBe(403);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('returns an opaque database revision unchanged even if JSON numbers round in JavaScript', async () => {
  const cursor = '11111111-1111-4111-8111-111111111111';
  const revision = 'b'.repeat(64);
  const metadata = JSON.parse('{"serial":9007199254740993}');
  expect(metadata.serial).toBe(9007199254740992);
  mocks.result.data = Array.from({ length: 21 }, (_, i) => ({
    product: {
      id: `11111111-1111-4111-8111-${String(i + 1).padStart(12, '0')}`,
      name: 'Phone',
      category: 'Smartphones',
      metadata,
      discovery_metadata: null,
      specifications: [],
      mpn: null,
      color: null,
    },
    revision,
  }));
  const response = await GET(request(`?cursor=${cursor}`));
  const body = await response.json();
  expect(mocks.rpc).toHaveBeenCalledWith(
    'get_product_discovery_research_page',
    { p_merchant_id: 'merchant', p_cursor: cursor }
  );
  expect(body.products).toHaveLength(20);
  expect(body.nextCursor).toBe('11111111-1111-4111-8111-000000000020');
  expect(body.products[0]).toMatchObject({
    draft: { product_type: 'phone' },
    currentMetadata: null,
    expectedRevision: revision,
  });
  expect(body.products[0]).not.toHaveProperty('expectedSource');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
});
it('rejects invalid query fields before merchant lookup and sanitizes database failures', async () => {
  expect((await GET(request('?cursor=bad'))).status).toBe(400);
  expect((await GET(request('?tracking=unknown'))).status).toBe(400);
  expect(mocks.merchant).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.result.error = { message: 'private database error' };
  const response = await GET(request());
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('private database');
});
it('authorizes explicit merchant selection independently and uses a null first-page cursor', async () => {
  const merchantId = '11111111-1111-4111-8111-111111111111';
  expect((await GET(request(`?merchantId=${merchantId}`))).status).toBe(200);
  expect(mocks.merchant).toHaveBeenCalledWith(expect.anything(), 'user', {
    requestedMerchantId: merchantId,
  });
  expect(mocks.rpc).toHaveBeenCalledWith(
    'get_product_discovery_research_page',
    { p_merchant_id: 'merchant', p_cursor: null }
  );
  mocks.merchant.mockResolvedValueOnce(null);
  mocks.rpc.mockClear();
  expect((await GET(request(`?merchantId=${merchantId}`))).status).toBe(404);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it('rejects malformed RPC data without leaking source values', async () => {
  mocks.result.data = [
    { product: { id: 'bad', name: 'private source' }, revision: 'invalid' },
  ];
  const response = await GET(request());
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('private source');
});
